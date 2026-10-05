import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { NextFunction, Request, Response } from "express";
import { pool } from "./db";

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

export async function login(email: string, password: string, ip: string | undefined, userAgent: string | undefined) {
  const result = await pool.query<{
    id: string; company_id: string; password_hash: string; active: boolean;
  }>(
    `SELECT id, company_id, password_hash, active FROM users WHERE lower(email) = lower($1) LIMIT 1`,
    [email],
  );
  const user = result.rows[0];
  if (!user || !user.active || !(await verifyPassword(password, user.password_hash))) return null;

  const token = randomBytes(32).toString("base64url");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const session = await client.query<{ id: string }>(
      `INSERT INTO sessions (user_id, company_id, token_hash, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, now() + ($4 * interval '1 hour'), $5, $6) RETURNING id`,
      [user.id, user.company_id, hashToken(token), SESSION_TTL_HOURS, ip ?? null, userAgent ?? null],
    );
    await client.query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
    await client.query(
      `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type, entity_id, ip_address)
       VALUES ($1, $2, 'auth.login', 'user', ($2::uuid)::text, $3)`,
      [user.company_id, user.id, ip ?? null],
    );
    await client.query("COMMIT");
    return { token, userId: user.id, companyId: user.company_id, sessionId: session.rows[0].id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in is required." } });

  try {
    const result = await pool.query<{
      id: string; user_id: string; company_id: string; branch_id: string | null;
    }>(
      `SELECT s.id, s.user_id, s.company_id, s.branch_id
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.active = true`,
      [hashToken(token)],
    );
    const session = result.rows[0];
    if (!session) return res.status(401).json({ error: { code: "SESSION_INVALID", message: "Your session has expired. Sign in again." } });
    req.auth = { userId: session.user_id, companyId: session.company_id, branchId: session.branch_id, sessionId: session.id };
    return next();
  } catch (error) {
    return next(error);
  }
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
