import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { pool } from "../src/db";
import { assertDisposableVerificationTarget } from "./verification-target";

const presets = {
  sales_staff: ["masters.view", "sales.view", "sales.create", "sales.post"],
  production_staff: ["masters.view", "production.view", "production.create", "production.post", "stock.view"],
  loading_staff: ["loading.view", "loading.create", "loading.edit"],
  store_staff: ["masters.view", "stock.view", "stock.adjust", "stock.transfer", "purchases.view", "purchases.receive"],
} as const;

async function main() {
  assertDisposableVerificationTarget();
  const migration = await readFile(join(process.cwd(), "backend", "migrations", "103_operational_staff_role_presets.sql"), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const suffix = randomBytes(6).toString("hex");
    const company = await client.query<{ id: string }>("INSERT INTO companies(name) VALUES($1) RETURNING id", [`Role migration fixture ${suffix}`]);
    const companyId = company.rows[0].id;

    // Simulate a company that existed before migration 103.
    await client.query(migration);
    const readPresets = async () => client.query<{
      code: keyof typeof presets;
      system_role: boolean;
      read_only: boolean;
      permission_codes: string[];
    }>(`
      SELECT r.code,r.system_role,r.read_only,
        COALESCE(array_agg(p.code ORDER BY p.code) FILTER(WHERE p.code IS NOT NULL),'{}') AS permission_codes
      FROM roles r
      LEFT JOIN role_permissions rp ON rp.role_id=r.id
      LEFT JOIN permissions p ON p.id=rp.permission_id
      WHERE r.company_id=$1 AND r.code=ANY($2::text[])
      GROUP BY r.id ORDER BY r.code`, [companyId, Object.keys(presets)]);
    const first = await readPresets();
    assert.equal(first.rowCount, Object.keys(presets).length, "all operational staff presets should seed for an existing company");
    for (const role of first.rows) {
      assert.equal(role.system_role, true, `${role.code} should be a protected built-in role`);
      assert.equal(role.read_only, false, `${role.code} should support its operational actions`);
      assert.deepEqual(role.permission_codes, [...presets[role.code]].sort(), `${role.code} should receive only its approved permissions`);
    }

    // Reapplying the migration must keep a single role and the same permissions.
    await client.query(migration);
    const repeated = await readPresets();
    assert.deepEqual(repeated.rows, first.rows, "migration rerun should be idempotent");
    console.log(JSON.stringify({ passed: true, existingCompanySeed: true, rerunIdempotent: true, presets: repeated.rows.map(row => row.code) }));
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("Operational role migration verification failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
