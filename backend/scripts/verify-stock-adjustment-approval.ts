import { randomBytes } from "node:crypto";
import { pool } from "../src/db";
import { assertDisposableVerificationTarget, assertLocalVerificationApi } from "./verification-target";

const api = process.env.ERP_VERIFY_API_URL ?? "http://127.0.0.1:44143";
const suffix = randomBytes(5).toString("hex");
const ownerEmail = `stock-owner-${suffix}@example.test`;
const ownerPassword = `Owner-${randomBytes(12).toString("base64url")}-9A`;
const managerEmail = `stock-manager-${suffix}@example.test`;
const managerPassword = `Manager-${randomBytes(12).toString("base64url")}-9A`;
const storeEmail = `stock-store-${suffix}@example.test`;
const storePassword = `Store-${randomBytes(12).toString("base64url")}-9A`;
let requestNumber = 0;

async function request<T>(path: string, method = "GET", body?: unknown, token?: string) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method === "POST" ? { "Idempotency-Key": `stock-approval-${suffix}-${++requestNumber}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({})) as T & { error?: { code?: string; message?: string } };
  return { status: response.status, data };
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function stockQuantity(token: string, productId: string): Promise<number> {
  const result = await request<{ balances: Array<{ productId: string; quality: string; quantity: string }> }>("/api/stock/balances", "GET", undefined, token);
  expect(result.status === 200, `Stock balance read expected 200, received ${result.status}.`);
  return result.data.balances.filter((row) => row.productId === productId && row.quality === "good")
    .reduce((sum, row) => sum + Number(row.quantity), 0);
}

async function main() {
  assertDisposableVerificationTarget();
  assertLocalVerificationApi(api);
  const migration = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM schema_migrations WHERE filename IN ('107_stock_adjustment_approval.sql','108_stocktake_approval_limits.sql')");
  expect(migration.rows[0]?.count === 2, "Migrations 107 and 108 must be applied before stock approval API verification.");

  const setup = await request("/api/auth/setup", "POST", {
    companyName: `Stock approval verification ${suffix}`,
    ownerName: "Synthetic Stock Owner",
    email: ownerEmail,
    password: ownerPassword,
  });
  expect(setup.status === 201, `Fresh Owner setup expected 201, received ${setup.status}.`);

  const login = async (email: string, password: string) => {
    const result = await request<{ token: string }>("/api/auth/login", "POST", { email, password });
    expect(result.status === 200 && Boolean(result.data.token), `Sign-in failed for synthetic role (${result.status}).`);
    return result.data.token;
  };
  const ownerToken = await login(ownerEmail, ownerPassword);
  const roleResult = await request<{ roles: Array<{ id: string; code: string; permissionCodes: string[] }> }>("/api/admin/access/roles", "GET", undefined, ownerToken);
  expect(roleResult.status === 200, "Owner could not load role presets.");
  const ownerRole = roleResult.data.roles.find((role) => role.code === "owner");
  const managerRole = roleResult.data.roles.find((role) => role.code === "manager");
  const storeRole = roleResult.data.roles.find((role) => role.code === "store_staff");
  expect(ownerRole && managerRole && storeRole, "Owner, Manager and Store Staff presets must exist after setup.");
  expect(managerRole.permissionCodes.includes("stock.adjust.approve") && managerRole.permissionCodes.includes("stock.adjust"), "Manager must submit and review adjustments.");
  expect(managerRole.permissionCodes.includes("stocktake.approve"), "Migration 108 must enable Manager stocktake reviews behind a configured amount limit.");
  expect(storeRole.permissionCodes.includes("stock.adjust") && !storeRole.permissionCodes.includes("stock.adjust.approve"), "Store Staff may request but cannot approve adjustments.");

  const countRole = await request<{ id: string }>("/api/admin/access/roles", "POST", { code: `stock_counter_${suffix}`, name: "Synthetic Stock Counter", permissionCodes: ["stocktake.create", "stock.view"] }, ownerToken);
  expect(countRole.status === 201 && countRole.data.id, `Stock counter role creation expected 201, received ${countRole.status}.`);
  const makeUser = async (fullName: string, email: string, password: string, roleIds: string[]) => {
    const result = await request<{ id: string }>("/api/admin/access/users", "POST", { fullName, email, password, roleIds, branchIds: [] }, ownerToken);
    expect(result.status === 201, `Synthetic ${fullName} account creation expected 201, received ${result.status}.`);
  };
  await makeUser("Synthetic Stock Manager", managerEmail, managerPassword, [managerRole.id, countRole.data.id]);
  await makeUser("Synthetic Store Staff", storeEmail, storePassword, [storeRole.id]);
  const managerToken = await login(managerEmail, managerPassword);
  const storeToken = await login(storeEmail, storePassword);

  const product = await request<{ id: string }>("/api/masters/products", "POST", {
    name: `Approval test brick ${suffix}`, code: `SAP${suffix.toUpperCase()}`, unit: "piece", sellingRate: 10, taxRate: 0, purchaseRate: 2, purchaseTaxRate: 0, minimumStock: 0,
  }, ownerToken);
  expect(product.status === 201 && product.data.id, `Product creation expected 201, received ${product.status}.`);
  const locations = await request<{ locations: Array<{ id: string }> }>("/api/stock/locations", "GET", undefined, ownerToken);
  const locationId = locations.data.locations?.[0]?.id;
  expect(locations.status === 200 && locationId, "Default stock location is missing.");
  const opening = await request("/api/stock/opening-balances", "POST", {
    locationId,
    openingDate: new Date().toISOString().slice(0, 10),
    notes: "Synthetic stock approval test opening",
    lines: [{ productId: product.data.id, quality: "good", quantity: 100, unitCode: "PIECE", unitCost: 2 }],
  }, ownerToken);
  expect(opening.status === 201, `Stock opening expected 201, received ${opening.status}.`);
  expect(Math.abs(await stockQuantity(ownerToken, product.data.id) - 100) < 0.01, "Opening stock must be 100 pieces.");

  const stocktake = await request<{ id: string }>("/api/stocktakes", "POST", { locationId, notes: "Synthetic stocktake value-cap test" }, ownerToken);
  expect(stocktake.status === 201 && stocktake.data.id, `Stocktake creation expected 201, received ${stocktake.status}.`);
  const stocktakeDetail = await request<{ lines: Array<{ lineId: string; quality: string; expectedQuantity: string }> }>(`/api/stocktakes/${stocktake.data.id}`, "GET", undefined, ownerToken);
  expect(stocktakeDetail.status === 200 && stocktakeDetail.data.lines.length > 0, "Stocktake should snapshot active products and qualities.");
  const countLines = stocktakeDetail.data.lines.map((line) => ({ lineId: line.lineId, countedQuantity: Number(line.expectedQuantity) - (line.quality === "good" ? 4 : 0), unitCode: "PIECE" }));
  const savedCounts = await request(`/api/stocktakes/${stocktake.data.id}/counts`, "PATCH", { lines: countLines }, ownerToken);
  expect(savedCounts.status === 200, `Stocktake counts expected 200, received ${savedCounts.status}.`);
  const submittedCount = await request<{ status: string }>(`/api/stocktakes/${stocktake.data.id}/submit`, "POST", {}, ownerToken);
  expect(submittedCount.status === 200 && submittedCount.data.status === "pending", "Completed physical count must enter the review queue.");
  const countQueue = await request<{ items: Array<{ id: string; type: string; amount: number | null; summaryTa?: string }> }>("/api/approvals", "GET", undefined, managerToken);
  const queuedCount = countQueue.data.items.find((item) => item.id === stocktake.data.id && item.type === "stocktake");
  expect(countQueue.status === 200 && queuedCount && Math.abs(Number(queuedCount.amount) - 8) < 0.01 && queuedCount.summaryTa?.includes("உருப்படிகள்"), "Manager Approval Center must show the count estimate and Tamil details.");
  const missingCap = await request(`/api/stocktakes/${stocktake.data.id}/approve`, "POST", { approve: true, reason: "Verified the physical count" }, managerToken);
  expect(missingCap.status === 403 && missingCap.data.error?.code === "APPROVAL_LIMIT_NOT_CONFIGURED", "Manager stocktake review must fail closed until Owner configures a value cap.");
  const setStocktakeCap = (maxAmount: string) => request(`/api/admin/access/roles/${managerRole.id}/approval-limits`, "PUT", { limits: [{ permissionCode: "stocktake.approve", maxAmount }] }, ownerToken);
  const lowCap = await setStocktakeCap("7.99");
  expect(lowCap.status === 200, `Owner stocktake cap setup expected 200, received ${lowCap.status}.`);
  const overCap = await request(`/api/stocktakes/${stocktake.data.id}/approve`, "POST", { approve: true, reason: "Verified the physical count" }, managerToken);
  expect(overCap.status === 403 && overCap.data.error?.code === "APPROVAL_LIMIT_EXCEEDED", "Stocktake adjustment estimate over the configured cap must be blocked.");
  const exactCap = await setStocktakeCap("8.00");
  expect(exactCap.status === 200, `Exact stocktake cap setup expected 200, received ${exactCap.status}.`);
  const approvedCount = await request<{ status: string; adjustments: number }>(`/api/stocktakes/${stocktake.data.id}/approve`, "POST", { approve: true, reason: "Verified the physical count" }, managerToken);
  expect(approvedCount.status === 200 && approvedCount.data.status === "approved" && approvedCount.data.adjustments === 1, `Manager approval at the exact stocktake cap expected success, received ${approvedCount.status}.`);
  expect(Math.abs(await stockQuantity(managerToken, product.data.id) - 96) < 0.01, "Approved stocktake should post its count variance exactly once.");

  const selfStocktake = await request<{ id: string }>("/api/stocktakes", "POST", { locationId, notes: "Synthetic self-review prevention test" }, managerToken);
  expect(selfStocktake.status === 201 && selfStocktake.data.id, `Manager stocktake creation expected 201, received ${selfStocktake.status}.`);
  const selfDetail = await request<{ lines: Array<{ lineId: string; expectedQuantity: string }> }>(`/api/stocktakes/${selfStocktake.data.id}`, "GET", undefined, managerToken);
  const unchangedCounts = selfDetail.data.lines.map((line) => ({ lineId: line.lineId, countedQuantity: Number(line.expectedQuantity), unitCode: "PIECE" }));
  const saveUnchangedCounts = await request(`/api/stocktakes/${selfStocktake.data.id}/counts`, "PATCH", { lines: unchangedCounts }, managerToken);
  expect(saveUnchangedCounts.status === 200, "Manager must be able to save a stock count using the assigned counter role.");
  const submitSelf = await request(`/api/stocktakes/${selfStocktake.data.id}/submit`, "POST", {}, managerToken);
  expect(submitSelf.status === 200, "Manager's own stocktake should be submit-ready.");
  const selfQueue = await request<{ items: Array<{ id: string; type: string }> }>("/api/approvals", "GET", undefined, managerToken);
  expect(selfQueue.status === 200 && !selfQueue.data.items.some((item) => item.id === selfStocktake.data.id), "A submitter must not see their stocktake in their review queue.");
  const selfReview = await request(`/api/stocktakes/${selfStocktake.data.id}/approve`, "POST", { approve: true, reason: "Attempting self review" }, managerToken);
  expect(selfReview.status === 403 && selfReview.data.error?.code === "SELF_APPROVAL_NOT_ALLOWED", "A Manager cannot review a stocktake they submitted.");

  const adjust = (token: string, action: "increase" | "decrease" | "damage", quantity: number, reason: string) => request<{ id: string; requestNumber?: string; status: string }>("/api/stock/adjustments", "POST", {
    productId: product.data.id, locationId, quality: "good", action, quantity, unitCode: "PIECE", unitCost: action === "increase" ? 2 : undefined, reason,
  }, token);
  const submitted = await adjust(storeToken, "decrease", 5, "Counted shelf damage correction");
  expect(submitted.status === 201 && submitted.data.status === "pending_approval" && submitted.data.requestNumber, "Non-Owner stock adjustment must become a numbered pending request.");
  expect(Math.abs(await stockQuantity(storeToken, product.data.id) - 96) < 0.01, "Submitting a request must not change on-hand stock.");
  const ownerQueue = await request<{ items: Array<{ id: string; type: string; number: string }> }>("/api/approvals", "GET", undefined, ownerToken);
  expect(ownerQueue.status === 200 && ownerQueue.data.items.some((item) => item.id === submitted.data.id && item.type === "stock_adjustment"), "The Owner Approval Center must show the request.");
  const storeDecision = await request(`/api/stock/adjustment-requests/${submitted.data.id}/decision`, "POST", { approve: true, reason: "Not authorized" }, storeToken);
  expect(storeDecision.status === 403, "Store Staff must not be allowed to approve stock adjustments.");
  const managerApproval = await request<{ status: string }>(`/api/stock/adjustment-requests/${submitted.data.id}/decision`, "POST", { approve: true, reason: "Verified physical quantity and reason" }, managerToken);
  expect(managerApproval.status === 200 && managerApproval.data.status === "approved", `Manager approval expected 200, received ${managerApproval.status}.`);
  expect(Math.abs(await stockQuantity(managerToken, product.data.id) - 91) < 0.01, "Approved decrease must post exactly once.");

  const managerRequest = await adjust(managerToken, "increase", 3, "Found extra saleable stock");
  expect(managerRequest.status === 201 && managerRequest.data.status === "pending_approval", "Manager adjustments must also enter the approval queue.");
  const managerQueue = await request<{ items: Array<{ id: string; type: string }> }>("/api/approvals", "GET", undefined, managerToken);
  expect(managerQueue.status === 200 && !managerQueue.data.items.some((item) => item.id === managerRequest.data.id), "Requesters must not see their own stock adjustment in their review queue.");
  const selfApproval = await request(`/api/stock/adjustment-requests/${managerRequest.data.id}/decision`, "POST", { approve: true, reason: "Self approval attempt" }, managerToken);
  expect(selfApproval.status === 403, "A Manager cannot approve their own adjustment request.");
  const ownerApproval = await request<{ status: string }>(`/api/stock/adjustment-requests/${managerRequest.data.id}/decision`, "POST", { approve: true, reason: "Owner verified the stock report" }, ownerToken);
  expect(ownerApproval.status === 200 && ownerApproval.data.status === "approved", "Owner must be able to approve a Manager's request.");
  expect(Math.abs(await stockQuantity(ownerToken, product.data.id) - 94) < 0.01, "Approved increase must post exactly once.");

  const rejected = await adjust(storeToken, "increase", 4, "Duplicate count entry correction");
  expect(rejected.status === 201 && rejected.data.status === "pending_approval", "Rejection scenario must enter the approval queue.");
  const rejectResult = await request<{ status: string }>(`/api/stock/adjustment-requests/${rejected.data.id}/decision`, "POST", { approve: false, reason: "Count evidence did not support this increase" }, managerToken);
  expect(rejectResult.status === 200 && rejectResult.data.status === "rejected", "Manager rejection must record a rejected request.");
  expect(Math.abs(await stockQuantity(ownerToken, product.data.id) - 94) < 0.01, "Rejected requests must not change stock.");

  const stale = await adjust(storeToken, "decrease", 60, "Large shelf count decrease request");
  expect(stale.status === 201 && stale.data.status === "pending_approval", "Stale-stock scenario must be submitted.");
  const directOwnerAdjustment = await adjust(ownerToken, "decrease", 50, "Owner cleared verified damaged stock");
  expect(directOwnerAdjustment.status === 201 && directOwnerAdjustment.data.status === "posted", "Owner adjustment must retain its immediate posting path.");
  expect(Math.abs(await stockQuantity(ownerToken, product.data.id) - 44) < 0.01, "Owner direct adjustment must post.");
  const insufficientApproval = await request(`/api/stock/adjustment-requests/${stale.data.id}/decision`, "POST", { approve: true, reason: "The source stock is no longer available" }, managerToken);
  expect(insufficientApproval.status === 409 && insufficientApproval.data.error?.code === "INSUFFICIENT_STOCK", "A request must recheck stock before approval.");

  console.log(JSON.stringify({
    migrations107And108: true,
    rolePermissions: true,
    stocktakeLimitMissingAndOverCapDenied: true,
    stocktakeExactCapAllowed: true,
    stocktakeSelfApprovalBlocked: true,
    storeRequestDoesNotPost: true,
    managerApprovalPosts: true,
    requesterSelfApprovalBlocked: true,
    rejectionDoesNotPost: true,
    ownerDirectPath: true,
    changedStockRecheckedAtApproval: true,
  }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Stock adjustment approval verification failed.");
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
});
