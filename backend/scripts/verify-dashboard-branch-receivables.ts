import { randomBytes } from "node:crypto";
import { pool } from "../src/db";
import { assertDisposableVerificationTarget, assertLocalVerificationApi } from "./verification-target";

const api = process.env.ERP_VERIFY_API_URL ?? "http://127.0.0.1:44137";
const suffix = randomBytes(5).toString("hex");
const email = `dashboard-branch-${suffix}@example.test`;
const password = `Branch-${randomBytes(12).toString("base64url")}-9A`;
let requestCounter = 0;

async function request<T>(path: string, method = "GET", body?: unknown, token?: string): Promise<T> {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method === "POST" ? { "Idempotency-Key": `dashboard-branch-${suffix}-${++requestCounter}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${payload.error?.message ?? "request failed"}`);
  return payload;
}

async function main() {
  assertDisposableVerificationTarget();
  assertLocalVerificationApi(api);

  await request("/api/auth/setup", "POST", {
    companyName: `Dashboard branch check ${suffix}`,
    ownerName: "Dashboard Verification Owner",
    email,
    password,
  });
  const login = await request<{ token: string }>("/api/auth/login", "POST", { email, password });
  const token = login.token;
  if (!token) throw new Error("Owner login did not return a session token.");
  const owner = await pool.query<{ company_id: string }>("SELECT company_id FROM users WHERE lower(email)=lower($1)", [email]);
  if (!owner.rowCount) throw new Error("The verification Owner was not created.");
  const companyId = owner.rows[0].company_id;

  const branchA = await request<{ id: string }>("/api/admin/access/branches", "POST", { code: `A-${suffix}`, name: "Dashboard test branch A" }, token);
  const branchB = await request<{ id: string }>("/api/admin/access/branches", "POST", { code: `B-${suffix}`, name: "Dashboard test branch B" }, token);
  const customer = await request<{ id: string }>("/api/masters/customers", "POST", {
    name: "Dashboard test customer", code: `C-${suffix}`, phone: "9876543210", email: "",
    address: "Disposable test data", gstin: "", creditDays: 0, creditLimit: "",
  }, token);
  const product = await request<{ id: string }>("/api/masters/products", "POST", {
    name: "Dashboard test brick", code: `P-${suffix}`, unit: "pieces", sellingRate: 12,
    taxRate: 0, purchaseRate: 5, purchaseTaxRate: 0,
  }, token);

  await request("/api/auth/branch", "POST", { branchId: branchB.id }, token);
  const location = await pool.query<{ id: string }>("SELECT id FROM stock_locations WHERE company_id=$1 AND branch_id=$2 AND active=true LIMIT 1", [companyId, branchB.id]);
  if (!location.rowCount) throw new Error("The new branch did not receive a stock location.");
  const today = new Date().toISOString().slice(0, 10);
  await request("/api/stock/opening-balances", "POST", {
    locationId: location.rows[0].id,
    openingDate: today,
    notes: "Disposable dashboard branch regression fixture",
    lines: [{ productId: product.id, quality: "good", quantity: 5, unitCode: "PIECES", unitCost: 5 }],
  }, token);
  const order = await request<{ id: string }>("/api/sales/orders", "POST", {
    customerId: customer.id, orderDate: today, productId: product.id, quality: "good", quantity: 1,
  }, token);
  const invoice = await request<{ id: string; total: number }>(`/api/sales/orders/${order.id}/invoice`, "POST", {}, token);

  await request("/api/auth/branch", "POST", { branchId: branchA.id }, token);
  const branchASummary = await request<{ branchId: string | null; receivables: string }>(`/api/dashboard/summary?from=${today}&to=${today}`, "GET", undefined, token);
  await request("/api/auth/branch", "POST", { branchId: branchB.id }, token);
  const branchBSummary = await request<{ branchId: string | null; receivables: string }>(`/api/dashboard/summary?from=${today}&to=${today}`, "GET", undefined, token);
  await request("/api/auth/branch", "POST", { branchId: null }, token);
  const companySummary = await request<{ branchId: string | null; receivables: string }>(`/api/dashboard/summary?from=${today}&to=${today}`, "GET", undefined, token);

  const branchAIsolated = branchASummary.branchId === branchA.id && Math.abs(Number(branchASummary.receivables)) < 0.005;
  const branchBSeesInvoice = branchBSummary.branchId === branchB.id && Math.abs(Number(branchBSummary.receivables) - invoice.total) < 0.005;
  const companySeesInvoice = companySummary.branchId === null && Math.abs(Number(companySummary.receivables) - invoice.total) < 0.005;
  const result = { branchAIsolated, branchAReceivables: Number(branchASummary.receivables), branchBSeesInvoice, branchBReceivables: Number(branchBSummary.receivables), companySeesInvoice, companyReceivables: Number(companySummary.receivables), expectedInvoiceTotal: invoice.total };
  console.log(JSON.stringify(result));
  if (!branchAIsolated || !branchBSeesInvoice || !companySeesInvoice) process.exitCode = 1;
  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error("Dashboard branch verification failed:", error instanceof Error ? error.message : "unknown error");
  await pool.end();
  process.exitCode = 1;
});
