import { randomBytes } from "node:crypto";
import { pool } from "../src/db";
import { assertDisposableVerificationTarget, assertLocalVerificationApi } from "./verification-target";

const api = process.env.ERP_VERIFY_API_URL ?? "http://127.0.0.1:44137";
const suffix = randomBytes(5).toString("hex");
const email = `cash-opening-${suffix}@example.test`;
const password = `Cash-${randomBytes(12).toString("base64url")}-9A`;

async function request<T>(path: string, method = "GET", body?: unknown, token?: string, key?: string) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  return { status: response.status, data };
}

async function main() {
  assertDisposableVerificationTarget();
  assertLocalVerificationApi(api);
  const setup = await request("/api/auth/setup", "POST", {
    companyName: `Cash Opening Verification ${suffix}`,
    ownerName: "Cash Opening Verification Owner",
    email,
    password,
  });
  if (setup.status !== 201) throw new Error(`Fresh company setup returned ${setup.status}.`);
  const login = await request<{ token: string }>("/api/auth/login", "POST", { email, password });
  if (login.status !== 200 || !login.data.token) throw new Error("Owner login failed.");
  const token = login.data.token;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const before = await request<{ canPostOpening: boolean; openingBalances: unknown[] }>("/api/accounting/cash-opening-balance", "GET", undefined, token);
  if (before.status !== 200 || before.data.canPostOpening !== true || before.data.openingBalances.length !== 0) {
    throw new Error(`Fresh company should allow one cash opening: ${JSON.stringify(before)}`);
  }
  const payload = { openingDate: today, amount: 1250.5, reason: "Verified cash counted for ERP opening" };
  const key = `cash-opening-${suffix}`;
  const posted = await request<{ id: string; openingNumber: string; amount: number }>("/api/accounting/cash-opening-balance", "POST", payload, token, key);
  const replay = await request<{ id: string; openingNumber: string; amount: number }>("/api/accounting/cash-opening-balance", "POST", payload, token, key);
  const duplicate = await request("/api/accounting/cash-opening-balance", "POST", payload, token, `cash-opening-duplicate-${suffix}`);
  if (posted.status !== 201 || replay.status !== 201 || posted.data.id !== replay.data.id
    || Number(posted.data.amount) !== 1250.5 || duplicate.status !== 409) {
    throw new Error(`Cash opening post/retry/duplicate guard failed: ${JSON.stringify({ posted, replay, duplicate })}`);
  }
  const book = await request<{ openingBalance: number; inflows: number; outflows: number; closingBalance: number; entries: Array<{ entryNumber: string; debit: number | string }> }>(
    `/api/accounting/cash-bank-book?account=1110&from=${today}&to=${today}`, "GET", undefined, token,
  );
  const audit = await pool.query<{ audits: number; debit: string; credit: string; source_type: string }>(`SELECT
      (SELECT count(*)::int FROM audit_logs WHERE company_id=$1 AND action='cash.opening.post' AND entity_id=$2::uuid::text) AS audits,
      (SELECT COALESCE(sum(l.debit),0)::text FROM journal_entries j JOIN journal_entry_lines l ON l.company_id=j.company_id AND l.journal_entry_id=j.id WHERE j.company_id=$1 AND j.source_type='cash_opening_balance' AND j.source_id=$2::uuid) AS debit,
      (SELECT COALESCE(sum(l.credit),0)::text FROM journal_entries j JOIN journal_entry_lines l ON l.company_id=j.company_id AND l.journal_entry_id=j.id WHERE j.company_id=$1 AND j.source_type='cash_opening_balance' AND j.source_id=$2::uuid) AS credit,
      (SELECT source_type FROM journal_entries WHERE company_id=$1 AND source_id=$2::uuid LIMIT 1) AS source_type`,
  [((await pool.query<{ company_id: string }>("SELECT company_id FROM users WHERE lower(email)=lower($1)", [email])).rows[0]?.company_id), posted.data.id]);
  const row = audit.rows[0];
  const ledgerPassed = book.status === 200 && Number(book.data.inflows) === 1250.5
    && Number(book.data.closingBalance) === 1250.5 && book.data.entries.some((line) => line.description.includes(posted.data.openingNumber));
  const postingPassed = row?.audits === 1 && Number(row.debit) === 1250.5 && Number(row.credit) === 1250.5
    && row.source_type === "cash_opening_balance";
  if (!ledgerPassed || !postingPassed) throw new Error(`Cash book or journal/audit verification failed: ${JSON.stringify({ book, row })}`);
  const close = await request<{ status: string; expectedCash: number; actualCash: number; difference: number }>(
    "/api/accounting/cash-closings", "POST", { closingDate: today, actualCash: 1250.5, reason: "" }, token, `cash-close-${suffix}`,
  );
  if (close.status !== 201 || close.data.status !== "approved" || Number(close.data.expectedCash) !== 1250.5
    || Number(close.data.actualCash) !== 1250.5 || Number(close.data.difference) !== 0) {
    throw new Error(`Cash close did not reconcile to the opening balance: ${JSON.stringify(close)}`);
  }
  console.log(JSON.stringify({
    check: "cash-opening-balance",
    setup: setup.status,
    ownerLogin: login.status,
    cashOpening: posted.status,
    idempotentRetryPassed: posted.data.id === replay.data.id,
    duplicateRejected: duplicate.status === 409,
    ledgerPassed,
    balancedJournalAndAuditPassed: postingPassed,
    cashCloseMatchedOpening: close.status === 201 && Number(close.data.expectedCash) === 1250.5,
  }));
}

main().catch((error: unknown) => {
  console.error("Cash opening verification failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
});
