import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireOwnerRole, requirePermission } from "./auth";
import { pool } from "./db";

export const employeeBranchAssignmentRouter = Router();

employeeBranchAssignmentRouter.patch("/:id/branch", requireAuth, requireOwnerRole, requirePermission("employees.edit"), async (req, res, next) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const body = z.object({ branchId: z.union([z.string().uuid(), z.null()]) }).safeParse(req.body);
  if (!id.success || !body.success) {
    return res.status(400).json({ error: { code: "INVALID_BRANCH_ASSIGNMENT", message: "Choose a valid branch or shared company scope." } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { companyId, userId } = req.auth!;
    const branchId = body.data.branchId;
    if (branchId) {
      const branch = await client.query("SELECT 1 FROM branches WHERE company_id=$1 AND id=$2 AND active=true", [companyId, branchId]);
      if (!branch.rowCount) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: { code: "INVALID_BRANCH", message: "Choose an active branch in this company." } });
      }
    }

    const employee = await client.query<{ branch_id: string | null }>(
      "SELECT branch_id FROM employees WHERE company_id=$1 AND id=$2 FOR UPDATE",
      [companyId, id.data],
    );
    if (!employee.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "EMPLOYEE_NOT_FOUND", message: "Employee was not found." } });
    }

    await client.query("UPDATE employees SET branch_id=$3,updated_at=now() WHERE company_id=$1 AND id=$2", [companyId, id.data, branchId]);
    if (branchId) {
      await client.query("UPDATE attendance_records SET branch_id=$3 WHERE company_id=$1 AND employee_id=$2 AND branch_id IS NULL", [companyId, id.data, branchId]);
      await client.query("UPDATE employee_advances SET branch_id=$3 WHERE company_id=$1 AND employee_id=$2 AND branch_id IS NULL", [companyId, id.data, branchId]);
      await client.query("UPDATE employee_advance_repayments SET branch_id=$3 WHERE company_id=$1 AND employee_id=$2 AND branch_id IS NULL", [companyId, id.data, branchId]);
      await client.query(
        `UPDATE salary_runs r SET branch_id=$3
         WHERE r.company_id=$1 AND r.branch_id IS NULL
           AND EXISTS (SELECT 1 FROM salary_run_lines l WHERE l.company_id=r.company_id AND l.salary_run_id=r.id AND l.employee_id=$2)
           AND NOT EXISTS (
             SELECT 1 FROM salary_run_lines l JOIN employees e ON e.company_id=l.company_id AND e.id=l.employee_id
             WHERE l.company_id=r.company_id AND l.salary_run_id=r.id AND e.branch_id IS DISTINCT FROM $3
           )`,
        [companyId, id.data, branchId],
      );
      await client.query(
        `UPDATE journal_entries je SET branch_id=$3
         WHERE je.company_id=$1 AND je.branch_id IS NULL
           AND je.source_type IN ('employee_advance','employee_advance_repayment','employee_opening_balance')
           AND EXISTS (
             SELECT 1 FROM journal_entry_lines l
             WHERE l.company_id=je.company_id AND l.journal_entry_id=je.id AND l.employee_id=$2
           )`,
        [companyId, id.data, branchId],
      );
      await client.query(
        `UPDATE journal_entries je SET branch_id=r.branch_id
         FROM salary_runs r
         WHERE je.company_id=r.company_id AND je.company_id=$1 AND je.source_type='salary_run' AND je.source_id=r.id
           AND r.branch_id=$2 AND je.branch_id IS NULL`,
        [companyId, branchId],
      );
      await client.query(
        `UPDATE journal_entries je SET branch_id=r.branch_id
         FROM salary_payments p JOIN salary_runs r ON r.company_id=p.company_id AND r.id=p.salary_run_id
         WHERE je.company_id=p.company_id AND je.company_id=$1 AND je.source_type='salary_payment' AND je.source_id=p.id
           AND r.branch_id=$2 AND je.branch_id IS NULL`,
        [companyId, branchId],
      );
    }
    await client.query(
      "INSERT INTO audit_logs(company_id,branch_id,actor_user_id,action,entity_type,entity_id,before_data,after_data) VALUES($1,$2,$3,'employee.branch.assign','employee',$4,jsonb_build_object('branchId',$5::text),jsonb_build_object('branchId',($2::uuid)::text))",
      [companyId, branchId, userId, id.data, employee.rows[0].branch_id],
    );
    await client.query("COMMIT");
    return res.json({ id: id.data, branchId });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return next(error);
  } finally {
    client.release();
  }
});
