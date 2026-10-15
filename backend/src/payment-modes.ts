import express from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { requireAuth, requireOwnerRole } from "./auth";
import { pool } from "./db";

const codes = ["cash", "upi", "bank_transfer", "cheque", "card", "other"] as const;
const modeCode = z.enum(codes);
const updateSchema = z.object({ active: z.boolean(), accountCode: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9._-]+$/) });

export const paymentModesRouter = express.Router();

/** Resolve the configured liquid-asset account for a payment mode. */
export async function resolvePaymentModeAccount(client: PoolClient, companyId: string, code: string, allowInactive = false): Promise<string> {
  const mode = modeCode.safeParse(code);
  if (!mode.success) throw Object.assign(new Error("Choose a supported payment method."), { httpStatus: 400, errorCode: "PAYMENT_MODE_INVALID" });
  const result = await client.query<{ account_code: string }>(
    `SELECT pm.account_code
       FROM company_payment_modes pm
       JOIN accounts a ON a.company_id=pm.company_id AND a.code=pm.account_code
      WHERE pm.company_id=$1 AND pm.code=$2
        AND pm.account_code=CASE pm.code WHEN 'cash' THEN '1110' ELSE '1120' END
        AND ($3::boolean OR pm.active=true)
        AND a.active=true AND a.account_type='asset'`,
    [companyId, mode.data, allowInactive],
  );
  if (!result.rowCount) throw Object.assign(new Error("This payment method is disabled or its ledger account is unavailable. Ask the Owner to review payment settings."), { httpStatus: 409, errorCode: "PAYMENT_MODE_UNAVAILABLE" });
  return result.rows[0].account_code;
}

paymentModesRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT pm.code,pm.account_code AS "accountCode",pm.active,
              (a.active=true AND a.account_type='asset' AND pm.account_code=CASE pm.code WHEN 'cash' THEN '1110' ELSE '1120' END) AS "accountAvailable"
         FROM company_payment_modes pm
         LEFT JOIN accounts a ON a.company_id=pm.company_id AND a.code=pm.account_code
        WHERE pm.company_id=$1
        ORDER BY array_position(ARRAY['cash','upi','bank_transfer','cheque','card','other']::text[],pm.code)`,
      [req.auth!.companyId],
    );
    return res.json({ modes: result.rows });
  } catch (error) { return next(error); }
});

paymentModesRouter.put("/:code", requireAuth, requireOwnerRole, async (req, res, next) => {
  const code = modeCode.safeParse(req.params.code);
  const parsed = updateSchema.safeParse(req.body);
  if (!code.success || !parsed.success) return res.status(400).json({ error: { code: "PAYMENT_MODE_INVALID", message: "Choose a supported payment method, active status, and a ledger account." } });

  const companyId = req.auth!.companyId;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`payment-modes:${companyId}`]);
    const before = await client.query<{ account_code: string; active: boolean }>(
      "SELECT account_code,active FROM company_payment_modes WHERE company_id=$1 AND code=$2 FOR UPDATE",
      [companyId, code.data],
    );
    if (!before.rowCount) throw Object.assign(new Error("Payment method configuration was not found."), { httpStatus: 404 });
    if (before.rows[0].active && !parsed.data.active) {
      const enabled = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM company_payment_modes WHERE company_id=$1 AND active=true", [companyId]);
      if (Number(enabled.rows[0]?.count ?? 0) <= 1) throw Object.assign(new Error("Keep at least one payment method enabled."), { httpStatus: 409, errorCode: "PAYMENT_MODE_REQUIRED" });
    }
    const requiredAccount = code.data === "cash" ? "1110" : "1120";
    if (parsed.data.accountCode !== requiredAccount) throw Object.assign(new Error(code.data === "cash" ? "Cash must use the Cash on hand account (1110) so daily cash closing stays accurate." : "Non-cash methods must use the Bank and UPI account (1120) so bank reports and reconciliation stay accurate."), { httpStatus: 400 });
    const account = await client.query(
      "SELECT 1 FROM accounts WHERE company_id=$1 AND code=$2 AND active=true AND account_type='asset'",
      [companyId, parsed.data.accountCode],
    );
    if (!account.rowCount) throw Object.assign(new Error("Choose an active asset account for cash or bank settlement."), { httpStatus: 400 });

    await client.query(
      "UPDATE company_payment_modes SET account_code=$3,active=$4,updated_by=$5,updated_at=now() WHERE company_id=$1 AND code=$2",
      [companyId, code.data, parsed.data.accountCode, parsed.data.active, req.auth!.userId],
    );
    await client.query(
      `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
       VALUES($1,$2,'payment_mode.update','payment_mode',$3,$4::jsonb,$5::jsonb)`,
      [companyId, req.auth!.userId, code.data, JSON.stringify({ accountCode: before.rows[0].account_code, active: before.rows[0].active }), JSON.stringify(parsed.data)],
    );
    await client.query("COMMIT");
    return res.json({ success: true, code: code.data, ...parsed.data });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const status = (error as { httpStatus?: number }).httpStatus;
    if (status) return res.status(status).json({ error: { code: (error as { errorCode?: string }).errorCode ?? "PAYMENT_MODE_INVALID", message: (error as Error).message } });
    return next(error);
  } finally { client.release(); }
});
