import "dotenv/config";
import { randomUUID } from "node:crypto";
import { pool } from "../src/db";
import { enforceApprovalLimit } from "../src/approval-limits";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectLimitError(action: () => Promise<void>, code: string) {
  try {
    await action();
  } catch (error) {
    assert((error as { errorCode?: string }).errorCode === code, `Expected ${code}.`);
    return;
  }
  throw new Error(`Expected ${code}, but the action was allowed.`);
}

let stage = "connect";

async function main() {
  if (process.env.APPROVAL_LIMIT_VERIFY_ALLOW_DISPOSABLE_DB !== "1") {
    throw new Error("Set APPROVAL_LIMIT_VERIFY_ALLOW_DISPOSABLE_DB=1 only for a disposable PostgreSQL database.");
  }
  const client = await pool.connect();
  try {
    const server = await client.query<{ port: number }>("SELECT current_setting('port')::int AS port");
    const expectedPort = Number(process.env.APPROVAL_LIMIT_VERIFY_PORT ?? 55432);
    assert(server.rows[0].port === expectedPort, `Refusing to verify against port ${server.rows[0].port}; expected disposable port ${expectedPort}.`);

    await client.query("BEGIN");
    const companyId = randomUUID(), ownerId = randomUUID(), staffId = randomUUID();
    const ownerRoleId = randomUUID(), managerRoleId = randomUUID(), secondRoleId = randomUUID();
    const permission = await client.query<{ id: string }>("SELECT id FROM permissions WHERE code='sales.approve'");
    assert(permission.rowCount === 1, "The sales.approve permission is missing.");
    const permissionId = permission.rows[0].id;

    await client.query("INSERT INTO companies(id,name) VALUES($1,'Approval limit verifier')", [companyId]);
    await client.query("INSERT INTO users(id,company_id,email,full_name,password_hash) VALUES($1,$3,'owner@example.invalid','Verifier Owner','unused'),($2,$3,'staff@example.invalid','Verifier Staff','unused')", [ownerId, staffId, companyId]);
    await client.query("INSERT INTO roles(id,company_id,code,name,system_role) VALUES($1,$3,'owner','Owner',true),($2,$3,'manager','Manager',true),($4,$3,'extra','Extra role',false)", [ownerRoleId, managerRoleId, companyId, secondRoleId]);
    await client.query("INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$3),($2,$3)", [managerRoleId, secondRoleId, permissionId]);
    await client.query("INSERT INTO user_roles(company_id,user_id,role_id) VALUES($1,$2,$3),($1,$2,$4),($1,$5,$6)", [companyId, staffId, managerRoleId, secondRoleId, ownerId, ownerRoleId]);

    const args = { companyId, userId: staffId, permissionCode: "sales.approve" };
    stage = "missing limit blocks";
    await expectLimitError(() => enforceApprovalLimit(client, { ...args, amount: 1 }), "APPROVAL_LIMIT_NOT_CONFIGURED");

    stage = "configured exact limit passes";
    await client.query("INSERT INTO role_approval_limits(company_id,role_id,permission_code,max_amount,updated_by) VALUES($1,$2,'sales.approve',1000,$3)", [companyId, managerRoleId, ownerId]);
    await enforceApprovalLimit(client, { ...args, amount: 1000 });
    await expectLimitError(() => enforceApprovalLimit(client, { ...args, amount: 1000.01 }), "APPROVAL_LIMIT_EXCEEDED");

    stage = "zero limit denies positive amounts";
    await client.query("UPDATE role_approval_limits SET max_amount=0 WHERE company_id=$1 AND role_id=$2 AND permission_code='sales.approve'", [companyId, managerRoleId]);
    await enforceApprovalLimit(client, { ...args, amount: 0 });
    await expectLimitError(() => enforceApprovalLimit(client, { ...args, amount: 0.01 }), "APPROVAL_LIMIT_EXCEEDED");

    stage = "highest assigned role limit wins";
    await client.query("INSERT INTO role_approval_limits(company_id,role_id,permission_code,max_amount,updated_by) VALUES($1,$2,'sales.approve',5000,$3)", [companyId, secondRoleId, ownerId]);
    const assignedLimits=await client.query("SELECT r.code,l.max_amount::text FROM user_roles ur JOIN roles r ON r.company_id=ur.company_id AND r.id=ur.role_id JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id LEFT JOIN role_approval_limits l ON l.company_id=ur.company_id AND l.role_id=r.id AND l.permission_code=p.code WHERE ur.company_id=$1 AND ur.user_id=$2 AND p.code='sales.approve' ORDER BY r.code",[companyId,staffId]);
    assert(assignedLimits.rows.some(row=>row.code==="manager"&&row.max_amount==="0.00")&&assignedLimits.rows.some(row=>row.code==="extra"&&row.max_amount==="5000.00"),`The test user's assigned roles did not retain both configured limits: ${JSON.stringify(assignedLimits.rows)}`);
    await enforceApprovalLimit(client, { ...args, amount: 5000 });
    await expectLimitError(() => enforceApprovalLimit(client, { ...args, amount: 5000.01 }), "APPROVAL_LIMIT_EXCEEDED");

    stage = "Owner bypass";
    await enforceApprovalLimit(client, { companyId, userId: ownerId, permissionCode: "sales.approve", amount: 999999999999 });
    await client.query("ROLLBACK");
    console.log(JSON.stringify({ check: "role-approval-limits", migrationBackedTable: true, missingLimitBlocked: true, exactLimitAllowed: true, overLimitBlocked: true, zeroLimitBlocksPositiveAmount: true, highestAssignedRoleLimitWins: true, ownerUnrestricted: true, temporaryRecordsRolledBack: true }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
    console.error(`Role approval limit verification failed during ${stage}: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
