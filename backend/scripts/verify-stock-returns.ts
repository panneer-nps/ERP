import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { assertDisposableVerificationTarget, assertLocalVerificationApi } from "./verification-target";

const api = process.env.ERP_VERIFY_API_URL ?? "http://127.0.0.1:4408";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`${api}${path}`, options);
  const body = response.status === 204 ? null : await response.json();
  return { response, body };
}

async function main() {
  assertDisposableVerificationTarget();
  assertLocalVerificationApi(api);
  const initial = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM companies");
  const migrations = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM schema_migrations");
  if (Number(initial.rows[0].count) !== 0) throw new Error("Refusing to run: the verification database must contain no companies.");
  if (Number(migrations.rows[0].count) < 91) throw new Error("Expected all 91 ERP migrations before running this verifier.");

  const suffix = randomUUID();
  const password = `Verify-${suffix}-ERP`;
  const email = `verify-owner-${suffix}@example.invalid`;
  const setup = await request("/api/auth/setup", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyName: "Stock Return Verification", ownerName: "Verification Owner", email, password }),
  });
  if (setup.response.status !== 201) throw new Error(`Owner setup failed with HTTP ${setup.response.status}.`);
  const login = await request("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }),
  });
  if (!login.response.ok || !login.body?.token) throw new Error(`Owner login failed with HTTP ${login.response.status}.`);
  const ownerToken = login.body.token as string;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const roleResult = await request("/api/admin/access/roles", { headers: auth(ownerToken) });
  if (!roleResult.response.ok) throw new Error(`Owner could not load role presets: HTTP ${roleResult.response.status}.`);
  const roles = roleResult.body.roles as Array<{ id: string; code: string; permissionCodes: string[] }>;
  const manager = roles.find((role) => role.code === "manager");
  const cashier = roles.find((role) => role.code === "cashier");
  if (!manager?.permissionCodes.includes("stock.return.create")) throw new Error("The Manager preset is missing stock.return.create.");
  if (cashier?.permissionCodes.includes("stock.return.create")) throw new Error("The Cashier preset unexpectedly has stock.return.create.");

  const managerEmail = `verify-manager-${suffix}@example.invalid`;
  const cashierEmail = `verify-cashier-${suffix}@example.invalid`;
  const managerCreated = await request("/api/admin/access/users", {
    method: "POST", headers: { ...auth(ownerToken), "Content-Type": "application/json" },
    body: JSON.stringify({ fullName: "Verification Manager", email: managerEmail, password: `Manager-${suffix}-ERP`, roleIds: [manager.id], branchIds: [] }),
  });
  const cashierCreated = await request("/api/admin/access/users", {
    method: "POST", headers: { ...auth(ownerToken), "Content-Type": "application/json" },
    body: JSON.stringify({ fullName: "Verification Cashier", email: cashierEmail, password: `Cashier-${suffix}-ERP`, roleIds: [cashier!.id], branchIds: [] }),
  });
  if (managerCreated.response.status !== 201 || cashierCreated.response.status !== 201) throw new Error("Could not create Manager and Cashier verification accounts.");

  const company = await pool.query<{ id: string }>("SELECT id FROM companies LIMIT 1");
  const customer = await pool.query<{ id: string }>(
    "INSERT INTO business_partners(company_id,partner_type,name,code) VALUES($1,'customer','Return Test Customer',$2) RETURNING id", [company.rows[0].id, `VERIFY-${suffix.slice(0, 8)}`]);
  const product = await pool.query<{ id: string }>("INSERT INTO products(company_id,name,code,unit) VALUES($1,'Return Test Brick',$2,'pieces') RETURNING id", [company.rows[0].id, `VERIFY-${suffix.slice(0, 8)}`]);
  await pool.query("INSERT INTO product_units(company_id,product_id,code,label,conversion_to_base,is_base,created_by) VALUES($1,$2,'CARTON','Carton',10,false,$3)", [company.rows[0].id, product.rows[0].id, (managerCreated.body as { id: string }).id]);
  const location = await pool.query<{ id: string }>("SELECT id FROM stock_locations WHERE company_id=$1 AND code='MAIN'", [company.rows[0].id]);

  const managerLogin = await request("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: managerEmail, password: `Manager-${suffix}-ERP` }),
  });
  const cashierLogin = await request("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: cashierEmail, password: `Cashier-${suffix}-ERP` }),
  });
  if (!managerLogin.response.ok || !cashierLogin.response.ok) throw new Error("Manager/Cashier login failed.");

  const returnBody = {
    customerId: customer.rows[0].id, locationId: location.rows[0].id,
    returnDate: new Date().toISOString().slice(0, 10), reference: "TEST-NON-INVOICE-1",
    reason: "Integration verification of returned saleable stock.",
    lines: [{ productId: product.rows[0].id, quality: "good", quantity: 2, unitCode: "CARTON", unitCost: 100 }],
  };
  const idempotencyKey = `verify-stock-return-${suffix}`;
  const post = (token: string, key = idempotencyKey, body = returnBody) => request("/api/stock/returns", {
    method: "POST", headers: { ...auth(token), "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body),
  });
  const first = await post(managerLogin.body.token as string);
  const replay = await post(managerLogin.body.token as string);
  const altered = await post(managerLogin.body.token as string, idempotencyKey, { ...returnBody, reason: "A different reason for the same key." });
  const cashierAttempt = await post(cashierLogin.body.token as string, `verify-cashier-denied-${suffix}`);
  if (first.response.status !== 201 || replay.response.status !== 201 || altered.response.status !== 409 || cashierAttempt.response.status !== 403) {
    throw new Error(`Unexpected stock return statuses: first=${first.response.status}, replay=${replay.response.status}, changedKey=${altered.response.status}, cashier=${cashierAttempt.response.status}.`);
  }
  if (first.body.id !== replay.body.id || first.body.returnNumber !== replay.body.returnNumber || Number(first.body.totalCost) !== 200) {
    throw new Error("The return response did not preserve the expected idempotent document and converted inventory cost.");
  }

  const id = first.body.id as string;
  const persisted = await pool.query<{
    return_count: number; line_count: number; movement_count: number; layer_count: number;
    quantity: string; inventory_cost: string; layer_quantity: string; layer_unit_cost: string;
    journal_debit: string; journal_credit: string; audit_count: number;
  }>(`
    SELECT (SELECT count(*)::int FROM stock_returns WHERE company_id=$1 AND id=$2) AS return_count,
      (SELECT count(*)::int FROM stock_return_lines WHERE company_id=$1 AND stock_return_id=$2) AS line_count,
      (SELECT count(*)::int FROM stock_movements WHERE company_id=$1 AND reference_type='stock_return' AND reference_id=$2) AS movement_count,
      (SELECT count(*)::int FROM inventory_cost_layers WHERE company_id=$1 AND source_type='customer_return' AND source_id=$2) AS layer_count,
      (SELECT quantity::text FROM stock_return_lines WHERE company_id=$1 AND stock_return_id=$2) AS quantity,
      (SELECT inventory_cost::text FROM stock_movements WHERE company_id=$1 AND reference_type='stock_return' AND reference_id=$2) AS inventory_cost,
      (SELECT received_quantity::text FROM inventory_cost_layers WHERE company_id=$1 AND source_type='customer_return' AND source_id=$2) AS layer_quantity,
      (SELECT unit_cost::text FROM inventory_cost_layers WHERE company_id=$1 AND source_type='customer_return' AND source_id=$2) AS layer_unit_cost,
      (SELECT sum(jl.debit)::text FROM journal_entry_lines jl JOIN journal_entries je ON je.company_id=jl.company_id AND je.id=jl.journal_entry_id WHERE je.company_id=$1 AND je.source_type='stock_return' AND je.source_id=$2) AS journal_debit,
      (SELECT sum(jl.credit)::text FROM journal_entry_lines jl JOIN journal_entries je ON je.company_id=jl.company_id AND je.id=jl.journal_entry_id WHERE je.company_id=$1 AND je.source_type='stock_return' AND je.source_id=$2) AS journal_credit,
      (SELECT count(*)::int FROM audit_logs WHERE company_id=$1 AND entity_type='stock_return' AND entity_id=$2::text AND action='stock.return.post') AS audit_count`,
  [company.rows[0].id, id]);
  const row = persisted.rows[0];
  if (row.return_count !== 1 || row.line_count !== 1 || row.movement_count !== 1 || row.layer_count !== 1 || Number(row.quantity) !== 20 || Number(row.inventory_cost) !== 200 || Number(row.layer_quantity) !== 20 || Number(row.layer_unit_cost) !== 10 || Number(row.journal_debit) !== 200 || Number(row.journal_credit) !== 200 || row.audit_count !== 1) {
    throw new Error(`Persisted return verification failed: ${JSON.stringify(row)}.`);
  }
  const list = await request("/api/stock/returns", { headers: auth(managerLogin.body.token as string) });
  if (!list.response.ok || !list.body.returns.some((item: { id: string }) => item.id === id)) throw new Error("The Manager could not read the posted return in history.");

  const owner = await pool.query<{ id: string }>("SELECT id FROM users WHERE company_id=$1 AND email=$2", [company.rows[0].id, email]);
  const reconciliation = await pool.query<{ id: string }>(
    "INSERT INTO inventory_valuation_reconciliations(company_id,reconciliation_number,location_id,branch_id,effective_date,reason,total_value,created_by) VALUES($1,$2,$3,NULL,current_date,'Verification fixture for valuation history display',25,$4) RETURNING id",
    [company.rows[0].id, `VERIFY-IVR-${suffix.slice(0, 8)}`, location.rows[0].id, owner.rows[0].id]);
  await pool.query(
    "INSERT INTO inventory_valuation_reconciliation_lines(company_id,reconciliation_id,product_id,quality,quantity,unit_cost,total_value) VALUES($1,$2,$3,'second',5,5,25)",
    [company.rows[0].id, reconciliation.rows[0].id, product.rows[0].id]);
  const valuationHistory = await request("/api/inventory/valuation/reconciliations", { headers: auth(ownerToken) });
  const historyRecord = valuationHistory.body?.reconciliations?.find((item: { id: string }) => item.id === reconciliation.rows[0].id);
  const cashierValuationHistory = await request("/api/inventory/valuation/reconciliations", { headers: auth(cashierLogin.body.token as string) });
  if (!valuationHistory.response.ok || !historyRecord || historyRecord.locationName !== "Main yard" || historyRecord.createdBy !== "Verification Owner" || historyRecord.lines?.length !== 1 || historyRecord.lines[0].productName !== "Return Test Brick" || Number(historyRecord.lines[0].quantity) !== 5 || Number(historyRecord.lines[0].unitCost) !== 5 || Number(historyRecord.lines[0].totalValue) !== 25) {
    throw new Error(`Inventory valuation history response was incomplete: HTTP ${valuationHistory.response.status}.`);
  }
  if (cashierValuationHistory.response.status !== 403) throw new Error("Cashier could unexpectedly read inventory valuation history.");

  console.log(JSON.stringify({ check: "customer-stock-return-integration", migrations: Number(migrations.rows[0].count), ownerSetup: setup.response.status, ownerLogin: login.response.status, managerLogin: managerLogin.response.status, cashierLogin: cashierLogin.response.status, managerCanCreateReturn: true, cashierDenied: cashierAttempt.response.status === 403, createStatus: first.response.status, replaySameDocument: first.body.id === replay.body.id, reusedKeyWithDifferentBody: altered.response.status, enteredCartons: 2, baseQuantity: Number(row.quantity), baseUnitCost: Number(row.layer_unit_cost), inventoryCost: Number(row.inventory_cost), journalBalanced: Number(row.journal_debit) === Number(row.journal_credit), duplicateRecords: false, auditCount: row.audit_count, historyRead: list.response.status, valuationHistoryRead: valuationHistory.response.status, valuationHistoryIncludesLines: historyRecord.lines.length === 1, cashierValuationHistoryDenied: cashierValuationHistory.response.status === 403 }));
}

main().catch((error: unknown) => {
  console.error("Stock return integration verification failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
}).finally(async () => { await pool.end(); });
