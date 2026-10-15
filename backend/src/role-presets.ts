import type { PoolClient } from "pg";

/** Default permissions for the built-in Accountant role in the Master PRD. */
export const ACCOUNTANT_PERMISSION_CODES = [
  "audit.view",
  "masters.view",
  "masters.create",
  "sales.view",
  "sales.create",
  "sales.post",
  "sales.return",
  "sales.credit.settle",
  "purchases.view",
  "purchases.create",
  "purchases.post",
  "purchases.return",
  "purchases.credit.apply",
  "purchases.credit.refund",
  "expenses.view",
  "expenses.create",
  "expense.submit_for_approval",
  "stock.view",
  "inventory.valuation.view",
  "attendance.view",
  "employees.view",
  "employees.advance.view",
  "brokers.commission.view",
  "brokers.commission.pay",
  "payroll.view",
  "payroll.create",
  "payroll.pay",
  "cash.close.view",
  "cash.close.record",
  "cash.opening.post",
  "bank.reconcile.view",
  "bank.reconcile.create",
  "bank.reconcile.match",
  "bank.reconcile.complete",
  "bank.opening.post",
  "partners.opening.post",
  "accounting.view",
  "accounting.accounts.view",
  "accounting.period.close.view",
  "accounting.financial-years.view",
  "accounting.journal.create",
] as const;

export const LOADING_VERIFIER_PERMISSION_CODES = ["loading.view", "loading.verify"] as const;

/** Least-privilege operational staff roles described by the Master PRD. */
export const OPERATIONAL_STAFF_ROLE_PRESETS = [
  {
    code: "sales_staff",
    name: "Sales Staff",
    permissions: ["masters.view", "sales.view", "sales.create", "sales.post"],
  },
  {
    code: "production_staff",
    name: "Production Staff",
    permissions: ["masters.view", "production.view", "production.create", "production.post", "stock.view"],
  },
  {
    code: "loading_staff",
    name: "Loading Staff",
    permissions: ["loading.view", "loading.create", "loading.edit"],
  },
  {
    code: "store_staff",
    name: "Store Staff",
    permissions: ["masters.view", "stock.view", "stock.adjust", "stock.transfer", "purchases.view", "purchases.receive"],
  },
] as const;

/** Seeded for both first-time setup/bootstrap and existing companies via migration 103. */
export async function seedOperationalStaffRoles(client: PoolClient, companyId: string): Promise<void> {
  for (const preset of OPERATIONAL_STAFF_ROLE_PRESETS) {
    const role = await client.query<{ id: string }>(
      `INSERT INTO roles(company_id,code,name,read_only,system_role)
       VALUES($1,$2,$3,false,true)
       ON CONFLICT(company_id,code) DO UPDATE
         SET name=EXCLUDED.name,read_only=false,system_role=true
         WHERE roles.system_role=true
       RETURNING id`,
      [companyId, preset.code, preset.name],
    );
    // Preserve a custom role that happens to use one of these reserved preset codes.
    if (!role.rowCount) continue;
    await client.query(
      `INSERT INTO role_permissions(role_id,permission_id)
       SELECT $1,id FROM permissions WHERE code=ANY($2::text[])
       ON CONFLICT DO NOTHING`,
      [role.rows[0].id, preset.permissions],
    );
    await client.query(
      `DELETE FROM role_permissions rp
       USING permissions p
       WHERE rp.role_id=$1 AND p.id=rp.permission_id AND NOT (p.code=ANY($2::text[]))`,
      [role.rows[0].id, preset.permissions],
    );
  }
}

/** Seeded for both first-time setup/bootstrap and existing companies via migration 102. */
export async function seedLoadingVerifierRole(client: PoolClient, companyId: string): Promise<void> {
  const role = await client.query<{ id: string }>(
    "INSERT INTO roles(company_id,code,name,read_only,system_role) VALUES($1,'loading_verifier','Loading Verifier',false,true) ON CONFLICT(company_id,code) DO UPDATE SET name='Loading Verifier',read_only=false,system_role=true WHERE roles.system_role=true RETURNING id",
    [companyId],
  );
  await client.query(
    "INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=ANY($2::text[]) ON CONFLICT DO NOTHING",
    [role.rows[0].id, LOADING_VERIFIER_PERMISSION_CODES],
  );
}
