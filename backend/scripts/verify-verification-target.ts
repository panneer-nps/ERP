import assert from "node:assert/strict";
import { assertDisposableVerificationTarget, assertLocalVerificationApi } from "./verification-target";

const saved = new Map<string, string | undefined>();
const keys = ["DATABASE_URL", "ERP_VERIFY_EXPECTED_DATABASE", "ERP_VERIFY_ALLOW_MUTATION"];
for (const key of keys) saved.set(key, process.env[key]);

function setTarget(databaseUrl: string, expectedDatabase: string, allowMutation?: string): void {
  process.env.DATABASE_URL = databaseUrl;
  process.env.ERP_VERIFY_EXPECTED_DATABASE = expectedDatabase;
  if (allowMutation === undefined) delete process.env.ERP_VERIFY_ALLOW_MUTATION;
  else process.env.ERP_VERIFY_ALLOW_MUTATION = allowMutation;
}

try {
  setTarget("postgres://tester:secret@127.0.0.1:5432/erp_verify", "erp_verify");
  assert.throws(assertDisposableVerificationTarget, /ERP_VERIFY_ALLOW_MUTATION/);

  setTarget("postgres://tester:secret@127.0.0.1:5432/erp_verify", "brick_erp", "1");
  assert.throws(assertDisposableVerificationTarget, /exactly match/);

  setTarget("postgres://tester:secret@example.com:5432/erp_verify", "erp_verify", "1");
  assert.throws(assertDisposableVerificationTarget, /this computer/);

  setTarget("http://tester:secret@127.0.0.1:5432/erp_verify", "erp_verify", "1");
  assert.throws(assertDisposableVerificationTarget, /PostgreSQL protocol/);

  assert.throws(() => assertLocalVerificationApi("https://example.com"), /this computer/);
  assert.throws(() => assertLocalVerificationApi("not a URL"), /valid local API URL/);
  assert.doesNotThrow(() => assertLocalVerificationApi("http://127.0.0.1:44137"));

  setTarget("postgres://tester:secret@127.0.0.1:5432/erp_verify", "erp_verify", "1");
  assert.doesNotThrow(assertDisposableVerificationTarget);
  console.log("Verification target guard checks passed (no database connection made).");
} finally {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
