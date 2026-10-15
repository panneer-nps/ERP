import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "./auth";
import { pool } from "./db";

/** Read-only as-of reconstruction from stock events and recorded FIFO layers. */
export const inventoryValuationHistoryRouter = Router();

const querySchema = z.object({ asOf: z.string().date().optional() });
const periodSchema = z.object({ from: z.string().date().optional(), to: z.string().date().optional() });

inventoryValuationHistoryRouter.get("/", requireAuth, requirePermission("inventory.valuation.view"), async (req, res, next) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: { code: "INVALID_AS_OF_DATE", message: "Choose a valid as-of date in YYYY-MM-DD format." } });

  try {
    const { companyId, branchId } = req.auth!;
    const context = await pool.query<{ timezone: string; today: string }>(
      "SELECT timezone,(now() AT TIME ZONE timezone)::date::text AS today FROM companies WHERE id=$1 AND active=true",
      [companyId],
    );
    if (!context.rowCount) return res.status(404).json({ error: { code: "COMPANY_NOT_FOUND", message: "The active company could not be found." } });
    const { timezone, today } = context.rows[0];
    const asOf = parsed.data.asOf ?? today;
    if (asOf > today) return res.status(400).json({ error: { code: "AS_OF_DATE_IN_FUTURE", message: "The as-of date cannot be after today in the company timezone." } });

    const result = await pool.query(`
      WITH company_context AS (
        SELECT timezone, (($3::date + interval '1 day') AT TIME ZONE timezone) AS cutoff
        FROM companies WHERE id=$1 AND active=true
      ), physical AS (
        SELECT sm.product_id,sm.location_id,sm.quality,
          SUM(CASE WHEN sm.direction='in' THEN sm.quantity ELSE -sm.quantity END)::numeric(14,2) AS quantity
        FROM stock_movements sm
        JOIN stock_locations l ON l.company_id=sm.company_id AND l.id=sm.location_id
        CROSS JOIN company_context cc
        WHERE sm.company_id=$1 AND sm.occurred_at<cc.cutoff
          AND ($2::uuid IS NULL OR l.branch_id IS NULL OR l.branch_id=$2)
        GROUP BY sm.product_id,sm.location_id,sm.quality
      ), layers AS (
        SELECT cl.product_id,cl.location_id,cl.quality,
          SUM(GREATEST(cl.received_quantity-COALESCE(used.consumed_quantity,0),0))::numeric(14,2) AS quantity,
          SUM(GREATEST(cl.received_quantity-COALESCE(used.consumed_quantity,0),0)*cl.unit_cost)::numeric(14,2) AS value
        FROM inventory_cost_layers cl
        CROSS JOIN company_context cc
        LEFT JOIN LATERAL (
          SELECT SUM(c.quantity)::numeric(14,2) AS consumed_quantity
          FROM inventory_cost_consumptions c
          JOIN stock_movements sm ON sm.company_id=c.company_id AND sm.id=c.stock_movement_id
          WHERE c.company_id=cl.company_id AND c.cost_layer_id=cl.id AND sm.occurred_at<cc.cutoff
        ) used ON true
        JOIN stock_locations l ON l.company_id=cl.company_id AND l.id=cl.location_id
        WHERE cl.company_id=$1 AND cl.occurred_at<cc.cutoff
          AND ($2::uuid IS NULL OR l.branch_id IS NULL OR l.branch_id=$2)
        GROUP BY cl.product_id,cl.location_id,cl.quality
      ), dimensions AS (
        SELECT product_id,location_id,quality FROM physical
        UNION
        SELECT product_id,location_id,quality FROM layers
      ), inventory_rows AS (
        SELECT d.product_id AS "productId",p.name AS "productName",p.code,p.unit,
          d.location_id AS "locationId",l.name AS "locationName",d.quality,
          COALESCE(ph.quantity,0)::numeric(14,2) AS "onHandQuantity",
          COALESCE(la.quantity,0)::numeric(14,2) AS "valuedQuantity",
          GREATEST(COALESCE(ph.quantity,0)-COALESCE(la.quantity,0),0)::numeric(14,2) AS "unvaluedQuantity",
          GREATEST(COALESCE(la.quantity,0)-COALESCE(ph.quantity,0),0)::numeric(14,2) AS "overvaluedQuantity",
          GREATEST(-COALESCE(ph.quantity,0),0)::numeric(14,2) AS "negativeQuantity",
          COALESCE(la.value,0)::numeric(14,2) AS "inventoryValue",
          CASE WHEN COALESCE(la.quantity,0)>0 THEN (la.value/la.quantity)::numeric(14,4) ELSE 0 END AS "averageUnitCost"
        FROM dimensions d
        JOIN products p ON p.company_id=$1 AND p.id=d.product_id
        JOIN stock_locations l ON l.company_id=$1 AND l.id=d.location_id
        LEFT JOIN physical ph ON ph.product_id=d.product_id AND ph.location_id=d.location_id AND ph.quality=d.quality
        LEFT JOIN layers la ON la.product_id=d.product_id AND la.location_id=d.location_id AND la.quality=d.quality
      )
      SELECT * FROM inventory_rows ORDER BY lower("productName"),lower("locationName"),quality`,
    [companyId, branchId, asOf]);

    const totals = result.rows.reduce((sum, row) => ({
      rows: sum.rows + 1,
      unvaluedRows: sum.unvaluedRows + (Number(row.unvaluedQuantity) >= 0.01 ? 1 : 0),
      overvaluedRows: sum.overvaluedRows + (Number(row.overvaluedQuantity) >= 0.01 ? 1 : 0),
      negativeRows: sum.negativeRows + (Number(row.negativeQuantity) >= 0.01 ? 1 : 0),
      inventoryValue: sum.inventoryValue + Number(row.inventoryValue),
    }), { rows: 0, unvaluedRows: 0, overvaluedRows: 0, negativeRows: 0, inventoryValue: 0 });

    const control = await pool.query<{ balance: string }>(`
      SELECT COALESCE(SUM(jl.debit-jl.credit),0)::numeric(14,2)::text AS balance
      FROM journal_entry_lines jl
      JOIN journal_entries je ON je.company_id=jl.company_id AND je.id=jl.journal_entry_id
      JOIN accounts a ON a.company_id=jl.company_id AND a.id=jl.account_id
      WHERE jl.company_id=$1 AND a.code='1300' AND je.effective_date<=$3::date
        AND ($2::uuid IS NULL OR je.branch_id IS NULL OR je.branch_id=$2)`,
    [companyId, branchId, asOf]);
    const inventoryControlBalance = Number(control.rows[0]?.balance ?? 0);
    const ledgerVariance = inventoryControlBalance - totals.inventoryValue;
    const complete = totals.unvaluedRows === 0 && totals.overvaluedRows === 0
      && totals.negativeRows === 0 && Math.abs(ledgerVariance) < 0.01;

    return res.json({
      asOf,
      today,
      timezone,
      scope: branchId ? "branch_and_shared" : "company",
      method: "recorded_fifo_layers_as_of_stock_event_time",
      rows: result.rows,
      summary: totals,
      inventoryControlBalance,
      ledgerVariance,
      complete,
      caveat: "This read-only view dates stock movements and FIFO layers by occurred_at, while the inventory ledger is dated by journal effective_date. Backdated entries can therefore show a date-basis variance. Unvalued stock remains unknown; the report does not restate journals or prove records entered later were known at the selected date.",
    });
  } catch (error) { return next(error); }
});

/** Compare period COGS postings to their source FIFO layers, without posting corrections. */
inventoryValuationHistoryRouter.get("/cogs", requireAuth, requirePermission("inventory.valuation.view"), requirePermission("accounting.view"), async (req, res, next) => {
  const parsed = periodSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: { code: "INVALID_COGS_PERIOD", message: "Choose valid start and end dates in YYYY-MM-DD format." } });
  try {
    const { companyId, branchId } = req.auth!;
    const company = await pool.query<{ today: string }>(
      "SELECT (now() AT TIME ZONE timezone)::date::text AS today FROM companies WHERE id=$1 AND active=true", [companyId],
    );
    if (!company.rowCount) return res.status(404).json({ error: { code: "COMPANY_NOT_FOUND", message: "The active company could not be found." } });
    const today = company.rows[0].today;
    const to = parsed.data.to ?? today;
    const from = parsed.data.from ?? `${to.slice(0, 7)}-01`;
    if (from > to) return res.status(400).json({ error: { code: "INVALID_COGS_PERIOD", message: "The start date must be on or before the end date." } });
    if (to > today) return res.status(400).json({ error: { code: "COGS_PERIOD_IN_FUTURE", message: "The period cannot end after today in the company timezone." } });

    const result = await pool.query(`
      WITH cogs_entries AS (
        SELECT je.id AS "journalEntryId",je.entry_number AS "entryNumber",je.source_type AS "sourceType",
          je.source_id AS "sourceId",je.effective_date::text AS "effectiveDate",je.branch_id AS "branchId",
          SUM(jl.debit-jl.credit)::numeric(14,2) AS "postedCogs"
        FROM journal_entries je
        JOIN journal_entry_lines jl ON jl.company_id=je.company_id AND jl.journal_entry_id=je.id
        JOIN accounts a ON a.company_id=jl.company_id AND a.id=jl.account_id
        WHERE je.company_id=$1 AND a.code='5200' AND je.source_type<>'financial_year_close'
          AND je.effective_date BETWEEN $3::date AND $4::date
          AND ($2::uuid IS NULL OR je.branch_id IS NULL OR je.branch_id=$2)
        GROUP BY je.id
      ), traced AS (
        SELECT e.*,
          CASE e."sourceType"
            WHEN 'sales_invoice_cogs' THEN (
              SELECT SUM(c.extended_cost)::numeric(14,2)
              FROM inventory_cost_consumptions c
              JOIN stock_movements sm ON sm.company_id=c.company_id AND sm.id=c.stock_movement_id
              WHERE c.company_id=$1 AND sm.id=e."sourceId" AND sm.movement_type='sale_out'
            )
            WHEN 'stock_adjustment_cogs' THEN (
              SELECT SUM(c.extended_cost)::numeric(14,2)
              FROM stock_movements sm
              JOIN inventory_cost_consumptions c ON c.company_id=sm.company_id AND c.stock_movement_id=sm.id
              WHERE sm.company_id=$1 AND sm.reference_type='stock_adjustment'
                AND sm.reference_id=e."sourceId" AND sm.direction='out'
            )
            WHEN 'sales_invoice_reversal' THEN (
              SELECT -SUM(cl.received_quantity*cl.unit_cost)::numeric(14,2)
              FROM inventory_cost_layers cl
              WHERE cl.company_id=$1 AND cl.source_type='customer_return' AND cl.source_id=e."sourceId"
            )
            WHEN 'sales_return' THEN (
              SELECT -SUM(cl.received_quantity*cl.unit_cost)::numeric(14,2)
              FROM inventory_cost_layers cl
              WHERE cl.company_id=$1 AND cl.source_type='customer_return' AND cl.source_id=e."sourceId"
            )
            WHEN 'stock_return' THEN (
              SELECT -SUM(cl.received_quantity*cl.unit_cost)::numeric(14,2)
              FROM inventory_cost_layers cl
              WHERE cl.company_id=$1 AND cl.source_type='customer_return' AND cl.source_id=e."sourceId"
            )
            ELSE NULL::numeric
          END AS "fifoCogs",
          CASE e."sourceType"
            WHEN 'sales_invoice_cogs' THEN EXISTS(
              SELECT 1 FROM inventory_cost_consumptions c
              JOIN stock_movements sm ON sm.company_id=c.company_id AND sm.id=c.stock_movement_id
              WHERE c.company_id=$1 AND sm.id=e."sourceId" AND sm.movement_type='sale_out'
            )
            WHEN 'stock_adjustment_cogs' THEN EXISTS(
              SELECT 1 FROM stock_movements sm
              JOIN inventory_cost_consumptions c ON c.company_id=sm.company_id AND c.stock_movement_id=sm.id
              WHERE sm.company_id=$1 AND sm.reference_type='stock_adjustment'
                AND sm.reference_id=e."sourceId" AND sm.direction='out'
            )
            WHEN 'sales_invoice_reversal' THEN EXISTS(
              SELECT 1 FROM inventory_cost_layers cl
              WHERE cl.company_id=$1 AND cl.source_type='customer_return' AND cl.source_id=e."sourceId"
            )
            WHEN 'sales_return' THEN EXISTS(
              SELECT 1 FROM inventory_cost_layers cl
              WHERE cl.company_id=$1 AND cl.source_type='customer_return' AND cl.source_id=e."sourceId"
            )
            WHEN 'stock_return' THEN EXISTS(
              SELECT 1 FROM inventory_cost_layers cl
              WHERE cl.company_id=$1 AND cl.source_type='customer_return' AND cl.source_id=e."sourceId"
            )
            ELSE false
          END AS matched
        FROM cogs_entries e
      ), details AS (
        SELECT *,CASE WHEN matched THEN "postedCogs"-"fifoCogs" END::numeric(14,2) AS variance
        FROM traced
      )
      SELECT * FROM details ORDER BY "effectiveDate","entryNumber"`,
    [companyId, branchId, from, to]);

    const summary = result.rows.reduce((sum, row) => ({
      journalEntries: sum.journalEntries + 1,
      matchedEntries: sum.matchedEntries + (row.matched ? 1 : 0),
      unmatchedEntries: sum.unmatchedEntries + (row.matched ? 0 : 1),
      varianceEntries: sum.varianceEntries + (row.matched && Math.abs(Number(row.variance)) >= 0.01 ? 1 : 0),
      postedCogs: sum.postedCogs + Number(row.postedCogs),
      matchedFifoCogs: sum.matchedFifoCogs + (row.matched ? Number(row.fifoCogs) : 0),
      matchedVariance: sum.matchedVariance + (row.matched ? Number(row.variance) : 0),
      grossVariance: sum.grossVariance + (row.matched ? Math.abs(Number(row.variance)) : 0),
    }), { journalEntries: 0, matchedEntries: 0, unmatchedEntries: 0, varianceEntries: 0, postedCogs: 0, matchedFifoCogs: 0, matchedVariance: 0, grossVariance: 0 });
    const complete = summary.unmatchedEntries === 0 && summary.varianceEntries === 0;
    return res.json({
      periodFrom: from, periodTo: to, today, scope: branchId ? "branch_and_shared" : "company",
      rows: result.rows, summary, complete,
      caveat: "Read-only comparison by journal effective date. It matches invoice COGS, inventory write-offs and invoice reversals to recorded FIFO consumptions or restored cost layers. Unknown legacy costs and COGS entries from other sources remain unmatched; this report does not post corrections.",
    });
  } catch (error) { return next(error); }
});
