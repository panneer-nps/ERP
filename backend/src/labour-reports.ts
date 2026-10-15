import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "./auth";
import { pool } from "./db";

export const labourReportsRouter = Router();

const filterSchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  department: z.string().trim().max(120).optional(),
  status: z.enum(["all", "posted", "pending_approval", "rejected"]).optional().default("all"),
});

const reportRows = `
  FROM salary_runs r
  JOIN salary_run_lines l ON l.company_id=r.company_id AND l.salary_run_id=r.id
  JOIN employees e ON e.company_id=l.company_id AND e.id=l.employee_id
  WHERE r.company_id=$1
    AND ($2::date IS NULL OR r.period_end >= $2::date)
    AND ($3::date IS NULL OR r.period_start <= $3::date)
    AND ($4::text IS NULL OR COALESCE(NULLIF(btrim(l.department_snapshot),''),'Unassigned') ILIKE '%'||$4||'%')
    AND ($5::text='all' OR ($5::text='posted' AND r.status IN ('approved','partially_paid','paid')) OR r.status=$5)
    AND ($6::uuid IS NULL OR r.branch_id=$6)
`;

labourReportsRouter.get("/labour", requireAuth, requirePermission("payroll.view"), async (req, res, next) => {
  const parsed = filterSchema.safeParse(req.query);
  if (!parsed.success || (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to)) {
    return res.status(400).json({ error: { code: "INVALID_LABOUR_REPORT_FILTER", message: "Choose a valid payroll period, department and status." } });
  }
  const filters = parsed.data;
  const params = [req.auth!.companyId, filters.from ?? null, filters.to ?? null, filters.department || null, filters.status, req.auth!.branchId];
  try {
    const [rows, departments, summary] = await Promise.all([
      pool.query(`WITH base AS (SELECT r.id AS "runId",r.run_number AS "runNumber",r.period_start AS "periodStart",r.period_end AS "periodEnd",r.status,l.employee_id AS "employeeId",e.employee_number AS "employeeNumber",e.full_name AS "employeeName",COALESCE(NULLIF(btrim(l.department_snapshot),''),'Unassigned') AS department,l.salary_type AS "salaryType",l.present_days AS "presentDays",l.half_days AS "halfDays",l.overtime_hours AS "overtimeHours",l.piece_quantity AS "pieceQuantity",l.base_earnings AS "baseEarnings",l.overtime_earnings AS "overtimeEarnings",l.bonus,l.other_deductions AS "otherDeductions",l.advance_recovery AS "advanceRecovery",l.net_pay AS "netPay",l.paid_amount AS "paidAmount",(l.base_earnings+l.overtime_earnings+l.bonus)::numeric(14,2) AS "grossCost" ${reportRows}) SELECT base.*,count(*) OVER()::int AS "totalRows" FROM base ORDER BY "periodStart" DESC,"runNumber" DESC,department,"employeeName" LIMIT 10000`, params),
      pool.query(`SELECT DISTINCT COALESCE(NULLIF(btrim(l.department_snapshot),''),'Unassigned') AS department FROM salary_run_lines l JOIN salary_runs r ON r.company_id=l.company_id AND r.id=l.salary_run_id WHERE r.company_id=$1 AND ($2::uuid IS NULL OR r.branch_id=$2) ORDER BY department`, [req.auth!.companyId, req.auth!.branchId]),
      pool.query(`WITH base AS (SELECT r.id AS run_id,r.status,l.employee_id,COALESCE(NULLIF(btrim(l.department_snapshot),''),'Unassigned') AS department,(l.base_earnings+l.overtime_earnings+l.bonus)::numeric(14,2) AS gross,l.other_deductions AS deductions,l.advance_recovery AS recovery,l.net_pay AS net,l.paid_amount AS paid ${reportRows}) SELECT department,count(DISTINCT run_id)::int AS "runCount",count(DISTINCT employee_id)::int AS "employeeCount",COALESCE(sum(gross) FILTER(WHERE status IN ('approved','partially_paid','paid')),0)::numeric(14,2) AS "postedGrossCost",COALESCE(sum(gross) FILTER(WHERE status='pending_approval'),0)::numeric(14,2) AS "pendingGrossCost",COALESCE(sum(deductions) FILTER(WHERE status IN ('approved','partially_paid','paid')),0)::numeric(14,2) AS "postedDeductions",COALESCE(sum(recovery) FILTER(WHERE status IN ('approved','partially_paid','paid')),0)::numeric(14,2) AS "postedAdvanceRecovery",COALESCE(sum(net) FILTER(WHERE status IN ('approved','partially_paid','paid')),0)::numeric(14,2) AS "postedNetPay",COALESCE(sum(paid) FILTER(WHERE status IN ('approved','partially_paid','paid')),0)::numeric(14,2) AS "paidAmount" FROM base GROUP BY department ORDER BY department`, params),
    ]);
    return res.json({ rows: rows.rows, departments: departments.rows.map((row) => row.department), summary: summary.rows, totalRows: Number(rows.rows[0]?.totalRows ?? 0), limit: 10000, from: filters.from ?? null, to: filters.to ?? null, status: filters.status });
  } catch (error) {
    return next(error);
  }
});
