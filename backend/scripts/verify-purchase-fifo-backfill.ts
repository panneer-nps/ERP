import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPasswordHash } from "../src/auth";
import { pool } from "../src/db";
import { assertDisposableVerificationTarget, assertLocalVerificationApi } from "./verification-target";

const api = process.env.ERP_VERIFY_API_URL ?? "http://127.0.0.1:44137";
const suffix = randomBytes(5).toString("hex");
let requestCounter = 0;

async function request<T>(path: string, method = "GET", body?: unknown, token?: string) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method === "POST" ? { "Idempotency-Key": `fifo-backfill-${suffix}-${++requestCounter}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (response.status >= 400) throw new Error(`${method} ${path} returned ${response.status}: ${data.error?.message ?? "request failed"}`);
  return { status: response.status, data };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  assertDisposableVerificationTarget();
  assertLocalVerificationApi(api);
  const email = `fifo-backfill-${suffix}@example.test`;
  const password = `Verify-${randomBytes(14).toString("base64url")}-9A`;
  const setup = await request<{ message?: string }>("/api/auth/setup", "POST", {
    companyName: `FIFO backfill verification ${suffix}`,
    ownerName: "FIFO Backfill Verification Owner",
    email,
    password,
  });
  assert(setup.status === 201, "Fresh owner setup failed.");
  const login = await request<{ token?: string }>("/api/auth/login", "POST", { email, password });
  assert(login.status === 200 && login.data.token, "Owner login failed.");
  const token = login.data.token;
  const owner = await pool.query<{ id: string; company_id: string }>("SELECT id,company_id FROM users WHERE lower(email)=lower($1)", [email]);
  assert(owner.rowCount === 1, "Verification company was not created.");
  const { id: ownerId, company_id: companyId } = owner.rows[0];

  const supplier = await request<{ id?: string }>("/api/masters/suppliers", "POST", {
    name: "FIFO Backfill Test Supplier", code: `FS-${suffix}`,
  }, token);
  const products: string[] = [];
  const receiptIds: string[] = [];
  for (const [index, productCode] of [`FB-${suffix}`, `FBO-${suffix}`].entries()) {
    const product = await request<{ id?: string }>("/api/masters/products", "POST", {
      name: `FIFO backfill test brick ${index}`, code: productCode, unit: "pieces",
      sellingRate: 10, purchaseRate: 2.5,
    }, token);
    assert(product.data.id, "Test product was not created.");
    products.push(product.data.id);
    const order = await request<{ id?: string }>("/api/purchases/orders", "POST", {
      supplierId: supplier.data.id, productId: product.data.id,
      orderDate: "2026-10-01", quantity: 8,
    }, token);
    assert(order.data.id, "Test purchase order was not created.");
    const lines = await request<{ orders?: Array<{ id: string; orderLineId: string }> }>("/api/purchases/orders", "GET", undefined, token);
    const orderLine = lines.data.orders?.find(line => line.id === order.data.id);
    assert(orderLine?.orderLineId, "Purchase order line was not available for receipt.");
    const receipt = await request<{ id?: string }>(`/api/purchases/orders/${order.data.id}/receipts`, "POST", {
      receiptDate: "2026-10-02", notes: "Synthetic legacy receipt fixture",
      lines: [{ orderLineId: orderLine.orderLineId, quantity: 8 }],
    }, token);
    assert(receipt.data.id, "Test purchase receipt was not created.");
    receiptIds.push(receipt.data.id);
  }

  const movements = await pool.query<{ id: string; product_id: string; location_id: string; receipt_id: string; inventory_cost: string; occurred_at: string }>(
    `SELECT sm.id,sm.product_id,sm.location_id,sm.reference_id AS receipt_id,sm.inventory_cost::text,sm.occurred_at::text
     FROM stock_movements sm WHERE sm.company_id=$1 AND sm.reference_type='purchase_receipt'
       AND sm.reference_id=ANY($2::uuid[]) ORDER BY sm.reference_id`, [companyId, receiptIds],
  );
  assert(movements.rowCount === 2, "Expected exactly one stock movement per receipt fixture.");
  await pool.query("DELETE FROM inventory_cost_layers WHERE company_id=$1 AND source_type='purchase_receipt' AND source_id=ANY($2::uuid[])", [companyId, receiptIds]);
  await pool.query("UPDATE stock_movements SET valuation_status='unvalued',inventory_cost=NULL WHERE company_id=$1 AND id=ANY($2::uuid[])", [companyId, movements.rows.map(row => row.id)]);
  const outboundFixture = movements.rows.find(row => row.receipt_id === receiptIds[1]);
  assert(outboundFixture, "Outbound fixture receipt movement was not found.");
  await pool.query(`INSERT INTO stock_movements
    (company_id,product_id,movement_type,quality,direction,quantity,occurred_at,actor_user_id,location_id,reason)
    VALUES($1,$2,'adjustment','good','out',1,$3::timestamptz+interval '1 day',$4,$5,'Synthetic later issue for conservative backfill verification')`,
  [companyId, outboundFixture.product_id, outboundFixture.occurred_at, ownerId, outboundFixture.location_id]);

  const sql = await readFile(resolve(__dirname, "../migrations/100_backfill_unambiguous_purchase_fifo.sql"), "utf8");
  const client = await pool.connect();
  let eligiblePassed = false, outboundSkipped = false, idempotentPassed = false;
  try {
    await client.query("BEGIN");
    await client.query(sql);
    const state = await client.query<{ movement_id: string; receipt_id: string; valuation_status: string; inventory_cost: string | null; layer_count: number; layer_value: string | null }>(
      `SELECT sm.id AS movement_id,sm.reference_id AS receipt_id,sm.valuation_status,sm.inventory_cost::text,
        COUNT(cl.id)::int AS layer_count,COALESCE(SUM(cl.received_quantity*cl.unit_cost),0)::numeric(14,2)::text AS layer_value
       FROM stock_movements sm LEFT JOIN inventory_cost_layers cl
         ON cl.company_id=sm.company_id AND cl.source_line_id=sm.id AND cl.source_type='purchase_receipt'
       WHERE sm.company_id=$1 AND sm.id=ANY($2::uuid[]) GROUP BY sm.id`, [companyId, movements.rows.map(row => row.id)],
    );
    const eligible = state.rows.find(row => row.receipt_id === receiptIds[0]);
    const skipped = state.rows.find(row => row.receipt_id === receiptIds[1]);
    eligiblePassed = eligible?.valuation_status === "valued" && Number(eligible.inventory_cost) === 20
      && eligible.layer_count === 1 && Number(eligible.layer_value) === 20;
    outboundSkipped = skipped?.valuation_status === "unvalued" && skipped.inventory_cost === null && skipped.layer_count === 0;
    assert(eligiblePassed, `Eligible receipt was not backfilled exactly: ${JSON.stringify(eligible)}.`);
    assert(outboundSkipped, `Receipt with a later issue was not left unvalued: ${JSON.stringify(skipped)}.`);
    await client.query(sql);
    const rerun = await client.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM inventory_cost_layers WHERE company_id=$1 AND source_type='purchase_receipt' AND source_id=ANY($2::uuid[])",
      [companyId, receiptIds],
    );
    idempotentPassed = rerun.rows[0].count === 1;
    assert(idempotentPassed, "Repeating the backfill created duplicate layers.");
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  console.log(JSON.stringify({ eligibleReceiptBackfilled: eligiblePassed, laterOutboundReceiptSkipped: outboundSkipped, rerunIdempotent: idempotentPassed }));
  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : "Purchase FIFO backfill verification failed.");
  await pool.end();
  process.exitCode = 1;
});
