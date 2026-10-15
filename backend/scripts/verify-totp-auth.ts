import "dotenv/config";
import { generateTotpCode } from "../src/totp";
import { pool } from "../src/db";
import { assertDisposableVerificationTarget, assertLocalVerificationApi } from "./verification-target";

const api = process.env.ERP_VERIFY_API_URL ?? "http://127.0.0.1:4000";
const password = "Verify-TOTP-Owner-Password-2026";
const email = "owner@totp-verify.example.invalid";

async function request(path: string, body?: unknown, token?: string, idempotencyKey?: string) {
  const response = await fetch(`${api}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, body: await response.json().catch(() => ({})) as Record<string, any> };
}

async function main() {
  assertDisposableVerificationTarget();
  assertLocalVerificationApi(api);
  const companies = await pool.query("SELECT 1 FROM companies LIMIT 1");
  if (companies.rowCount) throw new Error("The TOTP runtime verifier requires a fresh disposable database with no company records.");

  try {
    const setup = await request("/api/auth/setup", { companyName: "TOTP Verification Chamber", ownerName: "Verification Owner", email, password }, undefined, "totp-verifier-setup-v1");
    if (setup.response.status !== 201) throw new Error(`Disposable Owner setup failed with HTTP ${setup.response.status}.`);

    const initialLogin = await request("/api/auth/login", { email, password });
    if (initialLogin.response.status !== 200 || !initialLogin.body.token) throw new Error("Owner could not sign in before enrolling TOTP.");
    const initialToken = initialLogin.body.token as string;
    const start = await request("/api/auth/totp/enrollment", {}, initialToken);
    if (start.response.status !== 200 || typeof start.body.secret !== "string" || !String(start.body.otpauthUri).startsWith("otpauth://totp/")) throw new Error(`TOTP enrollment start failed with HTTP ${start.response.status}.`);

    const confirm = await request("/api/auth/totp/enrollment/confirm", { code: generateTotpCode(start.body.secret), password }, initialToken);
    const recoveryCodes = confirm.body.recoveryCodes as string[] | undefined;
    if (confirm.response.status !== 200 || !Array.isArray(recoveryCodes) || recoveryCodes.length !== 10) throw new Error(`TOTP enrollment confirmation failed with HTTP ${confirm.response.status}.`);
    await new Promise(resolve => setTimeout(resolve, 30_100 - (Date.now() % 30_000)));

    const challenge1 = await request("/api/auth/login", { email, password });
    if (challenge1.response.status !== 202 || challenge1.body.mfaRequired !== true || !challenge1.body.challenge || challenge1.body.token) throw new Error("Enabled TOTP did not block token issuance pending a second factor.");
    const secondFactor = await request("/api/auth/login", { email, password, challenge: challenge1.body.challenge, code: generateTotpCode(start.body.secret) });
    if (secondFactor.response.status !== 200 || !secondFactor.body.token) throw new Error("A valid TOTP code did not complete sign-in.");

    const challenge2 = await request("/api/auth/login", { email, password });
    const recoveryLogin = await request("/api/auth/login", { email, password, challenge: challenge2.body.challenge, code: recoveryCodes[0] });
    if (challenge2.response.status !== 202 || recoveryLogin.response.status !== 200 || !recoveryLogin.body.token) throw new Error("A valid one-time recovery code did not complete sign-in.");

    const challenge3 = await request("/api/auth/login", { email, password });
    const replay = await request("/api/auth/login", { email, password, challenge: challenge3.body.challenge, code: recoveryCodes[0] });
    if (challenge3.response.status !== 202 || replay.response.status !== 401) throw new Error("A consumed recovery code was accepted more than once.");

    const disable = await request("/api/auth/totp/disable", { password, code: generateTotpCode(start.body.secret) }, initialToken);
    const finalLogin = await request("/api/auth/login", { email, password });
    const status = await request("/api/auth/totp/status", undefined, initialToken);
    const report = { setup:setup.response.status, enrollment:start.response.status, confirm:confirm.response.status, loginRequiresSecondFactor:challenge1.response.status===202&&!challenge1.body.token, totpLogin:secondFactor.response.status, recoveryLogin:recoveryLogin.response.status, recoveryReplayRejected:replay.response.status===401, disable:disable.response.status, statusAfterDisable:status.body.enabled, loginAfterDisable:finalLogin.response.status };
    console.log(JSON.stringify(report));
    if (disable.response.status!==200 || status.response.status!==200 || status.body.enabled!==false || finalLogin.response.status!==200) throw new Error("TOTP disable did not restore password-only login.");
  } finally { await pool.end(); }
}

main().catch(error => { console.error("TOTP runtime verification failed:", error instanceof Error ? error.message : "unknown error"); process.exitCode=1; });
