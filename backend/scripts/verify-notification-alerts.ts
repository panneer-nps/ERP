import "dotenv/config";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "../src/db";
import { assertDisposableVerificationTarget } from "./verification-target";

async function main() {
  assertDisposableVerificationTarget();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const company = await client.query<{ id: string }>("INSERT INTO companies(name) VALUES('Notification verifier') RETURNING id");
    const companyId = company.rows[0].id;
    const user = await client.query<{ id: string }>("INSERT INTO users(company_id,email,full_name,password_hash) VALUES($1,'alerts@example.invalid','Alert Owner','test-only') RETURNING id", [companyId]);
    const role = await client.query<{ id: string }>("INSERT INTO roles(company_id,code,name,system_role) VALUES($1,'owner','Owner',true) RETURNING id", [companyId]);
    await client.query("INSERT INTO user_roles(company_id,user_id,role_id) VALUES($1,$2,$3)", [companyId, user.rows[0].id, role.rows[0].id]);
    await client.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code IN ('expenses.approve','payroll.approve')", [role.rows[0].id]);
    const manager = await client.query<{ id: string }>("INSERT INTO users(company_id,email,full_name,password_hash) VALUES($1,'manager@example.invalid','Alert Manager','test-only') RETURNING id", [companyId]);
    const managerRole = await client.query<{ id: string }>("INSERT INTO roles(company_id,code,name,system_role) VALUES($1,'manager','Manager',true) RETURNING id", [companyId]);
    await client.query("INSERT INTO user_roles(company_id,user_id,role_id) VALUES($1,$2,$3)", [companyId, manager.rows[0].id, managerRole.rows[0].id]);
    const cashier = await client.query<{ id: string }>("INSERT INTO users(company_id,email,full_name,password_hash) VALUES($1,'cashier@example.invalid','Alert Cashier','test-only') RETURNING id", [companyId]);
    const cashierRole = await client.query<{ id: string }>("INSERT INTO roles(company_id,code,name,system_role) VALUES($1,'cashier','Cashier',true) RETURNING id", [companyId]);
    await client.query("INSERT INTO user_roles(company_id,user_id,role_id) VALUES($1,$2,$3)", [companyId, cashier.rows[0].id, cashierRole.rows[0].id]);
    await client.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=ANY($2::text[])", [managerRole.rows[0].id, ["expenses.approve", "employees.advance.approve", "sales.approve", "cash.close.approve", "stocktake.approve", "loading.approve", "accounting.journal.approve", "payroll.approve"]]);
    const branch = await client.query<{ id: string }>("INSERT INTO branches(company_id,code,name) VALUES($1,'ALERT','Notification test branch') RETURNING id", [companyId]);
    await client.query("INSERT INTO user_branches(company_id,user_id,branch_id) VALUES($1,$2,$3),($1,$4,$3)", [companyId, manager.rows[0].id, branch.rows[0].id, cashier.rows[0].id]);
    const otherBranch = await client.query<{ id: string }>("INSERT INTO branches(company_id,code,name) VALUES($1,'OTHER','Other test branch') RETURNING id", [companyId]);
    const otherManager = await client.query<{ id: string }>("INSERT INTO users(company_id,email,full_name,password_hash) VALUES($1,'other-manager@example.invalid','Other Branch Manager','test-only') RETURNING id", [companyId]);
    await client.query("INSERT INTO user_roles(company_id,user_id,role_id) VALUES($1,$2,$3)", [companyId, otherManager.rows[0].id, managerRole.rows[0].id]);
    await client.query("INSERT INTO user_branches(company_id,user_id,branch_id) VALUES($1,$2,$3)", [companyId, otherManager.rows[0].id, otherBranch.rows[0].id]);
    await client.query("INSERT INTO company_settings(company_id,key,value) VALUES($1,'notification_preferences',$2::jsonb)", [companyId, JSON.stringify({ sales_invoice: false, loading_completed: false })]);
    for (const filename of ["093_actionable_owner_alerts.sql", "094_broker_commission_notifications.sql", "095_approver_request_notifications.sql"]) {
      const migration = await readFile(join(__dirname, "..", "migrations", filename), "utf8");
      const functionStart = migration.search(/CREATE(?: OR REPLACE)? FUNCTION/i);
      assert.notEqual(functionStart, -1, `${filename} contains its notification trigger function`);
      const triggerExists = filename === "095_approver_request_notifications.sql"
        ? await client.query("SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='zz_approval_request_notifications' AND NOT tgisinternal) AS exists")
        : null;
      await client.query(filename === "095_approver_request_notifications.sql" && !triggerExists?.rows[0].exists ? migration : migration.slice(0, functionStart));
    }
    const migratedPreferences = await client.query<{ value: Record<string, boolean> }>("SELECT value FROM company_settings WHERE company_id=$1 AND key='notification_preferences'", [companyId]);
    assert.deepEqual(migratedPreferences.rows[0].value, { sales_invoice: false, loading_completed: false, employee_advance: true, broker_commission_pending: true, approval_request: true }, "migrations add alert defaults without overwriting existing Owner preferences");

    async function audit(action: string, entityType: string, entityId: string, after: object, branchId: string | null = null, actorId = user.rows[0].id) {
      const result = await client.query<{ id: string }>("INSERT INTO audit_logs(company_id,branch_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$6,$2,$3,$4,$5,$7::jsonb) RETURNING id", [companyId, actorId, action, entityType, entityId, branchId, JSON.stringify(after)]);
      return result.rows[0].id;
    }
    async function event(sourceAuditId: string, recipientId = user.rows[0].id) {
      return client.query<{ event_type: string; title_ta: string; body_en: string; href: string }>("SELECT event_type,title_ta,body_en,href FROM user_notifications WHERE company_id=$1 AND source_audit_id=$2 AND recipient_user_id=$3", [companyId, sourceAuditId, recipientId]);
    }

    const approverRequestSource = await audit("expense.submit_for_approval", "expense", "expense-1", { number: "EXP-00001", amount: 2500 }, branch.rows[0].id);
    const approverAlert = await event(approverRequestSource, manager.rows[0].id);
    assert.equal(approverAlert.rowCount, 1, "a branch-assigned Manager with expenses.approve receives a bilingual queue notification");
    assert.equal(approverAlert.rows[0].event_type, "approval_request");
    assert.match(approverAlert.rows[0].title_ta, /ஒப்புதல்/);
    assert.match(approverAlert.rows[0].body_en, /EXP-00001.*2500/);
    assert.equal(approverAlert.rows[0].href, "/approvals");
    assert.equal((await event(approverRequestSource)).rows[0]?.event_type, "expense_approval", "the Owner's specific expense alert is retained when the approver alert also targets them");
    assert.equal((await event(approverRequestSource, cashier.rows[0].id)).rowCount, 0, "a same-branch Cashier without the approval permission is not notified");
    assert.equal((await event(approverRequestSource, otherManager.rows[0].id)).rowCount, 0, "an authorized Manager assigned only to another branch is not notified");
    const selfRequest = await audit("expense.submit_for_approval", "expense", "expense-self", { number: "EXP-SELF", amount: 30 }, branch.rows[0].id, manager.rows[0].id);
    assert.equal((await event(selfRequest, manager.rows[0].id)).rowCount, 0, "the requester is not notified as their own approver");

    const payrollSource = await audit("payroll.run.create", "salary_run", "salary-1", { runNumber: "PAY-00001", employeeCount: 2 }, null, manager.rows[0].id);
    const ownerPayrollAlert = await event(payrollSource);
    assert.equal(ownerPayrollAlert.rows[0]?.event_type, "approval_request", "an Owner receives approval requests that previously had no owner alert");
    assert.equal(ownerPayrollAlert.rows[0]?.href, "/approvals");

    const advanceSource = await audit("employee.advance.submit_for_approval", "employee_advance", "advance-1", { advanceNumber: "ADV-00001", amount: 2500, status: "pending_approval" });
    const advance = await event(advanceSource);
    assert.equal(advance.rowCount, 1, "pending employee advance notifies the Owner by default");
    assert.equal(advance.rows[0].event_type, "employee_advance");
    assert.match(advance.rows[0].title_ta, /ஒப்புதல்/);
    assert.match(advance.rows[0].body_en, /ADV-00001.*2500/);
    assert.equal(advance.rows[0].href, "/approvals");
    assert.equal((await event(advanceSource, manager.rows[0].id)).rows[0]?.event_type, "approval_request", "an eligible Manager receives the employee-advance request too");

    const salesSource = await audit("sales.order.create", "sales_order", "sales-1", { orderNumber: "SO-00001", total: 5000, status: "pending_approval" }, branch.rows[0].id);
    assert.equal((await event(salesSource, manager.rows[0].id)).rows[0]?.event_type, "approval_request", "credit-sale approval is routed to sales approvers");
    const ordinarySalesSource = await audit("sales.order.create", "sales_order", "sales-2", { orderNumber: "SO-00002", total: 100, status: "open" }, branch.rows[0].id);
    assert.equal((await event(ordinarySalesSource, manager.rows[0].id)).rowCount, 0, "ordinary open sales orders do not trigger approval alerts");

    const cashSource = await audit("cash.close.record", "cash_closing", "cash-1", { closingNumber: "CC-00001", difference: -250, status: "pending" }, branch.rows[0].id);
    assert.equal((await event(cashSource, manager.rows[0].id)).rows[0]?.event_type, "approval_request", "pending cash variances are routed to cash approvers");
    const stocktakeSource = await audit("stocktake.submit", "stocktake", "stocktake-1", { status: "pending" }, branch.rows[0].id);
    assert.equal((await event(stocktakeSource, manager.rows[0].id)).rows[0]?.event_type, "approval_request", "submitted stock counts are routed to stocktake approvers");
    const loadingSource = await audit("loading.verify", "loading_session", "loading-approval-1", { status: "mismatch", plannedQuantity: 30, loadedQuantity: 28, verifiedQuantity: 27 }, branch.rows[0].id);
    assert.equal((await event(loadingSource, manager.rows[0].id)).rows[0]?.event_type, "approval_request", "loading mismatches are routed to loading approvers");
    const journalSource = await audit("accounting.manual_journal.request", "manual_journal_request", "journal-1", { requestNumber: "MJR-00001" }, branch.rows[0].id);
    assert.equal((await event(journalSource, manager.rows[0].id)).rows[0]?.event_type, "approval_request", "manual journal requests are routed to journal approvers");

    const commissionSource = await audit("broker.commission.accrue", "broker_commission_accrual", "commission-1", { commissionId: "commission-1", amount: 875.5 });
    const commission = await event(commissionSource);
    assert.equal(commission.rowCount, 1, "a broker commission accrual notifies the Owner by default");
    assert.equal(commission.rows[0].event_type, "broker_commission_pending");
    assert.match(commission.rows[0].title_ta, /தரகர்/);
    assert.match(commission.rows[0].body_en, /875\.5/);
    assert.equal(commission.rows[0].href, "/brokers");
    const commissionRecipients = await client.query<{ recipients: number }>("SELECT count(*)::int AS recipients FROM user_notifications WHERE company_id=$1 AND source_audit_id=$2", [companyId, commissionSource]);
    assert.equal(commissionRecipients.rows[0].recipients, 1, "the commission alert is delivered only to the company Owner, not the Manager");

    const mismatchSource = await audit("loading.verify", "loading_session", "loading-1", { status: "mismatch", plannedQuantity: 100, loadedQuantity: 98, verifiedQuantity: 97 });
    const mismatch = await event(mismatchSource);
    assert.equal(mismatch.rowCount, 1, "loading mismatch notifies at verification, before approval");
    assert.equal(mismatch.rows[0].event_type, "loading_mismatch");
    assert.match(mismatch.rows[0].body_en, /Planned 100, loaded 98, verified 97/);

    const verifiedSource = await audit("loading.verify", "loading_session", "loading-2", { status: "verified", plannedQuantity: 100, loadedQuantity: 100, verifiedQuantity: 100 });
    assert.equal((await event(verifiedSource)).rows[0]?.event_type, "loading_verified", "matching verification retains the success alert");

    const approvalSource = await audit("loading.mismatch.approve", "loading_session", "loading-1", { approved: true });
    assert.equal((await event(approvalSource)).rowCount, 0, "approval does not create a misleading second mismatch alert");

    await client.query("UPDATE company_settings SET value=$2::jsonb WHERE company_id=$1 AND key='notification_preferences'", [companyId, JSON.stringify({ employee_advance: false, broker_commission_pending: false, loading_mismatch: false, approval_request: false })]);
    const suppressedApproval = await audit("expense.submit_for_approval", "expense", "expense-suppressed", { number: "EXP-SUPPRESSED", amount: 75 }, branch.rows[0].id, cashier.rows[0].id);
    const suppressedAdvance = await audit("employee.advance.submit_for_approval", "employee_advance", "advance-2", { advanceNumber: "ADV-00002", amount: 500, status: "pending_approval" });
    const suppressedCommission = await audit("broker.commission.accrue", "broker_commission_accrual", "commission-2", { commissionId: "commission-2", amount: 200 });
    const suppressedMismatch = await audit("loading.verify", "loading_session", "loading-3", { status: "mismatch", plannedQuantity: 10, loadedQuantity: 8, verifiedQuantity: 8 });
    assert.equal((await event(suppressedAdvance)).rowCount, 0, "Owner can suppress employee advance alerts");
    assert.equal((await event(suppressedApproval, manager.rows[0].id)).rowCount, 0, "Owner preference suppresses approver queue alerts");
    assert.equal((await event(suppressedCommission)).rowCount, 0, "Owner can suppress payable broker commission alerts");
    assert.equal((await event(suppressedMismatch)).rowCount, 0, "Owner can suppress loading mismatch alerts");

    console.log("All eight approval event types, permission and branch isolation, requester exclusion, preference suppression, and Owner alert compatibility passed.");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Notification verifier failed.");
  process.exitCode = 1;
});
