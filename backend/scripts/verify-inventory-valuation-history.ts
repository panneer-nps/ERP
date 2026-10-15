import { randomBytes, randomUUID } from "node:crypto";
import { createPasswordHash } from "../src/auth";
import { pool } from "../src/db";
import { assertDisposableVerificationTarget, assertLocalVerificationApi } from "./verification-target";

const api = process.env.ERP_VERIFY_API_URL ?? "http://127.0.0.1:44137";
const suffix = randomBytes(5).toString("hex");
const email = `valuation-${suffix}@example.test`;
const password = `Verify-${randomBytes(12).toString("base64url")}-9A`;

async function request<T>(path: string, method = "GET", body?: unknown, token?: string) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  return { status: response.status, data };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  assertDisposableVerificationTarget();
  assertLocalVerificationApi(api);
  const setup = await request<{ message?: string }>("/api/auth/setup", "POST", {
    companyName: `Historical valuation verification ${suffix}`,
    ownerName: "Valuation Verification Owner",
    email,
    password,
  });
  assert(setup.status === 201, `Fresh owner setup failed (${setup.status}).`);
  const login = await request<{ token?: string }>("/api/auth/login", "POST", { email, password });
  assert(login.status === 200 && login.data.token, "Owner login failed.");
  const token = login.data.token;
  const owner = await pool.query<{ id: string; company_id: string; timezone: string }>(
    "SELECT u.id,c.id AS company_id,c.timezone FROM users u JOIN companies c ON c.id=u.company_id WHERE lower(u.email)=lower($1)", [email],
  );
  assert(owner.rowCount === 1, "Verification company was not created.");
  const { id: ownerId, company_id: companyId, timezone } = owner.rows[0];
  const dates = await pool.query<{ first: string; sale: string; today: string }>(
    "SELECT ((now() AT TIME ZONE $1)::date-3)::text AS first,((now() AT TIME ZONE $1)::date-2)::text AS sale,(now() AT TIME ZONE $1)::date::text AS today", [timezone],
  );
  const { first, sale: saleDate, today } = dates.rows[0];
  const product = await pool.query<{ id: string }>(
    "INSERT INTO products(company_id,code,name,unit) VALUES($1,$2,'Valuation test brick','pieces') RETURNING id", [companyId, `V-${suffix}`],
  );
  const location = await pool.query<{ id: string }>(
    "SELECT id FROM stock_locations WHERE company_id=$1 AND code='MAIN'", [companyId],
  );
  assert(product.rowCount === 1 && location.rowCount === 1, "Verification product or default stock location is missing.");
  const productId = product.rows[0].id, locationId = location.rows[0].id;

  const receipt = await pool.query<{ id: string }>(`INSERT INTO stock_movements
    (company_id,product_id,movement_type,quality,direction,quantity,occurred_at,actor_user_id,location_id)
    VALUES($1,$2,'opening_in','good','in',10,($3::date+time '12:00') AT TIME ZONE $4,$5,$6) RETURNING id`,
  [companyId, productId, first, timezone, ownerId, locationId]);
  const layer = await pool.query<{ id: string }>(`INSERT INTO inventory_cost_layers
    (company_id,product_id,quality,location_id,source_type,source_id,source_line_id,received_quantity,remaining_quantity,unit_cost,occurred_at)
    VALUES($1,$2,'good',$3,'opening_balance',$4,$4,10,6,12,($5::date+time '12:00') AT TIME ZONE $6) RETURNING id`,
  [companyId, productId, locationId, receipt.rows[0].id, first, timezone]);
  const saleMovement = await pool.query<{ id: string }>(`INSERT INTO stock_movements
    (company_id,product_id,movement_type,quality,direction,quantity,occurred_at,actor_user_id,location_id)
    VALUES($1,$2,'sale_out','good','out',4,($3::date+time '12:00') AT TIME ZONE $4,$5,$6) RETURNING id`,
  [companyId, productId, saleDate, timezone, ownerId, locationId]);
  await pool.query(`INSERT INTO inventory_cost_consumptions(company_id,stock_movement_id,cost_layer_id,quantity,unit_cost,extended_cost)
    VALUES($1,$2,$3,4,12,48)`, [companyId, saleMovement.rows[0].id, layer.rows[0].id]);
  await pool.query("UPDATE inventory_cost_layers SET remaining_quantity=6 WHERE company_id=$1 AND id=$2", [companyId, layer.rows[0].id]);
  await pool.query(`INSERT INTO stock_movements
    (company_id,product_id,movement_type,quality,direction,quantity,occurred_at,actor_user_id,location_id)
    VALUES($1,$2,'adjustment','good','in',3,($3::date+time '10:00') AT TIME ZONE $4,$5,$6)`,
  [companyId, productId, today, timezone, ownerId, locationId]);

  const accounts = await pool.query<{ id: string; code: string }>("SELECT id,code FROM accounts WHERE company_id=$1 AND code IN ('1110','1300','3000','5200')", [companyId]);
  const inventoryAccount = accounts.rows.find(row => row.code === "1300");
  const cashAccount = accounts.rows.find(row => row.code === "1110");
  const openingEquityAccount = accounts.rows.find(row => row.code === "3000");
  const cogsAccount = accounts.rows.find(row => row.code === "5200");
  assert(inventoryAccount && cashAccount && openingEquityAccount && cogsAccount, "Cash, inventory control, opening equity or COGS account is missing.");
  {
    const journal = await pool.query<{ id: string }>(`INSERT INTO journal_entries(company_id,entry_number,source_type,source_id,description,posted_by,effective_date)
      VALUES($1,$2,'verification',$3,'Historical valuation opening test journal',$4,$5::date) RETURNING id`,
    [companyId, `VOPEN-${suffix}`, randomUUID(), ownerId, first]);
    await pool.query(`INSERT INTO journal_entry_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
      VALUES($1,$2,1,$3,'Inventory control verification',120,0)`,
    [companyId, journal.rows[0].id, inventoryAccount.id]);
  }
  const saleJournal = await pool.query<{ id: string }>(`INSERT INTO journal_entries(company_id,entry_number,source_type,source_id,description,posted_by,effective_date)
    VALUES($1,$2,'sales_invoice_cogs',$3,'Historical valuation sale COGS',$4,$5::date) RETURNING id`,
  [companyId, `VSALE-${suffix}`, saleMovement.rows[0].id, ownerId, saleDate]);
  await pool.query(`INSERT INTO journal_entry_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
    VALUES($1,$2,1,$3,'Cost of goods sold',48,0),($1,$2,2,$4,'Inventory control',0,48)`,
  [companyId, saleJournal.rows[0].id, cogsAccount.id, inventoryAccount.id]);

  const cogs = await request<{ summary: { journalEntries: number; matchedEntries: number; unmatchedEntries: number; postedCogs: number; matchedFifoCogs: number; matchedVariance: number }; complete: boolean }>(
    `/api/inventory/valuation/history/cogs?from=${saleDate}&to=${saleDate}`, "GET", undefined, token,
  );
  assert(cogs.status === 200 && cogs.data.complete && cogs.data.summary.journalEntries === 1
    && cogs.data.summary.matchedEntries === 1 && cogs.data.summary.unmatchedEntries === 0
    && Number(cogs.data.summary.postedCogs) === 48 && Number(cogs.data.summary.matchedFifoCogs) === 48
    && Number(cogs.data.summary.matchedVariance) === 0,
  "Period COGS reconciliation did not match the ₹48 sale journal to its FIFO consumption.");

  const offsetProduct = await pool.query<{ id: string }>("INSERT INTO products(company_id,code,name,unit) VALUES($1,$2,'Offsetting variance test brick','pieces') RETURNING id", [companyId, `VO-${suffix}`]);
  const offsetCosts = [{ cost: 10, posted: 19, time: "10:00" }, { cost: 20, posted: 11, time: "11:00" }];
  const offsetLayers: string[] = [];
  for (const [index, item] of offsetCosts.entries()) {
    const receipt = await pool.query<{ id: string }>(`INSERT INTO stock_movements
      (company_id,product_id,movement_type,quality,direction,quantity,occurred_at,actor_user_id,location_id,valuation_status,inventory_cost)
      VALUES($1,$2,'opening_in','good','in',1,($3::date+($4::time - interval '1 hour')) AT TIME ZONE $5,$6,$7,'valued',$8) RETURNING id`,
    [companyId, offsetProduct.rows[0].id, saleDate, item.time, timezone, ownerId, locationId, item.cost]);
    const layer = await pool.query<{ id: string }>(`INSERT INTO inventory_cost_layers
      (company_id,product_id,quality,location_id,source_type,source_id,source_line_id,received_quantity,remaining_quantity,unit_cost,occurred_at)
      VALUES($1,$2,'good',$3,'opening_balance',$4,$4,1,1,$5,($6::date+($7::time - interval '1 hour')) AT TIME ZONE $8) RETURNING id`,
    [companyId, offsetProduct.rows[0].id, locationId, receipt.rows[0].id, item.cost, saleDate, item.time, timezone]);
    offsetLayers.push(layer.rows[0].id);
  }
  const offsetOpening = await pool.query<{ id: string }>(`INSERT INTO journal_entries(company_id,entry_number,source_type,source_id,description,posted_by,effective_date)
    VALUES($1,$2,'verification',$3,'Offset variance opening inventory',$4,$5::date) RETURNING id`,
  [companyId, `VOFFSETOPEN-${suffix}`, randomUUID(), ownerId, saleDate]);
  await pool.query(`INSERT INTO journal_entry_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
    VALUES($1,$2,1,$3,'Opening inventory',30,0),($1,$2,2,$4,'Opening equity',0,30)`,
  [companyId, offsetOpening.rows[0].id, inventoryAccount.id, openingEquityAccount.id]);
  for (const [index, item] of offsetCosts.entries()) {
    const movement = await pool.query<{ id: string }>(`INSERT INTO stock_movements
      (company_id,product_id,movement_type,quality,direction,quantity,occurred_at,actor_user_id,location_id,valuation_status,inventory_cost)
      VALUES($1,$2,'sale_out','good','out',1,($3::date+($4::time + interval '1 hour')) AT TIME ZONE $5,$6,$7,'valued',$8) RETURNING id`,
    [companyId, offsetProduct.rows[0].id, saleDate, item.time, timezone, ownerId, locationId, item.cost]);
    await pool.query("INSERT INTO inventory_cost_consumptions(company_id,stock_movement_id,cost_layer_id,quantity,unit_cost,extended_cost) VALUES($1,$2,$3,1,$4,$4)",
      [companyId, movement.rows[0].id, offsetLayers[index], item.cost]);
    await pool.query("UPDATE inventory_cost_layers SET remaining_quantity=0 WHERE company_id=$1 AND id=$2", [companyId, offsetLayers[index]]);
    const journal = await pool.query<{ id: string }>(`INSERT INTO journal_entries(company_id,entry_number,source_type,source_id,description,posted_by,effective_date)
      VALUES($1,$2,'sales_invoice_cogs',$3,'Offsetting COGS variance test',$4,$5::date) RETURNING id`,
    [companyId, `VOFFSETCOGS-${index}-${suffix}`, movement.rows[0].id, ownerId, saleDate]);
    if (item.posted > item.cost) {
      await pool.query(`INSERT INTO journal_entry_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
        VALUES($1,$2,1,$3,'Posted COGS', $4,0),($1,$2,2,$5,'FIFO inventory relief',0,$6),($1,$2,3,$7,'Balancing equity',0,$8)`,
      [companyId, journal.rows[0].id, cogsAccount.id, item.posted, inventoryAccount.id, item.cost, openingEquityAccount.id, item.posted-item.cost]);
    } else {
      await pool.query(`INSERT INTO journal_entry_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
        VALUES($1,$2,1,$3,'Posted COGS',$4,0),($1,$2,2,$5,'Balancing cash',$6,0),($1,$2,3,$7,'FIFO inventory relief',0,$8)`,
      [companyId, journal.rows[0].id, cogsAccount.id, item.posted, cashAccount.id, item.cost-item.posted, inventoryAccount.id, item.cost]);
    }
  }
  const offsetting = await request<{ summary: { journalEntries: number; unmatchedEntries: number; varianceEntries: number; postedCogs: number; matchedFifoCogs: number; matchedVariance: number; grossVariance: number }; complete: boolean }>(
    `/api/inventory/valuation/history/cogs?from=${saleDate}&to=${saleDate}`, "GET", undefined, token,
  );
  assert(offsetting.status === 200 && !offsetting.data.complete && offsetting.data.summary.journalEntries === 3
    && offsetting.data.summary.unmatchedEntries === 0 && offsetting.data.summary.varianceEntries === 2
    && Number(offsetting.data.summary.postedCogs) === 78 && Number(offsetting.data.summary.matchedFifoCogs) === 78
    && Number(offsetting.data.summary.matchedVariance) === 0 && Number(offsetting.data.summary.grossVariance) === 18,
  "Offsetting +₹9 and -₹9 COGS variances incorrectly netted to a complete reconciliation.");

  const futurePeriod = await request(`/api/inventory/valuation/history/cogs?from=${today}&to=2999-01-01`, "GET", undefined, token);
  assert(futurePeriod.status === 400, "A future COGS period was not rejected.");

  const returnId = randomUUID();
  const returnMovement = await pool.query<{ id: string }>(`INSERT INTO stock_movements
    (company_id,product_id,movement_type,quality,direction,quantity,occurred_at,actor_user_id,location_id,reference_type,reference_id,valuation_status,inventory_cost)
    VALUES($1,$2,'customer_return','good','in',1,($3::date+time '14:00') AT TIME ZONE $4,$5,$6,'sales_return',$7,'valued',12) RETURNING id`,
  [companyId, productId, today, timezone, ownerId, locationId, returnId]);
  await pool.query(`INSERT INTO inventory_cost_layers
    (company_id,product_id,quality,location_id,source_type,source_id,source_line_id,received_quantity,remaining_quantity,unit_cost,occurred_at)
    VALUES($1,$2,'good',$3,'customer_return',$4,$5,1,1,12,($6::date+time '14:00') AT TIME ZONE $7)`,
  [companyId, productId, locationId, returnId, returnMovement.rows[0].id, today, timezone]);
  const returnJournal = await pool.query<{ id: string }>(`INSERT INTO journal_entries(company_id,entry_number,source_type,source_id,description,posted_by,effective_date)
    VALUES($1,$2,'sales_return',$3,'FIFO return COGS reversal',$4,$5::date) RETURNING id`,
  [companyId, `VRETURN-${suffix}`, returnId, ownerId, today]);
  await pool.query(`INSERT INTO journal_entry_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
    VALUES($1,$2,1,$3,'Inventory restored',12,0),($1,$2,2,$4,'COGS reversed',0,12)`,
  [companyId, returnJournal.rows[0].id, inventoryAccount.id, cogsAccount.id]);
  const stockReturnId = randomUUID();
  const stockReturnMovement = await pool.query<{ id: string }>(`INSERT INTO stock_movements
    (company_id,product_id,movement_type,quality,direction,quantity,occurred_at,actor_user_id,location_id,reference_type,reference_id,valuation_status,inventory_cost)
    VALUES($1,$2,'customer_return','good','in',2,($3::date+time '15:00') AT TIME ZONE $4,$5,$6,'stock_return',$7,'valued',10) RETURNING id`,
  [companyId, productId, today, timezone, ownerId, locationId, stockReturnId]);
  await pool.query(`INSERT INTO inventory_cost_layers
    (company_id,product_id,quality,location_id,source_type,source_id,source_line_id,received_quantity,remaining_quantity,unit_cost,occurred_at)
    VALUES($1,$2,'good',$3,'customer_return',$4,$5,2,2,5,($6::date+time '15:00') AT TIME ZONE $7)`,
  [companyId, productId, locationId, stockReturnId, stockReturnMovement.rows[0].id, today, timezone]);
  const stockReturnJournal = await pool.query<{ id: string }>(`INSERT INTO journal_entries(company_id,entry_number,source_type,source_id,description,posted_by,effective_date)
    VALUES($1,$2,'stock_return',$3,'FIFO stock return cost recovery',$4,$5::date) RETURNING id`,
  [companyId, `VSTOCKRETURN-${suffix}`, stockReturnId, ownerId, today]);
  await pool.query(`INSERT INTO journal_entry_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
    VALUES($1,$2,1,$3,'Inventory returned',10,0),($1,$2,2,$4,'COGS recovered',0,10)`,
  [companyId, stockReturnJournal.rows[0].id, inventoryAccount.id, cogsAccount.id]);

  const unknownJournal = await pool.query<{ id: string }>(`INSERT INTO journal_entries(company_id,entry_number,source_type,source_id,description,posted_by,effective_date)
    VALUES($1,$2,'manual_journal',$3,'Unmatched COGS verification',$4,$5::date) RETURNING id`,
  [companyId, `VUNMATCHED-${suffix}`, randomUUID(), ownerId, today]);
  await pool.query(`INSERT INTO journal_entry_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
    VALUES($1,$2,1,$3,'Unmatched COGS verification',9,0)`, [companyId, unknownJournal.rows[0].id, cogsAccount.id]);
  const withUnknown = await request<{ rows: Array<{ sourceType: string; matched: boolean; fifoCogs: string | number | null }>; summary: { unmatchedEntries: number; postedCogs: number; matchedFifoCogs: number }; complete: boolean }>(
    `/api/inventory/valuation/history/cogs?from=${saleDate}&to=${today}`, "GET", undefined, token,
  );
  const returnCogs = withUnknown.data.rows.find(row => row.sourceType === "sales_return");
  const stockReturnCogs = withUnknown.data.rows.find(row => row.sourceType === "stock_return");
  assert(withUnknown.status === 200 && !withUnknown.data.complete && withUnknown.data.summary.unmatchedEntries === 1
    && Number(withUnknown.data.summary.postedCogs) === 65 && Number(withUnknown.data.summary.matchedFifoCogs) === 56
    && returnCogs?.matched === true && Number(returnCogs.fifoCogs) === -12
    && stockReturnCogs?.matched === true && Number(stockReturnCogs.fifoCogs) === -10,
  "The COGS reconciliation did not identify unmatched journals and both negative FIFO customer return costs.");

  const historical = await request<{ asOf: string; rows: Array<Record<string, unknown>>; summary: { inventoryValue: number; unvaluedRows: number }; ledgerVariance: number; complete: boolean }>(
    `/api/inventory/valuation/history?asOf=${first}`, "GET", undefined, token,
  );
  assert(historical.status === 200, `Historical valuation returned ${historical.status}.`);
  const oldRow = historical.data.rows.find(row => row.productId === productId);
  assert(oldRow && Number(oldRow.onHandQuantity) === 10 && Number(oldRow.valuedQuantity) === 10
    && Number(oldRow.inventoryValue) === 120 && historical.data.complete === true
    && Number(historical.data.ledgerVariance) === 0, "Receipt-date valuation did not reconstruct 10 units at ₹120 with a balanced ledger.");

  const current = await request<{ rows: Array<Record<string, unknown>>; summary: { inventoryValue: number; unvaluedRows: number }; ledgerVariance: number; complete: boolean }>(
    "/api/inventory/valuation/history", "GET", undefined, token,
  );
  assert(current.status === 200, `Current historical valuation returned ${current.status}.`);
  const currentRow = current.data.rows.find(row => row.productId === productId);
  assert(currentRow && Number(currentRow.onHandQuantity) === 12 && Number(currentRow.valuedQuantity) === 9
    && Number(currentRow.unvaluedQuantity) === 3 && Number(currentRow.inventoryValue) === 94
    && Number(current.data.ledgerVariance) === 0 && current.data.complete === false,
  "Current valuation did not include the two costed returns: 12 physical, 9 valued, 3 unknown units and ₹94 ledger value.");

  const future = await request("/api/inventory/valuation/history?asOf=2999-01-01", "GET", undefined, token);
  assert(future.status === 400, "A future as-of date was not rejected.");
  const anonymous = await request("/api/inventory/valuation/history", "GET");
  assert(anonymous.status === 401, "Anonymous historical valuation access was not rejected.");

  const branchA = await request<{ id?: string }>("/api/admin/access/branches", "POST", { code: `HVA-${suffix}`, name: "Valuation test branch A" }, token);
  const branchB = await request<{ id?: string }>("/api/admin/access/branches", "POST", { code: `HVB-${suffix}`, name: "Valuation test branch B" }, token);
  assert(branchA.status === 201 && branchA.data.id && branchB.status === 201 && branchB.data.id, "Could not create verification branches.");
  const branchProductA = await pool.query<{ id: string }>("INSERT INTO products(company_id,code,name,unit) VALUES($1,$2,'Branch A valuation brick','pieces') RETURNING id", [companyId, `VA-${suffix}`]);
  const branchProductB = await pool.query<{ id: string }>("INSERT INTO products(company_id,code,name,unit) VALUES($1,$2,'Branch B valuation brick','pieces') RETURNING id", [companyId, `VB-${suffix}`]);
  const branchLocationA = await pool.query<{ id: string }>("INSERT INTO stock_locations(company_id,code,name,branch_id) VALUES($1,$2,'Valuation test yard A',$3) RETURNING id", [companyId, `VLA-${suffix}`, branchA.data.id]);
  const branchLocationB = await pool.query<{ id: string }>("INSERT INTO stock_locations(company_id,code,name,branch_id) VALUES($1,$2,'Valuation test yard B',$3) RETURNING id", [companyId, `VLB-${suffix}`, branchB.data.id]);
  await pool.query(`INSERT INTO stock_movements(company_id,product_id,movement_type,quality,direction,quantity,occurred_at,actor_user_id,location_id)
    VALUES($1,$2,'adjustment','good','in',5,($3::date+time '11:00') AT TIME ZONE $4,$5,$6),
          ($1,$7,'adjustment','good','in',7,($3::date+time '11:00') AT TIME ZONE $4,$5,$8)`,
  [companyId, branchProductA.rows[0].id, today, timezone, ownerId, branchLocationA.rows[0].id, branchProductB.rows[0].id, branchLocationB.rows[0].id]);
  const viewerRole = await pool.query<{ id: string }>("INSERT INTO roles(company_id,code,name,read_only) VALUES($1,$2,'Valuation report viewer',true) RETURNING id", [companyId, `valuation_view_${suffix}`]);
  await pool.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code IN ('inventory.valuation.view','accounting.view')", [viewerRole.rows[0].id]);
  const viewerEmail = `valuation-viewer-${suffix}@example.test`, viewerPassword = `Viewer-${randomBytes(12).toString("base64url")}-9A`;
  const viewerHash = await createPasswordHash(viewerPassword);
  const viewer = await pool.query<{ id: string }>("INSERT INTO users(company_id,email,full_name,password_hash) VALUES($1,$2,'Valuation branch viewer',$3) RETURNING id", [companyId, viewerEmail, viewerHash]);
  await pool.query("INSERT INTO user_roles(company_id,user_id,role_id) VALUES($1,$2,$3)", [companyId, viewer.rows[0].id, viewerRole.rows[0].id]);
  await pool.query("INSERT INTO user_branches(company_id,user_id,branch_id) VALUES($1,$2,$3)", [companyId, viewer.rows[0].id, branchA.data.id]);
  const viewerLogin = await request<{ token?: string }>("/api/auth/login", "POST", { email: viewerEmail, password: viewerPassword });
  assert(viewerLogin.status === 200 && viewerLogin.data.token, "Branch valuation viewer login failed.");
  const branchReport = await request<{ scope: string; rows: Array<Record<string, unknown>> }>("/api/inventory/valuation/history", "GET", undefined, viewerLogin.data.token);
  assert(branchReport.status === 200 && branchReport.data.scope === "branch_and_shared", "Branch valuation viewer could not read its branch and shared inventory.");
  assert(branchReport.data.rows.some(row => row.productId === productId)
    && branchReport.data.rows.some(row => row.productId === branchProductA.rows[0].id)
    && !branchReport.data.rows.some(row => row.productId === branchProductB.rows[0].id),
  "Branch valuation report leaked another branch or omitted shared/assigned-branch stock.");

  const branchCogs = await request<{ scope: string }>(`/api/inventory/valuation/history/cogs?from=${saleDate}&to=${saleDate}`, "GET", undefined, viewerLogin.data.token);
  assert(branchCogs.status === 200 && branchCogs.data.scope === "branch_and_shared", "Branch COGS reconciliation scope is unavailable.");

  console.log("Historical FIFO and period COGS verification passed: receipt-date reconstruction, FIFO consumption, unknown stock, inventory GL balance, matched and unmatched COGS journals, future-date rejection, anonymous denial and branch/shared-stock access.");
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Historical valuation verification failed.");
  process.exitCode = 1;
}).finally(async () => { await pool.end(); });
