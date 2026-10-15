import "dotenv/config";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pool } from "../src/db";
import { assertDisposableVerificationTarget, assertLocalVerificationApi } from "./verification-target";

const api = process.env.ERP_VERIFY_API_URL ?? "http://127.0.0.1:14411";
const email = "owner@password-recovery-verify.example.invalid";
const initialPassword = "Initial-Owner-Password-2026";
const changedPassword = "Changed-Owner-Password-2026";

async function request(path: string, body?: unknown, token?: string, idempotencyKey?: string) {
  const response = await fetch(`${api}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, body: await response.json().catch(() => ({})) as Record<string, any> };
}

function runRecovery(emailAddress: string, databaseUrl = process.env.DATABASE_URL ?? "") {
  const repoRoot = resolve(__dirname, "../..");
  return spawnSync(process.execPath, ["--import", "tsx", "src/recover-owner-password.ts", "--email", emailAddress, "--confirm"], {
    cwd: resolve(repoRoot, "backend"),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

async function main() {
  assertDisposableVerificationTarget();
  assertLocalVerificationApi(api);
  assert.match(process.env.DATABASE_URL ?? "", /brick_erp_recovery_verify_[a-f0-9]+$/i, "recovery verifier must target its uniquely named disposable database");
  const existingCompany = await pool.query("SELECT 1 FROM companies LIMIT 1");
  assert.equal(existingCompany.rowCount, 0, "the disposable test database must start empty");

  try {
    const setup = await request("/api/auth/setup", {
      companyName: "Password Recovery Verification",
      ownerName: "Verification Owner",
      email,
      password: initialPassword,
    }, undefined, "pw-recovery-setup-v1");
    assert.equal(setup.response.status, 201, `first-owner setup failed with HTTP ${setup.response.status}`);

    const firstLogin = await request("/api/auth/login", { email, password: initialPassword });
    assert.equal(firstLogin.response.status, 200, "new Owner should be able to sign in before recovery");
    const preRecoveryToken = String(firstLogin.body.token ?? "");
    assert.ok(preRecoveryToken, "initial login should issue a session");

    const remoteGuard = runRecovery(email, "postgresql://postgres@example.invalid:5432/not_local");
    assert.notEqual(remoteGuard.status, 0, "password recovery must reject a non-loopback database");
    assert.match(`${remoteGuard.stdout}${remoteGuard.stderr}`, /on this computer/i);

    const reset = runRecovery(email);
    assert.equal(reset.status, 0, `local Owner recovery failed: ${(reset.stderr ?? "").trim()}`);
    const temporaryPassword = reset.stdout?.match(/^Temporary password \(copy it now\): ([A-Za-z0-9_-]+)$/m)?.[1];
    assert.ok(temporaryPassword && temporaryPassword.length >= 32, "recovery should output a one-time random temporary password");
    assert.doesNotMatch(reset.stdout ?? "", /password_hash|salt:/i, "recovery must not expose a stored password hash");

    assert.equal((await request("/api/auth/me", undefined, preRecoveryToken)).response.status, 401, "recovery should revoke pre-existing sessions");
    assert.equal((await request("/api/auth/login", { email, password: initialPassword })).response.status, 401, "old password should stop working after recovery");

    const primaryLogin = await request("/api/auth/login", { email, password: temporaryPassword });
    const secondLogin = await request("/api/auth/login", { email, password: temporaryPassword });
    assert.equal(primaryLogin.response.status, 200, "temporary password should allow Owner sign-in");
    assert.equal(secondLogin.response.status, 200, "a second session should be available for revocation checks");
    const primaryToken = String(primaryLogin.body.token ?? "");
    const secondToken = String(secondLogin.body.token ?? "");
    assert.ok(primaryToken && secondToken);

    assert.equal((await request("/api/auth/password/change", { currentPassword: "wrong-current", newPassword: changedPassword }, primaryToken)).response.status, 401);
    assert.equal((await request("/api/auth/password/change", { currentPassword: temporaryPassword, newPassword: temporaryPassword }, primaryToken)).response.status, 409);
    assert.equal((await request("/api/auth/password/change", { currentPassword: temporaryPassword, newPassword: "short" }, primaryToken)).response.status, 400);
    const change = await request("/api/auth/password/change", { currentPassword: temporaryPassword, newPassword: changedPassword }, primaryToken);
    assert.equal(change.response.status, 200, `valid password change failed with HTTP ${change.response.status}`);
    assert.equal(change.body.success, true);
    assert.ok(change.body.otherSessionsRevoked >= 1, "password change should revoke concurrent sessions");
    assert.equal((await request("/api/auth/me", undefined, primaryToken)).response.status, 200, "the changing session should remain active");
    assert.equal((await request("/api/auth/me", undefined, secondToken)).response.status, 401, "other sessions should be revoked");
    assert.equal((await request("/api/auth/login", { email, password: temporaryPassword })).response.status, 401, "temporary password should stop working after change");
    assert.equal((await request("/api/auth/login", { email, password: changedPassword })).response.status, 200, "new password should allow sign-in");

    const audit = await pool.query<{ events: number; audit_data: string }>(
      `SELECT count(*)::int AS events,COALESCE(string_agg(after_data::text,' '),'') AS audit_data
         FROM audit_logs WHERE action='auth.password.change' AND entity_type='user'`,
    );
    assert.ok(audit.rows[0].events >= 1, "password change should be audited");
    assert.doesNotMatch(audit.rows[0].audit_data, /password|secret|hash/i, "audit metadata must not contain credentials");

    console.log(JSON.stringify({
      status: "passed",
      isolatedDatabase: process.env.ERP_VERIFY_EXPECTED_DATABASE,
      firstOwnerSetup: setup.response.status,
      localRecovery: reset.status === 0,
      remoteDatabaseRejected: remoteGuard.status !== 0,
      previousSessionsRevoked: true,
      temporaryPasswordLogin: primaryLogin.response.status,
      currentPasswordRequired: true,
      minimumLengthEnforced: true,
      samePasswordRejected: true,
      changedSessionPreserved: true,
      otherSessionsRevoked: change.body.otherSessionsRevoked,
      auditEventRecordedWithoutCredentialData: true,
    }));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("Owner recovery integration verification failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
