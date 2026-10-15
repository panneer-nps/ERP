import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { NextFunction, Request, Response } from "express";
import { pool } from "./db";
import { decryptTotpSecret, verifyTotpOrRecovery } from "./totp";

const scrypt = promisify(scryptCallback);
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS ?? 12);

declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string; companyId: string; branchId: string | null; sessionId: string };
    }
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [salt, expectedHex] = encoded.split(":");
  if (!salt || !expectedHex || !/^[a-f0-9]{128}$/i.test(expectedHex)) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function createPasswordHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}

export async function login(email: string, password: string, ip: string | undefined, userAgent: string | undefined, challenge?: string, code?: string) {
  const result = await pool.query<{
    id: string; company_id: string; password_hash: string; active: boolean; totp_enabled: boolean; totp_secret_ciphertext: string | null;
  }>(
    `SELECT u.id,u.company_id,u.password_hash,u.active,t.enabled_at IS NOT NULL AS totp_enabled,t.secret_ciphertext AS totp_secret_ciphertext
       FROM users u LEFT JOIN user_totp t ON t.company_id=u.company_id AND t.user_id=u.id
      WHERE lower(u.email)=lower($1) LIMIT 1`,
    [email],
  );
  const user = result.rows[0];
  if (!user || !user.active || !(await verifyPassword(password, user.password_hash))) return null;

  if (user.totp_enabled && (!challenge || !code)) {
    if (challenge || code) return null;
    const challengeToken = randomBytes(32).toString("base64url");
    await pool.query("DELETE FROM auth_login_challenges WHERE user_id=$1 AND (expires_at<=now() OR consumed_at IS NOT NULL)", [user.id]);
    await pool.query(`INSERT INTO auth_login_challenges(company_id,user_id,token_hash,ip_address,user_agent,expires_at)
      VALUES($1,$2,$3,$4,$5,now()+interval '5 minutes')`, [user.company_id,user.id,hashToken(challengeToken),ip ?? null,userAgent ?? null]);
    return { mfaRequired: true as const, challenge: challengeToken };
  }
  if (challenge || code) {
    if (!user.totp_enabled || !challenge || !code || !user.totp_secret_ciphertext) return null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const pending = await client.query<{ id:string; attempts:number }>(`SELECT id,attempts FROM auth_login_challenges
        WHERE token_hash=$1 AND company_id=$2 AND user_id=$3 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE`,
        [hashToken(challenge),user.company_id,user.id]);
      if (!pending.rowCount || pending.rows[0].attempts >= 5) { await client.query("ROLLBACK"); return null; }
      const factors = await client.query<{ recovery_code_hashes:string[]; secret_ciphertext:string; last_totp_counter:string|null }>("SELECT recovery_code_hashes,secret_ciphertext,last_totp_counter FROM user_totp WHERE company_id=$1 AND user_id=$2 AND enabled_at IS NOT NULL FOR UPDATE", [user.company_id,user.id]);
      if (!factors.rowCount) { await client.query("ROLLBACK"); return null; }
      const verified = verifyTotpOrRecovery(decryptTotpSecret(factors.rows[0].secret_ciphertext),factors.rows[0].recovery_code_hashes,code);
      const replayed = verified.totpCounter !== undefined && factors.rows[0].last_totp_counter !== null && verified.totpCounter <= Number(factors.rows[0].last_totp_counter);
      if (!verified.valid || replayed) {
        const attempts = pending.rows[0].attempts + 1;
        await client.query("UPDATE auth_login_challenges SET attempts=$2::smallint,consumed_at=CASE WHEN $2::smallint>=5 THEN now() ELSE consumed_at END WHERE id=$1", [pending.rows[0].id,attempts]);
        await client.query("COMMIT");
        return null;
      }
      if (verified.recoveryHashes) await client.query("UPDATE user_totp SET recovery_code_hashes=$3,updated_at=now() WHERE company_id=$1 AND user_id=$2", [user.company_id,user.id,verified.recoveryHashes]);
      if (verified.totpCounter !== undefined) await client.query("UPDATE user_totp SET last_totp_counter=$3,updated_at=now() WHERE company_id=$1 AND user_id=$2", [user.company_id,user.id,verified.totpCounter]);
      await client.query("UPDATE auth_login_challenges SET consumed_at=now() WHERE id=$1", [pending.rows[0].id]);
      return await createSession(client,user.id,user.company_id,ip,userAgent);
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await createSession(client,user.id,user.company_id,ip,userAgent);
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

async function createSession(client: import("pg").PoolClient, userId: string, companyId: string, ip: string | undefined, userAgent: string | undefined) {
  const token = randomBytes(32).toString("base64url");
  const session = await client.query<{ id: string }>(
      `INSERT INTO sessions (user_id, company_id, token_hash, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, now() + ($4 * interval '1 hour'), $5, $6) RETURNING id`,
      [userId, companyId, hashToken(token), SESSION_TTL_HOURS, ip ?? null, userAgent ?? null],
    );
    await client.query("UPDATE users SET last_login_at = now() WHERE id = $1", [userId]);
    await client.query(
      `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type, entity_id, ip_address)
       VALUES ($1, $2, 'auth.login', 'user', ($2::uuid)::text, $3)`,
      [companyId, userId, ip ?? null],
    );
    await client.query("COMMIT");
    return { token, userId, companyId, sessionId: session.rows[0].id };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in is required." } });

  try {
    const result = await pool.query<{
      id: string; user_id: string; company_id: string; branch_id: string | null;
      is_owner: boolean; assigned_branch_ids: string[]; active_branch_count: number;
    }>(
      `SELECT s.id,s.user_id,s.company_id,s.branch_id,
        EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.company_id=ur.company_id AND r.id=ur.role_id WHERE ur.company_id=s.company_id AND ur.user_id=s.user_id AND r.code='owner') AS is_owner,
        ARRAY(SELECT ub.branch_id FROM user_branches ub JOIN branches b ON b.company_id=ub.company_id AND b.id=ub.branch_id WHERE ub.company_id=s.company_id AND ub.user_id=s.user_id AND b.active=true ORDER BY ub.branch_id) AS assigned_branch_ids,
        (SELECT count(*)::int FROM branches b WHERE b.company_id=s.company_id AND b.active=true) AS active_branch_count
       FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.active=true`,
      [hashToken(token)],
    );
    const session=result.rows[0];
    if (!session) return res.status(401).json({ error: { code: "SESSION_INVALID", message: "Your session has expired. Sign in again." } });
    const branchIds=session.assigned_branch_ids;
    let branchId=session.branch_id;
    const branchPicker=req.path==="/api/auth/branches"||req.path==="/api/auth/branch";
    if(branchId&&!session.is_owner&&!branchIds.includes(branchId))return res.status(403).json({error:{code:"BRANCH_ACCESS_DENIED",message:"Your account is not assigned to this branch. Sign in again or contact an administrator."}});
    if(!session.is_owner&&session.active_branch_count>0&&branchIds.length===0)return res.status(403).json({error:{code:"BRANCH_ACCESS_UNASSIGNED",message:"An administrator must assign your account to a branch before you can access branch data."}});
    if(!branchId&&!session.is_owner&&branchIds.length===1){branchId=branchIds[0];await pool.query("UPDATE sessions SET branch_id=$2 WHERE id=$1 AND branch_id IS NULL",[session.id,branchId]);}
    if(!branchId&&!session.is_owner&&branchIds.length>1&&!branchPicker)return res.status(409).json({error:{code:"BRANCH_SELECTION_REQUIRED",message:"Choose a branch to continue."}});
    req.auth={userId:session.user_id,companyId:session.company_id,branchId,sessionId:session.id};
    return next();
  } catch (error) { return next(error); }
}
export function requirePermission(permissionCode: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in is required." } });
    try {
      const result = await pool.query(
        `SELECT 1 FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE ur.user_id = $1 AND ur.company_id = $2 AND p.code = $3 LIMIT 1`,
        [req.auth.userId, req.auth.companyId, permissionCode],
      );
      if (!result.rowCount) return res.status(403).json({ error: { code: "FORBIDDEN", message: "You do not have permission to perform this action." } });
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export async function requireOwnerRole(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in is required." } });
  try {
    const result = await pool.query(
      `SELECT 1 FROM user_roles ur JOIN roles r ON r.company_id=ur.company_id AND r.id=ur.role_id
       WHERE ur.user_id=$1 AND ur.company_id=$2 AND r.code='owner' LIMIT 1`,
      [req.auth.userId, req.auth.companyId],
    );
    if (!result.rowCount) return res.status(403).json({ error: { code: "OWNER_REQUIRED", message: "Only a company Owner can perform this action." } });
    return next();
  } catch (error) { return next(error); }
}
