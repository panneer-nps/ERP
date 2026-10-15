import { Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { requireAuth, requirePermission } from "./auth";
import { pool } from "./db";
import { claimIdempotencyKey, completeIdempotencyKey } from "./idempotency";

type JournalWriter = (client: PoolClient, args: {
  companyId: string; actorId: string; sourceType: string; sourceId: string; description: string; effectiveDate: string; branchId: string | null;
  lines: Array<{ accountCode: string; description: string; debit: number; credit: number }>;
}) => Promise<unknown>;
type DocumentNumber = (client: PoolClient, companyId: string, type: string) => Promise<string>;
type CostLayerWriter = (client: PoolClient, args: {
  companyId: string; productId: string; quality: string; locationId: string; sourceType: string; sourceId: string; sourceLineId?: string | null; quantity: number; unitCost: number; occurredAt: string;
}) => Promise<void>;

const returnSchema = z.object({
  customerId: z.string().uuid(),
  locationId: z.string().uuid(),
  returnDate: z.string().date(),
  reference: z.string().trim().max(120).optional().default(""),
  reason: z.string().trim().min(5).max(500),
  lines: z.array(z.object({
    productId: z.string().uuid(), quality: z.enum(["good", "second", "damaged"]),
    quantity: z.coerce.number().positive().max(10000000), unitCode: z.string().trim().min(1).max(30),
    unitCost: z.coerce.number().positive().max(999999999),
  })).min(1).max(50),
}).superRefine((value, context) => {
  if (new Set(value.lines.map((line) => `${line.productId}:${line.quality}`)).size !== value.lines.length) {
    context.addIssue({ code: "custom", message: "A product and quality may appear only once per return.", path: ["lines"] });
  }
});

function cents(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }

export function createStockReturnsRouter(dependencies: { nextNumber: DocumentNumber; addCostLayer: CostLayerWriter; writeJournal: JournalWriter }) {
  const router = Router();
  router.use(requireAuth);

  router.get("/", requirePermission("stock.view"), async (req, res, next) => {
    try {
      const result = await pool.query(`
        SELECT r.id,r.return_number AS "returnNumber",r.return_date AS "returnDate",r.reference,r.reason,r.total_cost AS "totalCost",
          r.branch_id AS "branchId",c.name AS "customerName",l.name AS "locationName",u.full_name AS "createdBy",
          count(rl.id)::int AS "lineCount",r.created_at AS "createdAt"
        FROM stock_returns r
        JOIN business_partners c ON c.company_id=r.company_id AND c.id=r.customer_id
        JOIN stock_locations l ON l.company_id=r.company_id AND l.id=r.location_id
        JOIN users u ON u.company_id=r.company_id AND u.id=r.created_by
        JOIN stock_return_lines rl ON rl.company_id=r.company_id AND rl.stock_return_id=r.id
        WHERE r.company_id=$1 AND ($2::uuid IS NULL OR r.branch_id IS NULL OR r.branch_id=$2)
        GROUP BY r.id,c.name,l.name,u.full_name ORDER BY r.return_date DESC,r.created_at DESC LIMIT 200`,
      [req.auth!.companyId, req.auth!.branchId]);
      return res.json({ returns: result.rows });
    } catch (error) { return next(error); }
  });

  router.post("/", requirePermission("stock.return.create"), async (req, res, next) => {
    const parsed = returnSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: "STOCK_RETURN_INVALID", message: "Choose a customer, location and at least one valid product line; enter a positive unit cost and a reason." } });
    const input = parsed.data, companyId = req.auth!.companyId, actorId = req.auth!.userId;
    const requestKey = (req.get("Idempotency-Key") ?? "").trim(), operation = "stock.return.post";
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const claim = await claimIdempotencyKey(client, { companyId, userId: actorId, operation, requestKey, body: input });
      if (claim.replay) { await client.query("COMMIT"); return res.status(claim.status).json(claim.body); }

      const customer = await client.query("SELECT id FROM business_partners WHERE company_id=$1 AND id=$2 AND partner_type='customer' AND active=true", [companyId, input.customerId]);
      if (!customer.rowCount) throw Object.assign(new Error("Choose an active customer."), { httpStatus: 400 });
      const location = await client.query<{ id: string; branch_id: string | null }>(
        "SELECT id,branch_id FROM stock_locations WHERE company_id=$1 AND id=$2 AND active=true AND ($3::uuid IS NULL OR branch_id IS NULL OR branch_id=$3) FOR UPDATE",
        [companyId, input.locationId, req.auth!.branchId]);
      if (!location.rowCount) throw Object.assign(new Error("Choose an active stock location in your branch."), { httpStatus: 400 });
      const branchId = req.auth!.branchId ?? location.rows[0].branch_id;

      const prepared: Array<{ productId: string; productName: string; quality: string; enteredQuantity: number; quantity: number; unitCode: string; conversion: number; unitCost: number; lineCost: number }> = [];
      for (const line of input.lines) {
        const product = await client.query<{ name: string }>("SELECT name FROM products WHERE company_id=$1 AND id=$2 AND active=true FOR UPDATE", [companyId, line.productId]);
        if (!product.rowCount) throw Object.assign(new Error("Choose an active product for every return line."), { httpStatus: 400 });
        const unit = await client.query<{ code: string; conversion_to_base: string }>(
          "SELECT code,conversion_to_base::text FROM product_units WHERE company_id=$1 AND product_id=$2 AND code=$3 AND active=true LIMIT 1",
          [companyId, line.productId, line.unitCode]);
        if (!unit.rowCount) throw Object.assign(new Error("Choose an active unit configured for each product."), { httpStatus: 400 });
        const conversion = Number(unit.rows[0].conversion_to_base);
        const quantity = cents(line.quantity * conversion);
        const unitCost = Math.round((line.unitCost / conversion + Number.EPSILON) * 10000) / 10000;
        const lineCost = cents(quantity * unitCost);
        if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 10000000 || !Number.isFinite(unitCost) || unitCost <= 0 || lineCost <= 0) {
          throw Object.assign(new Error("Converted quantity and inventory cost must be greater than zero and within the allowed range."), { httpStatus: 400 });
        }
        prepared.push({ productId: line.productId, productName: product.rows[0].name, quality: line.quality, enteredQuantity: line.quantity, quantity, unitCode: unit.rows[0].code, conversion, unitCost, lineCost });
      }
      const totalCost = cents(prepared.reduce((total, line) => total + line.lineCost, 0));
      const returnNumber = await dependencies.nextNumber(client, companyId, "stock_return");
      const saved = await client.query<{ id: string }>(
        `INSERT INTO stock_returns(company_id,return_number,customer_id,location_id,return_date,reference,reason,branch_id,total_cost,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [companyId, returnNumber, input.customerId, input.locationId, input.returnDate, input.reference || null, input.reason, branchId, totalCost, actorId]);
      const returnId = saved.rows[0].id;
      for (const line of prepared) {
        const savedLine = await client.query<{ id: string }>(
          `INSERT INTO stock_return_lines(company_id,stock_return_id,product_id,quality,quantity,entered_quantity,entered_unit_code,conversion_to_base,unit_cost,line_cost)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [companyId, returnId, line.productId, line.quality, line.quantity, line.enteredQuantity, line.unitCode, line.conversion, line.unitCost, line.lineCost]);
        await client.query(
          `INSERT INTO stock_movements(company_id,product_id,movement_type,quality,direction,quantity,actor_user_id,reason,reference_type,reference_id,location_id,valuation_status,inventory_cost,entered_quantity,entered_unit_code,conversion_to_base)
           VALUES($1,$2,'customer_return',$3,'in',$4,$5,$6,'stock_return',$7,$8,'valued',$9,$10,$11,$12)`,
          [companyId, line.productId, line.quality, line.quantity, actorId, input.reason, returnId, input.locationId, line.lineCost, line.enteredQuantity, line.unitCode, line.conversion]);
        await dependencies.addCostLayer(client, { companyId, productId: line.productId, quality: line.quality, locationId: input.locationId, sourceType: "customer_return", sourceId: returnId, sourceLineId: savedLine.rows[0].id, quantity: line.quantity, unitCost: line.unitCost, occurredAt: `${input.returnDate}T12:00:00+05:30` });
      }
      await dependencies.writeJournal(client, {
        companyId, actorId, sourceType: "stock_return", sourceId: returnId, description: `Non-invoice customer stock return ${returnNumber}: ${input.reason}`, effectiveDate: input.returnDate, branchId,
        lines: [
          { accountCode: "1300", description: `Returned inventory ${returnNumber}`, debit: totalCost, credit: 0 },
          { accountCode: "5200", description: `Cost recovery ${returnNumber}`, debit: 0, credit: totalCost },
        ],
      });
      await client.query(
        `INSERT INTO audit_logs(company_id,branch_id,actor_user_id,action,entity_type,entity_id,reason,after_data)
         VALUES($1,$2,$3,'stock.return.post','stock_return',$4,$5,$6::jsonb)`,
        [companyId, branchId, actorId, returnId, input.reason, JSON.stringify({ returnNumber, customerId: input.customerId, locationId: input.locationId, returnDate: input.returnDate, reference: input.reference, lines: prepared, totalCost, customerCreditCreated: false })]);
      const response = { id: returnId, returnNumber, totalCost, lineCount: prepared.length };
      await completeIdempotencyKey(client, { companyId, userId: actorId, operation, requestKey, status: 201, body: response });
      await client.query("COMMIT");
      return res.status(201).json(response);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const status = (error as { httpStatus?: number }).httpStatus;
      if (status) return res.status(status).json({ error: { code: (error as { errorCode?: string }).errorCode ?? "STOCK_RETURN_INVALID", message: (error as Error).message } });
      return next(error);
    } finally { client.release(); }
  });
  return router;
}
