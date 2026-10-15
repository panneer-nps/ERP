import "dotenv/config";
import { randomBytes } from "node:crypto";
import { pool } from "./db";
import { createPasswordHash } from "./auth";

function parseEmail(args: string[]): string {
  const index = args.indexOf("--email");
  const email = index >= 0 ? args[index + 1]?.trim().toLowerCase() : "";
  if (!email || !args.includes("--confirm") || args.length !== 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Usage: npm run owner:password-reset -- --email owner@example.com --confirm");
  }
  return email;
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Owner recovery is disabled in production; use the approved deployment recovery procedure.");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const databaseHost = new URL(databaseUrl).hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(databaseHost)) {
    throw new Error("Owner recovery only connects to a PostgreSQL database on this computer.");
  }

  const email = parseEmail(process.argv.slice(2));
  const temporaryPassword = randomBytes(24).toString("base64url");
  const passwordHash = await createPasswordHash(temporaryPassword);
  const client = await pool.connect();
  let totpEnabled = false;
  let revokedSessions = 0;
  try {
    await client.query("BEGIN");
    const owner = await client.query<{ id: string; company_id: string; active: boolean; totp_enabled: boolean }>(
      `SELECT u.id,u.company_id,u.active,(t.enabled_at IS NOT NULL) AS totp_enabled
         FROM users u
         JOIN user_roles ur ON ur.company_id=u.company_id AND ur.user_id=u.id
         JOIN roles r ON r.company_id=ur.company_id AND r.id=ur.role_id AND r.code='owner'
         LEFT JOIN user_totp t ON t.company_id=u.company_id AND t.user_id=u.id
        WHERE lower(u.email)=lower($1)
        FOR UPDATE OF u`,
      [email],
    );
    if (owner.rowCount !== 1) throw new Error("Exactly one Owner account must match that email in this local database.");
    if (!owner.rows[0].active) throw new Error("The matching Owner account is inactive; recovery stopped without changing it.");
    if (owner.rows[0].totp_enabled) throw new Error("Authenticator verification is enabled. Use a saved recovery code or the approved MFA recovery procedure; the password was not changed.");
    totpEnabled = owner.rows[0].totp_enabled;

    await client.query("UPDATE users SET password_hash=$3,updated_at=now() WHERE company_id=$1 AND id=$2", [owner.rows[0].company_id, owner.rows[0].id, passwordHash]);
    const sessions = await client.query(
      "UPDATE sessions SET revoked_at=now() WHERE company_id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id",
      [owner.rows[0].company_id, owner.rows[0].id],
    );
    revokedSessions = sessions.rowCount ?? 0;
    await client.query(
      `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,reason,after_data)
       VALUES($1,NULL,'auth.owner.password.recovery','user',$2,'Local administrator recovery',jsonb_build_object('sessionsRevoked',true))`,
      [owner.rows[0].company_id, owner.rows[0].id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  console.log(`Owner password reset completed for ${email}.`);
  console.log(`Temporary password (copy it now): ${temporaryPassword}`);
  console.log(`Revoked existing sessions: ${revokedSessions}.`);
  if (totpEnabled) console.log("Authenticator verification remains enabled.");
  console.log("Sign in, then open Account security and change the temporary password immediately.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Owner password recovery failed.");
  process.exitCode = 1;
});
