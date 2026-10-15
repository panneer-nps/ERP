import { createHash, randomBytes } from "node:crypto";
import { pool } from "../src/db";
import { runApprovedTool } from "../src/assistant";
import { assertDisposableVerificationTarget, assertLocalVerificationApi } from "./verification-target";

const api = process.env.ERP_VERIFY_API_URL ?? "http://127.0.0.1:44137";
const suffix = randomBytes(5).toString("hex");
const email = `delivery-${suffix}@example.test`;
const password = `Brick-${randomBytes(12).toString("base64url")}-9A`;
let requestCounter = 0;
const offsetDate = (date: string, days: number) => { const value = new Date(`${date}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86400000);

async function request<T>(path: string, method = "GET", body?: unknown, token?: string, idempotencyKey?: string): Promise<{ status: number; data: T }> {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method === "POST" ? { "Idempotency-Key": idempotencyKey ?? `prd-e2e-${suffix}-${++requestCounter}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (response.status >= 400) throw new Error(`${method} ${path} returned ${response.status}: ${data.error?.message ?? "request failed"}`);
  return { status: response.status, data };
}

async function expectStatus(path: string, token: string, expectedStatus: number) {
  const response = await fetch(`${api}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json().catch(() => ({}));
  if (response.status !== expectedStatus) throw new Error(`GET ${path} expected ${expectedStatus}, received ${response.status}.`);
  return data as Record<string, unknown>;
}

async function postRaw(path: string, body: unknown, token: string, idempotencyKey?: string) {
  const response = await fetch(`${api}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as { error?: { code?: string } };
  return { status: response.status, data };
}

async function patchRaw(path: string, body: unknown, token: string) {
  const response = await fetch(`${api}${path}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as { error?: { code?: string } };
  return { status: response.status, data };
}

function containsListRow(payload: Record<string, unknown>, listKey: string, expected: Record<string, string>): boolean {
  const rows = payload[listKey];
  return Array.isArray(rows) && rows.some((value) => {
    if (!value || typeof value !== "object") return false;
    const row = value as Record<string, unknown>;
    return Object.entries(expected).every(([key, id]) => row[key] === id);
  });
}

async function verifyBranchFinanceReports(
  companyId: string,
  token: string,
  branchId: string,
  financialYearId: string,
  yearStart: string,
  reportDate: string,
) {
  await request("/api/auth/branch", "POST", { branchId }, token);
  const [trial, profitLoss, balanceSheet, cashBook, bankBook] = await Promise.all([
    request<{ rows?: Array<{ code: string; accountType: string; debit: number; credit: number; balance: number }>; totalDebit?: number; totalCredit?: number }>(
      `/api/accounting/trial-balance?financialYearId=${financialYearId}&to=${reportDate}`, "GET", undefined, token,
    ),
    request<{ income?: number; expenses?: number; netProfit?: number }>(
      `/api/accounting/profit-loss?from=${yearStart}&to=${reportDate}`, "GET", undefined, token,
    ),
    request<{ totalAssets?: number; totalLiabilitiesAndEquity?: number; balanced?: boolean }>(
      `/api/accounting/balance-sheet?to=${reportDate}`, "GET", undefined, token,
    ),
    request<{ closingBalance?: number }>(
      `/api/accounting/cash-bank-book?account=1110&from=${yearStart}&to=${reportDate}`, "GET", undefined, token,
    ),
    request<{ closingBalance?: number }>(
      `/api/accounting/cash-bank-book?account=1120&from=${yearStart}&to=${reportDate}`, "GET", undefined, token,
    ),
  ]);
  const expected = await pool.query<{ code: string; account_type: string; debit: string; credit: string }>(`
    SELECT a.code,a.account_type,
      COALESCE(SUM(CASE WHEN je.id IS NOT NULL AND (a.account_type NOT IN ('income','expense') OR (je.effective_date >= $2::date AND je.source_type <> 'financial_year_close')) THEN jl.debit ELSE 0 END),0)::numeric(14,2)::text AS debit,
      COALESCE(SUM(CASE WHEN je.id IS NOT NULL AND (a.account_type NOT IN ('income','expense') OR (je.effective_date >= $2::date AND je.source_type <> 'financial_year_close')) THEN jl.credit ELSE 0 END),0)::numeric(14,2)::text AS credit
    FROM accounts a
    LEFT JOIN journal_entry_lines jl ON jl.company_id=a.company_id AND jl.account_id=a.id
    LEFT JOIN journal_entries je ON je.company_id=jl.company_id AND je.id=jl.journal_entry_id
      AND je.effective_date <= $3::date AND (je.branch_id IS NULL OR je.branch_id=$4)
    WHERE a.company_id=$1 AND a.active=true
    GROUP BY a.id
    ORDER BY a.code`, [companyId, yearStart, reportDate, branchId]);
  const actualRows = new Map((trial.data.rows ?? []).map(row => [row.code, row]));
  const ledgerRowsMatch = expected.rows.length === actualRows.size && expected.rows.every(row => {
    const actual = actualRows.get(row.code);
    const balance = row.account_type === "asset" || row.account_type === "expense"
      ? Number(row.debit) - Number(row.credit)
      : Number(row.credit) - Number(row.debit);
    return actual !== undefined
      && actual.accountType === row.account_type
      && Math.abs(actual.debit - Number(row.debit)) < 0.011
      && Math.abs(actual.credit - Number(row.credit)) < 0.011
      && Math.abs(actual.balance - balance) < 0.011;
  });
  const expectedDebit = expected.rows.reduce((sum, row) => sum + Number(row.debit), 0);
  const expectedCredit = expected.rows.reduce((sum, row) => sum + Number(row.credit), 0);
  const expectedIncome = expected.rows.filter(row => row.account_type === "income")
    .reduce((sum, row) => sum + Number(row.credit) - Number(row.debit), 0);
  const expectedExpenses = expected.rows.filter(row => row.account_type === "expense")
    .reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0);
  const expectedCash = expected.rows.filter(row => row.code === "1110")
    .reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0);
  const expectedBank = expected.rows.filter(row => row.code === "1120")
    .reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0);
  const close = (left: number | undefined, right: number) => typeof left === "number" && Math.abs(left - right) < 0.011;
  const passed = ledgerRowsMatch
    && close(trial.data.totalDebit, expectedDebit) && close(trial.data.totalCredit, expectedCredit)
    && close(profitLoss.data.income, expectedIncome) && close(profitLoss.data.expenses, expectedExpenses)
    && close(profitLoss.data.netProfit, expectedIncome - expectedExpenses)
    && balanceSheet.data.balanced === true
    && close(balanceSheet.data.totalAssets, balanceSheet.data.totalLiabilitiesAndEquity ?? NaN)
    && close(cashBook.data.closingBalance, expectedCash)
    && close(bankBook.data.closingBalance, expectedBank);
  return { passed, totalDebit: trial.data.totalDebit, totalCredit: trial.data.totalCredit, income: profitLoss.data.income, expenses: profitLoss.data.expenses };
}

async function verifyBranchPartnerLedger(
  companyId: string,
  token: string,
  branchId: string,
  kind: "customer" | "supplier" | "broker",
  partnerId: string,
  path: string,
) {
  const partnerColumn = kind === "customer" ? "customer_id" : kind === "supplier" ? "supplier_id" : "broker_id";
  const accountCode = kind === "customer" ? "1100" : kind === "supplier" ? "2100" : "2150";
  const sign = kind === "customer" ? "jl.debit-jl.credit" : "jl.credit-jl.debit";
  const brokerGuard = kind === "broker" ? "JOIN business_partners b ON b.company_id=jl.company_id AND b.id=jl.broker_id AND b.partner_type='broker'" : "";
  await request("/api/auth/branch", "POST", { branchId }, token);
  const response = await expectStatus(path, token, 200) as {
    entries?: Array<{ entryNumber: string; debit: number | string; credit: number | string; balance: number | string }>;
    balance?: number | string;
  };
  const expected = await pool.query<{ entry_number: string; debit: string; credit: string; balance: string }>(`
    SELECT je.entry_number,jl.debit::text AS debit,jl.credit::text AS credit,
      SUM(${sign}) OVER(ORDER BY je.effective_date,je.entry_number,jl.line_number ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::text AS balance
    FROM journal_entry_lines jl
    JOIN journal_entries je ON je.company_id=jl.company_id AND je.id=jl.journal_entry_id
    JOIN accounts a ON a.company_id=jl.company_id AND a.id=jl.account_id
    ${brokerGuard}
    WHERE jl.company_id=$1 AND jl.${partnerColumn}=$2 AND a.code=$4
      AND (je.branch_id IS NULL OR je.branch_id=$3)
    ORDER BY je.effective_date,je.entry_number,jl.line_number`,
    [companyId, partnerId, branchId, accountCode]);
  const actualEntries = response.entries ?? [];
  const entriesMatch = actualEntries.length === expected.rows.length && expected.rows.every((row, index) => {
    const actual = actualEntries[index];
    return actual.entryNumber === row.entry_number
      && Math.abs(Number(actual.debit) - Number(row.debit)) < 0.011
      && Math.abs(Number(actual.credit) - Number(row.credit)) < 0.011
      && Math.abs(Number(actual.balance) - Number(row.balance)) < 0.011;
  });
  const balanceMatch = Math.abs(Number(response.balance ?? 0) - Number(expected.rows.at(-1)?.balance ?? 0)) < 0.011;
  return { passed: entriesMatch && balanceMatch, entries: actualEntries.length, balance: Number(response.balance ?? 0) };
}

async function verifySubledgerReconciliation(companyId: string, token: string, branchId: string | null) {
  await request("/api/auth/branch", "POST", { branchId }, token);
  const asOf = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const response = await expectStatus(`/api/accounting/subledger-reconciliation?asOf=${asOf}`, token, 200) as {
    asOf: string;
    branchId: string | null;
    accounts: Array<{ code: string; controlBalance: number; subledgerBalance: number; difference: number; balanced: boolean; partners: Array<{ id: string; balance: number }>; unallocatedLineCount: number; unallocatedLines: Array<{ id: string; amount: number; detail: string }> }>;
  };
  const definitions = [
    { code: "1100", column: "customer_id", table: "business_partners", sign: 1, filter: "partner_type='customer'" },
    { code: "2100", column: "supplier_id", table: "business_partners", sign: -1, filter: "partner_type='supplier'" },
    { code: "2150", column: "broker_id", table: "business_partners", sign: -1, filter: "partner_type='broker'" },
    { code: "1400", column: "employee_id", table: "employees", sign: 1, filter: "TRUE" },
  ] as const;
  const checks = await Promise.all(definitions.map(async definition => {
    const actual = response.accounts.find(account => account.code === definition.code);
    if (!actual) return { passed: false, code: definition.code };
    const [control, partner, unallocated] = await Promise.all([
      pool.query<{ balance: string }>(`SELECT COALESCE(SUM(jl.debit-jl.credit),0)::text balance FROM journal_entry_lines jl JOIN journal_entries je ON je.company_id=jl.company_id AND je.id=jl.journal_entry_id JOIN accounts a ON a.company_id=jl.company_id AND a.id=jl.account_id WHERE jl.company_id=$1 AND a.code=$2 AND je.effective_date<=$3::date AND ($4::uuid IS NULL OR je.branch_id IS NULL OR je.branch_id=$4)`, [companyId, definition.code, asOf, branchId]),
      pool.query<{ balance: string }>(`SELECT COALESCE(SUM(jl.debit-jl.credit),0)::text balance FROM ${definition.table} p JOIN journal_entry_lines jl ON jl.company_id=p.company_id AND jl.${definition.column}=p.id JOIN journal_entries je ON je.company_id=jl.company_id AND je.id=jl.journal_entry_id JOIN accounts a ON a.company_id=jl.company_id AND a.id=jl.account_id AND a.code=$2 WHERE p.company_id=$1 AND ${definition.filter} AND je.effective_date<=$3::date AND ($4::uuid IS NULL OR je.branch_id IS NULL OR je.branch_id=$4)`, [companyId, definition.code, asOf, branchId]),
      pool.query<{ count: string; balance: string }>(`SELECT COUNT(*)::text count,COALESCE(SUM(jl.debit-jl.credit),0)::text balance FROM journal_entry_lines jl JOIN journal_entries je ON je.company_id=jl.company_id AND je.id=jl.journal_entry_id JOIN accounts a ON a.company_id=jl.company_id AND a.id=jl.account_id WHERE jl.company_id=$1 AND a.code=$2 AND jl.${definition.column} IS NULL AND je.effective_date<=$3::date AND ($4::uuid IS NULL OR je.branch_id IS NULL OR je.branch_id=$4)`, [companyId, definition.code, asOf, branchId]),
    ]);
    const expectedControl = Number(control.rows[0].balance) * definition.sign;
    const expectedSubledger = Number(partner.rows[0].balance) * definition.sign;
    const expectedDifference = Math.round((expectedControl - expectedSubledger + Number.EPSILON) * 100) / 100;
    const expectedUnallocated = Math.round(Number(unallocated.rows[0].balance) * definition.sign * 100) / 100;
    const listedUnallocated = actual.unallocatedLines.reduce((sum, line) => sum + line.amount, 0);
    return {
      passed: Math.abs(actual.controlBalance - expectedControl) < 0.011
        && Math.abs(actual.subledgerBalance - expectedSubledger) < 0.011
        && Math.abs(actual.difference - expectedDifference) < 0.011
        && actual.balanced === (Math.abs(expectedDifference) < 0.01)
        && actual.unallocatedLineCount === Number(unallocated.rows[0].count)
        && Math.abs(listedUnallocated - expectedUnallocated) < 0.011,
      code: definition.code,
      controlBalance: actual.controlBalance,
      subledgerBalance: actual.subledgerBalance,
      difference: actual.difference,
      unallocatedDetails: actual.unallocatedLines.map(line => line.detail),
    };
  }));
  return { passed: response.asOf === asOf && response.branchId === branchId && checks.every(check => check.passed), checks };
}

async function main() {
  assertDisposableVerificationTarget();
  assertLocalVerificationApi(api);
  const setupBody = {
    companyName: `PRD Delivery Verification ${suffix}`,
    ownerName: "PRD Verification Owner",
    email,
    password,
  };
  const setupMissingKey = await postRaw("/api/auth/setup", setupBody, "");
  const setupKey = `prd-e2e-${suffix}-first-setup`;
  const setup = await request<{ message: string }>("/api/auth/setup", "POST", setupBody, undefined, setupKey);
  if (setup.status !== 201) throw new Error(`Fresh company setup expected 201, received ${setup.status}.`);
  const setupReplay = await request<{ message: string }>("/api/auth/setup", "POST", setupBody, undefined, setupKey);
  const setupChangedReplay = await postRaw("/api/auth/setup", { ...setupBody, companyName: `${setupBody.companyName} Changed` }, "", setupKey);
  const setupCompanyCount = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM companies");
  const setupFingerprint = await pool.query<{ request_hash: string }>("SELECT request_hash FROM setup_idempotency_keys WHERE request_key=$1", [setupKey]);
  const plainSetupDigest = createHash("sha256").update(JSON.stringify({ operation: "auth.setup", body: setupBody })).digest("hex");
  const setupIdempotencyPassed = setupMissingKey.status === 400
    && setupMissingKey.data.error?.code === "IDEMPOTENCY_KEY_REQUIRED"
    && setupReplay.status === 201
    && setupReplay.data.message === setup.data.message
    && setupChangedReplay.status === 409
    && setupChangedReplay.data.error?.code === "IDEMPOTENCY_KEY_REUSED"
    && setupFingerprint.rows[0]?.request_hash !== plainSetupDigest
    && setupCompanyCount.rows[0]?.count === 1;
  if (!setupIdempotencyPassed) throw new Error("First-owner setup retry did not replay exactly once or reject changed request details.");
  const login = await request<{ token: string }>("/api/auth/login", "POST", { email, password });
  const token = login.data.token;
  if (!token) throw new Error("Owner login did not return a session token.");
  const owner = await pool.query<{ id: string; company_id: string }>(
    "SELECT id,company_id FROM users WHERE lower(email)=lower($1)", [email],
  );
  if (!owner.rowCount) throw new Error("Fresh setup owner was not stored.");
  const ownerId = owner.rows[0].id;
  const { company_id: companyId } = owner.rows[0];
  const ownerDashboard = await request<{ ownerPulse?: { supplierPayable: string; cashBalance: string; bankBalance: string; employeeAdvanceBalance: string; salaryPayable: string; brokerPayable: string; activeLoadings: number; loadingMismatches: number; asOfDate: string; scope: string } }>("/api/dashboard/summary?from=2026-10-01&to=2026-10-08", "GET", undefined, token);
  const ownerPulseExpected = await pool.query<{ cash:string;bank:string;supplier:string;advance:string;salary:string;broker:string }>(`SELECT
    COALESCE(SUM(jl.debit-jl.credit) FILTER(WHERE a.code='1110'),0)::numeric(14,2)::text cash,
    COALESCE(SUM(jl.debit-jl.credit) FILTER(WHERE a.code='1120'),0)::numeric(14,2)::text bank,
    COALESCE(SUM(jl.credit-jl.debit) FILTER(WHERE a.code='2100'),0)::numeric(14,2)::text supplier,
    COALESCE(SUM(jl.debit-jl.credit) FILTER(WHERE a.code='1400'),0)::numeric(14,2)::text advance,
    COALESCE(SUM(jl.credit-jl.debit) FILTER(WHERE a.code='2500'),0)::numeric(14,2)::text salary
    FROM journal_entry_lines jl JOIN journal_entries je ON je.company_id=jl.company_id AND je.id=jl.journal_entry_id JOIN accounts a ON a.company_id=jl.company_id AND a.id=jl.account_id
    WHERE je.company_id=$1 AND je.effective_date<='2026-10-08'`,[companyId]);
  const expectedBrokerPayable = await pool.query<{ amount:string }>(`SELECT COALESCE(SUM(bc.accrued_amount-COALESCE(p.paid,0)),0)::numeric(14,2)::text amount FROM broker_commissions bc JOIN sales_invoices i ON i.company_id=bc.company_id AND i.id=bc.invoice_id LEFT JOIN LATERAL(SELECT SUM(bp.amount) paid FROM broker_commission_payments bp WHERE bp.company_id=bc.company_id AND bp.commission_id=bc.id) p ON true WHERE bc.company_id=$1 AND i.status='posted' AND bc.cancelled_at IS NULL AND i.invoice_date<='2026-10-08'`,[companyId]);
  const ownerPulseValuesMatch = ownerDashboard.data.ownerPulse !== undefined && ownerDashboard.data.ownerPulse !== null
    && Number(ownerDashboard.data.ownerPulse.cashBalance) === Number(ownerPulseExpected.rows[0].cash)
    && Number(ownerDashboard.data.ownerPulse.bankBalance) === Number(ownerPulseExpected.rows[0].bank)
    && Number(ownerDashboard.data.ownerPulse.supplierPayable) === Number(ownerPulseExpected.rows[0].supplier)
    && Number(ownerDashboard.data.ownerPulse.employeeAdvanceBalance) === Number(ownerPulseExpected.rows[0].advance)
    && Number(ownerDashboard.data.ownerPulse.salaryPayable) === Number(ownerPulseExpected.rows[0].salary)
    && Number(ownerDashboard.data.ownerPulse.brokerPayable) === Number(expectedBrokerPayable.rows[0].amount);
  const ownerPulsePassed = ownerDashboard.data.ownerPulse?.scope === "company"
    && ownerDashboard.data.ownerPulse.asOfDate === "2026-10-08"
    && ownerPulseValuesMatch
    && [ownerDashboard.data.ownerPulse.supplierPayable, ownerDashboard.data.ownerPulse.cashBalance, ownerDashboard.data.ownerPulse.bankBalance, ownerDashboard.data.ownerPulse.employeeAdvanceBalance, ownerDashboard.data.ownerPulse.salaryPayable, ownerDashboard.data.ownerPulse.brokerPayable].every(value => typeof value === "string")
    && [ownerDashboard.data.ownerPulse.activeLoadings, ownerDashboard.data.ownerPulse.loadingMismatches].every(value => typeof value === "number");
  if (!ownerPulsePassed) throw new Error("Owner dashboard control-room summary returned an invalid shape or scope.");
  const assistantStatus = await request<{ configured: boolean }>("/api/ai/status", "GET", undefined, token);
  const ownerAssistantAuthPassed = typeof assistantStatus.data.configured === "boolean";
  if (!ownerAssistantAuthPassed) throw new Error("Owner assistant status was not available to the Owner.");
  const assistantToolResults = await Promise.all([
    runApprovedTool("business_today", {}, { companyId, branchId: null }),
    runApprovedTool("customer_outstanding", { minimumAmount: 100000 }, { companyId, branchId: null }),
    runApprovedTool("broker_commission_pending", {}, { companyId, branchId: null }),
    runApprovedTool("employee_advance_outstanding", {}, { companyId, branchId: null }),
    runApprovedTool("loading_mismatches_today", {}, { companyId, branchId: null }),
    runApprovedTool("production_cost_by_chamber", { chamberName: "Chamber" }, { companyId, branchId: null }),
  ]);
  const ownerAssistantApprovedLookupsPassed = assistantToolResults.length === 6
    && assistantToolResults.every(result => typeof result === "object" && result !== null && "source" in result);
  if (!ownerAssistantApprovedLookupsPassed) throw new Error("One or more Owner assistant approved ERP data lookups failed.");

  const originalProfile = await request<{ profile: { name: string; legalName: string; addressLine1: string; addressLine2: string; city: string; district: string; state: string; pincode: string; phone: string; gstin: string; pan: string; timezone: string } }>("/api/company/profile", "GET", undefined, token);
  const renamedCompany = `PRD Profile Verification ${suffix}`;
  await request("/api/company/profile", "PUT", { ...originalProfile.data.profile, name: renamedCompany }, token);
  const ownerBrand = await expectStatus("/api/auth/me", token, 200) as { user?: { companyName?: string } };
  const profileNameUpdatePassed = ownerBrand.user?.companyName === renamedCompany;
  const logoData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4l8AAAAASUVORK5CYII=";
  const logoUpload = await request<{ success: boolean }>("/api/company/profile/logo", "PUT", { data: logoData }, token);
  const logoRead = await fetch(`${api}/api/company/profile/logo`, { headers: { Authorization: `Bearer ${token}` } });
  const companyProfilePassed = originalProfile.status === 200 && profileNameUpdatePassed
    && logoUpload.status === 200 && logoRead.status === 200
    && logoRead.headers.get("content-type") === "image/png";
  if (!companyProfilePassed) throw new Error("Owner company profile or logo update/read-back failed.");

  const branchAPath = "/api/admin/access/branches";
  const branchABody = { code: `A-${suffix}`, name: "Verification branch A" };
  const branchAKey = `prd-e2e-${suffix}-branch-a-create`;
  const branchAMissingKey = await postRaw(branchAPath, branchABody, token);
  const branchA = await request<{ id: string }>(branchAPath, "POST", branchABody, token, branchAKey);
  const branchARetry = await request<{ id: string }>(branchAPath, "POST", branchABody, token, branchAKey);
  const branchAChangedRetry = await postRaw(branchAPath, { ...branchABody, name: "Changed verification branch A" }, token, branchAKey);
  const branchARecordCounts = await pool.query<{ branches: number; yards: number; auditEvents: number }>(
    `SELECT count(DISTINCT b.id)::int AS branches,
      count(DISTINCT sl.id)::int AS yards,
      count(DISTINCT al.id)::int AS "auditEvents"
     FROM branches b
     LEFT JOIN stock_locations sl ON sl.company_id=b.company_id AND sl.branch_id=b.id
     LEFT JOIN audit_logs al ON al.company_id=b.company_id AND al.entity_id=b.id::text AND al.action='branch.create'
     WHERE b.company_id=$1 AND b.id=$2`,
    [companyId, branchA.data.id],
  );
  const branchCreationIdempotencyPassed = branchAMissingKey.status === 400
    && branchAMissingKey.data.error?.code === "IDEMPOTENCY_KEY_REQUIRED"
    && branchARetry.data.id === branchA.data.id
    && branchAChangedRetry.status === 409 && branchAChangedRetry.data.error?.code === "IDEMPOTENCY_KEY_REUSED"
    && branchARecordCounts.rows[0]?.branches === 1 && branchARecordCounts.rows[0]?.yards === 1
    && branchARecordCounts.rows[0]?.auditEvents === 1;
  if (!branchCreationIdempotencyPassed) throw new Error("Branch creation retry did not replay one branch, yard and audit event.");
  const branchB = await request<{ id: string }>("/api/admin/access/branches", "POST", { code: `B-${suffix}`, name: "Verification branch B" }, token);
  await request("/api/auth/branch", "POST", { branchId: branchA.data.id }, token);
  const branchDashboard = await request<{ ownerPulse?: { scope: string; supplierPayable: string; cashBalance: string; bankBalance: string; employeeAdvanceBalance: string; salaryPayable: string; brokerPayable: string } }>("/api/dashboard/summary?from=2026-10-01&to=2026-10-08", "GET", undefined, token);
  const branchOwnerPulseExpected = await pool.query<{ cash:string;bank:string;supplier:string;advance:string;salary:string }>(`SELECT
    COALESCE(SUM(jl.debit-jl.credit) FILTER(WHERE a.code='1110'),0)::numeric(14,2)::text cash,
    COALESCE(SUM(jl.debit-jl.credit) FILTER(WHERE a.code='1120'),0)::numeric(14,2)::text bank,
    COALESCE(SUM(jl.credit-jl.debit) FILTER(WHERE a.code='2100'),0)::numeric(14,2)::text supplier,
    COALESCE(SUM(jl.debit-jl.credit) FILTER(WHERE a.code='1400'),0)::numeric(14,2)::text advance,
    COALESCE(SUM(jl.credit-jl.debit) FILTER(WHERE a.code='2500'),0)::numeric(14,2)::text salary
    FROM journal_entry_lines jl JOIN journal_entries je ON je.company_id=jl.company_id AND je.id=jl.journal_entry_id JOIN accounts a ON a.company_id=jl.company_id AND a.id=jl.account_id
    WHERE je.company_id=$1 AND je.effective_date<='2026-10-08' AND je.branch_id=$2`,[companyId,branchA.data.id]);
  const ownerPulseBranchValuesMatch = branchDashboard.data.ownerPulse?.scope === "branch"
    && Number(branchDashboard.data.ownerPulse.cashBalance) === Number(branchOwnerPulseExpected.rows[0].cash)
    && Number(branchDashboard.data.ownerPulse.bankBalance) === Number(branchOwnerPulseExpected.rows[0].bank)
    && Number(branchDashboard.data.ownerPulse.supplierPayable) === Number(branchOwnerPulseExpected.rows[0].supplier)
    && Number(branchDashboard.data.ownerPulse.employeeAdvanceBalance) === Number(branchOwnerPulseExpected.rows[0].advance)
    && Number(branchDashboard.data.ownerPulse.salaryPayable) === Number(branchOwnerPulseExpected.rows[0].salary)
    && Number(branchDashboard.data.ownerPulse.brokerPayable) === 0;
  if (!ownerPulseBranchValuesMatch) throw new Error("Owner dashboard branch balances did not match branch-only SQL totals.");
  await request("/api/auth/branch", "POST", { branchId: null }, token);

  const roles = await request<{ roles: Array<{ id: string; code: string; permissionCodes: string[] }> }>("/api/admin/access/roles", "GET", undefined, token);
  const operationalPresets = [
    { code: "sales_staff", permissions: ["masters.view", "sales.view", "sales.create", "sales.post"], route: "/api/sales/orders" },
    { code: "production_staff", permissions: ["masters.view", "production.view", "production.create", "production.post", "stock.view"], route: "/api/production/batches" },
    { code: "loading_staff", permissions: ["loading.view", "loading.create", "loading.edit"], route: "/api/loading" },
    { code: "store_staff", permissions: ["masters.view", "stock.view", "stock.adjust", "stock.transfer", "purchases.view", "purchases.receive"], route: "/api/stock/balances" },
  ] as const;
  for (const [index, preset] of operationalPresets.entries()) {
    const definition = roles.data.roles.find((role) => role.code === preset.code);
    if (!definition) throw new Error(`Fresh Owner setup did not seed the ${preset.code} role.`);
    const granted = new Set(definition.permissionCodes);
    const expected = new Set<string>(preset.permissions);
    if (preset.permissions.some((permission) => !granted.has(permission)) || definition.permissionCodes.some((permission) => !expected.has(permission))) {
      throw new Error(`${preset.code} permissions did not match its least-privilege preset: ${JSON.stringify(definition.permissionCodes)}`);
    }
    const staffPassword = `Staff-${randomBytes(12).toString("base64url")}-9A`;
    const staffEmail = `${preset.code}-${suffix}@example.test`;
    const created = await request<{ id: string }>("/api/admin/access/users", "POST", {
      fullName: `Test ${preset.code}`, email: staffEmail, password: staffPassword,
      roleIds: [definition.id], branchIds: [branchA.data.id],
    }, token);
    const signedIn = await request<{ token: string }>("/api/auth/login", "POST", { email: staffEmail, password: staffPassword });
    if (created.status !== 201 || signedIn.status !== 200 || !signedIn.data.token) {
      throw new Error(`${preset.code} staff account could not be created and signed in.`);
    }
    await request("/api/auth/branch", "POST", { branchId: branchA.data.id }, signedIn.data.token);
    const me = await expectStatus("/api/auth/me", signedIn.data.token, 200) as { user?: { roles?: Array<{ code: string }>; permissions?: string[] } };
    const actual = new Set(me.user?.permissions ?? []);
    const allowed = await expectStatus(preset.route, signedIn.data.token, 200);
    const userAdminDenied = (await fetch(`${api}/api/admin/users`, { headers: { Authorization: `Bearer ${signedIn.data.token}` } })).status === 403;
    const profileDenied = (await fetch(`${api}/api/company/profile`, { headers: { Authorization: `Bearer ${signedIn.data.token}` } })).status === 403;
    const allowedEndpointPassed = Object.keys(allowed).length > 0;
    if (!me.user?.roles?.some((role) => role.code === preset.code) || !preset.permissions.every((permission) => actual.has(permission))
        || !allowedEndpointPassed || !userAdminDenied || !profileDenied
        || actual.has("users.roles.manage") || actual.has("company.configure")) {
      throw new Error(`${preset.code} login, branch access, allowed workflow or restricted administration check failed.`);
    }
  }
  const operationalRolePresetsPassed = true;
  const managerRole = roles.data.roles.find((role) => role.code === "manager");
  if (!managerRole) throw new Error("Fresh setup did not seed the Manager role.");
  const managerEmail = `manager-${suffix}@example.test`;
  const managerPassword = `Manager-${randomBytes(12).toString("base64url")}-9A`;
  const manager = await request<{ id: string }>("/api/admin/access/users", "POST", {
    fullName: "Branch A Manager", email: managerEmail, password: managerPassword, roleIds: [managerRole.id], branchIds: [branchA.data.id],
  }, token);
  const managerLogin = await request<{ token: string }>("/api/auth/login", "POST", { email: managerEmail, password: managerPassword });
  const managerToken = managerLogin.data.token;
  if (!managerToken) throw new Error("Branch manager login did not return a session token.");
  const managerDashboard = await request<{ ownerPulse: null }>("/api/dashboard/summary?from=2026-10-01&to=2026-10-08", "GET", undefined, managerToken);
  if (managerDashboard.data.ownerPulse !== null) throw new Error("Manager received Owner-only dashboard financial details.");
  const managerAssistantAccessStatus = await fetch(`${api}/api/ai/status`, { headers: { Authorization: `Bearer ${managerToken}` } });
  const managerAssistantAccessDenied = managerAssistantAccessStatus.status === 403;
  if (!managerAssistantAccessDenied) throw new Error("The Owner assistant status endpoint did not deny Manager access.");
  const managerProfile = await expectStatus("/api/auth/me", managerToken, 200) as {
    user?: { permissions?: string[]; companyName?: string };
  };
  const managerCannotEditCompanyProfile = (await fetch(`${api}/api/company/profile`, { headers: { Authorization: `Bearer ${managerToken}` } })).status === 403;
  const cashierRole = roles.data.roles.find((role) => role.code === "cashier");
  if (!cashierRole) throw new Error("Fresh setup did not seed the Cashier role.");
  const cashierEmail = `cashier-${suffix}@example.test`;
  const cashierPassword = `Cashier-${randomBytes(12).toString("base64url")}-9A`;
  const cashierCreateBody = {
    fullName: "Branch A Cashier", email: cashierEmail, password: cashierPassword, roleIds: [cashierRole.id], branchIds: [branchA.data.id],
  };
  const cashierCreateKey = `prd-e2e-${suffix}-cashier-create-retry`;
  const cashier = await request<{ id: string; roles: string[] }>("/api/admin/access/users", "POST", cashierCreateBody, token, cashierCreateKey);
  const cashierRetry = await request<{ id: string; roles: string[] }>("/api/admin/access/users", "POST", cashierCreateBody, token, cashierCreateKey);
  const cashierChangedRetry = await postRaw("/api/admin/access/users", { ...cashierCreateBody, fullName: "Changed Cashier Name" }, token, cashierCreateKey);
  const cashierAccountCount = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM users WHERE company_id=$1 AND email=$2", [companyId, cashierEmail]);
  const staffFingerprint = await pool.query<{ request_hash: string }>("SELECT request_hash FROM transaction_idempotency_keys WHERE company_id=$1 AND user_id=$2 AND operation='admin.user.create' AND request_key=$3", [companyId, ownerId, cashierCreateKey]);
  const plainStaffDigest = createHash("sha256").update(JSON.stringify({ operation: "admin.user.create", body: cashierCreateBody })).digest("hex");
  const staffCreateIdempotencyPassed = cashier.status === 201 && cashierRetry.status === 201
    && cashierRetry.data.id === cashier.data.id && cashierChangedRetry.status === 409
    && cashierChangedRetry.data.error?.code === "IDEMPOTENCY_KEY_REUSED" && cashierAccountCount.rows[0]?.count === 1
    && staffFingerprint.rows[0]?.request_hash !== plainStaffDigest;
  if (!staffCreateIdempotencyPassed) throw new Error("Staff account creation retry duplicated or altered an account instead of replaying the original result.");
  const cashierLogin = await request<{ token: string }>("/api/auth/login", "POST", { email: cashierEmail, password: cashierPassword });
  const cashierMe = cashierLogin.data.token ? await expectStatus("/api/auth/me", cashierLogin.data.token, 200) as { user?: { roles?: Array<{ code: string }> } } : {};
  const cashierRoleAndBranchPassed = cashier.status === 201 && cashierLogin.status === 200
    && cashierMe.user?.roles?.some((role) => role.code === "cashier") === true
    && (await expectStatus("/api/auth/branches", cashierLogin.data.token, 200) as { branches?: Array<{ id: string }> }).branches?.some((branch) => branch.id === branchA.data.id) === true;
  const cashierDashboard = cashierLogin.data.token ? await request<{ ownerPulse: null }>("/api/dashboard/summary?from=2026-10-01&to=2026-10-08", "GET", undefined, cashierLogin.data.token) : null;
  const cashierDashboardPrivacyPassed = cashierDashboard?.data.ownerPulse === null;
  if (!cashierDashboardPrivacyPassed) throw new Error("Cashier received Owner-only dashboard financial details.");
  if (!cashierRoleAndBranchPassed || !managerCannotEditCompanyProfile) throw new Error("Cashier role/branch setup or Manager company-profile restriction failed.");
  const accountantRole = roles.data.roles.find((role) => role.code === "accountant");
  if (!accountantRole) throw new Error("Fresh setup did not seed the Accountant role.");
  const accountantEmail = `accountant-${suffix}@example.test`;
  const accountantPassword = `Accountant-${randomBytes(12).toString("base64url")}-9A`;
  const accountant = await request<{ id: string; roles: string[] }>("/api/admin/access/users", "POST", {
    fullName: "Branch A Accountant", email: accountantEmail, password: accountantPassword,
    roleIds: [accountantRole.id], branchIds: [branchA.data.id],
  }, token);
  const accountantLogin = await request<{ token: string }>("/api/auth/login", "POST", { email: accountantEmail, password: accountantPassword });
  const accountantMe = accountantLogin.data.token ? await expectStatus("/api/auth/me", accountantLogin.data.token, 200) as {
    user?: { roles?: Array<{ code: string }>; permissions?: string[] };
  } : {};
  const accountantBranches = accountantLogin.data.token
    ? await expectStatus("/api/auth/branches", accountantLogin.data.token, 200) as { branches?: Array<{ id: string }> }
    : {};
  const accountantPermissionSet = new Set(accountantMe.user?.permissions ?? []);
  const accountantCapabilities = ["sales.view", "sales.post", "purchases.view", "purchases.post", "expenses.create", "accounting.view", "accounting.journal.create", "bank.reconcile.view"];
  const accountantRestrictedPermissions = ["users.roles.manage", "company.configure", "sales.approve", "expenses.approve", "accounting.journal.approve", "accounting.accounts.configure", "payroll.configure", "sales.invoice.reverse"];
  const accountantMissingPermissions = accountantCapabilities.filter((permission) => !accountantPermissionSet.has(permission));
  const accountantGrantedRestrictedPermissions = accountantRestrictedPermissions.filter((permission) => accountantPermissionSet.has(permission));
  const accountantRoleAndBranchPassed = accountant.status === 201 && accountantLogin.status === 200
    && accountantMe.user?.roles?.some((role) => role.code === "accountant") === true
    && accountantMissingPermissions.length === 0
    && accountantGrantedRestrictedPermissions.length === 0
    && accountantBranches.branches?.length === 1 && accountantBranches.branches[0].id === branchA.data.id;
  const accountantCannotManageUsers = accountantLogin.data.token
    ? (await fetch(`${api}/api/admin/users`, { headers: { Authorization: `Bearer ${accountantLogin.data.token}` } })).status === 403
    : false;
  const accountantCannotEditCompany = accountantLogin.data.token
    ? (await fetch(`${api}/api/company/profile`, { method: "PUT", headers: { Authorization: `Bearer ${accountantLogin.data.token}`, "Content-Type": "application/json" }, body: JSON.stringify(originalProfile.data.profile) })).status === 403
    : false;
  if (!accountantRoleAndBranchPassed || !accountantCannotManageUsers || !accountantCannotEditCompany) {
    throw new Error(`Accountant preset login, branch scope, expected financial permissions or privilege restrictions failed: ${JSON.stringify({ createStatus: accountant.status, loginStatus: accountantLogin.status, role: accountantMe.user?.roles, missingPermissions: accountantMissingPermissions, restrictedPermissions: accountantGrantedRestrictedPermissions, branchIds: accountantBranches.branches?.map(branch => branch.id), expectedBranchId: branchA.data.id, usersDenied: accountantCannotManageUsers, profileDenied: accountantCannotEditCompany })}`);
  }
  const resetPassword = `Reset-${randomBytes(12).toString("base64url")}-7B`;
  const resetPath = `/api/admin/access/users/${cashier.data.id}/password`;
  const resetBody = { password: resetPassword };
  const resetMissingKey = await postRaw(resetPath, resetBody, token);
  const resetKey = `prd-e2e-${suffix}-cashier-password-reset`;
  const cashierReset = await request<{ success: boolean }>(resetPath, "POST", resetBody, token, resetKey);
  const cashierResetReplay = await request<{ success: boolean }>(resetPath, "POST", resetBody, token, resetKey);
  const cashierResetChangedReplay = await postRaw(resetPath, { password: `${resetPassword}Changed` }, token, resetKey);
  const oldCashierLogin = await fetch(`${api}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: cashierEmail, password: cashierPassword }) });
  const resetCashierLogin = await request<{ token: string }>("/api/auth/login", "POST", { email: cashierEmail, password: resetPassword });
  const revokedCashierSession = await fetch(`${api}/api/auth/me`, { headers: { Authorization: `Bearer ${cashierLogin.data.token}` } });
  const cashierResetAudit = await pool.query("SELECT 1 FROM audit_logs WHERE company_id=$1 AND actor_user_id=$2 AND entity_id=$3::text AND action='users.password.reset'", [companyId, ownerId, cashier.data.id]);
  const managerResetAttempt = await fetch(`${api}/api/admin/access/users/${cashier.data.id}/password`, { method: "POST", headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ password: resetPassword }) });
  const ownerResetAttempt = await fetch(`${api}/api/admin/access/users/${ownerId}/password`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ password: resetPassword }) });
  const ownerResetError = await ownerResetAttempt.json() as { error?: { code?: string } };
  const staffPasswordResetPassed = resetMissingKey.status === 400 && resetMissingKey.data.error?.code === "IDEMPOTENCY_KEY_REQUIRED"
    && cashierReset.status === 200 && cashierResetReplay.status === 200 && cashierResetReplay.data.success === true
    && cashierResetChangedReplay.status === 409 && cashierResetChangedReplay.data.error?.code === "IDEMPOTENCY_KEY_REUSED"
    && oldCashierLogin.status === 401 && resetCashierLogin.status === 200
    && revokedCashierSession.status === 401 && cashierResetAudit.rowCount === 1
    && managerResetAttempt.status === 403 && ownerResetAttempt.status === 409 && ownerResetError.error?.code === "CANNOT_RESET_SELF";
  if (!staffPasswordResetPassed) throw new Error(`Owner staff-password reset checks failed: reset=${cashierReset.status}, oldLogin=${oldCashierLogin.status}, newLogin=${resetCashierLogin.status}, revokedSession=${revokedCashierSession.status}, manager=${managerResetAttempt.status}, owner=${ownerResetAttempt.status}.`);
  const restrictedManagerPermissions = [
    "sales.invoice.reverse", "sales.pricing.configure", "stock.opening.post", "inventory.valuation.reconcile",
    "accounting.accounts.configure", "accounting.period.close", "accounting.financial-years.close",
    "payroll.configure", "products.tax.configure", "products.units.configure",
  ];
  const managerPresetLeastPrivilege = restrictedManagerPermissions.every((code) => !managerProfile.user?.permissions?.includes(code));
  if (!managerPresetLeastPrivilege) throw new Error("The default Manager role includes a restricted owner setup or reversal permission.");
  const managerBranches = await expectStatus("/api/auth/branches", managerToken, 200) as {
    branches?: Array<{ id: string }>;
    canViewAll?: boolean;
  };
  const managerBranchSwitch = await fetch(`${api}/api/auth/branch`, {
    method: "POST", headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ branchId: branchB.data.id }),
  });
  const managerAllBranchesSwitch = await fetch(`${api}/api/auth/branch`, {
    method: "POST", headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ branchId: null }),
  });
  const managerRoleAdmin = await fetch(`${api}/api/admin/access/roles`, { headers: { Authorization: `Bearer ${managerToken}` } });
  const managerBranchIsolation = managerBranches.branches?.length === 1
    && managerBranches.branches[0].id === branchA.data.id
    && managerBranches.canViewAll === false
    && managerBranchSwitch.status === 403
    && managerAllBranchesSwitch.status === 403
    && managerRoleAdmin.status === 403;
  if (!managerBranchIsolation) throw new Error("Manager branch assignment or role-admin restriction failed.");

  await request("/api/auth/branch", "POST", { branchId: branchA.data.id }, managerToken);
  const creditCustomer = await request<{ id: string }>("/api/masters/customers", "POST", {
    name: "Credit approval verification customer", code: `CC-${suffix}`, phone: "9876543213", email: "",
    address: "Test address", gstin: "", creditDays: 0, creditLimit: 1,
  }, managerToken);
  await request("/api/auth/branch", "POST", { branchId: branchB.data.id }, token);

  const customer = await request<{ id: string }>("/api/masters/customers", "POST", {
    name: "Delivery verification customer", code: `C-${suffix}`, phone: "9876543210", email: "",
    address: "Test address", gstin: "", businessName: "Brick Chamber Trade Customer", whatsappNumber: "+919876543210",
    pan: "ABCDE1234F", customerType: "wholesale", paymentTerms: "Net 30", creditDays: 0, creditLimit: "",
  }, token);
  await request(`/api/masters/customers/${customer.data.id}`, "PATCH", {
    name: "Delivery verification customer", code: `C-${suffix}`, phone: "9876543210", email: "",
    address: "Updated test address", gstin: "", businessName: "Updated Brick Chamber Trade Customer", whatsappNumber: "+919876543211",
    pan: "ABCDE1234F", customerType: "retail", paymentTerms: "Due on receipt", creditDays: 5, creditLimit: "",
  }, token);
  const customerProfileList = await expectStatus("/api/masters/customers", token, 200) as {
    records?: Array<{ id: string; businessName?: string; whatsappNumber?: string; pan?: string; customerType?: string; paymentTerms?: string; address?: string; creditDays?: number }>;
  };
  const customerProfileRow = customerProfileList.records?.find(record => record.id === customer.data.id);
  const customerProfileAudit = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM audit_logs WHERE company_id=$1 AND entity_id=$2::text AND action='master.partner.update'", [companyId, customer.data.id]);
  const customerProfilePassed = customerProfileRow?.businessName === "Updated Brick Chamber Trade Customer"
    && customerProfileRow.whatsappNumber === "+919876543211" && customerProfileRow.pan === "ABCDE1234F"
    && customerProfileRow.customerType === "retail" && customerProfileRow.paymentTerms === "Due on receipt"
    && customerProfileRow.address === "Updated test address" && Number(customerProfileRow.creditDays) === 5
    && customerProfileAudit.rows[0]?.count === 1;
  if (!customerProfilePassed) throw new Error(`Customer profile create/update or audit failed: ${JSON.stringify({ customerProfileRow, auditCount: customerProfileAudit.rows[0]?.count })}`);
  const openingCustomer = await request<{ id: string }>("/api/masters/customers", "POST", {
    name: "Opening balance verification customer", code: `OC-${suffix}`, phone: "9876543214", email: "",
    address: "Test address", gstin: "", creditDays: 0, creditLimit: "",
  }, token);
  const customerOpeningPayload = {
    amount: 125, balanceSide: "debit", openingDate: new Date().toISOString().slice(0, 10), reason: "Verified opening receivable",
  };
  const customerOpeningKey = `partner-opening-customer-${suffix}`;
  const customerOpening = await request<{ id: string; openingNumber: string }>(
    `/api/masters/customers/${openingCustomer.data.id}/opening-balance`, "POST", customerOpeningPayload, token, customerOpeningKey,
  );
  const customerOpeningReplay = await request<{ id: string; openingNumber: string }>(
    `/api/masters/customers/${openingCustomer.data.id}/opening-balance`, "POST", customerOpeningPayload, token, customerOpeningKey,
  );
  const customerOpeningChangedPayload = await postRaw(`/api/masters/customers/${openingCustomer.data.id}/opening-balance`, { ...customerOpeningPayload, amount: 126 }, token, customerOpeningKey);
  const duplicateCustomerOpening = await postRaw(`/api/masters/customers/${openingCustomer.data.id}/opening-balance`, customerOpeningPayload, token, `partner-opening-customer-duplicate-${suffix}`);
  const missingCustomerOpeningKey = await postRaw(`/api/masters/customers/${openingCustomer.data.id}/opening-balance`, customerOpeningPayload, token);
  const customerOpeningLedger = await expectStatus(`/api/sales/customers/${openingCustomer.data.id}/ledger`, token, 200) as {
    balance?: number; entries?: Array<{ debit: number; credit: number; entryNumber: string }>;
  };
  const customerMaster = await expectStatus("/api/masters/customers", token, 200) as {
    records?: Array<{ id: string; openingNumber?: string; openingAmount?: number; openingSide?: string }>;
  };
  const customerOpeningEvidence = await pool.query<{ journals: number; balanced: boolean; audit_events: number; receivables: string; equity: string }>(`
    SELECT
      (SELECT count(*)::int FROM journal_entries j WHERE j.company_id=$1 AND j.source_type='partner_opening_balance' AND j.source_id=$2) AS journals,
      (SELECT NOT EXISTS(SELECT 1 FROM journal_entries j JOIN journal_entry_lines l ON l.company_id=j.company_id AND l.journal_entry_id=j.id WHERE j.company_id=$1 AND j.source_type='partner_opening_balance' AND j.source_id=$2 GROUP BY j.id HAVING sum(l.debit)<>sum(l.credit))) AS balanced,
      (SELECT count(*)::int FROM audit_logs a WHERE a.company_id=$1 AND a.entity_id=$2::text AND a.action='partners.opening.post') AS audit_events,
      (SELECT COALESCE(sum(l.debit-l.credit),0)::text FROM journal_entry_lines l JOIN accounts a ON a.company_id=l.company_id AND a.id=l.account_id WHERE l.company_id=$1 AND l.customer_id=$3 AND a.code='1100') AS receivables,
      (SELECT COALESCE(sum(l.credit-l.debit),0)::text FROM journal_entry_lines l JOIN accounts a ON a.company_id=l.company_id AND a.id=l.account_id JOIN journal_entries j ON j.company_id=l.company_id AND j.id=l.journal_entry_id WHERE l.company_id=$1 AND j.source_type='partner_opening_balance' AND j.source_id=$2 AND a.code='3000') AS equity
  `, [companyId, customerOpening.data.id, openingCustomer.data.id]);
  const customerMasterRow = customerMaster.records?.find(record => record.id === openingCustomer.data.id);
  const customerOpeningReplayPassed = customerOpeningReplay.status === 201 && customerOpeningReplay.data.id === customerOpening.data.id
    && customerOpeningReplay.data.openingNumber === customerOpening.data.openingNumber;
  const customerOpeningPassed = customerOpening.status === 201 && customerOpeningReplayPassed
    && customerOpeningChangedPayload.status === 409 && customerOpeningChangedPayload.data.error?.code === "IDEMPOTENCY_KEY_REUSED"
    && duplicateCustomerOpening.status === 409 && duplicateCustomerOpening.data.error?.code === "OPENING_ALREADY_POSTED"
    && missingCustomerOpeningKey.status === 400 && missingCustomerOpeningKey.data.error?.code === "IDEMPOTENCY_KEY_REQUIRED"
    && Number(customerOpeningLedger.balance) === 125 && customerOpeningLedger.entries?.length === 1
    && customerMasterRow?.openingNumber === customerOpening.data.openingNumber
    && Number(customerMasterRow?.openingAmount) === 125 && customerMasterRow?.openingSide === "debit"
    && Number(customerOpeningEvidence.rows[0]?.journals) === 1 && customerOpeningEvidence.rows[0]?.balanced === true
    && Number(customerOpeningEvidence.rows[0]?.audit_events) === 1
    && Number(customerOpeningEvidence.rows[0]?.receivables) === 125 && Number(customerOpeningEvidence.rows[0]?.equity) === 125;
  if (!customerOpeningPassed) throw new Error(`Customer opening balance did not post exactly once with safe idempotent replay, AR ledger, balanced opening-equity journal and audit: ${JSON.stringify({ ledger: customerOpeningLedger, evidence: customerOpeningEvidence.rows[0], replayStatus: customerOpeningReplay.status, changedPayloadStatus: customerOpeningChangedPayload.status, duplicateStatus: duplicateCustomerOpening.status, missingKeyStatus: missingCustomerOpeningKey.status })}`);
  const product = await request<{ id: string }>("/api/masters/products", "POST", {
    name: "Delivery verification brick", code: `P-${suffix}`, unit: "pieces", sellingRate: 12,
    taxRate: 0, purchaseRate: 5, purchaseTaxRate: 0,
  }, token);
  const broker = await request<{ id: string }>("/api/masters/brokers", "POST", {
    name: "Delivery verification broker", code: `BR-${suffix}`, phone: "9876543215", email: "",
    address: "Test address", gstin: "", creditDays: 0, creditLimit: "",
  }, token);
  await request(`/api/brokers/${broker.data.id}/commission-rule`, "PUT", {
    commissionType: "per_brick", rate: 1, accrualEvent: "payment",
  }, token);
  const creditOrder = await request<{ id: string; status: string }>("/api/sales/orders", "POST", {
    customerId: creditCustomer.data.id, orderDate: new Date().toISOString().slice(0, 10),
    productId: product.data.id, quality: "good", quantity: 1,
  }, managerToken);
  if (creditOrder.data.status !== "pending_approval") throw new Error("A sale over the customer's credit limit was not held for approval.");
  await request("/api/auth/branch", "POST", { branchId: branchA.data.id }, token);
  const ownerApprovals = await expectStatus("/api/approvals", token, 200) as {
    items?: Array<{ id: string; type: string }>;
  };
  if (!ownerApprovals.items?.some((item) => item.id === creditOrder.data.id && item.type === "sales_order")) {
    throw new Error("The over-limit sales order did not appear in the Owner's approval queue.");
  }
  await request("/api/auth/branch", "POST", { branchId: branchB.data.id }, token);
  const otherBranchApprovals = await expectStatus("/api/approvals", token, 200) as {
    items?: Array<{ id: string; type: string }>;
  };
  const creditOrderBranchFilterPassed = !otherBranchApprovals.items?.some((item) => item.id === creditOrder.data.id && item.type === "sales_order");
  if (!creditOrderBranchFilterPassed) {
    throw new Error("The approval queue exposed a branch A credit sale while the Owner was viewing branch B.");
  }
  await request("/api/auth/branch", "POST", { branchId: branchA.data.id }, token);
  await request(`/api/sales/orders/${creditOrder.data.id}/decision`, "POST", {
    approve: true, reason: "Disposable integration test approval.",
  }, token);
  const approvedCreditOrder = await expectStatus(`/api/sales/orders/${creditOrder.data.id}`, token, 200) as {
    order?: { status?: string };
  };
  const creditApprovalEvidence = await pool.query<{
    status: string;
    approved: boolean;
    branch_id: string;
    audit_events: number;
  }>(`SELECT o.status,o.credit_limit_override_approved AS approved,o.branch_id,
      (SELECT count(*)::int FROM audit_logs a WHERE a.company_id=o.company_id AND a.entity_id=o.id::text AND a.action='sales.order.approve') AS audit_events
    FROM sales_orders o WHERE o.company_id=$1 AND o.id=$2`, [companyId, creditOrder.data.id]);
  const creditApprovalPassed = approvedCreditOrder.order?.status === "open"
    && creditApprovalEvidence.rows[0]?.status === "open"
    && creditApprovalEvidence.rows[0]?.approved === true
    && creditApprovalEvidence.rows[0]?.branch_id === branchA.data.id
    && creditApprovalEvidence.rows[0]?.audit_events === 1;
  if (!creditApprovalPassed) throw new Error("Credit approval did not reopen the order and persist its branch-scoped override and audit event.");

  await request("/api/employee-advances/approval-settings", "PUT", { threshold: 100 }, token);
  const employeeJoinedOn = new Date().toISOString().slice(0, 10);
  const employee = await request<{ id: string }>("/api/employees", "POST", {
    employeeNumber: `EMP-${suffix}`, fullName: "Advance approval verification employee", phone: "9876543214",
    email: "", jobTitle: "Chamber worker", employmentType: "labour", joinedOn: employeeJoinedOn,
    department: "Production",
    baseDailyRate: 650,
  }, managerToken);
  const employeeList = await request<{ employees: Array<{ id: string; joinedOn: string }> }>("/api/employees", "GET", undefined, token);
  const employeeListRow = employeeList.data.employees.find(row => row.id === employee.data.id);
  if (employeeListRow?.joinedOn !== employeeJoinedOn || !/^\d{4}-\d{2}-\d{2}$/.test(employeeListRow.joinedOn)) {
    throw new Error("The employee list must return joinedOn as a date-only string for People-page rendering.");
  }
  const employeeAdvance = await request<{ id: string; status: string }>("/api/employee-advances", "POST", {
    employeeId: employee.data.id, advanceDate: new Date().toISOString().slice(0, 10), amount: 150,
    paymentMethod: "cash", reference: "", notes: "Disposable approval verification advance",
  }, managerToken);
  if (employeeAdvance.data.status !== "pending_approval") throw new Error("An employee advance above the configured threshold was not held for approval.");
  const advanceApprovals = await expectStatus("/api/approvals", token, 200) as {
    items?: Array<{ id: string; type: string }>;
  };
  if (!advanceApprovals.items?.some((item) => item.id === employeeAdvance.data.id && item.type === "employee_advance")) {
    throw new Error("The employee advance did not appear in the Owner's approval queue.");
  }
  const advanceDecision = await request<{ status: string; journalPosted: boolean }>(
    `/api/employee-advances/${employeeAdvance.data.id}/decision`, "POST",
    { approve: true, reason: "Disposable integration test approval." }, token,
  );
  const advanceEvidence = await pool.query<{
    status: string;
    owner_approved: boolean;
    journal_exists: boolean;
    journal_balanced: boolean;
    audit_events: number;
  }>(`SELECT a.status,a.approved_by=$3 AS owner_approved,
      EXISTS(SELECT 1 FROM journal_entries j WHERE j.company_id=a.company_id AND j.source_type='employee_advance' AND j.source_id=a.id) AS journal_exists,
      (SELECT COALESCE(sum(l.debit),0)=COALESCE(sum(l.credit),0) FROM journal_entries j JOIN journal_entry_lines l ON l.company_id=j.company_id AND l.journal_entry_id=j.id WHERE j.company_id=a.company_id AND j.source_type='employee_advance' AND j.source_id=a.id) AS journal_balanced,
      (SELECT count(*)::int FROM audit_logs l WHERE l.company_id=a.company_id AND l.entity_id=a.id::text AND l.action='employee.advance.approve') AS audit_events
    FROM employee_advances a WHERE a.company_id=$1 AND a.id=$2`, [companyId, employeeAdvance.data.id, ownerId]);
  const employeeAdvanceApprovalPassed = advanceDecision.data.status === "posted" && advanceDecision.data.journalPosted
    && advanceEvidence.rows[0]?.status === "posted" && advanceEvidence.rows[0]?.owner_approved === true
    && advanceEvidence.rows[0]?.journal_exists === true && advanceEvidence.rows[0]?.journal_balanced === true
    && advanceEvidence.rows[0]?.audit_events === 1;
  if (!employeeAdvanceApprovalPassed) throw new Error("Employee advance approval did not post one balanced journal and an owner-linked audit event.");
  const rejectedAdvance = await request<{ id: string; status: string }>("/api/employee-advances", "POST", {
    employeeId: employee.data.id, advanceDate: new Date().toISOString().slice(0, 10), amount: 200,
    paymentMethod: "cash", reference: "", notes: "Disposable rejection verification advance",
  }, managerToken);
  if (rejectedAdvance.data.status !== "pending_approval") throw new Error("Second threshold-exceeding employee advance was not held for review.");
  const rejectedDecision = await request<{ status: string; journalPosted: boolean }>(
    `/api/employee-advances/${rejectedAdvance.data.id}/decision`, "POST",
    { approve: false, reason: "Disposable integration test rejection." }, token,
  );
  const rejectionEvidence = await pool.query<{
    status: string;
    owner_rejected: boolean;
    journal_exists: boolean;
    audit_events: number;
  }>(`SELECT a.status,a.rejected_by=$3 AS owner_rejected,
      EXISTS(SELECT 1 FROM journal_entries j WHERE j.company_id=a.company_id AND j.source_type='employee_advance' AND j.source_id=a.id) AS journal_exists,
      (SELECT count(*)::int FROM audit_logs l WHERE l.company_id=a.company_id AND l.entity_id=a.id::text AND l.action='employee.advance.reject') AS audit_events
    FROM employee_advances a WHERE a.company_id=$1 AND a.id=$2`, [companyId, rejectedAdvance.data.id, ownerId]);
  const employeeAdvanceRejectionPassed = rejectedDecision.data.status === "rejected" && !rejectedDecision.data.journalPosted
    && rejectionEvidence.rows[0]?.status === "rejected" && rejectionEvidence.rows[0]?.owner_rejected === true
    && rejectionEvidence.rows[0]?.journal_exists === false && rejectionEvidence.rows[0]?.audit_events === 1;
  if (!employeeAdvanceRejectionPassed) throw new Error("Rejected employee advance posted a journal or did not retain its owner-linked audit event.");
  const payrollDate = new Date().toISOString().slice(0, 10);
  const payrollPeriodStart = `${payrollDate.slice(0, 7)}-01`;
  const payrollPeriodEnd = new Date(Date.UTC(Number(payrollDate.slice(0, 4)), Number(payrollDate.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const attendancePath = `/api/employees/${employee.data.id}/attendance`;
  const attendancePayload = { attendanceDate: payrollDate, status: "present", overtimeHours: 2, notes: "Disposable PRD payroll attendance" };
  const attendanceKey = `prd-attendance-${suffix}`;
  const attendance = await request<{ id: string }>(attendancePath, "POST", attendancePayload, managerToken, attendanceKey);
  const attendanceReplay = await request<{ id: string }>(attendancePath, "POST", attendancePayload, managerToken, attendanceKey);
  const attendanceEvidence = await pool.query<{ records: string; audits: string }>(`SELECT
      (SELECT count(*)::text FROM attendance_records WHERE company_id=$1 AND employee_id=$2 AND attendance_date=$3::date) AS records,
      (SELECT count(*)::text FROM audit_logs WHERE company_id=$1 AND entity_id=$4::text AND action='attendance.record') AS audits`,
  [companyId, employee.data.id, payrollDate, attendance.data.id]);
  if (attendance.data.id !== attendanceReplay.data.id || Number(attendanceEvidence.rows[0].records) !== 1
    || Number(attendanceEvidence.rows[0].audits) !== 1) {
    throw new Error("A repeated attendance submission created duplicate rows or audit events.");
  }
  await request(`/api/payroll/employees/${employee.data.id}/rules`, "PATCH", {
    salaryType: "daily", baseDailyRate: 650, monthlySalary: 0, pieceRate: 0, overtimeHourlyRate: 50,
  }, token);
  const monthlyEmployee = await request<{ id: string }>("/api/employees", "POST", {
    employeeNumber: `EMP-M-${suffix}`, fullName: "Monthly payroll verification employee", phone: "9876543215",
    email: "", jobTitle: "Office worker", employmentType: "staff", joinedOn: payrollPeriodStart, department: "Office", baseDailyRate: 0,
  }, managerToken);
  const pieceEmployee = await request<{ id: string }>("/api/employees", "POST", {
    employeeNumber: `EMP-P-${suffix}`, fullName: "Piece-rate verification employee", phone: "9876543216",
    email: "", jobTitle: "Packer", employmentType: "labour", joinedOn: payrollPeriodStart, department: "Packing", baseDailyRate: 0,
  }, managerToken);
  await request(`/api/payroll/employees/${monthlyEmployee.data.id}/rules`, "PATCH", {
    salaryType: "monthly", baseDailyRate: 0, monthlySalary: 26000, pieceRate: 0, overtimeHourlyRate: 0,
  }, token);
  await request(`/api/payroll/employees/${pieceEmployee.data.id}/rules`, "PATCH", {
    salaryType: "piece_rate", baseDailyRate: 0, monthlySalary: 0, pieceRate: 4, overtimeHourlyRate: 0,
  }, token);
  await request("/api/payroll/settings", "PUT", { monthlyProration: "fixed_days", monthlyWorkDays: 26, paidLeaveDays: 1 }, token);
  const monthlyAttendanceDates = [
    payrollPeriodStart,
    new Date(Date.UTC(Number(payrollPeriodStart.slice(0, 4)), Number(payrollPeriodStart.slice(5, 7)) - 1, 2)).toISOString().slice(0, 10),
    new Date(Date.UTC(Number(payrollPeriodStart.slice(0, 4)), Number(payrollPeriodStart.slice(5, 7)) - 1, 3)).toISOString().slice(0, 10),
  ];
  for (const [index, status] of ["present", "half_day", "leave"].entries()) {
    const attendanceDate = monthlyAttendanceDates[index];
    await request(`/api/employees/${monthlyEmployee.data.id}/attendance`, "POST", {
      attendanceDate, status, overtimeHours: 0, notes: `Disposable ${status} payroll attendance`,
    }, managerToken, `prd-attendance-${monthlyEmployee.data.id}-${attendanceDate}`);
  }
  const payrollRun = await request<{ id: string; status: string; totalGross: number; totalNet: number }>("/api/payroll/runs", "POST", {
    periodStart: payrollPeriodStart, periodEnd: payrollPeriodEnd, notes: "Disposable PRD payroll verification",
    adjustments: [
      { employeeId: employee.data.id, pieceQuantity: 0, bonus: 100, otherDeductions: 25, advanceRecovery: 50, reason: "Disposable bonus, deduction and advance recovery." },
      { employeeId: pieceEmployee.data.id, pieceQuantity: 15, bonus: 0, otherDeductions: 0, advanceRecovery: 0, reason: "" },
    ],
  }, token);
  if (payrollRun.data.status !== "pending_approval" || payrollRun.data.totalGross !== 3410 || payrollRun.data.totalNet !== 3335) {
    throw new Error(`Payroll did not calculate daily, monthly-prorated, piece-rate and adjusted pay correctly: ${JSON.stringify(payrollRun.data)}`);
  }
  await request("/api/auth/branch", "POST", { branchId: null }, token);
  const sharedEmployee = await request<{ id: string }>("/api/employees", "POST", {
    employeeNumber: `EMP-SH-${suffix}`, fullName: "Shared branch assignment verification employee", phone: "9876543220",
    email: "", jobTitle: "Packer", employmentType: "labour", joinedOn: payrollPeriodStart, department: "Packing", baseDailyRate: 650,
  }, token);
  await request(`/api/employees/${sharedEmployee.data.id}/branch`, "PATCH", { branchId: branchB.data.id }, token);
  await request("/api/auth/branch", "POST", { branchId: branchB.data.id }, token);
  await request(`/api/employees/${sharedEmployee.data.id}/attendance`, "POST", {
    attendanceDate: payrollDate, status: "present", overtimeHours: 0, notes: "Disposable Branch B payroll attendance",
  }, token);
  const branchBPayrollEmployees = await request<{ employees: Array<{ id: string }> }>("/api/payroll/employees", "GET", undefined, token);
  const branchBPeople = await request<{ employees: Array<{ id: string }> }>("/api/employees", "GET", undefined, token);
  const branchBRun = await request<{ id: string; status: string }>("/api/payroll/runs", "POST", {
    periodStart: payrollPeriodStart, periodEnd: payrollPeriodEnd, notes: "Disposable Branch B payroll scope check", adjustments: [],
  }, token);
  const branchBRuns = await request<{ runs: Array<{ id: string }> }>("/api/payroll/runs", "GET", undefined, token);
  const branchBRunDetailStatus = await expectStatus(`/api/payroll/runs/${payrollRun.data.id}`, token, 404);
  const branchBLabour = await expectStatus(`/api/reports/labour?from=${payrollPeriodStart}&to=${payrollPeriodEnd}`, token, 200) as {
    rows?: Array<{ employeeId: string }>;
  };
  const managerBranchAssignmentDenied = await patchRaw(`/api/employees/${sharedEmployee.data.id}/branch`, { branchId: branchA.data.id }, managerToken);
  const payrollBranchIsolationChecks = {
    branchBPayrollEmployeeVisible: branchBPayrollEmployees.data.employees.some(row => row.id === sharedEmployee.data.id),
    branchAPayrollEmployeeHidden: !branchBPayrollEmployees.data.employees.some(row => row.id === employee.data.id),
    branchBPeopleEmployeeVisible: branchBPeople.data.employees.some(row => row.id === sharedEmployee.data.id),
    branchAPeopleEmployeeHidden: !branchBPeople.data.employees.some(row => row.id === employee.data.id),
    branchBRunCreated: branchBRun.data.status === "pending_approval",
    branchBRunListed: branchBRuns.data.runs.some(run => run.id === branchBRun.data.id),
    branchARunHidden: !branchBRuns.data.runs.some(run => run.id === payrollRun.data.id),
    branchARunDetailHidden: (branchBRunDetailStatus.error as { code?: string } | undefined)?.code === "SALARY_RUN_NOT_FOUND",
    branchBLabourEmployeeVisible: branchBLabour.rows?.some(row => row.employeeId === sharedEmployee.data.id) === true,
    branchALabourEmployeeHidden: branchBLabour.rows?.some(row => row.employeeId === employee.data.id) !== true,
    managerAssignmentForbidden: managerBranchAssignmentDenied.status === 403,
  };
  const payrollBranchIsolationPassed = Object.values(payrollBranchIsolationChecks).every(Boolean);
  if (!payrollBranchIsolationPassed) {
    throw new Error(`Payroll branch ownership, same-period branch run, report filtering or Owner-only legacy assignment failed: ${JSON.stringify({ checks: payrollBranchIsolationChecks, branchBRun: branchBRun.data, branchBPayrollEmployees: branchBPayrollEmployees.data, branchBPeople: branchBPeople.data, branchBRuns: branchBRuns.data, branchBRunDetailStatus: branchBRunDetailStatus.status, branchBLabour, managerBranchAssignmentStatus: managerBranchAssignmentDenied.status })}`);
  }
  await request("/api/auth/branch", "POST", { branchId: branchA.data.id }, token);
  const branchAEmploymentRuns = await request<{ runs: Array<{ id: string }> }>("/api/payroll/runs", "GET", undefined, token);
  if (!branchAEmploymentRuns.data.runs.some(run => run.id === payrollRun.data.id)
    || branchAEmploymentRuns.data.runs.some(run => run.id === branchBRun.data.id)) {
    throw new Error("Branch A salary-run list did not isolate Branch A from Branch B after restoring the Owner session.");
  }
  const employeeDepartmentEdit = await request<{ id: string }>(`/api/employees/${employee.data.id}`, "PATCH", {
    employeeNumber: `EMP-${suffix}`, fullName: "Advance approval verification employee", phone: "9876543214",
    email: "", jobTitle: "Chamber worker", department: "Dispatch", employmentType: "labour",
    joinedOn: new Date().toISOString().slice(0, 10), baseDailyRate: 650,
  }, token);
  if (employeeDepartmentEdit.data.id !== employee.data.id) throw new Error("Employee department edit did not return the updated employee.");
  const currentEmployee = await pool.query<{ department: string }>(
    "SELECT department FROM employees WHERE company_id=$1 AND id=$2", [companyId, employee.data.id],
  );
  if (currentEmployee.rows[0]?.department !== "Dispatch") throw new Error("Employee department edit was not persisted.");
  const pendingLabourReport = await expectStatus(`/api/reports/labour?from=${payrollPeriodStart}&to=${payrollPeriodEnd}&department=Production&status=pending_approval`, token, 200) as {
    rows?: Array<{ employeeId: string; department: string }>;
    departments?: string[];
    summary?: Array<{ department: string; pendingGrossCost: string; postedGrossCost: string }>;
  };
  const payrollReportEvidence = await pool.query<{ status: string; period_start: string; period_end: string; department_snapshot: string; joined_employee: boolean; from_matches: boolean; to_matches: boolean; department_matches: boolean; status_matches: boolean }>(`SELECT r.status,r.period_start::text,r.period_end::text,l.department_snapshot,
      EXISTS(SELECT 1 FROM employees e WHERE e.company_id=l.company_id AND e.id=l.employee_id) AS joined_employee,
      r.period_end >= $3::date AS from_matches,r.period_start <= $4::date AS to_matches,
      COALESCE(NULLIF(btrim(l.department_snapshot),''),'Unassigned') ILIKE '%'||$5||'%' AS department_matches,
      r.status=$6 AS status_matches
    FROM salary_runs r JOIN salary_run_lines l ON l.company_id=r.company_id AND l.salary_run_id=r.id
    WHERE r.company_id=$1 AND r.id=$2 AND l.employee_id=$7`, [companyId, payrollRun.data.id, payrollPeriodStart, payrollPeriodEnd, "Production", "pending_approval", employee.data.id]);
  const unfilteredLabourReport = await expectStatus("/api/reports/labour", token, 200) as { totalRows?: number; rows?: Array<{ employeeId: string }> };
  const pendingDepartmentSummary = pendingLabourReport.summary?.find((row) => row.department === "Production");
  const pendingDepartmentCostPassed = pendingLabourReport.rows?.length === 1
    && pendingLabourReport.rows[0].employeeId === employee.data.id
    && pendingLabourReport.rows[0].department === "Production"
    && pendingLabourReport.departments?.includes("Production") === true
    && Number(pendingDepartmentSummary?.pendingGrossCost) === 850
    && Number(pendingDepartmentSummary?.postedGrossCost) === 0;
  if (!pendingDepartmentCostPassed) throw new Error(`Pending department labour cost did not match its salary snapshot: ${JSON.stringify({ report: pendingLabourReport, unfiltered: unfilteredLabourReport, database: payrollReportEvidence.rows })}`);
  const historicalDepartmentSnapshotPassed = payrollReportEvidence.rows[0]?.department_snapshot === "Production"
    && pendingLabourReport.rows?.[0]?.department === "Production" && currentEmployee.rows[0]?.department === "Dispatch";
  if (!historicalDepartmentSnapshotPassed) throw new Error(`Changing an employee's current department altered the historical salary-run department snapshot: ${JSON.stringify({ evidence: payrollReportEvidence.rows, report: pendingLabourReport.rows?.[0], current: currentEmployee.rows[0] })}`);
  await request(`/api/payroll/runs/${payrollRun.data.id}/approve`, "POST", { reason: "Disposable PRD payroll approval." }, token);
  const payrollDetail = await expectStatus(`/api/payroll/runs/${payrollRun.data.id}`, token, 200) as {
    run?: { status?: string };
    lines?: Array<{ lineId: string; employeeId: string; department: string; salaryType: string; presentDays: number; halfDays: number; paidLeaveDays: number; overtimeHours: number; overtimeEarnings: number; pieceQuantity: number; baseEarnings: number; bonus: number; otherDeductions: number; advanceRecovery: number; netPay: number; paidAmount: number }>;
  };
  const payrollLine = payrollDetail.lines?.find((line) => line.employeeId === employee.data.id);
  if (!payrollLine || payrollDetail.run?.status !== "approved" || payrollLine.department !== "Production" || Number(payrollLine.presentDays) !== 1 || Number(payrollLine.overtimeHours) !== 2 || Number(payrollLine.overtimeEarnings) !== 100 || Number(payrollLine.bonus) !== 100 || Number(payrollLine.otherDeductions) !== 25 || Number(payrollLine.advanceRecovery) !== 50 || Number(payrollLine.netPay) !== 775) {
    throw new Error("Approved payroll detail did not preserve attendance, overtime, bonus, deduction, recovery and net-pay snapshots.");
  }
  const monthlyPayrollLine = payrollDetail.lines?.find((line) => line.employeeId === monthlyEmployee.data.id);
  const piecePayrollLine = payrollDetail.lines?.find((line) => line.employeeId === pieceEmployee.data.id);
  if (!monthlyPayrollLine || monthlyPayrollLine.salaryType !== "monthly" || Number(monthlyPayrollLine.presentDays) !== 1
    || Number(monthlyPayrollLine.halfDays) !== 1 || Number(monthlyPayrollLine.paidLeaveDays) !== 1 || Number(monthlyPayrollLine.baseEarnings) !== 2500
    || !piecePayrollLine || piecePayrollLine.salaryType !== "piece_rate" || Number(piecePayrollLine.pieceQuantity) !== 15 || Number(piecePayrollLine.baseEarnings) !== 60) {
    throw new Error("Monthly proration, paid-leave allowance or piece-rate payroll calculation did not match its configured rule.");
  }
  const firstSalaryPayment = await request<{ paymentNumber: string; status: string; remaining: number }>(
    `/api/payroll/runs/${payrollRun.data.id}/lines/${payrollLine.lineId}/payments`, "POST",
    { paymentDate: payrollDate, amount: 300, paymentMethod: "cash", reference: `PAY-${suffix}-1`, notes: "Disposable PRD part salary payment" }, token,
  );
  if (firstSalaryPayment.data.status !== "partially_paid" || firstSalaryPayment.data.remaining !== 475) {
    throw new Error(`Payroll part-payment did not retain the remaining salary payable: ${JSON.stringify(firstSalaryPayment.data)}`);
  }
  const salaryPayment = await request<{ paymentNumber: string; status: string; remaining: number }>(
    `/api/payroll/runs/${payrollRun.data.id}/lines/${payrollLine.lineId}/payments`, "POST",
    { paymentDate: payrollDate, amount: 475, paymentMethod: "cash", reference: `PAY-${suffix}-2`, notes: "Disposable PRD salary balance payment" }, token,
  );
  if (salaryPayment.data.status !== "partially_paid" || salaryPayment.data.remaining !== 0) {
    throw new Error(`Payroll balance payment did not clear this employee's salary while other employees remained unpaid: ${JSON.stringify(salaryPayment.data)}`);
  }
  const monthlySalaryPayment = await request<{ paymentNumber: string; status: string; remaining: number }>(
    `/api/payroll/runs/${payrollRun.data.id}/lines/${monthlyPayrollLine.lineId}/payments`, "POST",
    { paymentDate: payrollDate, amount: 2500, paymentMethod: "bank_transfer", reference: `PAY-${suffix}-M`, notes: "Disposable monthly salary payment" }, token,
  );
  const pieceSalaryPayment = await request<{ paymentNumber: string; status: string; remaining: number }>(
    `/api/payroll/runs/${payrollRun.data.id}/lines/${piecePayrollLine.lineId}/payments`, "POST",
    { paymentDate: payrollDate, amount: 60, paymentMethod: "bank_transfer", reference: `PAY-${suffix}-P`, notes: "Disposable piece-rate salary payment" }, token,
  );
  if (monthlySalaryPayment.data.status !== "partially_paid" || monthlySalaryPayment.data.remaining !== 0
    || pieceSalaryPayment.data.status !== "paid" || pieceSalaryPayment.data.remaining !== 0) {
    throw new Error("Monthly and piece-rate salary payments did not settle the complete salary run.");
  }
  const postedLabourReport = await expectStatus(`/api/reports/labour?from=${payrollPeriodStart}&to=${payrollPeriodEnd}&department=Production&status=posted`, token, 200) as {
    rows?: Array<{ employeeId: string; department: string; grossCost: string; paidAmount: string }>;
    summary?: Array<{ department: string; postedGrossCost: string; pendingGrossCost: string; postedAdvanceRecovery: string; paidAmount: string }>;
  };
  const postedDepartmentSummary = postedLabourReport.summary?.find((row) => row.department === "Production");
  const postedDepartmentCostPassed = postedLabourReport.rows?.length === 1
    && postedLabourReport.rows[0].employeeId === employee.data.id
    && postedLabourReport.rows[0].department === "Production"
    && Number(postedLabourReport.rows[0].grossCost) === 850
    && Number(postedDepartmentSummary?.postedGrossCost) === 850
    && Number(postedDepartmentSummary?.pendingGrossCost) === 0
    && Number(postedDepartmentSummary?.postedAdvanceRecovery) === 50
    && Number(postedDepartmentSummary?.paidAmount) === 775;
  if (!postedDepartmentCostPassed) throw new Error(`Posted department labour cost did not match payroll and payment snapshots: ${JSON.stringify(postedLabourReport)}`);
  const salaryPaymentRecord = await pool.query<{ id: string }>(
    "SELECT id FROM salary_payments WHERE company_id=$1 AND payment_number=ANY($2::text[])",
    [companyId, [firstSalaryPayment.data.paymentNumber, salaryPayment.data.paymentNumber, monthlySalaryPayment.data.paymentNumber, pieceSalaryPayment.data.paymentNumber]],
  );
  if (salaryPaymentRecord.rowCount !== 4) throw new Error("All salary payments were not saved.");
  const payrollEvidence = await pool.query<{
    run_status: string; advance_balance: string; payable_balance: string;
    balanced: boolean; journal_count: number; approval_audits: number; payment_audits: number;
  }>(`SELECT r.status AS run_status,
      (SELECT COALESCE(sum(l.debit-l.credit),0)::text FROM journal_entry_lines l JOIN accounts a ON a.company_id=l.company_id AND a.id=l.account_id WHERE l.company_id=r.company_id AND l.employee_id=$2 AND a.code='1400') AS advance_balance,
      (SELECT COALESCE(sum(l.credit-l.debit),0)::text FROM journal_entry_lines l JOIN accounts a ON a.company_id=l.company_id AND a.id=l.account_id WHERE l.company_id=r.company_id AND l.employee_id=$2 AND a.code='2500') AS payable_balance,
      (SELECT NOT EXISTS(SELECT 1 FROM journal_entries j JOIN journal_entry_lines l ON l.company_id=j.company_id AND l.journal_entry_id=j.id WHERE j.company_id=r.company_id AND ((j.source_type='salary_run' AND j.source_id=r.id) OR (j.source_type='salary_payment' AND j.source_id=ANY($3::uuid[]))) GROUP BY j.id HAVING sum(l.debit)<>sum(l.credit))) AS balanced,
      (SELECT count(*)::int FROM journal_entries j WHERE j.company_id=r.company_id AND ((j.source_type='salary_run' AND j.source_id=r.id) OR (j.source_type='salary_payment' AND j.source_id=ANY($3::uuid[])))) AS journal_count,
      (SELECT count(*)::int FROM audit_logs a WHERE a.company_id=r.company_id AND a.entity_id=r.id::text AND a.action='payroll.run.approve') AS approval_audits,
      (SELECT count(*)::int FROM audit_logs a JOIN salary_payments sp ON sp.company_id=a.company_id AND sp.id::text=a.entity_id WHERE sp.company_id=r.company_id AND sp.salary_run_id=r.id AND a.action='payroll.payment.post') AS payment_audits
    FROM salary_runs r WHERE r.company_id=$1 AND r.id=$4`,
    [companyId, employee.data.id, salaryPaymentRecord.rows.map((row) => row.id), payrollRun.data.id]);
  const payrollRow = payrollEvidence.rows[0];
  const payrollPassed = salaryPayment.status === 201 && pieceSalaryPayment.data.status === "paid" && salaryPayment.data.remaining === 0
    && payrollRow?.run_status === "paid" && Number(payrollRow.advance_balance) === 100
    && Number(payrollRow.payable_balance) === 0 && payrollRow.balanced === true && payrollRow.journal_count === 5
    && payrollRow.approval_audits === 1 && payrollRow.payment_audits === 4;
  if (!payrollPassed) throw new Error(`Payroll payment, advance recovery, journals or audit records did not reconcile: ${JSON.stringify(payrollRow)}`);
  const monthlyProrationCases = [
    { mode: "calendar_days", employeeNumber: `EMP-C-${suffix}`, fullName: "Calendar-prorated payroll verification employee", joinedOn: "2026-11-16", start: "2026-11-01", end: "2026-11-30", expected: 13000 },
    { mode: "full_month", employeeNumber: `EMP-F-${suffix}`, fullName: "Full-month payroll verification employee", joinedOn: "2026-12-16", start: "2026-12-01", end: "2026-12-31", expected: 26000 },
  ] as const;
  const priorPayrollEmployees = [employee.data.id, monthlyEmployee.data.id, pieceEmployee.data.id];
  for (const scenario of monthlyProrationCases) {
    for (const employeeId of priorPayrollEmployees) {
      await request(`/api/employees/${employeeId}/status`, "PATCH", { active: false }, token);
    }
    const proratedEmployee = await request<{ id: string }>("/api/employees", "POST", {
      employeeNumber: scenario.employeeNumber, fullName: scenario.fullName, phone: "9876543217",
      email: "", jobTitle: "Monthly payroll verification", employmentType: "staff", joinedOn: scenario.joinedOn,
      department: "Office", baseDailyRate: 0,
    }, managerToken);
    priorPayrollEmployees.push(proratedEmployee.data.id);
    await request(`/api/payroll/employees/${proratedEmployee.data.id}/rules`, "PATCH", {
      salaryType: "monthly", baseDailyRate: 0, monthlySalary: 26000, pieceRate: 0, overtimeHourlyRate: 0,
    }, token);
    await request("/api/payroll/settings", "PUT", {
      monthlyProration: scenario.mode, monthlyWorkDays: 26, paidLeaveDays: 0,
    }, token);
    const modeRun = await request<{ id: string; status: string; totalGross: number; totalNet: number }>("/api/payroll/runs", "POST", {
      periodStart: scenario.start, periodEnd: scenario.end, notes: `Disposable ${scenario.mode} payroll verification`,
    }, token);
    if (modeRun.data.totalGross !== scenario.expected || modeRun.data.totalNet !== scenario.expected || modeRun.data.status !== "pending_approval") {
      throw new Error(`${scenario.mode} monthly payroll did not prorate a ₹26,000 salary as expected: ${JSON.stringify(modeRun.data)}`);
    }
    await request(`/api/payroll/runs/${modeRun.data.id}/approve`, "POST", { reason: `Disposable ${scenario.mode} monthly proration approval.` }, token);
    const modeDetail = await expectStatus(`/api/payroll/runs/${modeRun.data.id}`, token, 200) as {
      run?: { status: string };
      lines?: Array<{ lineId: string; employeeId: string; baseEarnings: string | number; netPay: string | number }>;
    };
    const modeLine = modeDetail.lines?.find((line) => line.employeeId === proratedEmployee.data.id);
    if (modeDetail.run?.status !== "approved" || Number(modeLine?.baseEarnings) !== scenario.expected || Number(modeLine?.netPay) !== scenario.expected) {
      throw new Error(`${scenario.mode} monthly payroll detail did not preserve the calculated salary snapshot.`);
    }
    const modePayment = await request<{ paymentNumber: string; status: string; remaining: number }>(
      `/api/payroll/runs/${modeRun.data.id}/lines/${modeLine!.lineId}/payments`,
      "POST", { paymentDate: scenario.end, amount: scenario.expected, paymentMethod: "bank_transfer", reference: `PAY-${scenario.mode}-${suffix}`, notes: `Disposable ${scenario.mode} salary settlement.` }, token,
    );
    if (modePayment.data.status !== "paid" || modePayment.data.remaining !== 0) {
      throw new Error(`${scenario.mode} monthly payroll did not settle at the expected amount.`);
    }
  }
  const monthlyProrationModesPassed = true;
  await request("/api/expenses/approval-settings", "PUT", { threshold: 100 }, token);
  const expenseCategories = await expectStatus("/api/expenses/categories", token, 200) as {
    categories?: Array<{ id: string; code: string; active: boolean }>;
  };
  const expenseCategory = expenseCategories.categories?.find((category) => category.code === "OTHER" && category.active);
  if (!expenseCategory) throw new Error("Fresh setup did not provide an active expense category.");
  const reportVehicle = `TN-ERP-${suffix}`;
  const offlineExpenseBody = {
    categoryId: expenseCategory.id, expenseDate: payrollDate, amount: 150, paymentMethod: "cash",
    description: "Disposable PRD expense approval", reference: `EXP-${suffix}`, vehicleReference: reportVehicle,
  };
  const offlineExpenseKey = `prd-offline-${suffix}-expense`;
  const expense = await request<{ id: string; status: string; expenseNumber: string }>("/api/expenses", "POST", offlineExpenseBody, managerToken, offlineExpenseKey);
  // Simulate losing the first HTTP response after the server committed. The browser outbox
  // must retry the same payload with the same key and receive the original result.
  const expenseRetry = await request<{ id: string; status: string; expenseNumber: string }>("/api/expenses", "POST", offlineExpenseBody, managerToken, offlineExpenseKey);
  const retryEvidence = await pool.query<{ expense_count: number; audit_count: number; idempotency_count: number }>(
    `SELECT
       (SELECT count(*)::int FROM expenses WHERE company_id=$1 AND id=$2) AS expense_count,
       (SELECT count(*)::int FROM audit_logs WHERE company_id=$1 AND entity_id=$2::text AND action='expense.submit_for_approval') AS audit_count,
       (SELECT count(*)::int FROM transaction_idempotency_keys WHERE company_id=$1 AND user_id=$3 AND operation='expenses.post' AND request_key=$4) AS idempotency_count`,
    [companyId, expense.data.id, manager.data.id, offlineExpenseKey],
  );
  const offlineRetryExactlyOnce = expense.status === 201 && expenseRetry.status === 201
    && expense.data.id === expenseRetry.data.id && expense.data.expenseNumber === expenseRetry.data.expenseNumber
    && retryEvidence.rows[0]?.expense_count === 1 && retryEvidence.rows[0]?.audit_count === 1
    && retryEvidence.rows[0]?.idempotency_count === 1;
  if (!offlineRetryExactlyOnce) throw new Error("Offline expense retry created duplicate effects or failed to replay its original response.");
  if (expense.data.status !== "pending_approval") throw new Error("Expense above the configured threshold was not queued for approval.");
  const expenseQueue = await expectStatus("/api/expenses", token, 200) as { expenses?: Array<{ id: string; status: string }> };
  if (!expenseQueue.expenses?.some((item) => item.id === expense.data.id && item.status === "pending_approval")) {
    throw new Error("Pending expense was not visible in the Owner's expense queue.");
  }
  await request(`/api/expenses/${expense.data.id}/approve`, "POST", { reason: "Disposable PRD expense approval." }, token);
  const expenseEvidence = await pool.query<{
    status: string; branch_id: string; journal_count: number; debit: string; credit: string; audit_events: number;
  }>(`SELECT e.status,e.branch_id,
      (SELECT count(*)::int FROM journal_entries j WHERE j.company_id=e.company_id AND j.source_type='expense' AND j.source_id=e.id) AS journal_count,
      (SELECT COALESCE(sum(l.debit),0)::text FROM journal_entries j JOIN journal_entry_lines l ON l.company_id=j.company_id AND l.journal_entry_id=j.id WHERE j.company_id=e.company_id AND j.source_type='expense' AND j.source_id=e.id) AS debit,
      (SELECT COALESCE(sum(l.credit),0)::text FROM journal_entries j JOIN journal_entry_lines l ON l.company_id=j.company_id AND l.journal_entry_id=j.id WHERE j.company_id=e.company_id AND j.source_type='expense' AND j.source_id=e.id) AS credit,
      (SELECT count(*)::int FROM audit_logs a WHERE a.company_id=e.company_id AND a.entity_id=e.id::text AND a.action='expense.approve') AS audit_events
    FROM expenses e WHERE e.company_id=$1 AND e.id=$2`, [companyId, expense.data.id]);
  const expenseRow = expenseEvidence.rows[0];
  const expenseApprovalPassed = expenseRow?.status === "posted" && expenseRow.branch_id === branchA.data.id && expenseRow.journal_count === 1
    && Number(expenseRow.debit) === 150 && Number(expenseRow.credit) === 150 && expenseRow.audit_events === 1;
  if (!expenseApprovalPassed) throw new Error(`Expense approval did not post one balanced cash journal and approval audit: ${JSON.stringify(expenseRow)}`);
  await request("/api/auth/branch", "POST", { branchId: branchA.data.id }, token);
  const expenseReportA = await expectStatus(`/api/reports/expenses?from=${payrollDate}&to=${payrollDate}&categoryId=${expenseCategory.id}&vehicle=${encodeURIComponent(reportVehicle)}&search=${encodeURIComponent(reportVehicle)}&status=posted`, token, 200) as {
    rows?: Array<{ id: string; vehicleReference: string }>;
    summary?: { count: number; postedTotal: string; pendingTotal: string; rejectedTotal: string; postedCount: number; pendingCount: number; rejectedCount: number };
  };
  const expenseReportBranchAPassed = expenseReportA.rows?.length === 1
    && expenseReportA.rows[0].id === expense.data.id && expenseReportA.rows[0].vehicleReference === reportVehicle
    && expenseReportA.summary?.count === 1 && Number(expenseReportA.summary.postedTotal) === 150
    && Number(expenseReportA.summary.pendingTotal) === 0 && Number(expenseReportA.summary.rejectedTotal) === 0
    && expenseReportA.summary.postedCount === 1 && expenseReportA.summary.pendingCount === 0 && expenseReportA.summary.rejectedCount === 0;
  if (!expenseReportBranchAPassed) throw new Error(`Branch A expense report filters/totals failed: ${JSON.stringify(expenseReportA.summary)}`);
  await request("/api/auth/branch", "POST", { branchId: branchB.data.id }, token);
  const expenseReportB = await expectStatus(`/api/reports/expenses?from=${payrollDate}&to=${payrollDate}&categoryId=${expenseCategory.id}&vehicle=${encodeURIComponent(reportVehicle)}&search=${encodeURIComponent(reportVehicle)}&status=posted`, token, 200) as { rows?: Array<{ id: string }>; summary?: { count: number; postedTotal: string } };
  const expenseReportBranchBIsolated = expenseReportB.rows?.length === 0 && expenseReportB.summary?.count === 0 && Number(expenseReportB.summary?.postedTotal) === 0;
  if (!expenseReportBranchBIsolated) throw new Error("Branch B expense report included a Branch A expense.");
  const supplier = await request<{ id: string }>("/api/masters/suppliers", "POST", {
    name: "Delivery verification supplier", code: `S-${suffix}`, phone: "9876543212", email: "",
    address: "Test address", gstin: "", businessName: "Brick Chamber Clay Supplier", whatsappNumber: "+919876543212",
    pan: "FGHIJ5678K", paymentTerms: "Net 15", suppliedMaterials: ["Red clay", "Sand"], creditDays: 0, creditLimit: "",
  }, token);
  await request(`/api/masters/suppliers/${supplier.data.id}`, "PATCH", {
    name: "Delivery verification supplier", code: `S-${suffix}`, phone: "9876543212", email: "",
    address: "Updated supplier address", gstin: "", businessName: "Updated Brick Chamber Clay Supplier", whatsappNumber: "+919876543213",
    pan: "FGHIJ5678K", paymentTerms: "Due on receipt", suppliedMaterials: ["Red clay", "Washed sand"], creditDays: 10,
  }, token);
  const supplierProfileList = await expectStatus("/api/masters/suppliers", token, 200) as {
    records?: Array<{ id: string; businessName?: string; whatsappNumber?: string; pan?: string; paymentTerms?: string; suppliedMaterials?: string[]; address?: string; creditDays?: number }>;
  };
  const supplierProfileRow = supplierProfileList.records?.find(record => record.id === supplier.data.id);
  const supplierProfileAudit = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM audit_logs WHERE company_id=$1 AND entity_id=$2::text AND action='master.partner.update'", [companyId, supplier.data.id]);
  const supplierProfilePassed = supplierProfileRow?.businessName === "Updated Brick Chamber Clay Supplier"
    && supplierProfileRow.whatsappNumber === "+919876543213" && supplierProfileRow.pan === "FGHIJ5678K"
    && supplierProfileRow.paymentTerms === "Due on receipt" && supplierProfileRow.suppliedMaterials?.join(",") === "Red clay,Washed sand"
    && supplierProfileRow.address === "Updated supplier address" && Number(supplierProfileRow.creditDays) === 10
    && supplierProfileAudit.rows[0]?.count === 1;
  if (!supplierProfilePassed) throw new Error(`Supplier profile create/update or audit failed: ${JSON.stringify({ supplierProfileRow, auditCount: supplierProfileAudit.rows[0]?.count })}`);
  await request(`/api/masters/suppliers/${supplier.data.id}`, "PATCH", {
    name: "Delivery verification supplier", code: `S-${suffix}`, phone: "9876543212", email: "",
    address: "Updated supplier address", gstin: "33ABCDE1234F1Z5", businessName: "Updated Brick Chamber Clay Supplier", whatsappNumber: "+919876543213",
    pan: "FGHIJ5678K", paymentTerms: "Due on receipt", suppliedMaterials: ["Red clay", "Washed sand"], creditDays: 10,
  }, token);
  const openingSupplier = await request<{ id: string }>("/api/masters/suppliers", "POST", {
    name: "Opening balance verification supplier", code: `OS-${suffix}`, phone: "9876543216", email: "",
    address: "Test address", gstin: "", creditDays: 0, creditLimit: "",
  }, token);
  const supplierOpeningPayload = {
    amount: 75, balanceSide: "credit", openingDate: new Date().toISOString().slice(0, 10), reason: "Verified opening payable",
  };
  const supplierOpeningKey = `partner-opening-supplier-${suffix}`;
  const supplierOpening = await request<{ id: string; openingNumber: string }>(
    `/api/masters/suppliers/${openingSupplier.data.id}/opening-balance`, "POST", supplierOpeningPayload, token, supplierOpeningKey,
  );
  const supplierOpeningReplay = await request<{ id: string; openingNumber: string }>(
    `/api/masters/suppliers/${openingSupplier.data.id}/opening-balance`, "POST", supplierOpeningPayload, token, supplierOpeningKey,
  );
  const supplierOpeningChangedPayload = await postRaw(`/api/masters/suppliers/${openingSupplier.data.id}/opening-balance`, { ...supplierOpeningPayload, amount: 76 }, token, supplierOpeningKey);
  const duplicateSupplierOpening = await postRaw(`/api/masters/suppliers/${openingSupplier.data.id}/opening-balance`, supplierOpeningPayload, token, `partner-opening-supplier-duplicate-${suffix}`);
  const missingSupplierOpeningKey = await postRaw(`/api/masters/suppliers/${openingSupplier.data.id}/opening-balance`, supplierOpeningPayload, token);
  const supplierOpeningLedger = await expectStatus(`/api/purchases/suppliers/${openingSupplier.data.id}/ledger`, token, 200) as {
    balance?: number; entries?: Array<{ debit: number; credit: number; entryNumber: string }>;
  };
  const supplierMaster = await expectStatus("/api/masters/suppliers", token, 200) as {
    records?: Array<{ id: string; openingNumber?: string; openingAmount?: number; openingSide?: string }>;
  };
  const supplierOpeningEvidence = await pool.query<{ journals: number; balanced: boolean; audit_events: number; payables: string; equity: string }>(`
    SELECT
      (SELECT count(*)::int FROM journal_entries j WHERE j.company_id=$1 AND j.source_type='partner_opening_balance' AND j.source_id=$2) AS journals,
      (SELECT NOT EXISTS(SELECT 1 FROM journal_entries j JOIN journal_entry_lines l ON l.company_id=j.company_id AND l.journal_entry_id=j.id WHERE j.company_id=$1 AND j.source_type='partner_opening_balance' AND j.source_id=$2 GROUP BY j.id HAVING sum(l.debit)<>sum(l.credit))) AS balanced,
      (SELECT count(*)::int FROM audit_logs a WHERE a.company_id=$1 AND a.entity_id=$2::text AND a.action='partners.opening.post') AS audit_events,
      (SELECT COALESCE(sum(l.credit-l.debit),0)::text FROM journal_entry_lines l JOIN accounts a ON a.company_id=l.company_id AND a.id=l.account_id WHERE l.company_id=$1 AND l.supplier_id=$3 AND a.code='2100') AS payables,
      (SELECT COALESCE(sum(l.debit-l.credit),0)::text FROM journal_entry_lines l JOIN accounts a ON a.company_id=l.company_id AND a.id=l.account_id JOIN journal_entries j ON j.company_id=l.company_id AND j.id=l.journal_entry_id WHERE l.company_id=$1 AND j.source_type='partner_opening_balance' AND j.source_id=$2 AND a.code='3000') AS equity
  `, [companyId, supplierOpening.data.id, openingSupplier.data.id]);
  const supplierMasterRow = supplierMaster.records?.find(record => record.id === openingSupplier.data.id);
  const supplierOpeningReplayPassed = supplierOpeningReplay.status === 201 && supplierOpeningReplay.data.id === supplierOpening.data.id
    && supplierOpeningReplay.data.openingNumber === supplierOpening.data.openingNumber;
  const supplierOpeningPassed = supplierOpening.status === 201 && supplierOpeningReplayPassed
    && supplierOpeningChangedPayload.status === 409 && supplierOpeningChangedPayload.data.error?.code === "IDEMPOTENCY_KEY_REUSED"
    && duplicateSupplierOpening.status === 409 && duplicateSupplierOpening.data.error?.code === "OPENING_ALREADY_POSTED"
    && missingSupplierOpeningKey.status === 400 && missingSupplierOpeningKey.data.error?.code === "IDEMPOTENCY_KEY_REQUIRED"
    && Number(supplierOpeningLedger.balance) === 75 && supplierOpeningLedger.entries?.length === 1
    && supplierMasterRow?.openingNumber === supplierOpening.data.openingNumber
    && Number(supplierMasterRow?.openingAmount) === 75 && supplierMasterRow?.openingSide === "credit"
    && Number(supplierOpeningEvidence.rows[0]?.journals) === 1 && supplierOpeningEvidence.rows[0]?.balanced === true
    && Number(supplierOpeningEvidence.rows[0]?.audit_events) === 1
    && Number(supplierOpeningEvidence.rows[0]?.payables) === 75 && Number(supplierOpeningEvidence.rows[0]?.equity) === 75;
  if (!supplierOpeningPassed) throw new Error(`Supplier opening balance did not post exactly once with safe idempotent replay, AP ledger, balanced opening-equity journal and audit: ${JSON.stringify({ ledger: supplierOpeningLedger, evidence: supplierOpeningEvidence.rows[0], replayStatus: supplierOpeningReplay.status, changedPayloadStatus: supplierOpeningChangedPayload.status, duplicateStatus: duplicateSupplierOpening.status, missingKeyStatus: missingSupplierOpeningKey.status })}`);
  const chamber = await request<{ id: string }>("/api/masters/chambers", "POST", {
    name: "Verification chamber", code: `CH-${suffix}`, capacity: 100, capacityUnit: "pieces", sections: 1, location: "Test branch",
  }, token);
  const vehicle = await request<{ id: string }>("/api/masters/vehicles", "POST", {
    name: "Verification truck", code: `V-${suffix}`, vehicleType: "truck", capacity: "", capacityUnit: "",
  }, token);
  const driver = await request<{ id: string }>("/api/masters/drivers", "POST", {
    name: "Verification driver", code: `DL-${suffix}`, licenseType: "LMV", phone: "9876543211",
  }, token);

  const priorBatchDate = await pool.query<{ date: string }>("SELECT (timezone(c.timezone,now())::date-1)::text AS date FROM companies c WHERE c.id=$1", [companyId]);
  const batchStartDate = priorBatchDate.rows[0].date;
  const batch = await request<{ id: string }>("/api/production/batches", "POST", {
    batchCode: `BATCH-${suffix}`, chamberId: chamber.data.id, productId: product.data.id,
    startedOn: batchStartDate, plannedQuantity: 30,
  }, token);
  await request(`/api/production/batches/${batch.data.id}/costs`, "POST", {
    category: "fuel", description: "Disposable kiln fuel cost", amount: 100,
    incurredOn: batchStartDate, fundingAccountCode: "1110", reference: `FUEL-${suffix}`,
  }, token);
  await request(`/api/production/batches/${batch.data.id}/start`, "POST", undefined, token);
  await request(`/api/production/batches/${batch.data.id}/milestones`, "POST", {
    milestone: "firing", loadedQuantity: 28, notes: "Disposable PRD verification kiln load.",
  }, token);
  await request(`/api/production/batches/${batch.data.id}/milestones`, "POST", { milestone: "cooling" }, token);
  await request(`/api/production/batches/${batch.data.id}/milestones`, "POST", { milestone: "unloading" }, token);
  const production = await request<{ lossQuantity: number; outputQuantity: number; quantities: { goodQuantity: number; secondQuantity: number; brokenQuantity: number; rejectedQuantity: number } }>(
    `/api/production/batches/${batch.data.id}/complete`, "POST",
    { goodQuantity: 24, secondQuantity: 2, brokenQuantity: 1, rejectedQuantity: 0, unitCode: "PIECES" }, token,
  );
  const productionEvidence = await pool.query<{
    status: string; loaded_quantity: string; good_quantity: string; second_quantity: string;
    broken_quantity: string; rejected_quantity: string; loss_quantity: string;
    production_stock: string; production_inventory_cost: string; production_layer_value: string;
    production_stock_date: string; production_layer_date: string; completion_journal_date: string; batch_started_on: string;
    gl_inventory_delta: string; wip_balance: string; balanced: boolean; journal_count: number; milestones: number;
  }>(`SELECT b.status,b.started_on::text AS batch_started_on,b.loaded_quantity::text,b.good_quantity::text,b.second_quantity::text,b.broken_quantity::text,b.rejected_quantity::text,b.loss_quantity::text,
      (SELECT COALESCE(sum(sm.quantity),0)::text FROM stock_movements sm WHERE sm.company_id=b.company_id AND sm.batch_id=b.id AND sm.movement_type='production_in') AS production_stock,
      (SELECT (min(sm.occurred_at) AT TIME ZONE c.timezone)::date::text FROM stock_movements sm WHERE sm.company_id=b.company_id AND sm.batch_id=b.id AND sm.movement_type='production_in') AS production_stock_date,
      (SELECT COALESCE(sum(sm.inventory_cost),0)::text FROM stock_movements sm WHERE sm.company_id=b.company_id AND sm.batch_id=b.id AND sm.movement_type='production_in') AS production_inventory_cost,
      (SELECT round(COALESCE(sum(l.remaining_quantity*l.unit_cost),0),2)::text FROM inventory_cost_layers l WHERE l.company_id=b.company_id AND l.source_type='production_batch' AND l.source_id=b.id) AS production_layer_value,
      (SELECT (min(l.occurred_at) AT TIME ZONE c.timezone)::date::text FROM inventory_cost_layers l WHERE l.company_id=b.company_id AND l.source_type='production_batch' AND l.source_id=b.id) AS production_layer_date,
      (SELECT j.effective_date::text FROM journal_entries j WHERE j.company_id=b.company_id AND j.source_type='production_batch_completion' AND j.source_id=b.id) AS completion_journal_date,
      (SELECT COALESCE(sum(jl.debit-jl.credit),0)::text FROM journal_entries j JOIN journal_entry_lines jl ON jl.company_id=j.company_id AND jl.journal_entry_id=j.id JOIN accounts a ON a.company_id=jl.company_id AND a.id=jl.account_id WHERE j.company_id=b.company_id AND a.code='1300' AND ((j.source_type='production_batch_completion' AND j.source_id=b.id) OR (j.source_type='production_cost_line' AND j.source_id IN (SELECT id FROM production_cost_lines WHERE company_id=b.company_id AND batch_id=b.id)))) AS gl_inventory_delta,
      (SELECT COALESCE(sum(jl.debit-jl.credit),0)::text FROM journal_entries j JOIN journal_entry_lines jl ON jl.company_id=j.company_id AND jl.journal_entry_id=j.id JOIN accounts a ON a.company_id=jl.company_id AND a.id=jl.account_id WHERE j.company_id=b.company_id AND a.code='1350' AND ((j.source_type='production_batch_completion' AND j.source_id=b.id) OR (j.source_type='production_cost_line' AND j.source_id IN (SELECT id FROM production_cost_lines WHERE company_id=b.company_id AND batch_id=b.id)))) AS wip_balance,
      (SELECT NOT EXISTS(SELECT 1 FROM journal_entries j JOIN journal_entry_lines jl ON jl.company_id=j.company_id AND jl.journal_entry_id=j.id WHERE j.company_id=b.company_id AND ((j.source_type='production_batch_completion' AND j.source_id=b.id) OR (j.source_type='production_cost_line' AND j.source_id IN (SELECT id FROM production_cost_lines WHERE company_id=b.company_id AND batch_id=b.id))) GROUP BY j.id HAVING sum(jl.debit)<>sum(jl.credit))) AS balanced,
      (SELECT count(*)::int FROM journal_entries j WHERE j.company_id=b.company_id AND ((j.source_type='production_batch_completion' AND j.source_id=b.id) OR (j.source_type='production_cost_line' AND j.source_id IN (SELECT id FROM production_cost_lines WHERE company_id=b.company_id AND batch_id=b.id)))) AS journal_count,
      (SELECT count(*)::int FROM production_batch_milestones m WHERE m.company_id=b.company_id AND m.batch_id=b.id) AS milestones
    FROM production_batches b JOIN companies c ON c.id=b.company_id WHERE b.company_id=$1 AND b.id=$2`, [companyId, batch.data.id]);
  const productionRow = productionEvidence.rows[0];
  const productionToStockPassed = production.data.lossQuantity === 1 && production.data.outputQuantity === 27
    && productionRow?.status === "completed" && Number(productionRow.loaded_quantity) === 28
    && productionRow.batch_started_on < productionRow.production_stock_date
    && productionRow.production_stock_date === productionRow.production_layer_date
    && productionRow.production_layer_date === productionRow.completion_journal_date
    && Number(productionRow.good_quantity) === 24 && Number(productionRow.second_quantity) === 2
    && Number(productionRow.broken_quantity) === 1 && Number(productionRow.rejected_quantity) === 0
    && Number(productionRow.loss_quantity) === 1 && Number(productionRow.production_stock) === 26
    && Number(productionRow.production_inventory_cost) === 100 && Number(productionRow.production_layer_value) === 100
    && Number(productionRow.gl_inventory_delta) === 100 && Number(productionRow.wip_balance) === 0
    && productionRow.balanced === true && productionRow.journal_count === 2 && productionRow.milestones === 6;
  if (!productionToStockPassed) throw new Error(`Production output did not reconcile with stock, dates, milestones and journal: ${JSON.stringify(productionRow)} ${JSON.stringify(production.data)}`);
  await pool.query("UPDATE products SET purchase_tax_rate=5 WHERE company_id=$1 AND id=$2", [companyId, product.data.id]);
  const purchaseOrder = await request<{ id: string }>("/api/purchases/orders", "POST", {
    supplierId: supplier.data.id, productId: product.data.id, orderDate: new Date().toISOString().slice(0, 10), quantity: 5,
  }, token);
  const purchaseOrderList = await expectStatus("/api/purchases/orders", token, 200) as {
    orders?: Array<{ id: string; orderLineId: string; status: string; quantity: number }>;
  };
  const purchaseOrderLine = purchaseOrderList.orders?.find((row) => row.id === purchaseOrder.data.id);
  if (!purchaseOrderLine) throw new Error("Created purchase order line was not visible to its owner.");
  const prematureBillResponse = await fetch(`${api}/api/purchases/orders/${purchaseOrder.data.id}/bills`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Idempotency-Key": `prd-e2e-${suffix}-bill-before-receipt` },
    body: JSON.stringify({ billDate: new Date().toISOString().slice(0, 10), supplierInvoiceNumber: `PRE-${suffix}` }),
  });
  if (prematureBillResponse.status !== 400) throw new Error(`Bill before goods receipt expected 400, received ${prematureBillResponse.status}.`);
  const purchaseReceipt = await request<{ id: string; subtotal: number }>(`/api/purchases/orders/${purchaseOrder.data.id}/receipts`, "POST", {
    receiptDate: new Date().toISOString().slice(0, 10), notes: "Disposable PRD partial supplier receipt 1/2",
    lines: [{ orderLineId: purchaseOrderLine.orderLineId, quantity: 2 }],
  }, token);
  const firstSupplierBill = await request<{ id: string; total: number }>(`/api/purchases/orders/${purchaseOrder.data.id}/bills`, "POST", {
    billDate: new Date().toISOString().slice(0, 10), supplierInvoiceNumber: `INV-${suffix}`,
  }, token);
  const partialPurchaseState = await pool.query<{ status: string; received_quantity: string; billed_quantity: string }>(
    "SELECT o.status,l.received_quantity::text,l.billed_quantity::text FROM purchase_orders o JOIN purchase_order_lines l ON l.company_id=o.company_id AND l.order_id=o.id WHERE o.company_id=$1 AND o.id=$2",
    [companyId, purchaseOrder.data.id],
  );
  if (partialPurchaseState.rows[0]?.status !== "partially_received"
      || Number(partialPurchaseState.rows[0]?.received_quantity) !== 2
      || Number(partialPurchaseState.rows[0]?.billed_quantity) !== 2) {
    throw new Error(`Partial receipt/bill quantities did not persist correctly: ${JSON.stringify(partialPurchaseState.rows[0])}`);
  }
  const excessReceiptResponse = await fetch(`${api}/api/purchases/orders/${purchaseOrder.data.id}/receipts`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Idempotency-Key": `prd-e2e-${suffix}-receipt-overage` },
    body: JSON.stringify({ receiptDate: new Date().toISOString().slice(0, 10), notes: "Must be rejected", lines: [{ orderLineId: purchaseOrderLine.orderLineId, quantity: 4 }] }),
  });
  if (excessReceiptResponse.status !== 409) throw new Error(`Receipt above the remaining order quantity expected 409, received ${excessReceiptResponse.status}.`);
  const firstSupplierPayment = await request<{ id: string }>("/api/purchases/payments", "POST", {
    supplierId: supplier.data.id, billId: firstSupplierBill.data.id, paymentDate: new Date().toISOString().slice(0, 10),
    amount: 5, paymentMethod: "cash", reference: `PAY-PART-${suffix}`,
  }, token);
  const excessPaymentResponse = await fetch(`${api}/api/purchases/payments`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Idempotency-Key": `prd-e2e-${suffix}-payment-overage` },
    body: JSON.stringify({ supplierId: supplier.data.id, billId: firstSupplierBill.data.id, paymentDate: new Date().toISOString().slice(0, 10), amount: firstSupplierBill.data.total - 5 + 0.01, paymentMethod: "cash", reference: `PAY-OVER-${suffix}` }),
  });
  if (excessPaymentResponse.status !== 400) throw new Error(`Payment above the outstanding bill amount expected 400, received ${excessPaymentResponse.status}.`);
  const secondPurchaseReceipt = await request<{ id: string; subtotal: number }>(`/api/purchases/orders/${purchaseOrder.data.id}/receipts`, "POST", {
    receiptDate: new Date().toISOString().slice(0, 10), notes: "Disposable PRD partial supplier receipt 2/2",
    lines: [{ orderLineId: purchaseOrderLine.orderLineId, quantity: 3 }],
  }, token);
  const secondSupplierBill = await request<{ id: string; total: number }>(`/api/purchases/orders/${purchaseOrder.data.id}/bills`, "POST", {
    billDate: new Date().toISOString().slice(0, 10), supplierInvoiceNumber: `INV-2-${suffix}`,
  }, token);
  const remainingFirstBillPayment = await request<{ id: string }>("/api/purchases/payments", "POST", {
    supplierId: supplier.data.id, billId: firstSupplierBill.data.id, paymentDate: new Date().toISOString().slice(0, 10),
    amount: firstSupplierBill.data.total - 5, paymentMethod: "cash", reference: `PAY-REST-${suffix}`,
  }, token);
  const secondBillPayment = await request<{ id: string }>("/api/purchases/payments", "POST", {
    supplierId: supplier.data.id, billId: secondSupplierBill.data.id, paymentDate: new Date().toISOString().slice(0, 10),
    amount: secondSupplierBill.data.total, paymentMethod: "cash", reference: `PAY-2-${suffix}`,
  }, token);
  const purchaseTaxRegister = await expectStatus(`/api/reports/purchases?from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`, token, 200) as {
    rows?: Array<{ billId: string; supplierGstin: string | null; taxRate: number | string; lineSubtotal: number | string; lineTax: number | string }>;
    summary?: { taxableTotal: number | string; inputTaxTotal: number | string };
  };
  const firstTaxBillLine = purchaseTaxRegister.rows?.find(row => row.billId === firstSupplierBill.data.id);
  const secondTaxBillLine = purchaseTaxRegister.rows?.find(row => row.billId === secondSupplierBill.data.id);
  const purchaseTaxRegisterPassed = firstTaxBillLine?.supplierGstin === "33ABCDE1234F1Z5"
    && secondTaxBillLine?.supplierGstin === "33ABCDE1234F1Z5"
    && Number(firstTaxBillLine.taxRate) === 5 && Number(secondTaxBillLine.taxRate) === 5
    && Number(firstTaxBillLine.lineTax) > 0 && Number(secondTaxBillLine.lineTax) > 0
    && Math.abs(Number(purchaseTaxRegister.summary?.taxableTotal ?? NaN) - 25) < 0.01
    && Math.abs(Number(purchaseTaxRegister.summary?.inputTaxTotal ?? NaN) - Number(firstTaxBillLine.lineTax) - Number(secondTaxBillLine.lineTax)) < 0.01;
  if (!purchaseTaxRegisterPassed) throw new Error(`Purchase tax register did not expose the supplier identifiers and bill tax snapshots: ${JSON.stringify({ firstTaxBillLine, secondTaxBillLine, summary: purchaseTaxRegister.summary })}`);
  const purchasePartialLifecyclePassed = partialPurchaseState.rows[0]?.status === "partially_received"
    && Number(partialPurchaseState.rows[0]?.received_quantity) === 2
    && Number(partialPurchaseState.rows[0]?.billed_quantity) === 2
    && prematureBillResponse.status === 400
    && excessReceiptResponse.status === 409 && excessPaymentResponse.status === 400
    && firstSupplierPayment.status === 201 && remainingFirstBillPayment.status === 201 && secondBillPayment.status === 201;
  const supplierLedger = await expectStatus(`/api/purchases/suppliers/${supplier.data.id}/ledger`, token, 200) as { balance?: number };
  const purchaseEvidence = await pool.query<{
    order_status: string; received: string; billed: string; paid: string; outstanding: string;
    receipt_inventory: string; journal_count: number; journals_balanced: boolean;
  }>(`SELECT po.status AS order_status,
      (SELECT COALESCE(sum(l.received_quantity),0)::text FROM purchase_order_lines l WHERE l.company_id=po.company_id AND l.order_id=po.id) AS received,
      (SELECT COALESCE(sum(l.billed_quantity),0)::text FROM purchase_order_lines l WHERE l.company_id=po.company_id AND l.order_id=po.id) AS billed,
      (SELECT COALESCE(sum(p.amount),0)::text FROM supplier_payments p JOIN purchase_bills b ON b.company_id=p.company_id AND b.id=p.bill_id WHERE p.company_id=po.company_id AND b.order_id=po.id) AS paid,
      (SELECT COALESCE(sum(b.total-COALESCE((SELECT sum(p.amount) FROM supplier_payments p WHERE p.company_id=b.company_id AND p.bill_id=b.id),0)),0)::text FROM purchase_bills b WHERE b.company_id=po.company_id AND b.order_id=po.id) AS outstanding,
      (SELECT COALESCE(sum(sm.inventory_cost),0)::text FROM stock_movements sm WHERE sm.company_id=po.company_id AND sm.movement_type='purchase_in' AND sm.reference_type='purchase_receipt' AND sm.reference_id=ANY($2::uuid[])) AS receipt_inventory,
      (SELECT count(*)::int FROM journal_entries j WHERE j.company_id=po.company_id AND ((j.source_type='purchase_receipt' AND j.source_id=ANY($2::uuid[])) OR (j.source_type='purchase_bill' AND j.source_id=ANY($3::uuid[])) OR (j.source_type='supplier_payment' AND j.source_id=ANY($4::uuid[])))) AS journal_count,
      (SELECT NOT EXISTS(SELECT 1 FROM journal_entries j JOIN journal_entry_lines l ON l.company_id=j.company_id AND l.journal_entry_id=j.id WHERE j.company_id=po.company_id AND ((j.source_type='purchase_receipt' AND j.source_id=ANY($2::uuid[])) OR (j.source_type='purchase_bill' AND j.source_id=ANY($3::uuid[])) OR (j.source_type='supplier_payment' AND j.source_id=ANY($4::uuid[]))) GROUP BY j.id HAVING sum(l.debit)<>sum(l.credit))) AS journals_balanced
    FROM purchase_orders po WHERE po.company_id=$1 AND po.id=$5`,
    [companyId, [purchaseReceipt.data.id, secondPurchaseReceipt.data.id], [firstSupplierBill.data.id, secondSupplierBill.data.id], [firstSupplierPayment.data.id, remainingFirstBillPayment.data.id, secondBillPayment.data.id], purchaseOrder.data.id]);
  const purchaseRow = purchaseEvidence.rows[0];
  const purchaseToPaymentPassed = purchaseRow?.order_status === "billed" && Number(purchaseRow.received) === 5
    && Number(purchaseRow.billed) === 5 && Number(purchaseRow.paid) === firstSupplierBill.data.total + secondSupplierBill.data.total
    && Number(purchaseRow.outstanding) === 0 && Number(purchaseRow.receipt_inventory) === 25
    && purchaseRow.journal_count === 7 && purchaseRow.journals_balanced === true
    && Math.abs(Number(supplierLedger.balance)) < 0.005;
  if (!purchaseToPaymentPassed) throw new Error(`Purchase, receipt, bill, payment or supplier ledger did not reconcile: ${JSON.stringify(purchaseRow)}`);

  const location = await pool.query<{ id: string }>(
    "SELECT id FROM stock_locations WHERE company_id=$1 AND branch_id=$2 AND active=true LIMIT 1", [companyId, branchB.data.id],
  );
  if (!location.rowCount) throw new Error("Fresh setup did not create an active stock location.");
  const opening = await request<{ id: string }>("/api/stock/opening-balances", "POST", {
    locationId: location.rows[0].id,
    openingDate: new Date().toISOString().slice(0, 10),
    notes: "Disposable PRD delivery workflow verification",
    lines: [{ productId: product.data.id, quality: "good", quantity: 20, unitCode: "PIECES", unitCost: 5 }],
  }, token);
  const reversalOrder = await request<{ id: string }>("/api/sales/orders", "POST", {
    customerId: customer.data.id, orderDate: new Date().toISOString().slice(0, 10),
    productId: product.data.id, quality: "good", quantity: 1,
  }, token);
  const reversalInvoice = await request<{ id: string }>(`/api/sales/orders/${reversalOrder.data.id}/invoice`, "POST", {}, token);
  await pool.query(`INSERT INTO role_permissions(role_id,permission_id)
    SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='sales.invoice.reverse'
    WHERE r.company_id=$1 AND r.code='manager' ON CONFLICT DO NOTHING`, [companyId]);
  const managerReverseAttempt = await fetch(`${api}/api/sales/invoices/${reversalInvoice.data.id}/reverse`, {
    method: "POST",
    headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json", "Idempotency-Key": `prd-e2e-${suffix}-manager-reversal` },
    body: JSON.stringify({ reversalDate: new Date().toISOString().slice(0, 10), reason: "Verify Owner-only invoice reversal." }),
  });
  const managerReverseBody = await managerReverseAttempt.json() as { error?: { code?: string } };
  if (managerReverseAttempt.status !== 403 || managerReverseBody.error?.code !== "OWNER_REQUIRED") {
    throw new Error(`A Manager with an injected reversal permission was not blocked by the Owner-only guard: ${managerReverseAttempt.status}/${managerReverseBody.error?.code}.`);
  }
  const reversal = await request<{ id: string; reversalNumber: string }>(
    `/api/sales/invoices/${reversalInvoice.data.id}/reverse`, "POST",
    { reversalDate: new Date().toISOString().slice(0, 10), reason: "Disposable PRD invoice reversal verification." }, token,
  );
  const reversalEvidence = await pool.query<{
    invoice_status: string; order_status: string; reversal_count: number; restored_quantity: string;
    journal_count: number; balanced: boolean; audit_events: number;
  }>(`SELECT i.status AS invoice_status,o.status AS order_status,
      (SELECT count(*)::int FROM sales_invoice_reversals r WHERE r.company_id=i.company_id AND r.id=$2) AS reversal_count,
      (SELECT COALESCE(sum(sm.quantity),0)::text FROM stock_movements sm WHERE sm.company_id=i.company_id AND sm.movement_type='sale_reversal_in' AND sm.reference_id=$2) AS restored_quantity,
      (SELECT count(*)::int FROM journal_entries j WHERE j.company_id=i.company_id AND ((j.source_type='sales_invoice' AND j.source_id=i.id) OR (j.source_type='sales_invoice_reversal' AND j.source_id=$2))) AS journal_count,
      (SELECT NOT EXISTS(SELECT 1 FROM journal_entries j JOIN journal_entry_lines l ON l.company_id=j.company_id AND l.journal_entry_id=j.id WHERE j.company_id=i.company_id AND ((j.source_type='sales_invoice' AND j.source_id=i.id) OR (j.source_type='sales_invoice_reversal' AND j.source_id=$2)) GROUP BY j.id HAVING sum(l.debit)<>sum(l.credit))) AS balanced,
      (SELECT count(*)::int FROM audit_logs a WHERE a.company_id=i.company_id AND a.entity_id=$2::text AND a.action='sales.invoice.reverse') AS audit_events
    FROM sales_invoices i JOIN sales_orders o ON o.company_id=i.company_id AND o.id=i.order_id
    WHERE i.company_id=$1 AND i.id=$3`, [companyId, reversal.data.id, reversalInvoice.data.id]);
  const reversalRow = reversalEvidence.rows[0];
  const invoiceReversalPassed = managerReverseAttempt.status === 403 && reversalRow?.invoice_status === "reversed"
    && reversalRow.order_status === "cancelled" && reversalRow.reversal_count === 1
    && Number(reversalRow.restored_quantity) === 1 && reversalRow.journal_count === 2
    && reversalRow.balanced === true && reversalRow.audit_events === 1;
  if (!invoiceReversalPassed) throw new Error(`Invoice reversal did not restore stock and reverse accounting/audit consistently: ${JSON.stringify(reversalRow)}`);

  const approvalFixtures = await pool.query<{ cash_closing_id: string; loading_id: string; commission_id: string }>(
    `WITH cash AS (
       INSERT INTO cash_closings(company_id,closing_number,closing_date,expected_cash,actual_cash,difference,reason,status,recorded_by,branch_id)
       VALUES($1,$2,current_date,0,1,1,'Disposable branch approval filter fixture','pending',$3,$4)
       RETURNING id
     ), loading AS (
       INSERT INTO loading_sessions(company_id,loading_number,invoice_id,customer_id,product_id,quality,planned_quantity,loaded_quantity,verified_quantity,variance,status,verified_by,created_by,branch_id,entered_planned_quantity,entered_unit_code,planned_conversion_to_base,entered_loaded_quantity,loaded_unit_code,loaded_conversion_to_base,entered_verified_quantity,verified_unit_code,verified_conversion_to_base)
       SELECT $1,$5,$6,o.customer_id,l.product_id,'good',1,1,0,-1,'mismatch',$3,$3,$4,1,pu.code,1,1,pu.code,1,0,pu.code,1
       FROM sales_orders o JOIN sales_order_lines l ON l.company_id=o.company_id AND l.order_id=o.id
       JOIN product_units pu ON pu.company_id=l.company_id AND pu.product_id=l.product_id AND pu.is_base=true
       WHERE o.company_id=$1 AND o.id=$7
       ORDER BY l.line_number LIMIT 1
       RETURNING id
     ), commission AS (
       INSERT INTO broker_commissions(company_id,invoice_id,broker_id,commission_type,rate,quantity,basis_amount,accrual_event,commission_amount,created_by)
       SELECT $1,$6,$8,'per_brick',1,1,1,'approval',1,$3
       RETURNING id
     )
     SELECT (SELECT id FROM cash) AS cash_closing_id,(SELECT id FROM loading) AS loading_id,(SELECT id FROM commission) AS commission_id`,
    [companyId, `CC-VERIFY-${suffix}`, ownerId, branchB.data.id, `LOAD-VERIFY-${suffix}`, reversalInvoice.data.id,
      reversalOrder.data.id, broker.data.id],
  );
  const approvalFixtureIds = approvalFixtures.rows[0];
  if (!approvalFixtureIds?.cash_closing_id || !approvalFixtureIds.loading_id || !approvalFixtureIds.commission_id) {
    throw new Error("Disposable branch approval fixtures could not be created.");
  }
  await request("/api/auth/branch", "POST", { branchId: branchB.data.id }, token);
  const branchBApprovals = await expectStatus("/api/approvals", token, 200) as {
    items?: Array<{ id: string; type: string }>;
  };
  const branchBApprovalItems = branchBApprovals.items ?? [];
  const branchBApprovalFiltersPassed = [
    [approvalFixtureIds.cash_closing_id, "cash_close"],
    [approvalFixtureIds.loading_id, "loading"],
    [approvalFixtureIds.commission_id, "broker_commission"],
  ].every(([id, type]) => branchBApprovalItems.some((item) => item.id === id && item.type === type));
  if (!branchBApprovalFiltersPassed) throw new Error("The branch B approval queue omitted a branch B cash, loading, or commission item.");
  await request("/api/auth/branch", "POST", { branchId: branchA.data.id }, token);
  const branchAApprovals = await expectStatus("/api/approvals", token, 200) as {
    items?: Array<{ id: string; type: string }>;
  };
  const branchAApprovalItems = branchAApprovals.items ?? [];
  const crossBranchApprovalLeak = [
    [approvalFixtureIds.cash_closing_id, "cash_close"],
    [approvalFixtureIds.loading_id, "loading"],
    [approvalFixtureIds.commission_id, "broker_commission"],
  ].some(([id, type]) => branchAApprovalItems.some((item) => item.id === id && item.type === type));
  if (crossBranchApprovalLeak) throw new Error("The branch A approval queue exposed branch B cash, loading, or commission work.");
  await request("/api/auth/branch", "POST", { branchId: branchB.data.id }, token);

  const agingInvoiceDate = offsetDate(new Date().toISOString().slice(0, 10), -100);
  const order = await request<{ id: string; status?: string }>("/api/sales/orders", "POST", {
    customerId: customer.data.id,
    brokerId: broker.data.id,
    orderDate: agingInvoiceDate,
    productId: product.data.id,
    quality: "good",
    quantity: 10,
  }, token);
  const invoice = await request<{ id: string; invoiceNumber: string; total: number }>(
    `/api/sales/orders/${order.data.id}/invoice`, "POST", {}, token,
  );
  await request("/api/auth/branch", "POST", { branchId: branchA.data.id }, token);
  const branchADashboard = await request<{ receivables: string }>("/api/dashboard/summary?from=2026-10-01&to=2026-10-08", "GET", undefined, token);
  const branchAReceivablesIsolated = Math.abs(Number(branchADashboard.data.receivables)) < 0.005;
  await request("/api/auth/branch", "POST", { branchId: branchB.data.id }, token);
  const branchBDashboard = await request<{ receivables: string }>("/api/dashboard/summary?from=2026-10-01&to=2026-10-08", "GET", undefined, token);
  const branchBReceivablesVisible = Math.abs(Number(branchBDashboard.data.receivables) - invoice.data.total) < 0.005;
  if (!branchAReceivablesIsolated || !branchBReceivablesVisible) {
    throw new Error(`Dashboard receivables did not follow the selected branch: ${JSON.stringify({ branchA: branchADashboard.data.receivables, branchB: branchBDashboard.data.receivables, expectedBranchB: invoice.data.total })}`);
  }
  const agingToday = (await pool.query<{ today: string }>("SELECT timezone(c.timezone,now())::date::text AS today FROM companies c WHERE c.id=$1", [companyId])).rows[0].today;
  const agingResponse = await request<{ rows: Array<{ invoiceId: string; invoiceDate: string; dueDate: string; creditDays: number; outstanding: number; daysOverdue: number; bucket: string }>; summary: Record<string, number>; asOf: string }>(
    `/api/reports/customer-aging?asOf=${agingToday}`, "GET", undefined, token,
  );
  const agedInvoice = agingResponse.data.rows.find(row => row.invoiceId === invoice.data.id);
  const agingDueDate = offsetDate(agingInvoiceDate, 5);
  const agingDaysOverdue = daysBetween(agingDueDate, agingToday);
  const agingBoundaryExpectations = [
    { daysOverdue: 0, bucket: "current" },
    { daysOverdue: 1, bucket: "1-30" },
    { daysOverdue: 30, bucket: "1-30" },
    { daysOverdue: 31, bucket: "31-60" },
    { daysOverdue: 60, bucket: "31-60" },
    { daysOverdue: 61, bucket: "61-90" },
    { daysOverdue: 90, bucket: "61-90" },
    { daysOverdue: 91, bucket: "90+" },
  ];
  const agingBoundaryResults = await Promise.all(agingBoundaryExpectations.map(async expected => {
    const asOf = offsetDate(agingDueDate, expected.daysOverdue);
    const result = await request<{ rows: Array<{ invoiceId: string; daysOverdue: number; bucket: string }> }>(
      `/api/reports/customer-aging?asOf=${asOf}`, "GET", undefined, token,
    );
    const row = result.data.rows.find(item => item.invoiceId === invoice.data.id);
    return { ...expected, asOf, actualDaysOverdue: row?.daysOverdue, actualBucket: row?.bucket };
  }));
  const customerAgingBoundariesPassed = agingBoundaryResults.every(result =>
    result.actualDaysOverdue === result.daysOverdue && result.actualBucket === result.bucket,
  );
  if (!customerAgingBoundariesPassed) {
    throw new Error(`Customer aging bucket boundaries were incorrect: ${JSON.stringify(agingBoundaryResults)}`);
  }
  await request("/api/auth/branch", "POST", { branchId: branchA.data.id }, token);
  const branchAAging = await request<{ rows?: Array<{ invoiceId: string }>; summary?: { total?: number } }>(
    `/api/reports/customer-aging?asOf=${agingToday}`, "GET", undefined, token,
  );
  await request("/api/auth/branch", "POST", { branchId: branchB.data.id }, token);
  const branchBAging = await request<{ rows?: Array<{ invoiceId: string }>; summary?: { total?: number } }>(
    `/api/reports/customer-aging?asOf=${agingToday}`, "GET", undefined, token,
  );
  await request(`/api/masters/customers/${customer.data.id}`, "PATCH", {
    name: "Delivery verification customer", code: `C-${suffix}`, phone: "9876543210", email: "",
    address: "Updated test address", gstin: "", businessName: "Updated Brick Chamber Trade Customer", whatsappNumber: "+919876543211",
    pan: "ABCDE1234F", customerType: "retail", paymentTerms: "Due on receipt", creditDays: 0, creditLimit: "",
  }, token);
  const agingAfterTermsEdit = await request<{ rows: Array<{ invoiceId: string; dueDate: string; creditDays: number }> }>(
    `/api/reports/customer-aging?asOf=${agingToday}`, "GET", undefined, token,
  );
  const savedDueDateAfterTermsEdit = agingAfterTermsEdit.data.rows.find(row => row.invoiceId === invoice.data.id);
  const customerAgingPassed = agingResponse.data.asOf === agingToday
    && agedInvoice?.dueDate === agingDueDate && Number(agedInvoice.creditDays) === 5
    && Number(agedInvoice.daysOverdue) === agingDaysOverdue && agedInvoice.bucket === "90+"
    && Math.abs(Number(agedInvoice.outstanding) - Number(invoice.data.total)) < 0.005
    && Math.abs(Number(agingResponse.data.summary["90+"]) - Number(invoice.data.total)) < 0.005
    && !branchAAging.data.rows?.some(row => row.invoiceId === invoice.data.id)
    && Number(branchAAging.data.summary?.total ?? 0) === 0
    && branchBAging.data.rows?.some(row => row.invoiceId === invoice.data.id) === true
    && savedDueDateAfterTermsEdit?.dueDate === agingDueDate && Number(savedDueDateAfterTermsEdit.creditDays) === 5;
  if (!customerAgingPassed) throw new Error(`Customer aging failed due-date snapshot, 90+ bucket, invoice balance or branch isolation: ${JSON.stringify({ agedInvoice, agingDueDate, agingDaysOverdue, branchA: branchAAging.data, branchB: branchBAging.data, afterTermsEdit: savedDueDateAfterTermsEdit })}`);
  const invoiceStockAtPosting = await pool.query<{ movement_count: number; quantity: string }>(
    "SELECT count(*)::int AS movement_count,COALESCE(sum(quantity),0)::text AS quantity FROM stock_movements WHERE company_id=$1 AND movement_type='sale_out' AND reference_type='sales_invoice' AND reference_id=$2",
    [companyId, invoice.data.id],
  );
  const invoiceStockReliefPassed = invoiceStockAtPosting.rows[0]?.movement_count === 1
    && Number(invoiceStockAtPosting.rows[0]?.quantity) === 10;
  if (!invoiceStockReliefPassed) throw new Error("Posting the invoice did not create exactly one matching stock-out movement.");
  const reminderBefore = await pool.query<{ journal_count: number; receivable: string }>(`SELECT
    (SELECT count(*)::int FROM journal_entries WHERE company_id=$1 AND source_type='sales_invoice' AND source_id=$2) AS journal_count,
    (SELECT COALESCE(sum(l.debit-l.credit),0)::text FROM journal_entry_lines l JOIN accounts a ON a.company_id=l.company_id AND a.id=l.account_id WHERE l.company_id=$1 AND l.customer_id=$3 AND a.code='1100') AS receivable`, [companyId, invoice.data.id, customer.data.id]);
  const reminderDraft = await request<{ draft: { id: string; customerId: string; customerName: string; outstandingAmount: string; language: string; message: string; status: string } }>("/api/ai/reminder-drafts", "POST", { customerId: customer.data.id, language: "ta" }, token);
  const reminderDraftList = await expectStatus("/api/ai/reminder-drafts", token, 200) as { drafts?: Array<{ id: string }> };
  const reminderAudit = await pool.query("SELECT 1 FROM audit_logs WHERE company_id=$1 AND actor_user_id=$2 AND entity_id=$3::text AND action='ai.payment_reminder.draft.create'", [companyId, ownerId, reminderDraft.data.draft.id]);
  const reminderAfter = await pool.query<{ journal_count: number; receivable: string }>(`SELECT
    (SELECT count(*)::int FROM journal_entries WHERE company_id=$1 AND source_type='sales_invoice' AND source_id=$2) AS journal_count,
    (SELECT COALESCE(sum(l.debit-l.credit),0)::text FROM journal_entry_lines l JOIN accounts a ON a.company_id=l.company_id AND a.id=l.account_id WHERE l.company_id=$1 AND l.customer_id=$3 AND a.code='1100') AS receivable`, [companyId, invoice.data.id, customer.data.id]);
  const managerReminderAttempt = await fetch(`${api}/api/ai/reminder-drafts`, { method: "POST", headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ customerId: customer.data.id, language: "en" }) });
  const paymentReminderDraftPassed = reminderDraft.data.draft.customerId === customer.data.id
    && reminderDraft.data.draft.customerName === "Delivery verification customer"
    && Number(reminderDraft.data.draft.outstandingAmount) === Number(invoice.data.total)
    && reminderDraft.data.draft.language === "ta" && reminderDraft.data.draft.status === "draft"
    && reminderDraft.data.draft.message.includes("அன்புள்ள")
    && reminderDraftList.drafts?.some(draft => draft.id === reminderDraft.data.draft.id)
    && reminderAudit.rowCount === 1
    && reminderBefore.rows[0].journal_count === reminderAfter.rows[0].journal_count
    && Number(reminderBefore.rows[0].receivable) === Number(reminderAfter.rows[0].receivable)
    && managerReminderAttempt.status === 403;
  if (!paymentReminderDraftPassed) throw new Error("The reminder draft was not saved, audited, owner-restricted, or financially read-only.");
  const loading = await request<{ id: string; status?: string }>("/api/loading", "POST", {
    invoiceId: invoice.data.id, vehicleId: vehicle.data.id, driverId: driver.data.id, destination: "Verification destination",
  }, token);
  const testPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4RkAAAAASUVORK5CYII=";
  const beforePhotoBody = { photoType: "before", contentType: "image/png", imageBase64: testPngBase64 };
  const beforePhotoKey = `prd-e2e-${suffix}-photo-before-retry`;
  const beforePhoto = await request<{ id: string }>(`/api/loading/${loading.data.id}/photos`, "POST", beforePhotoBody, token, beforePhotoKey);
  // Model the client losing the first response and retrying the saved photo draft after reconnect.
  const beforePhotoRetry = await request<{ id: string }>(`/api/loading/${loading.data.id}/photos`, "POST", beforePhotoBody, token, beforePhotoKey);
  const beforePhotoEvidence = await pool.query<{ photo_count: number; audit_count: number; retry_count: number }>(
    `SELECT
       (SELECT count(*)::int FROM loading_photos WHERE company_id=$1 AND loading_session_id=$2 AND photo_type='before') AS photo_count,
       (SELECT count(*)::int FROM audit_logs WHERE company_id=$1 AND actor_user_id=$3 AND entity_type='loading_photo' AND entity_id=$4::text) AS audit_count,
       (SELECT count(*)::int FROM transaction_idempotency_keys WHERE company_id=$1 AND user_id=$3 AND operation=$5 AND request_key=$6) AS retry_count`,
    [companyId, loading.data.id, ownerId, beforePhoto.data.id, `loading.photo:${loading.data.id}`, beforePhotoKey],
  );
  const loadingPhotoRetryExactlyOnce = beforePhoto.status === 201 && beforePhotoRetry.status === 201
    && beforePhoto.data.id === beforePhotoRetry.data.id
    && beforePhotoEvidence.rows[0]?.photo_count === 1
    && beforePhotoEvidence.rows[0]?.audit_count === 1
    && beforePhotoEvidence.rows[0]?.retry_count === 1;
  if (!loadingPhotoRetryExactlyOnce) throw new Error("Retrying a saved loading photo after a lost response created duplicate evidence/audit effects or did not replay the original result.");
  await request(`/api/loading/${loading.data.id}/complete`, "POST", { quantity: 10 }, token);
  await request(`/api/loading/${loading.data.id}/photos`, "POST", {
    photoType: "during", contentType: "image/png", imageBase64: testPngBase64,
  }, token);
  const verified = await request<{ status: string; variance: number }>(
    `/api/loading/${loading.data.id}/verify`, "POST", { quantity: 10 }, token,
  );
  if (verified.data.status !== "verified" || verified.data.variance !== 0) throw new Error("Matching loading quantity did not verify cleanly.");
  await request(`/api/loading/${loading.data.id}/photos`, "POST", {
    photoType: "after", contentType: "image/png", imageBase64: testPngBase64,
  }, token);
  const loadingWithPhotos = await expectStatus(`/api/loading/${loading.data.id}`, token, 200) as {
    photos?: Array<{ photoType: string; byteSize: number; imageBase64: string }>;
  };
  const loadingPhotosPassed = loadingWithPhotos.photos?.length === 3
    && ["before", "during", "after"].every((type) => loadingWithPhotos.photos?.some((photo) => photo.photoType === type
      && Number(photo.byteSize) > 0
      && photo.imageBase64.replace(/\s/g, "").replace(/=+$/g, "") === testPngBase64.replace(/=+$/g, "")));
  if (!loadingPhotosPassed) throw new Error(`Loading photo evidence did not round-trip with its stage, content and size metadata: ${JSON.stringify(loadingWithPhotos.photos?.map(({ photoType, byteSize, imageBase64 }) => ({ photoType, byteSize, base64Length: imageBase64.length })))}`);

  const branchBDetails = await Promise.all([
    expectStatus(`/api/sales/orders/${order.data.id}`, token, 200),
    expectStatus(`/api/loading/${loading.data.id}`, token, 200),
    expectStatus(`/api/purchases/orders/${purchaseOrder.data.id}`, token, 200),
    expectStatus(`/api/purchases/bills/${firstSupplierBill.data.id}`, token, 200),
    expectStatus(`/api/production/batches/${batch.data.id}/costs`, token, 200),
    expectStatus(`/api/production/batches/${batch.data.id}/milestones`, token, 200),
  ]);
  const branchBLists = await Promise.all([
    expectStatus("/api/sales/invoices", token, 200),
    expectStatus("/api/purchases/bills", token, 200),
  ]) as Array<{ invoices?: Array<{ id: string }>; bills?: Array<{ id: string }> }>;
  const branchBTransactionListsPassed = branchBLists[0].invoices?.some((item) => item.id === invoice.data.id) === true
    && branchBLists[1].bills?.some((item) => item.id === firstSupplierBill.data.id) === true;
  if (!branchBTransactionListsPassed) throw new Error("Branch B did not list its sales invoice and supplier bill.");
  const branchBCoreLists = await Promise.all([
    expectStatus("/api/sales/orders", token, 200),
    expectStatus("/api/purchases/orders", token, 200),
    expectStatus("/api/production/batches", token, 200),
    expectStatus("/api/loading", token, 200),
    expectStatus("/api/reports/production", token, 200),
    expectStatus("/api/reports/loading", token, 200),
    expectStatus("/api/reports/sales-register", token, 200),
    expectStatus("/api/stock/balances", token, 200),
    expectStatus("/api/stock/movements", token, 200),
    expectStatus("/api/reports/stock", token, 200),
    expectStatus("/api/reports/purchases", token, 200),
    expectStatus("/api/reports/broker-commissions", token, 200),
  ]);
  const branchBCoreListsPassed = containsListRow(branchBCoreLists[0], "orders", { id: order.data.id })
    && containsListRow(branchBCoreLists[1], "orders", { id: purchaseOrder.data.id })
    && containsListRow(branchBCoreLists[2], "batches", { id: batch.data.id })
    && containsListRow(branchBCoreLists[3], "loading", { id: loading.data.id })
    && containsListRow(branchBCoreLists[4], "rows", { id: batch.data.id })
    && containsListRow(branchBCoreLists[5], "rows", { id: loading.data.id })
    && containsListRow(branchBCoreLists[6], "rows", { invoiceId: invoice.data.id })
    && containsListRow(branchBCoreLists[7], "balances", { productId: product.data.id, locationId: location.rows[0].id })
    && containsListRow(branchBCoreLists[8], "movements", { locationId: location.rows[0].id, referenceId: invoice.data.id })
    && containsListRow(branchBCoreLists[9], "balances", { productId: product.data.id, locationId: location.rows[0].id })
    && containsListRow(branchBCoreLists[9], "movements", { locationId: location.rows[0].id, referenceId: invoice.data.id })
    && containsListRow(branchBCoreLists[10], "rows", { billId: firstSupplierBill.data.id })
    && containsListRow(branchBCoreLists[11], "rows", { invoiceId: invoice.data.id, brokerId: broker.data.id });
  if (!branchBCoreListsPassed) throw new Error("Branch B core lists or reports did not include its sales, purchase, production, loading, stock, purchase-register or broker-commission records.");
  const returnProduct = await request<{ id: string }>("/api/masters/products", "POST", {
    name: "Branch return isolation brick", code: `RET-${suffix}`, unit: "pieces", sellingRate: 12,
    taxRate: 0, purchaseRate: 5, purchaseTaxRate: 0,
  }, token);
  const branchBStockReturn = await request<{ id: string }>("/api/stock/returns", "POST", {
    customerId: customer.data.id, locationId: location.rows[0].id, returnDate: payrollDate,
    reference: `STOCK-RET-B-${suffix}`, reason: "Disposable branch-isolation return test.",
    lines: [{ productId: returnProduct.data.id, quality: "good", quantity: 2, unitCode: "PIECES", unitCost: 5 }],
  }, token, `prd-${suffix}-branch-b-stock-return`);
  const branchBStockReturnList = await expectStatus("/api/stock/returns", token, 200) as { returns?: Array<{ id: string; branchId: string | null }> };
  const branchBStockReturnListed = branchBStockReturnList.returns?.some((item) => item.id === branchBStockReturn.data.id && item.branchId === branchB.data.id) === true;
  if (!branchBStockReturnListed) throw new Error("Branch B did not list its own stock return with its branch attribution.");
  const branchBExpense = await request<{ id: string; status: string }>("/api/expenses", "POST", {
    ...offlineExpenseBody, amount: 160, reference: `EXP-B-${suffix}`, vehicleReference: `B-${reportVehicle}`,
  }, token, `prd-${suffix}-branch-b-expense`);
  if (branchBExpense.data.status !== "pending_approval") throw new Error("Branch B expense fixture was not queued for approval.");
  const crossBranchExpenseReject = await fetch(`${api}/api/expenses/${branchBExpense.data.id}/reject`, {
    method: "POST",
    headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json", "Idempotency-Key": `prd-${suffix}-cross-branch-expense-reject` },
    body: JSON.stringify({ reason: "Cross-branch rejection attempt." }),
  });
  const branchBExpenseAfterRejectAttempt = await pool.query<{ status: string }>("SELECT status FROM expenses WHERE company_id=$1 AND id=$2", [companyId, branchBExpense.data.id]);
  const crossBranchExpenseRejectDenied = crossBranchExpenseReject.status === 404 && branchBExpenseAfterRejectAttempt.rows[0]?.status === "pending_approval";
  if (!crossBranchExpenseRejectDenied) throw new Error(`A Branch A Manager changed an expense in Branch B (HTTP ${crossBranchExpenseReject.status}, state ${branchBExpenseAfterRejectAttempt.rows[0]?.status}).`);
  const productionAuditPath = `/api/audit/logs?search=${encodeURIComponent(batch.data.id)}&entityType=production_batch`;
  const branchBAudit = await expectStatus(productionAuditPath, token, 200) as { events?: unknown[] };
  if (!branchBAudit.events?.length) throw new Error("Branch B did not receive its production batch audit event.");
  const branchBOwnExpenseAudit = await expectStatus(`/api/audit/logs?search=${encodeURIComponent(branchBExpense.data.id)}&entityType=expense`, token, 200) as { events?: Array<{ action: string }> };
  if (!branchBOwnExpenseAudit.events?.some((event) => event.action === "expense.submit_for_approval")) throw new Error("Branch B did not receive its own expense submission audit event.");
  const branchBExpenseAudit = await expectStatus(`/api/audit/logs?search=${encodeURIComponent(expense.data.id)}&entityType=expense`, token, 200) as { events?: Array<{ action: string }> };
  if (branchBExpenseAudit.events?.length) throw new Error("Branch B received audit events for a Branch A expense.");
  const productionAuditByReference = await expectStatus(`/api/audit/logs?search=${encodeURIComponent(`BATCH-${suffix}`)}&entityType=production_batch`, token, 200) as { events?: Array<{ afterData?: { batchCode?: string } }> };
  if (!productionAuditByReference.events?.some((event) => event.afterData?.batchCode === `BATCH-${suffix}`)) {
    throw new Error("Audit search did not find a production batch by its human-readable batch code in the saved change snapshot.");
  }

  const tooEarly = await fetch(`${api}/api/loading/${loading.data.id}/deliver`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": `prd-e2e-${suffix}-early-delivery` },
  });
  if (tooEarly.status !== 409) throw new Error(`Delivery before dispatch should return 409; received ${tooEarly.status}.`);
  await request(`/api/loading/${loading.data.id}/dispatch`, "POST", undefined, token);
  const photoAfterDispatch = await fetch(`${api}/api/loading/${loading.data.id}/photos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": `prd-e2e-${suffix}-photo-after-dispatch` },
    body: JSON.stringify({ photoType: "after", contentType: "image/png", imageBase64: testPngBase64 }),
  });
  if (photoAfterDispatch.status !== 409) throw new Error(`Loading evidence after dispatch should return 409; received ${photoAfterDispatch.status}.`);
  await request(`/api/loading/${loading.data.id}/deliver`, "POST", undefined, token);
  const stockAfterDelivery = await pool.query<{ movement_count: number; quantity: string }>(
    "SELECT count(*)::int AS movement_count,COALESCE(sum(CASE WHEN direction='out' THEN quantity ELSE -quantity END),0)::text AS quantity FROM stock_movements WHERE company_id=$1 AND ((reference_type='sales_invoice' AND reference_id=$2) OR (reference_type='loading_session' AND reference_id=$3))",
    [companyId, invoice.data.id, loading.data.id],
  );
  const stockReliefTimingPassed = invoiceStockReliefPassed && stockAfterDelivery.rows[0]?.movement_count === 1
    && Number(stockAfterDelivery.rows[0]?.quantity) === 10;
  if (!stockReliefTimingPassed) throw new Error("Loading and delivery changed or duplicated the invoice's stock-out movement.");

  const receipt = await request<{ id: string }>("/api/sales/receipts", "POST", {
    customerId: customer.data.id, invoiceId: invoice.data.id, receiptDate: new Date().toISOString().slice(0, 10),
    amount: invoice.data.total, paymentMethod: "cash", reference: "Delivery verification receipt",
  }, token);
  const agingAfterReceipt = await request<{ rows: Array<{ invoiceId: string; outstanding: number }>; asOf: string }>(
    `/api/reports/customer-aging?asOf=${agingToday}`, "GET", undefined, token,
  );
  const customerAgingSettledPassed = agingAfterReceipt.data.asOf === agingToday
    && !agingAfterReceipt.data.rows.some((row) => row.invoiceId === invoice.data.id);
  if (!customerAgingSettledPassed) {
    throw new Error(`A fully settled invoice remained in customer aging: ${JSON.stringify({ invoiceId: invoice.data.id, asOf: agingAfterReceipt.data.asOf, row: agingAfterReceipt.data.rows.find((row) => row.invoiceId === invoice.data.id) })}`);
  }
  const staleReminderDraftAttempt = await fetch(`${api}/api/ai/reminder-drafts`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ customerId: customer.data.id, language: "en" }) });
  const staleReminderBalanceDenied = staleReminderDraftAttempt.status === 409;
  const customerLedger = await expectStatus(`/api/sales/customers/${customer.data.id}/ledger`, token, 200) as {
    balance?: number;
  };
  const commissionList = await expectStatus("/api/broker-commissions", token, 200) as {
    commissions?: Array<{ id: string; brokerId: string; invoiceId: string; commissionAmount: number; accruedAmount: number; payableAmount: number }>;
  };
  const commission = commissionList.commissions?.find((item) => item.brokerId === broker.data.id && item.invoiceId === invoice.data.id);
  const customerReceiptJournal = await pool.query<{ debit: string; credit: string }>(
    `SELECT COALESCE(sum(l.debit),0)::text AS debit,COALESCE(sum(l.credit),0)::text AS credit
     FROM journal_entries j JOIN journal_entry_lines l ON l.company_id=j.company_id AND l.journal_entry_id=j.id
     WHERE j.company_id=$1 AND j.source_type='customer_receipt' AND j.source_id=$2`,
    [companyId, receipt.data.id],
  );
  const receiptAndCommissionPassed = Math.abs(Number(customerLedger.balance)) < 0.005
    && Number(customerReceiptJournal.rows[0]?.debit) === invoice.data.total
    && Number(customerReceiptJournal.rows[0]?.credit) === invoice.data.total
    && Number(commission?.commissionAmount) === 10 && Number(commission?.accruedAmount) === 10 && Number(commission?.payableAmount) === 10;
  if (!receiptAndCommissionPassed || !commission) throw new Error("Customer payment, receivable ledger, or payment-triggered broker commission did not reconcile.");
  const brokerPayment = await request<{ id: string }>(`/api/broker-commissions/${commission.id}/payments`, "POST", {
    paymentDate: new Date().toISOString().slice(0, 10), amount: 10, paymentMethod: "cash", reference: "Verification payout",
  }, token);
  const brokerLedgerAfterPayment = await expectStatus(`/api/brokers/${broker.data.id}/ledger`, token, 200) as {
    balance?: number;
  };
  const brokerPaymentJournal = await pool.query<{ debit: string; credit: string }>(
    `SELECT COALESCE(sum(l.debit),0)::text AS debit,COALESCE(sum(l.credit),0)::text AS credit
     FROM journal_entries j JOIN journal_entry_lines l ON l.company_id=j.company_id AND l.journal_entry_id=j.id
     WHERE j.company_id=$1 AND j.source_type='broker_commission_payment' AND j.source_id=$2`,
    [companyId, brokerPayment.data.id],
  );
  const brokerSettlementPassed = Math.abs(Number(brokerLedgerAfterPayment.balance)) < 0.005
    && Number(brokerPaymentJournal.rows[0]?.debit) === 10 && Number(brokerPaymentJournal.rows[0]?.credit) === 10;
  if (!brokerSettlementPassed) throw new Error("Broker payment did not clear the commission payable with a balanced journal.");

  await request("/api/auth/branch", "POST", { branchId: branchA.data.id }, token);
  const branchALists = await Promise.all([
    expectStatus("/api/sales/invoices", token, 200),
    expectStatus("/api/purchases/bills", token, 200),
  ]) as Array<{ invoices?: Array<{ id: string }>; bills?: Array<{ id: string }> }>;
  const branchATransactionListsExclude = !branchALists[0].invoices?.some((item) => item.id === invoice.data.id)
    && !branchALists[1].bills?.some((item) => item.id === firstSupplierBill.data.id);
  if (!branchATransactionListsExclude) throw new Error("Branch A transaction lists exposed a branch B sales invoice or supplier bill.");
  const branchACoreLists = await Promise.all([
    expectStatus("/api/sales/orders", token, 200),
    expectStatus("/api/purchases/orders", token, 200),
    expectStatus("/api/production/batches", token, 200),
    expectStatus("/api/loading", token, 200),
    expectStatus("/api/reports/production", token, 200),
    expectStatus("/api/reports/loading", token, 200),
    expectStatus("/api/reports/sales-register", token, 200),
    expectStatus("/api/stock/balances", token, 200),
    expectStatus("/api/stock/movements", token, 200),
    expectStatus("/api/reports/stock", token, 200),
    expectStatus("/api/reports/purchases", token, 200),
    expectStatus("/api/reports/broker-commissions", token, 200),
  ]);
  const branchACoreListsExclude = !containsListRow(branchACoreLists[0], "orders", { id: order.data.id })
    && !containsListRow(branchACoreLists[1], "orders", { id: purchaseOrder.data.id })
    && !containsListRow(branchACoreLists[2], "batches", { id: batch.data.id })
    && !containsListRow(branchACoreLists[3], "loading", { id: loading.data.id })
    && !containsListRow(branchACoreLists[4], "rows", { id: batch.data.id })
    && !containsListRow(branchACoreLists[5], "rows", { id: loading.data.id })
    && !containsListRow(branchACoreLists[6], "rows", { invoiceId: invoice.data.id })
    && !containsListRow(branchACoreLists[7], "balances", { productId: product.data.id, locationId: location.rows[0].id })
    && !containsListRow(branchACoreLists[8], "movements", { locationId: location.rows[0].id, referenceId: invoice.data.id })
    && !containsListRow(branchACoreLists[9], "balances", { productId: product.data.id, locationId: location.rows[0].id })
    && !containsListRow(branchACoreLists[9], "movements", { locationId: location.rows[0].id, referenceId: invoice.data.id })
    && !containsListRow(branchACoreLists[10], "rows", { billId: firstSupplierBill.data.id })
    && !containsListRow(branchACoreLists[11], "rows", { invoiceId: invoice.data.id, brokerId: broker.data.id });
  if (!branchACoreListsExclude) throw new Error("Branch A core lists or reports exposed branch B sales, purchase, production, loading, stock, purchase-register or broker-commission records.");
  const branchAStockReturnList = await expectStatus("/api/stock/returns", token, 200) as { returns?: Array<{ id: string }> };
  const branchAStockReturnExcluded = !branchAStockReturnList.returns?.some((item) => item.id === branchBStockReturn.data.id);
  const crossBranchStockReturnCreate = await postRaw("/api/stock/returns", {
    customerId: customer.data.id, locationId: location.rows[0].id, returnDate: payrollDate,
    reference: `STOCK-RET-DENIED-${suffix}`, reason: "Attempt cross-branch stock return.",
    lines: [{ productId: returnProduct.data.id, quality: "good", quantity: 1, unitCode: "PIECES", unitCost: 5 }],
  }, token, `prd-${suffix}-cross-branch-stock-return`);
  const crossBranchStockReturnDenied = crossBranchStockReturnCreate.status === 400 && branchAStockReturnExcluded;
  if (!crossBranchStockReturnDenied) throw new Error(`Branch A exposed or accepted a Branch B stock return (HTTP ${crossBranchStockReturnCreate.status}).`);
  const crossBranchStatuses = await Promise.all([
    expectStatus(`/api/sales/orders/${order.data.id}`, token, 404),
    expectStatus(`/api/loading/${loading.data.id}`, token, 404),
    expectStatus(`/api/purchases/orders/${purchaseOrder.data.id}`, token, 404),
    expectStatus(`/api/purchases/bills/${firstSupplierBill.data.id}`, token, 404),
    expectStatus(`/api/production/batches/${batch.data.id}/costs`, token, 404),
    expectStatus(`/api/production/batches/${batch.data.id}/milestones`, token, 404),
  ]);
  const branchAAudit = await expectStatus(productionAuditPath, token, 200) as { events?: unknown[] };
  if (branchAAudit.events?.length) throw new Error("Branch A received audit events for a branch-B production batch.");
  const branchAExpenseAudit = await expectStatus(`/api/audit/logs?search=${encodeURIComponent(expense.data.id)}&entityType=expense`, token, 200) as { events?: Array<{ action: string }> };
  const branchAExpenseAuditScoped = branchAExpenseAudit.events?.filter((event) => event.action === "expense.submit_for_approval" || event.action === "expense.approve").length === 2;
  if (!branchAExpenseAuditScoped) throw new Error("Branch A did not receive its own expense submission and approval audit events.");
  const managerBranchBDetails = await Promise.all([
    expectStatus(`/api/sales/orders/${order.data.id}`, managerToken, 404),
    expectStatus(`/api/loading/${loading.data.id}`, managerToken, 404),
    expectStatus(`/api/purchases/orders/${purchaseOrder.data.id}`, managerToken, 404),
    expectStatus(`/api/purchases/bills/${firstSupplierBill.data.id}`, managerToken, 404),
    expectStatus(`/api/production/batches/${batch.data.id}/costs`, managerToken, 404),
    expectStatus(`/api/production/batches/${batch.data.id}/milestones`, managerToken, 404),
  ]);
  const managerBranchAudit = await expectStatus(productionAuditPath, managerToken, 200) as { events?: unknown[] };
  if (managerBranchAudit.events?.length) throw new Error("Branch A Manager received audit events for a branch-B production batch.");

  const branchBPartnerLedgers = await Promise.all([
    verifyBranchPartnerLedger(companyId, token, branchB.data.id, "customer", customer.data.id, `/api/sales/customers/${customer.data.id}/ledger`),
    verifyBranchPartnerLedger(companyId, token, branchB.data.id, "supplier", supplier.data.id, `/api/purchases/suppliers/${supplier.data.id}/ledger`),
    verifyBranchPartnerLedger(companyId, token, branchB.data.id, "broker", broker.data.id, `/api/brokers/${broker.data.id}/ledger`),
  ]);
  const branchAPartnerLedgers = await Promise.all([
    verifyBranchPartnerLedger(companyId, token, branchA.data.id, "customer", customer.data.id, `/api/sales/customers/${customer.data.id}/ledger`),
    verifyBranchPartnerLedger(companyId, token, branchA.data.id, "supplier", supplier.data.id, `/api/purchases/suppliers/${supplier.data.id}/ledger`),
    verifyBranchPartnerLedger(companyId, token, branchA.data.id, "broker", broker.data.id, `/api/brokers/${broker.data.id}/ledger`),
  ]);
  const branchPartnerLedgersPassed = [...branchBPartnerLedgers, ...branchAPartnerLedgers].every(ledger => ledger.passed);
  if (!branchPartnerLedgersPassed) {
    throw new Error(`Branch customer, supplier or broker ledger did not match branch-filtered SQL: ${JSON.stringify({ branchBPartnerLedgers, branchAPartnerLedgers })}`);
  }
  await request("/api/auth/branch", "POST", { branchId: null }, token);
  const branchManagerBEmail = `reconcile-manager-${suffix}@example.test`;
  const branchManagerBPassword = `Reconcile-${randomBytes(12).toString("base64url")}-9A`;
  const branchManagerB = await request<{ id: string }>("/api/admin/access/users", "POST", {
    fullName: "Branch B Reconciliation Manager", email: branchManagerBEmail,
    password: branchManagerBPassword, roleIds: [managerRole.id], branchIds: [branchB.data.id],
  }, token);
  const branchManagerBLogin = await request<{ token: string }>("/api/auth/login", "POST", { email: branchManagerBEmail, password: branchManagerBPassword });
  const branchManagerBToken = branchManagerBLogin.data.token;
  if (!branchManagerBToken) throw new Error("Branch B reconciliation manager login did not return a session token.");
  await request("/api/auth/branch", "POST", { branchId: branchB.data.id }, branchManagerBToken);
  const controlAccountIds = await pool.query<{ code: string; id: string }>("SELECT code,id FROM accounts WHERE company_id=$1 AND code=ANY($2::text[])", [companyId, ["1100", "3000"]]);
  const receivableAccount = controlAccountIds.rows.find(account => account.code === "1100");
  const equityAccount = controlAccountIds.rows.find(account => account.code === "3000");
  if (!receivableAccount || !equityAccount) throw new Error("Fresh chart of accounts is missing the receivable or opening-equity control account.");
  const unallocatedJournal = await request<{ id: string }>("/api/accounting/manual-journals", "POST", {
    effectiveDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()),
    description: "Reconciliation fixture without partner tag", reason: "Verify unallocated control balance display",
    lines: [
      { accountId: receivableAccount.id, description: "Unassigned receivable test line", debit: 7, credit: 0 },
      { accountId: equityAccount.id, description: "Reconciliation fixture offset", debit: 0, credit: 7 },
    ],
  }, branchManagerBToken);
  await request("/api/auth/branch", "POST", { branchId: branchA.data.id }, token);
  const crossBranchJournalDecision = await fetch(`${api}/api/accounting/manual-journals/${unallocatedJournal.data.id}/decision`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": `prd-${suffix}-cross-branch-manual-journal-decision` },
    body: JSON.stringify({ approve: true, reason: "Cross-branch approval attempt." }),
  });
  const crossBranchJournalDecisionDenied = crossBranchJournalDecision.status === 409;
  if (!crossBranchJournalDecisionDenied) throw new Error(`Branch A Owner changed a pending Branch B manual journal (HTTP ${crossBranchJournalDecision.status}).`);
  await request("/api/auth/branch", "POST", { branchId: branchB.data.id }, token);
  const unallocatedJournalDecision = await request<{ status: string }>(`/api/accounting/manual-journals/${unallocatedJournal.data.id}/decision`, "POST", { approve: true, reason: "Approve isolated reconciliation fixture" }, token);
  if (unallocatedJournalDecision.data.status !== "posted") throw new Error("Branch B unallocated reconciliation fixture was not posted.");
  const branchBManualJournalAudit = await expectStatus(`/api/audit/logs?search=${encodeURIComponent(unallocatedJournal.data.id)}&entityType=manual_journal_request`, token, 200) as { events?: Array<{ action: string }> };
  const branchBManualJournalAuditScoped = branchBManualJournalAudit.events?.some(event => event.action === "accounting.manual_journal.request")
    && branchBManualJournalAudit.events?.some(event => event.action === "accounting.manual_journal.posted");
  await request("/api/auth/branch", "POST", { branchId: branchA.data.id }, token);
  const branchAManualJournalAudit = await expectStatus(`/api/audit/logs?search=${encodeURIComponent(unallocatedJournal.data.id)}&entityType=manual_journal_request`, token, 200) as { events?: unknown[] };
  const branchAManualJournalAuditExcluded = branchAManualJournalAudit.events?.length === 0;
  await request("/api/auth/branch", "POST", { branchId: branchB.data.id }, token);
  if (!crossBranchJournalDecisionDenied || !branchBManualJournalAuditScoped || !branchAManualJournalAuditExcluded) {
    throw new Error(`Manual-journal branch scope failed: ${JSON.stringify({ crossBranchJournalDecisionStatus: crossBranchJournalDecision.status, branchBManualJournalAudit, branchAManualJournalAudit })}`);
  }
  const branchAuditOwnership = await pool.query<{ checked: number; mismatches: number }>(`WITH source_branches(entity_type,entity_id,branch_id) AS (
    SELECT 'production_batch',id::text,branch_id FROM production_batches WHERE company_id=$1
    UNION ALL SELECT 'sales_order',id::text,branch_id FROM sales_orders WHERE company_id=$1
    UNION ALL SELECT 'sales_invoice',id::text,branch_id FROM sales_invoices WHERE company_id=$1
    UNION ALL SELECT 'sales_return',id::text,branch_id FROM sales_returns WHERE company_id=$1
    UNION ALL SELECT 'customer_receipt',id::text,branch_id FROM customer_receipts WHERE company_id=$1
    UNION ALL SELECT 'customer_receipt_allocation',id::text,branch_id FROM customer_receipt_allocations WHERE company_id=$1
    UNION ALL SELECT 'customer_credit_application',id::text,branch_id FROM customer_credit_applications WHERE company_id=$1
    UNION ALL SELECT 'customer_refund',id::text,branch_id FROM customer_refunds WHERE company_id=$1
    UNION ALL SELECT 'sales_invoice_reversal',id::text,branch_id FROM sales_invoice_reversals WHERE company_id=$1
    UNION ALL SELECT 'purchase_order',id::text,branch_id FROM purchase_orders WHERE company_id=$1
    UNION ALL SELECT 'purchase_receipt',id::text,branch_id FROM purchase_receipts WHERE company_id=$1
    UNION ALL SELECT 'purchase_bill',id::text,branch_id FROM purchase_bills WHERE company_id=$1
    UNION ALL SELECT 'supplier_payment',id::text,branch_id FROM supplier_payments WHERE company_id=$1
    UNION ALL SELECT 'purchase_return',id::text,branch_id FROM purchase_returns WHERE company_id=$1
    UNION ALL SELECT 'purchase_return_allocation',id::text,branch_id FROM purchase_return_allocations WHERE company_id=$1
    UNION ALL SELECT 'purchase_return_refund',id::text,branch_id FROM purchase_return_refunds WHERE company_id=$1
    UNION ALL SELECT 'loading_session',id::text,branch_id FROM loading_sessions WHERE company_id=$1
    UNION ALL SELECT 'loading_photo',p.id::text,l.branch_id FROM loading_photos p JOIN loading_sessions l ON l.company_id=p.company_id AND l.id=p.loading_session_id WHERE p.company_id=$1
    UNION ALL SELECT 'production_cost_line',l.id::text,b.branch_id FROM production_cost_lines l JOIN production_batches b ON b.company_id=l.company_id AND b.id=l.batch_id WHERE l.company_id=$1
    UNION ALL SELECT 'stock_location',id::text,branch_id FROM stock_locations WHERE company_id=$1
    UNION ALL SELECT 'stock_opening_balance',o.id::text,l.branch_id FROM stock_opening_balances o JOIN stock_locations l ON l.company_id=o.company_id AND l.id=o.location_id WHERE o.company_id=$1
    UNION ALL SELECT 'stocktake',s.id::text,l.branch_id FROM stocktakes s JOIN stock_locations l ON l.company_id=s.company_id AND l.id=s.location_id WHERE s.company_id=$1
    UNION ALL SELECT 'stock_adjustment',m.id::text,l.branch_id FROM stock_movements m JOIN stock_locations l ON l.company_id=m.company_id AND l.id=m.location_id WHERE m.company_id=$1
    UNION ALL SELECT 'stock_transfer',t.id::text,CASE WHEN source.branch_id IS NOT DISTINCT FROM destination.branch_id THEN source.branch_id WHEN source.branch_id IS NULL THEN destination.branch_id WHEN destination.branch_id IS NULL THEN source.branch_id ELSE NULL END FROM stock_transfers t JOIN stock_locations source ON source.company_id=t.company_id AND source.id=t.source_location_id JOIN stock_locations destination ON destination.company_id=t.company_id AND destination.id=t.destination_location_id WHERE t.company_id=$1
    UNION ALL SELECT 'attendance_record',id::text,branch_id FROM attendance_records WHERE company_id=$1
    UNION ALL SELECT 'employee_advance',id::text,branch_id FROM employee_advances WHERE company_id=$1
    UNION ALL SELECT 'employee_advance_repayment',id::text,branch_id FROM employee_advance_repayments WHERE company_id=$1
    UNION ALL SELECT 'salary_run',id::text,branch_id FROM salary_runs WHERE company_id=$1
    UNION ALL SELECT 'salary_payment',p.id::text,r.branch_id FROM salary_payments p JOIN salary_runs r ON r.company_id=p.company_id AND r.id=p.salary_run_id WHERE p.company_id=$1
    UNION ALL SELECT 'expense',id::text,branch_id FROM expenses WHERE company_id=$1
    UNION ALL SELECT 'manual_journal_request',id::text,branch_id FROM manual_journal_requests WHERE company_id=$1
    UNION ALL SELECT 'stock_return',id::text,branch_id FROM stock_returns WHERE company_id=$1
  )
  SELECT count(*)::int AS checked,count(*) FILTER(WHERE a.branch_id IS DISTINCT FROM s.branch_id)::int AS mismatches
  FROM audit_logs a JOIN source_branches s ON s.entity_type=a.entity_type AND s.entity_id=a.entity_id
  WHERE a.company_id=$1`, [companyId]);
  const branchAuditOwnershipPassed = branchAuditOwnership.rows[0]?.checked > 0 && branchAuditOwnership.rows[0]?.mismatches === 0;
  if (!branchAuditOwnershipPassed) throw new Error(`Audit events did not inherit their source branch: ${JSON.stringify(branchAuditOwnership.rows[0])}`);
  const employeeBranchAudit = await pool.query<{ checked: number; mismatches: number }>(`SELECT count(*)::int AS checked,
    count(*) FILTER(WHERE a.branch_id IS DISTINCT FROM NULLIF(a.after_data->>'branchId','')::uuid)::int AS mismatches
    FROM audit_logs a WHERE a.company_id=$1 AND a.action='employee.branch.assign'`, [companyId]);
  const employeeBranchAuditPassed = employeeBranchAudit.rows[0]?.checked > 0 && employeeBranchAudit.rows[0]?.mismatches === 0;
  if (!employeeBranchAuditPassed) throw new Error(`Employee branch assignment audit scope failed: ${JSON.stringify(employeeBranchAudit.rows[0])}`);

  const branchBSubledgerReconciliation = await verifySubledgerReconciliation(companyId, token, branchB.data.id);
  const branchASubledgerReconciliation = await verifySubledgerReconciliation(companyId, token, branchA.data.id);
  const companySubledgerReconciliation = await verifySubledgerReconciliation(companyId, token, null);
  const branchBReceivable = branchBSubledgerReconciliation.checks.find(check => check.code === "1100");
  const branchAReceivable = branchASubledgerReconciliation.checks.find(check => check.code === "1100");
  const companyReceivable = companySubledgerReconciliation.checks.find(check => check.code === "1100");
  const unallocatedDifferenceDetectionPassed = branchBReceivable?.difference === 7
    && branchAReceivable?.difference === 0 && companyReceivable?.difference === 7
    && branchBReceivable.unallocatedDetails.includes("Unassigned receivable test line")
    && !branchAReceivable.unallocatedDetails.includes("Unassigned receivable test line");
  const subledgerReconciliationPassed = branchBSubledgerReconciliation.passed
    && branchASubledgerReconciliation.passed && companySubledgerReconciliation.passed
    && unallocatedDifferenceDetectionPassed;
  if (!subledgerReconciliationPassed) {
    throw new Error(`Subledger reconciliation did not match independent control-account/partner SQL or failed the branch-scoped unallocated fixture: ${JSON.stringify({ branchBSubledgerReconciliation, branchASubledgerReconciliation, companySubledgerReconciliation, unallocatedDifferenceDetectionPassed })}`);
  }
  const subledgerAnonymousStatus = (await fetch(`${api}/api/accounting/subledger-reconciliation`)).status;
  const subledgerCashierStatus = (await fetch(`${api}/api/accounting/subledger-reconciliation`, { headers: { Authorization: `Bearer ${resetCashierLogin.data.token}` } })).status;
  const subledgerInvalidDateStatus = (await fetch(`${api}/api/accounting/subledger-reconciliation?asOf=not-a-date`, { headers: { Authorization: `Bearer ${token}` } })).status;
  const subledgerAccessBoundaryPassed = subledgerAnonymousStatus === 401 && subledgerCashierStatus === 403 && subledgerInvalidDateStatus === 400;
  if (!subledgerAccessBoundaryPassed) throw new Error(`Subledger reconciliation access/date validation statuses were ${JSON.stringify({ subledgerAnonymousStatus, subledgerCashierStatus, subledgerInvalidDateStatus })}.`);

  const years = await expectStatus("/api/accounting/financial-years", token, 200) as {
    years?: Array<{ id: string; startsOn: string; endsOn: string; status: string }>;
  };
  const reportingYear = years.years?.find(year => year.status === "open");
  if (!reportingYear) throw new Error("The Owner has no open financial year for report reconciliation.");
  const reportDate = new Date().toISOString().slice(0, 10);
  const branchBFinanceReports = await verifyBranchFinanceReports(companyId, token, branchB.data.id, reportingYear.id, reportingYear.startsOn, reportDate);
  const branchAFinanceReports = await verifyBranchFinanceReports(companyId, token, branchA.data.id, reportingYear.id, reportingYear.startsOn, reportDate);
  const branchFinanceReportsPassed = branchBFinanceReports.passed && branchAFinanceReports.passed;
  if (!branchFinanceReportsPassed) {
    throw new Error(`Branch-scoped accounting reports did not match branch-filtered PostgreSQL ledger totals: ${JSON.stringify({ branchBFinanceReports, branchAFinanceReports })}`);
  }
  await request("/api/auth/branch", "POST", { branchId: null }, token);
  const trial = await expectStatus(`/api/accounting/trial-balance?financialYearId=${reportingYear.id}&to=${reportDate}`, token, 200) as {
    rows?: Array<{ code: string; accountType: string; balance: number }>;
    totalDebit?: number; totalCredit?: number;
  };
  const profitLoss = await expectStatus(`/api/accounting/profit-loss?from=${reportingYear.startsOn}&to=${reportDate}`, token, 200) as {
    rows?: Array<{ accountType: string; amount: number }>;
    income?: number; expenses?: number; netProfit?: number;
  };
  const balanceSheet = await expectStatus(`/api/accounting/balance-sheet?to=${reportDate}`, token, 200) as {
    totalAssets?: number; totalLiabilitiesAndEquity?: number; balanced?: boolean;
  };
  const cashBook = await expectStatus(`/api/accounting/cash-bank-book?account=1110&from=${reportingYear.startsOn}&to=${reportDate}`, token, 200) as {
    closingBalance?: number;
  };
  const bankBook = await expectStatus(`/api/accounting/cash-bank-book?account=1120&from=${reportingYear.startsOn}&to=${reportDate}`, token, 200) as {
    closingBalance?: number;
  };
  const amountMatches = (left: number | undefined, right: number | undefined) =>
    typeof left === "number" && typeof right === "number" && Math.abs(left - right) < 0.011;
  const trialIncome = trial.rows?.filter(row => row.accountType === "income").reduce((sum, row) => sum + row.balance, 0) ?? NaN;
  const trialExpenses = trial.rows?.filter(row => row.accountType === "expense").reduce((sum, row) => sum + row.balance, 0) ?? NaN;
  const reportReconciliationPassed = amountMatches(trial.totalDebit, trial.totalCredit)
    && amountMatches(profitLoss.income, trialIncome)
    && amountMatches(profitLoss.expenses, trialExpenses)
    && amountMatches(profitLoss.netProfit, trialIncome - trialExpenses)
    && balanceSheet.balanced === true
    && amountMatches(balanceSheet.totalAssets, balanceSheet.totalLiabilitiesAndEquity)
    && amountMatches(cashBook.closingBalance, trial.rows?.find(row => row.code === "1110")?.balance)
    && amountMatches(bankBook.closingBalance, trial.rows?.find(row => row.code === "1120")?.balance);
  if (!reportReconciliationPassed) {
    throw new Error(`Auditor report totals did not reconcile to the trial balance: ${JSON.stringify({
      trialDebit: trial.totalDebit, trialCredit: trial.totalCredit, trialIncome, reportIncome: profitLoss.income,
      trialExpenses, reportExpenses: profitLoss.expenses, reportNetProfit: profitLoss.netProfit,
      assets: balanceSheet.totalAssets, liabilitiesAndEquity: balanceSheet.totalLiabilitiesAndEquity,
      cashBook: cashBook.closingBalance, cashTrialBalance: trial.rows?.find(row => row.code === "1110")?.balance,
      bankBook: bankBook.closingBalance, bankTrialBalance: trial.rows?.find(row => row.code === "1120")?.balance,
    })}`);
  }

  const evidence = await pool.query<{
    loading_status: string; stock_quantity: string; invoice_status: string; invoice_total: string;
    journal_debits: string; journal_credits: string; audit_events: string;
    customer_credit_limit_is_null: boolean; vehicle_capacity_is_null: boolean;
    sales_order_in_branch_b: boolean; loading_in_branch_b: boolean;
    purchase_order_in_branch_b: boolean; production_batch_in_branch_b: boolean;
  }>(`SELECT ls.status AS loading_status,
      (SELECT COALESCE(sum(CASE WHEN sm.direction='in' THEN sm.quantity ELSE -sm.quantity END),0)::text
       FROM stock_movements sm WHERE sm.company_id=$1 AND sm.product_id=$2 AND sm.location_id=$3 AND sm.quality='good') AS stock_quantity,
      si.status AS invoice_status,si.total::text AS invoice_total,
      (SELECT COALESCE(sum(jl.debit),0)::text FROM journal_entries je JOIN journal_entry_lines jl ON jl.company_id=je.company_id AND jl.journal_entry_id=je.id WHERE je.company_id=$1 AND je.source_type='sales_invoice' AND je.source_id=si.id) AS journal_debits,
      (SELECT COALESCE(sum(jl.credit),0)::text FROM journal_entries je JOIN journal_entry_lines jl ON jl.company_id=je.company_id AND jl.journal_entry_id=je.id WHERE je.company_id=$1 AND je.source_type='sales_invoice' AND je.source_id=si.id) AS journal_credits,
      (SELECT count(*)::text FROM audit_logs al WHERE al.company_id=$1 AND al.entity_id=ls.id::text AND al.action IN ('loading.complete','loading.verify','delivery.dispatch','delivery.complete')) AS audit_events
      ,(SELECT credit_limit IS NULL FROM business_partners WHERE company_id=$1 AND id=$5) AS customer_credit_limit_is_null
      ,(SELECT capacity IS NULL FROM vehicles WHERE company_id=$1 AND id=$6) AS vehicle_capacity_is_null
      ,(SELECT branch_id=$7 FROM sales_orders WHERE company_id=$1 AND id=$8) AS sales_order_in_branch_b
      ,(SELECT branch_id=$7 FROM loading_sessions WHERE company_id=$1 AND id=$4) AS loading_in_branch_b
      ,(SELECT branch_id=$7 FROM purchase_orders WHERE company_id=$1 AND id=$9) AS purchase_order_in_branch_b
      ,(SELECT branch_id=$7 FROM production_batches WHERE company_id=$1 AND id=$10) AS production_batch_in_branch_b
    FROM loading_sessions ls JOIN sales_invoices si ON si.company_id=ls.company_id AND si.id=ls.invoice_id
    WHERE ls.company_id=$1 AND ls.id=$4`, [companyId, product.data.id, location.rows[0].id, loading.data.id, customer.data.id, vehicle.data.id, branchB.data.id, order.data.id, purchaseOrder.data.id, batch.data.id]);
  if (!evidence.rowCount) throw new Error("Final workflow records could not be found in PostgreSQL.");
  const row = evidence.rows[0];
  const result = {
    check: "sales-order-to-delivery-e2e",
    setup: setup.status,
    setupIdempotencyPassed,
    login: login.status,
    managerLogin: managerLogin.status,
    cashierLogin: cashierLogin.status,
    accountantLogin: accountantLogin.status,
    operationalRolePresetsPassed,
    accountantRoleAndBranchPassed,
    accountantRestrictedActionsDenied: accountantCannotManageUsers && accountantCannotEditCompany,
    ownerStaffPasswordReset: staffPasswordResetPassed,
    staffCreateIdempotencyPassed,
    branchCreationIdempotencyPassed,
    cashierRoleAndBranchPassed,
    ownerPulsePassed,
    ownerPulseValuesMatch,
    ownerPulseBranchValuesMatch,
    managerOwnerPulseHidden: managerDashboard.data.ownerPulse === null,
    cashierOwnerPulseHidden: cashierDashboardPrivacyPassed,
    companyProfilePassed,
    customerProfilePassed,
    supplierProfilePassed,
    reportReconciliationPassed,
    branchFinanceReportsPassed,
    branchBFinanceReports,
    branchAFinanceReports,
    branchPartnerLedgersPassed,
    branchBPartnerLedgers,
    branchAPartnerLedgers,
    subledgerReconciliationPassed,
    unallocatedDifferenceDetectionPassed,
    subledgerAccessBoundaryPassed,
    branchBSubledgerReconciliation,
    branchASubledgerReconciliation,
    companySubledgerReconciliation,
    trialBalanceDebit: trial.totalDebit,
    trialBalanceCredit: trial.totalCredit,
    trialIncome: Number(trialIncome.toFixed(2)),
    profitLossIncome: profitLoss.income,
    trialExpenses: Number(trialExpenses.toFixed(2)),
    profitLossExpenses: profitLoss.expenses,
    reportCashBookClosing: cashBook.closingBalance,
    trialCashBalance: trial.rows?.find(row => row.code === "1110")?.balance,
    reportBankBookClosing: bankBook.closingBalance,
    trialBankBalance: trial.rows?.find(row => row.code === "1120")?.balance,
    managerCannotEditCompanyProfile,
    managerPresetLeastPrivilege,
    invoiceReversalPassed,
    invoiceReversalManagerStatus: managerReverseAttempt.status,
    invoiceReversalRestoredQuantity: reversalRow?.restored_quantity,
    managerBranchIsolation,
    creditOrderStatusBeforeApproval: creditOrder.data.status,
    creditApprovalQueueIncludedOrder: true,
    creditApprovalPassed,
    employeeAdvanceStatusBeforeApproval: employeeAdvance.data.status,
    employeeAdvanceApprovalPassed,
    employeeAdvanceRejectionPassed,
    payrollPassed,
    payrollBranchIsolationPassed,
    monthlyProrationModesPassed,
    monthlyProration: monthlyProrationCases.map(({ mode, expected }) => ({ mode, expected })),
    pendingDepartmentCostPassed,
    historicalDepartmentSnapshotPassed,
    postedDepartmentCostPassed,
    payrollGross: payrollRun.data.totalGross,
    payrollAdvanceRecovery: payrollLine.advanceRecovery,
    payrollNetPaid: payrollRun.data.totalNet,
    payrollAdvanceRemaining: Number(payrollRow.advance_balance),
    payrollPayableRemaining: Number(payrollRow.payable_balance),
    expenseApprovalPassed,
    expenseReportBranchAPassed,
    expenseReportBranchBIsolated,
    offlineExpenseRetryExactlyOnce: offlineRetryExactlyOnce,
      loadingPhotoRetryExactlyOnce,
    expenseStatus: expenseRow.status,
    expensePaidFromCash: Number(expenseRow.credit),
    loadingPhotosPassed,
    productionToStockPassed,
    productionStatus: productionRow.status,
    productionLoadedQuantity: Number(productionRow.loaded_quantity),
    productionOutputQuantity: production.data.outputQuantity,
    productionStockQuantity: Number(productionRow.production_stock),
    productionInventoryCost: Number(productionRow.production_inventory_cost),
    productionLayerValue: Number(productionRow.production_layer_value),
    productionGlInventoryDelta: Number(productionRow.gl_inventory_delta),
    productionWipBalance: Number(productionRow.wip_balance),
    productionLossQuantity: Number(productionRow.loss_quantity),
    productionBalancedJournal: productionRow.balanced,
    productionDatesAligned: productionRow.batch_started_on < productionRow.production_stock_date
      && productionRow.production_stock_date === productionRow.production_layer_date
      && productionRow.production_layer_date === productionRow.completion_journal_date,
    productionStartDate: productionRow.batch_started_on,
    productionStockDate: productionRow.production_stock_date,
    productionLayerDate: productionRow.production_layer_date,
    productionCompletionJournalDate: productionRow.completion_journal_date,
    purchaseToPaymentPassed,
    purchaseOrderStatus: purchaseRow.order_status,
    purchaseReceived: Number(purchaseRow.received),
    purchasePartialLifecyclePassed,
    purchaseTaxRegisterPassed,
    supplierBillTotal: firstSupplierBill.data.total + secondSupplierBill.data.total,
    supplierPaid: Number(purchaseRow.paid),
    supplierOutstanding: Number(purchaseRow.outstanding),
    supplierLedgerBalance: Number(supplierLedger.balance),
    customerOpeningBalancePassed: customerOpeningPassed,
    customerOpeningReplayPassed,
    customerOpeningLedgerBalance: Number(customerOpeningLedger.balance),
    customerOpeningDuplicateStatus: duplicateCustomerOpening.status,
    supplierOpeningBalancePassed: supplierOpeningPassed,
    supplierOpeningReplayPassed,
    supplierOpeningLedgerBalance: Number(supplierOpeningLedger.balance),
    supplierOpeningDuplicateStatus: duplicateSupplierOpening.status,
    loadingPhotoAfterDispatchStatus: photoAfterDispatch.status,
    customerAgingPassed,
    customerAgingBoundariesPassed,
    customerAgingSettledPassed,
    customerAgingInvoiceDate: agingInvoiceDate,
    customerAgingDueDate: agingDueDate,
    customerAgingDaysOverdue: agingDaysOverdue,
    customerReceiptAndLedgerPassed: receiptAndCommissionPassed,
    brokerSettlementPassed,
    managerBranchBDetailStatuses: managerBranchBDetails.map(() => 404),
    managerBranchBProductionAuditEvents: managerBranchAudit.events?.length ?? 0,
    creditOrderBranchFilterPassed,
    branchBApprovalFiltersPassed,
    branchAHasNoBranchBApprovalItems: !crossBranchApprovalLeak,
    branchBTransactionListsPassed,
    branchBCoreListsPassed,
    branchATransactionListsExclude,
    branchACoreListsExclude,
    dashboardReceivablesBranchIsolationPassed: branchAReceivablesIsolated && branchBReceivablesVisible,
    masterCreates: [customer.status, product.status, vehicle.status, driver.status],
    openingStock: opening.status,
    order: order.status,
    invoice: invoice.status,
    loadingVerified: verified.data.status,
    earlyDeliveryGuard: tooEarly.status,
    finalLoadingStatus: row.loading_status,
    remainingGoodStock: Number(row.stock_quantity),
    postedInvoice: row.invoice_status,
    invoiceTotal: Number(row.invoice_total),
    stockRelievedOnceAtInvoiceAndNotAgainAtDispatch: stockReliefTimingPassed,
    ownerAssistantAuthPassed,
    managerAssistantAccessDenied,
    ownerAssistantApprovedLookupsPassed,
    paymentReminderDraftPassed,
    staleReminderBalanceDenied,
    blankCustomerCreditLimitStayedNull: row.customer_credit_limit_is_null,
    blankVehicleCapacityStayedNull: row.vehicle_capacity_is_null,
    branchRecordsStoredInBranchB: row.sales_order_in_branch_b && row.loading_in_branch_b
      && row.purchase_order_in_branch_b && row.production_batch_in_branch_b,
    balancedInvoiceJournal: Number(row.journal_debits) === Number(row.journal_credits) && Number(row.journal_debits) === Number(row.invoice_total),
    loadingAndDeliveryAuditEvents: Number(row.audit_events),
    branchBDetailStatuses: branchBDetails.map(() => 200),
    branchADetailStatusesForBranchBRecords: crossBranchStatuses.map(() => 404),
    branchBProductionAuditEvents: branchBAudit.events.length,
    branchAProductionAuditEventsForBranchBRecord: branchAAudit.events?.length ?? 0,
    branchBExpenseAuditEventsForBranchARecord: branchBExpenseAudit.events?.length ?? 0,
    branchAExpenseAuditScoped,
    crossBranchExpenseRejectDenied,
    branchBOwnExpenseAuditEvents: branchBOwnExpenseAudit.events?.length ?? 0,
    branchBStockReturnListed,
    branchAStockReturnExcluded,
    crossBranchStockReturnDenied,
    crossBranchJournalDecisionDenied,
    branchBManualJournalAuditScoped,
    branchAManualJournalAuditExcluded,
    branchAuditOwnershipPassed,
    branchAuditSourceRowsChecked: branchAuditOwnership.rows[0].checked,
    branchAuditSourceMismatches: branchAuditOwnership.rows[0].mismatches,
    employeeBranchAuditPassed,
  };
  console.log(JSON.stringify(result));
  if (row.loading_status !== "delivered" || Number(row.stock_quantity) !== 39 || row.invoice_status !== "posted"
      || Number(row.journal_debits) !== Number(row.journal_credits) || Number(row.journal_debits) !== Number(row.invoice_total)
      || !row.customer_credit_limit_is_null || !row.vehicle_capacity_is_null
      || !operationalRolePresetsPassed || !staffCreateIdempotencyPassed || !branchCreationIdempotencyPassed || !setupIdempotencyPassed
      || !row.sales_order_in_branch_b || !row.loading_in_branch_b || !row.purchase_order_in_branch_b || !row.production_batch_in_branch_b
      || Number(row.audit_events) < 4 || branchBDetails.length !== 6 || crossBranchStatuses.length !== 6
      || !branchBAudit.events.length || branchAAudit.events?.length || !reportReconciliationPassed
      || managerBranchBDetails.length !== 6 || managerBranchAudit.events?.length
      || !creditOrderBranchFilterPassed || !branchBApprovalFiltersPassed || crossBranchApprovalLeak
      || !ownerPulsePassed || !ownerPulseBranchValuesMatch || !cashierDashboardPrivacyPassed
      || !branchAReceivablesIsolated || !branchBReceivablesVisible
      || !branchBTransactionListsPassed || !branchATransactionListsExclude
      || !branchAExpenseAuditScoped || !crossBranchExpenseRejectDenied
      || !branchBStockReturnListed || !crossBranchStockReturnDenied
      || !purchaseTaxRegisterPassed || !payrollBranchIsolationPassed
      || !loadingPhotosPassed || !customerAgingPassed || !customerAgingBoundariesPassed || !customerAgingSettledPassed || !productionToStockPassed || !purchasePartialLifecyclePassed || !purchaseToPaymentPassed || !customerOpeningPassed || !supplierOpeningPassed || !customerProfilePassed || !supplierProfilePassed || !accountantRoleAndBranchPassed || !accountantCannotManageUsers || !accountantCannotEditCompany || !payrollPassed || !monthlyProrationModesPassed || !pendingDepartmentCostPassed || !historicalDepartmentSnapshotPassed || !postedDepartmentCostPassed || !expenseApprovalPassed || !expenseReportBranchAPassed || !expenseReportBranchBIsolated || !offlineRetryExactlyOnce || photoAfterDispatch.status !== 409 || !receiptAndCommissionPassed || !brokerSettlementPassed) process.exitCode = 1;
  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error("Sales/loading/delivery verification failed:", error instanceof Error ? error.message : "unknown error");
  await pool.end();
  process.exitCode = 1;
});
