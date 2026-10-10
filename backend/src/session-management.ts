import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "./auth";
import { pool } from "./db";

export const sessionManagementRouter = Router();

sessionManagementRouter.use(requireAuth);

sessionManagementRouter.get("/", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id,ip_address AS "ipAddress",user_agent AS "userAgent",
        created_at AS "createdAt",expires_at AS "expiresAt",branch_id AS "branchId",
        (id=$3::uuid) AS current
       FROM sessions
       WHERE company_id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now()
       ORDER BY (id=$3::uuid) DESC,created_at DESC`,
      [req.auth!.companyId, req.auth!.userId, req.auth!.sessionId],
    );
    res.setHeader("Cache-Control", "no-store");
    return res.json({ sessions: result.rows });
  } catch (error) {
    return next(error);
  }
});

sessionManagementRouter.post("/:sessionId/revoke", async (req, res, next) => {
  const parsed = z.object({ sessionId: z.string().uuid() }).safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ error: { code: "INVALID_SESSION", message: "Choose a valid session." } });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const revoked = await client.query<{ id: string }>(
      `UPDATE sessions SET revoked_at=now()
       WHERE id=$1 AND company_id=$2 AND user_id=$3 AND revoked_at IS NULL AND expires_at>now()
       RETURNING id`,
      [parsed.data.sessionId, req.auth!.companyId, req.auth!.userId],
    );
    if (!revoked.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "SESSION_NOT_FOUND", message: "That active session was not found." } });
    }
    const current = parsed.data.sessionId === req.auth!.sessionId;
    await client.query(
      `INSERT INTO audit_logs(company_id,branch_id,actor_user_id,action,entity_type,entity_id,ip_address,after_data)
       VALUES($1,$2,$3,'auth.session.revoke','session',$4,$5,jsonb_build_object('selfRevocation',$6::boolean))`,
      [req.auth!.companyId, req.auth!.branchId, req.auth!.userId, parsed.data.sessionId, req.ip ?? null, current],
    );
    await client.query("COMMIT");
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true, currentSessionRevoked: current });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return next(error);
  } finally {
    client.release();
  }
});
