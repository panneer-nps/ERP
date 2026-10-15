import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { pool } from "./db";
import { requireAuth, verifyPassword } from "./auth";
import { decryptTotpSecret, encryptTotpSecret, generateTotpSecret, hashRecoveryCode, matchingTotpCounter, newRecoveryCodes, TotpKeyConfigurationError, verifyTotpOrRecovery } from "./totp";

export const totpManagementRouter = Router();
totpManagementRouter.use(requireAuth);
const factorLimiter = rateLimit({ windowMs:15*60*1000, limit:10, standardHeaders:true, legacyHeaders:false });
const codeSchema = z.object({ code: z.string().trim().min(6).max(32) });

totpManagementRouter.get("/status", async (req, res, next) => {
  try {
    const result = await pool.query<{ enabled: boolean; recovery_count: number }>(
      "SELECT enabled_at IS NOT NULL AS enabled,cardinality(recovery_code_hashes)::int AS recovery_count FROM user_totp WHERE company_id=$1 AND user_id=$2",
      [req.auth!.companyId, req.auth!.userId],
    );
    res.setHeader("Cache-Control", "no-store");
    return res.json({ enabled: result.rows[0]?.enabled ?? false, recoveryCodeCount: result.rows[0]?.recovery_count ?? 0 });
  } catch (error) { return next(error); }
});

totpManagementRouter.post("/enrollment", factorLimiter, async (req, res, next) => {
  try {
    const current = await pool.query<{ enabled: boolean }>("SELECT enabled_at IS NOT NULL AS enabled FROM user_totp WHERE company_id=$1 AND user_id=$2", [req.auth!.companyId, req.auth!.userId]);
    if (current.rows[0]?.enabled) return res.status(409).json({ error: { code: "TOTP_ALREADY_ENABLED", message: "Turn off two-step verification before starting a new enrollment." } });
    const secret = generateTotpSecret(), ciphertext = encryptTotpSecret(secret);
    await pool.query(`INSERT INTO user_totp(company_id,user_id,pending_secret_ciphertext,pending_expires_at,updated_at)
      VALUES($1,$2,$3,now()+interval '10 minutes',now())
      ON CONFLICT(company_id,user_id) DO UPDATE SET pending_secret_ciphertext=EXCLUDED.pending_secret_ciphertext,pending_expires_at=EXCLUDED.pending_expires_at,updated_at=now()`,
      [req.auth!.companyId, req.auth!.userId, ciphertext]);
    const account = await pool.query<{ email: string }>("SELECT email FROM users WHERE company_id=$1 AND id=$2", [req.auth!.companyId, req.auth!.userId]);
    await pool.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,ip_address) VALUES($1,$2,'auth.totp.enrollment.start','user',$2::uuid::text,$3)", [req.auth!.companyId, req.auth!.userId, req.ip ?? null]);
    const label = encodeURIComponent(`Brick Chamber ERP:${account.rows[0]?.email ?? "account"}`);
    const issuer = encodeURIComponent("Brick Chamber ERP");
    res.setHeader("Cache-Control", "no-store");
    return res.json({ secret, otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`, expiresInSeconds: 600 });
  } catch (error) {
    if (error instanceof TotpKeyConfigurationError) return res.status(503).json({ error: { code: "TOTP_KEY_NOT_CONFIGURED", message: "Two-step verification is unavailable until the API administrator configures TOTP_ENCRYPTION_KEY." } });
    return next(error);
  }
});

totpManagementRouter.post("/enrollment/confirm", factorLimiter, async (req, res, next) => {
  const parsed = z.object({ code:z.string().regex(/^\d{6}$/), password:z.string().min(1).max(1024) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "TOTP_CODE_INVALID", message: "Enter your current password and the six-digit code from your authenticator app." } });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query<{password_hash:string}>("SELECT password_hash FROM users WHERE company_id=$1 AND id=$2 AND active=true", [req.auth!.companyId, req.auth!.userId]);
    if (!user.rowCount || !(await verifyPassword(parsed.data.password,user.rows[0].password_hash))) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "The current password is incorrect." } });
    }
    const row = await client.query<{ pending_secret_ciphertext: string | null; pending_expires_at: Date | null }>(
      "SELECT pending_secret_ciphertext,pending_expires_at FROM user_totp WHERE company_id=$1 AND user_id=$2 FOR UPDATE", [req.auth!.companyId, req.auth!.userId]);
    const pending = row.rows[0];
    if (!pending?.pending_secret_ciphertext || !pending.pending_expires_at || pending.pending_expires_at.getTime() <= Date.now()) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: { code: "TOTP_ENROLLMENT_EXPIRED", message: "Start two-step verification setup again; the setup code expired." } });
    }
    const enrolledCounter = matchingTotpCounter(decryptTotpSecret(pending.pending_secret_ciphertext), parsed.data.code);
    if (enrolledCounter === null) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: { code: "TOTP_CODE_INVALID", message: "That code is incorrect or expired. Check your phone time and try the current code." } });
    }
    const recoveryCodes = newRecoveryCodes();
    await client.query(`UPDATE user_totp SET secret_ciphertext=pending_secret_ciphertext,enabled_at=now(),pending_secret_ciphertext=NULL,pending_expires_at=NULL,recovery_code_hashes=$3,last_totp_counter=$4,updated_at=now()
      WHERE company_id=$1 AND user_id=$2`, [req.auth!.companyId, req.auth!.userId, recoveryCodes.map(hashRecoveryCode), enrolledCounter]);
    await client.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,ip_address) VALUES($1,$2,'auth.totp.enable','user',$2::uuid::text,$3)", [req.auth!.companyId, req.auth!.userId, req.ip ?? null]);
    await client.query("COMMIT");
    res.setHeader("Cache-Control", "no-store");
    return res.json({ enabled: true, recoveryCodes });
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); if(error instanceof TotpKeyConfigurationError)return res.status(503).json({error:{code:"TOTP_KEY_NOT_CONFIGURED",message:"Two-step verification is unavailable until the API administrator configures TOTP_ENCRYPTION_KEY."}}); return next(error); }
  finally { client.release(); }
});

const disableSchema = z.object({ password: z.string().min(1).max(1024), code: z.string().trim().min(6).max(32) });
totpManagementRouter.post("/disable", factorLimiter, async (req, res, next) => {
  const parsed = disableSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "TOTP_DISABLE_INVALID", message: "Enter your current password and an authenticator or recovery code." } });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE company_id=$1 AND id=$2 AND active=true", [req.auth!.companyId, req.auth!.userId]);
    if (!user.rowCount || !(await verifyPassword(parsed.data.password, user.rows[0].password_hash))) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "The current password is incorrect." } });
    }
    const row = await client.query<{ secret_ciphertext: string | null; recovery_code_hashes: string[]; enabled_at: Date | null }>(
      "SELECT secret_ciphertext,recovery_code_hashes,enabled_at FROM user_totp WHERE company_id=$1 AND user_id=$2 FOR UPDATE", [req.auth!.companyId, req.auth!.userId]);
    const factors = row.rows[0];
    if (!factors?.enabled_at || !factors.secret_ciphertext) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: { code: "TOTP_CODE_INVALID", message: "That authenticator or recovery code is incorrect." } });
    }
    const verified = verifyTotpOrRecovery(decryptTotpSecret(factors.secret_ciphertext), factors.recovery_code_hashes, parsed.data.code);
    if (!verified.valid) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: { code: "TOTP_CODE_INVALID", message: "That authenticator or recovery code is incorrect." } });
    }
    if (verified.recoveryHashes) await client.query("UPDATE user_totp SET recovery_code_hashes=$3 WHERE company_id=$1 AND user_id=$2", [req.auth!.companyId, req.auth!.userId, verified.recoveryHashes]);
    await client.query("DELETE FROM user_totp WHERE company_id=$1 AND user_id=$2", [req.auth!.companyId, req.auth!.userId]);
    await client.query("UPDATE sessions SET revoked_at=now() WHERE company_id=$1 AND user_id=$2 AND id<>$3 AND revoked_at IS NULL", [req.auth!.companyId, req.auth!.userId, req.auth!.sessionId]);
    await client.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,ip_address) VALUES($1,$2,'auth.totp.disable','user',$2::uuid::text,$3)", [req.auth!.companyId, req.auth!.userId, req.ip ?? null]);
    await client.query("COMMIT");
    return res.json({ enabled: false });
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); if(error instanceof TotpKeyConfigurationError)return res.status(503).json({error:{code:"TOTP_KEY_NOT_CONFIGURED",message:"Two-step verification cannot be changed until the API administrator restores TOTP_ENCRYPTION_KEY."}}); return next(error); }
  finally { client.release(); }
});

