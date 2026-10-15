import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "../src/db";
import { assertDisposableVerificationTarget, assertLocalVerificationApi } from "./verification-target";

const api = process.env.ERP_VERIFY_API_URL ?? "http://127.0.0.1:44137";
const suffix = randomBytes(5).toString("hex");
const email = `bank-replay-${suffix}@example.test`;
const password = `Verify-${randomBytes(12).toString("base64url")}-9A`;

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
  return { status: response.status, data: await response.json().catch(() => ({})) as T & { error?: { code?: string; message?: string } } };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  assertDisposableVerificationTarget();
  assertLocalVerificationApi(api);
  const setup = await request("/api/auth/setup", "POST", {
    companyName: `Bank reconciliation idempotency ${suffix}`,
    ownerName: "Bank Verification Owner",
    email,
    password,
  });
  assert(setup.status === 201, `Fresh owner setup failed (${setup.status}).`);
  const login = await request<{ token?: string }>("/api/auth/login", "POST", { email, password });
  assert(login.status === 200 && login.data.token, "Owner login failed.");
  const token = login.data.token;
  const owner = await pool.query<{ id: string; company_id: string; today: string }>(
    "SELECT u.id,c.id AS company_id,(now() AT TIME ZONE c.timezone)::date::text AS today FROM users u JOIN companies c ON c.id=u.company_id WHERE lower(u.email)=lower($1)", [email],
  );
  assert(owner.rowCount === 1, "Verification company was not created.");
  const { id: ownerId, company_id: companyId, today } = owner.rows[0];

  const opening = await request<{ id?: string }>("/api/accounting/bank-opening-balance", "POST", {
    openingDate: today, amount: 100, reason: "Test bank opening balance",
  }, token, "verify-bank-opening-00001");
  assert(opening.status === 201 && opening.data.id, `Bank opening balance failed (${opening.status}).`);
  const period = {
    periodFrom: today,
    periodTo: today,
    statementOpening: 100,
    statementClosing: 150,
    lines: [{ date: today, description: "Test deposit", reference: `DEP-${suffix}`, amount: 50 }],
  };
  const reconciliation = await request<{ id?: string }>("/api/accounting/bank-reconciliations", "POST", period, token, "verify-bank-period-0001");
  assert(reconciliation.status === 201 && reconciliation.data.id, `Reconciliation creation failed (${reconciliation.status}).`);
  const lines = await pool.query<{ id: string }>(
    "SELECT id FROM bank_reconciliation_lines WHERE company_id=$1 AND reconciliation_id=$2", [companyId, reconciliation.data.id],
  );
  const accounts = await pool.query<{ id: string; code: string }>(
    "SELECT id,code FROM accounts WHERE company_id=$1 AND code IN ('1120','4100')", [companyId],
  );
  const bankAccount = accounts.rows.find(row => row.code === "1120"), incomeAccount = accounts.rows.find(row => row.code === "4100");
  assert(lines.rowCount === 1 && bankAccount && incomeAccount, "Statement row or bank accounts are missing.");

  const journalIds = [] as string[];
  for (let index = 0; index < 2; index++) {
    const entry = await pool.query<{ id: string }>(`INSERT INTO journal_entries
      (company_id,entry_number,source_type,source_id,description,posted_by,effective_date)
      VALUES($1,$2,'bank_replay_verification',$3,'Verification deposit',$4,$5::date) RETURNING id`,
    [companyId, `BVR-${suffix}-${index}`, randomUUID(), ownerId, today]);
    journalIds.push(entry.rows[0].id);
    await pool.query(`INSERT INTO journal_entry_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
      VALUES($1,$2,1,$3,'Verification bank deposit',50,0),($1,$2,2,$4,'Verification income',0,50)`,
    [companyId, entry.rows[0].id, bankAccount.id, incomeAccount.id]);
  }
  const candidates = await pool.query<{ id: string }>(
    "SELECT id FROM journal_entry_lines WHERE company_id=$1 AND journal_entry_id=$2 AND account_id=$3 AND debit=50",
    [companyId, journalIds[0], bankAccount.id],
  );
  const alternate = await pool.query<{ id: string }>(
    "SELECT id FROM journal_entry_lines WHERE company_id=$1 AND journal_entry_id=$2 AND account_id=$3 AND debit=50",
    [companyId, journalIds[1], bankAccount.id],
  );
  const matchPath = `/api/accounting/bank-reconciliations/${reconciliation.data.id}/lines/${lines.rows[0].id}/match`;
  const matchBody = { journalLineId: candidates.rows[0].id };
  const matchKey = `verify-bank-match-${suffix}`;
  const matched = await request<{ success?: boolean }>(matchPath, "POST", matchBody, token, matchKey);
  const replayedMatch = await request<{ success?: boolean }>(matchPath, "POST", matchBody, token, matchKey);
  const changedMatch = await request(matchPath, "POST", { journalLineId: alternate.rows[0].id }, token, matchKey);
  assert(matched.status === 200 && replayedMatch.status === 200 && replayedMatch.data.success
    && changedMatch.status === 409 && changedMatch.data.error?.code === "IDEMPOTENCY_KEY_REUSED",
  "Matching did not replay the committed result or reject changed payload reuse.");
  const lineAudits = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM audit_logs WHERE company_id=$1 AND entity_type='bank_reconciliation_line' AND entity_id=$2 AND action='bank.reconcile.match'",
    [companyId, lines.rows[0].id],
  );
  assert(Number(lineAudits.rows[0].count) === 1, "A retried bank match created duplicate audit history.");

  const unmatchPath = `/api/accounting/bank-reconciliations/${reconciliation.data.id}/lines/${lines.rows[0].id}/unmatch`;
  const unmatchBody = { reason: "Correcting the selected bank transaction" };
  const unmatchKey = `verify-bank-unmatch-${suffix}`;
  const unmatched = await request<{ success?: boolean }>(unmatchPath, "POST", unmatchBody, token, unmatchKey);
  const replayedUnmatch = await request<{ success?: boolean }>(unmatchPath, "POST", unmatchBody, token, unmatchKey);
  const changedUnmatch = await request(unmatchPath, "POST", { reason: "Different unmatch reason" }, token, unmatchKey);
  assert(unmatched.status === 200 && replayedUnmatch.status === 200 && replayedUnmatch.data.success
    && changedUnmatch.status === 409 && changedUnmatch.data.error?.code === "IDEMPOTENCY_KEY_REUSED",
  "Removing a bank match did not replay or reject changed payload reuse correctly.");
  const unmatchAudits = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM audit_logs WHERE company_id=$1 AND entity_type='bank_reconciliation_line' AND entity_id=$2 AND action='bank.reconcile.unmatch'",
    [companyId, lines.rows[0].id],
  );
  assert(Number(unmatchAudits.rows[0].count) === 1, "A retried unmatch created duplicate audit history.");

  const rematched = await request(matchPath, "POST", matchBody, token, `verify-bank-rematch-${suffix}`);
  assert(rematched.status === 200, "The statement line could not be matched again after the audited unmatch.");
  const completePath = `/api/accounting/bank-reconciliations/${reconciliation.data.id}/complete`;
  const completed = await request<{ adjustedBookBalance?: number; statementClosing?: number }>(completePath, "POST", {}, token, `verify-bank-complete-${suffix}`);
  const replayedComplete = await request<{ adjustedBookBalance?: number; statementClosing?: number }>(completePath, "POST", {}, token, `verify-bank-complete-${suffix}`);
  assert(completed.status === 200 && replayedComplete.status === 200
    && Number(completed.data.adjustedBookBalance) === 150 && Number(replayedComplete.data.statementClosing) === 150,
  "The reconciliation did not complete and replay with the reconciled ₹150 closing balance.");

  console.log("Bank reconciliation idempotency passed: match/unmatch retries replay once, changed bodies are rejected, audit events are not duplicated, rematching works and the ₹150 statement reconciles.");
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Bank reconciliation idempotency verification failed.");
  process.exitCode = 1;
}).finally(async () => { await pool.end(); });
