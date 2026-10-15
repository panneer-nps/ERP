import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireOwnerRole } from "./auth";
import { pool } from "./db";

export const documentSequencesRouter = Router();
documentSequencesRouter.use(requireAuth, requireOwnerRole);

const updateSchema = z.object({
  sequences: z.array(z.object({
    documentType: z.string().trim().min(1).max(80),
    prefix: z.string().regex(/^[A-Za-z0-9._/-]{0,20}$/),
    padding: z.number().int().min(1).max(12),
  })).min(1).max(100),
});

documentSequencesRouter.get("/", async (req, res, next) => {
  try {
    const result = await pool.query<{ documentType: string; prefix: string; padding: number; nextValue: string }>(
      `SELECT document_type AS "documentType",prefix,padding,next_value AS "nextValue"
       FROM number_sequences WHERE company_id=$1 AND branch_id IS NULL AND financial_year_id IS NULL
       ORDER BY document_type`, [req.auth!.companyId],
    );
    return res.json({ sequences: result.rows });
  } catch (error) { return next(error); }
});

documentSequencesRouter.put("/", async (req, res, next) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success || new Set(parsed.data?.sequences.map((item) => item.documentType)).size !== parsed.data?.sequences.length) {
    return res.status(400).json({ error: { code: "DOCUMENT_SEQUENCE_INVALID", message: "Review the document prefixes and number lengths." } });
  }
  const companyId = req.auth!.companyId, actorId = req.auth!.userId;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query<{ documentType: string; prefix: string; padding: number }>(
      `SELECT document_type AS "documentType",prefix,padding FROM number_sequences
       WHERE company_id=$1 AND branch_id IS NULL AND financial_year_id IS NULL FOR UPDATE`, [companyId],
    );
    const existing = new Map(before.rows.map((row) => [row.documentType, row]));
    if (parsed.data.sequences.some((item) => !existing.has(item.documentType))) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: { code: "DOCUMENT_SEQUENCE_CHANGED", message: "The document list changed. Reload the page and try again." } });
    }
    const changes = parsed.data.sequences.filter((item) => {
      const row = existing.get(item.documentType)!;
      return item.prefix !== row.prefix || item.padding !== row.padding;
    });
    for (const item of changes) {
      await client.query(
        `UPDATE number_sequences SET prefix=$3,padding=$4,updated_at=now()
         WHERE company_id=$1 AND document_type=$2 AND branch_id IS NULL AND financial_year_id IS NULL`,
        [companyId, item.documentType, item.prefix, item.padding],
      );
    }
    if (changes.length) {
      await client.query(
        `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
         VALUES($1,$2,'company.document_sequences.update','number_sequences',$1::text,$3::jsonb,$4::jsonb)`,
        [companyId, actorId, JSON.stringify(Object.fromEntries(changes.map((item) => [item.documentType, existing.get(item.documentType)]))), JSON.stringify(Object.fromEntries(changes.map(({ documentType, ...item }) => [documentType, item])))],
      );
    }
    await client.query("COMMIT");
    return res.json({ success: true, updated: changes.length });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return next(error);
  } finally { client.release(); }
});
