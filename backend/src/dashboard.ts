import express from "express";
import { z } from "zod";
import { requireAuth } from "./auth";
import { pool } from "./db";

export const dashboardRouter = express.Router();
const rangeSchema = z.object({ from: z.string().date(), to: z.string().date() }).refine(x => x.from <= x.to, "Invalid date range");

dashboardRouter.get("/summary", requireAuth, async (req, res, next) => {
  const range = rangeSchema.safeParse({ from: req.query.from, to: req.query.to });
  if (!range.success) return res.status(400).json({ error: { code: "INVALID_DATE_RANGE", message: "Choose a valid start and end date." } });
  const { from, to } = range.data;
  const companyId = req.auth!.companyId;
  const branchId = req.auth!.branchId;
  try {
    const canReview = await pool.query<{ allowed: boolean }>(`SELECT EXISTS(
      SELECT 1 FROM user_roles ur JOIN roles r ON r.company_id=ur.company_id AND r.id=ur.role_id JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id
      WHERE ur.company_id=$1 AND ur.user_id=$2 AND p.code IN ('expenses.approve','stocktake.approve','cash.close.approve','loading.approve','brokers.commission.approve','sales.approve','employees.advance.approve','accounting.journal.approve','payroll.approve')
    ) allowed`, [companyId, req.auth!.userId]);
    const access = await pool.query<{ sales:boolean; expenses:boolean; stock:boolean; production:boolean; chambers:boolean; accounting:boolean; owner:boolean }>(`SELECT
      bool_or(p.code='sales.view') AS sales,bool_or(p.code='expenses.view') AS expenses,
      bool_or(p.code IN ('stock.view','inventory.valuation.view')) AS stock,bool_or(p.code='production.view') AS production,
      bool_or(p.code IN ('masters.view','chambers.status.manage')) AS chambers,bool_or(p.code='accounting.view') AS accounting,
      bool_or(r.code='owner') AS owner
      FROM user_roles ur JOIN roles r ON r.company_id=ur.company_id AND r.id=ur.role_id JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id
      WHERE ur.company_id=$1 AND ur.user_id=$2`, [companyId,req.auth!.userId]);

    const [activity, stock, production, chambers] = await Promise.all([
      pool.query(`WITH invoices AS (
        SELECT i.company_id,i.id,i.total,
          COALESCE((SELECT SUM(r.amount) FROM customer_receipts r WHERE r.company_id=i.company_id AND r.invoice_id=i.id),0)+COALESCE((SELECT SUM(a.amount) FROM customer_receipt_allocations a WHERE a.company_id=i.company_id AND a.target_invoice_id=i.id),0) paid,
          COALESCE((SELECT SUM(r.total) FROM sales_returns r WHERE r.company_id=i.company_id AND r.invoice_id=i.id),0) returned,
          COALESCE((SELECT SUM(a.amount) FROM customer_credit_applications a WHERE a.company_id=i.company_id AND a.target_invoice_id=i.id),0) credits,
          COALESCE((SELECT SUM(a.amount) FROM customer_credit_applications a JOIN sales_returns r ON r.company_id=a.company_id AND r.id=a.sales_return_id WHERE r.company_id=i.company_id AND r.invoice_id=i.id),0) source_credits,
          COALESCE((SELECT SUM(f.amount) FROM customer_refunds f JOIN sales_returns r ON r.company_id=f.company_id AND r.id=f.sales_return_id WHERE r.company_id=i.company_id AND r.invoice_id=i.id),0) refunds
        FROM sales_invoices i WHERE i.company_id=$1 AND i.status='posted' AND ($2::uuid IS NULL OR i.branch_id IS NULL OR i.branch_id=$2)
      ) SELECT
        (SELECT COALESCE(SUM(i.total),0)::numeric(14,2) FROM sales_invoices i WHERE i.company_id=$1 AND i.status='posted' AND i.invoice_date >= $3::date AND i.invoice_date <= $4::date AND ($2::uuid IS NULL OR i.branch_id IS NULL OR i.branch_id=$2)) AS sales,
        COALESCE((SELECT SUM(r.amount) FROM customer_receipts r WHERE r.company_id=$1 AND r.receipt_date >= $3::date AND r.receipt_date <= $4::date AND ($2::uuid IS NULL OR r.branch_id IS NULL OR r.branch_id=$2)),0)::numeric(14,2) AS collections,
        COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.company_id=$1 AND e.status='posted' AND e.expense_date >= $3::date AND e.expense_date <= $4::date AND ($2::uuid IS NULL OR e.branch_id IS NULL OR e.branch_id=$2)),0)::numeric(14,2) AS expenses,
        COALESCE((SELECT SUM(GREATEST(i.total-v.paid-v.returned-v.credits+v.source_credits+v.refunds,0)) FROM sales_invoices i JOIN invoices v ON v.company_id=i.company_id AND v.id=i.id WHERE i.company_id=$1 AND i.status='posted' AND ($2::uuid IS NULL OR i.branch_id IS NULL OR i.branch_id=$2)),0)::numeric(14,2) AS receivables`, [companyId, branchId, req.query.from, req.query.to]),
      pool.query(`WITH balances AS (
        SELECT sm.product_id,sm.quality,sm.location_id,SUM(CASE WHEN sm.direction='in' THEN sm.quantity ELSE -sm.quantity END) qty
        FROM stock_movements sm JOIN stock_locations sl ON sl.company_id=sm.company_id AND sl.id=sm.location_id
        WHERE sm.company_id=$1 AND ($2::uuid IS NULL OR sl.branch_id IS NULL OR sl.branch_id=$2)
        GROUP BY sm.product_id,sm.quality,sm.location_id
        HAVING SUM(CASE WHEN sm.direction='in' THEN sm.quantity ELSE -sm.quantity END)>0
      ), layers AS (
        SELECT product_id,quality,location_id,SUM(remaining_quantity) qty,SUM(remaining_quantity*unit_cost) value
        FROM inventory_cost_layers WHERE company_id=$1 AND ($2::uuid IS NULL OR location_id IN (SELECT id FROM stock_locations WHERE company_id=$1 AND (branch_id IS NULL OR branch_id=$2))) GROUP BY product_id,quality,location_id
      ) , valued AS (
        SELECT b.product_id,b.qty,COALESCE(LEAST(b.qty,COALESCE(l.qty,0))*COALESCE(l.value/NULLIF(l.qty,0),0),0) value,GREATEST(b.qty-COALESCE(l.qty,0),0) unvalued
        FROM balances b LEFT JOIN layers l ON l.product_id=b.product_id AND l.quality=b.quality AND l.location_id=b.location_id
      ) SELECT COUNT(DISTINCT product_id)::int "productCount",COALESCE(SUM(value),0)::numeric(16,2) value,
        COUNT(DISTINCT product_id) FILTER(WHERE unvalued>0.001)::int "unvaluedProductCount" FROM valued`, [companyId, branchId]),
      pool.query(`SELECT COUNT(*)::int batches,CASE WHEN COUNT(DISTINCT p.unit)=1 THEN SUM(COALESCE(b.good_quantity,0)+COALESCE(b.second_quantity,0))::numeric(16,2) ELSE NULL END saleable,CASE WHEN COUNT(DISTINCT p.unit)=1 THEN MAX(p.unit) ELSE NULL END AS unit
        FROM production_batches b JOIN products p ON p.company_id=b.company_id AND p.id=b.product_id WHERE b.company_id=$1 AND b.status='completed'
        AND b.completed_at >= $3::date::timestamp AT TIME ZONE 'Asia/Kolkata'
        AND b.completed_at < ($4::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'
        AND ($2::uuid IS NULL OR b.branch_id IS NULL OR b.branch_id=$2)`, [companyId, branchId, from, to]),
      pool.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE operational_status='available')::int available,
        COUNT(*) FILTER(WHERE operational_status='maintenance')::int maintenance,COUNT(*) FILTER(WHERE operational_status='out_of_service')::int "outOfService"
        FROM chambers WHERE company_id=$1 AND active=true`, [companyId]),
    ]);

    let ownerPulse: null | {
      supplierPayable:string;cashBalance:string;bankBalance:string;employeeAdvanceBalance:string;salaryPayable:string;
      brokerPayable:string;activeLoadings:number;loadingMismatches:number;asOfDate:string;scope:"company"|"branch";
    } = null;
    if (access.rows[0].owner) {
      const [balances, operations] = await Promise.all([
        pool.query(`SELECT
          COALESCE(SUM(jl.debit-jl.credit) FILTER(WHERE a.code='1110'),0)::numeric(14,2)::text AS "cashBalance",
          COALESCE(SUM(jl.debit-jl.credit) FILTER(WHERE a.code='1120'),0)::numeric(14,2)::text AS "bankBalance",
          COALESCE(SUM(jl.credit-jl.debit) FILTER(WHERE a.code='2100'),0)::numeric(14,2)::text AS "supplierPayable",
          COALESCE(SUM(jl.debit-jl.credit) FILTER(WHERE a.code='1400'),0)::numeric(14,2)::text AS "employeeAdvanceBalance",
          COALESCE(SUM(jl.credit-jl.debit) FILTER(WHERE a.code='2500'),0)::numeric(14,2)::text AS "salaryPayable"
          FROM journal_entry_lines jl JOIN journal_entries je ON je.company_id=jl.company_id AND je.id=jl.journal_entry_id
          JOIN accounts a ON a.company_id=jl.company_id AND a.id=jl.account_id
          WHERE je.company_id=$1 AND je.effective_date<=$3::date AND ($2::uuid IS NULL OR je.branch_id=$2)`,
        [companyId, branchId, to]),
        pool.query(`SELECT
          (SELECT COUNT(*)::int FROM loading_sessions l WHERE l.company_id=$1 AND l.status NOT IN ('delivered','cancelled')
            AND l.started_at < ($4::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'
            AND ($2::uuid IS NULL OR l.branch_id=$2)) AS "activeLoadings",
          (SELECT COUNT(*)::int FROM loading_sessions l WHERE l.company_id=$1 AND l.status='mismatch'
            AND l.started_at >= $3::date::timestamp AT TIME ZONE 'Asia/Kolkata'
            AND l.started_at < ($4::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'
            AND ($2::uuid IS NULL OR l.branch_id=$2)) AS "loadingMismatches",
          COALESCE((SELECT SUM(bc.accrued_amount-COALESCE(p.paid,0)) FROM broker_commissions bc
            JOIN sales_invoices i ON i.company_id=bc.company_id AND i.id=bc.invoice_id
            LEFT JOIN LATERAL(SELECT SUM(bp.amount) paid FROM broker_commission_payments bp WHERE bp.company_id=bc.company_id AND bp.commission_id=bc.id) p ON true
            WHERE bc.company_id=$1 AND i.status='posted' AND bc.cancelled_at IS NULL AND i.invoice_date<=$4::date
              AND ($2::uuid IS NULL OR i.branch_id=$2)),0)::numeric(14,2)::text AS "brokerPayable"`,
        [companyId, branchId, from, to]),
      ]);
      ownerPulse = {
        ...balances.rows[0],
        ...operations.rows[0],
        asOfDate: to,
        scope: branchId ? "branch" : "company",
      };
    }

    let pendingApprovals: number | null = null;
    if (canReview.rows[0].allowed) {
      const approvals = await pool.query(`SELECT COUNT(*)::int count FROM (
        SELECT e.id FROM expenses e WHERE e.company_id=$1 AND e.status='pending_approval' AND ($2::uuid IS NULL OR e.branch_id IS NULL OR e.branch_id=$2)
        UNION ALL SELECT st.id FROM stocktakes st JOIN stock_locations sl ON sl.company_id=st.company_id AND sl.id=st.location_id WHERE st.company_id=$1 AND st.status='pending' AND ($2::uuid IS NULL OR sl.branch_id IS NULL OR sl.branch_id=$2)
        UNION ALL SELECT c.id FROM cash_closings c WHERE c.company_id=$1 AND c.status='pending' AND ($2::uuid IS NULL OR c.branch_id IS NULL OR c.branch_id=$2)
        UNION ALL SELECT so.id FROM sales_orders so WHERE so.company_id=$1 AND so.status='pending_approval' AND ($2::uuid IS NULL OR so.branch_id IS NULL OR so.branch_id=$2)
        UNION ALL SELECT a.id FROM employee_advances a WHERE a.company_id=$1 AND a.status='pending_approval'
        UNION ALL SELECT mj.id FROM manual_journal_requests mj WHERE mj.company_id=$1 AND mj.status='pending_approval' AND ($2::uuid IS NULL OR mj.branch_id IS NULL OR mj.branch_id=$2)
        UNION ALL SELECT sr.id FROM salary_runs sr WHERE sr.company_id=$1 AND sr.status='pending_approval'
        UNION ALL SELECT l.id FROM loading_sessions l JOIN sales_invoices i ON i.company_id=l.company_id AND i.id=l.invoice_id WHERE l.company_id=$1 AND l.status='mismatch' AND ($2::uuid IS NULL OR i.branch_id IS NULL OR i.branch_id=$2)
        UNION ALL SELECT bc.id FROM broker_commissions bc JOIN sales_invoices i ON i.company_id=bc.company_id AND i.id=bc.invoice_id WHERE bc.company_id=$1 AND bc.accrual_event='approval' AND bc.accrued_amount=0 AND bc.cancelled_at IS NULL AND ($2::uuid IS NULL OR i.branch_id IS NULL OR i.branch_id=$2)
      ) pending`, [companyId, branchId]);
      pendingApprovals = approvals.rows[0].count;
    }

    const permissions=access.rows[0];
    return res.json({
      branchId,
      sales: permissions.sales||permissions.accounting ? activity.rows[0].sales : null,
      collections: permissions.sales||permissions.accounting ? activity.rows[0].collections : null,
      receivables: permissions.sales||permissions.accounting ? activity.rows[0].receivables : null,
      expenses: permissions.expenses||permissions.accounting ? activity.rows[0].expenses : null,
      stock: permissions.stock ? stock.rows[0] : null,
      production: permissions.production ? production.rows[0] : null,
      chambers: permissions.chambers||permissions.production ? chambers.rows[0] : null,
      ownerPulse,
      pendingApprovals, from, to,
    });
  } catch (error) { return next(error); }
});
