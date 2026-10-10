import "dotenv/config";
import { pool } from "../src/db";

async function main() {
  const result = await pool.query<{ migrationApplied: boolean; pendingStatusAllowed: boolean; rejectedStatusAllowed: boolean; overrideColumnExists: boolean; approvalPermissionExists: boolean; ownerPermissionAssigned: boolean; approvalIndexExists: boolean; employeeAdvanceMigrationApplied: boolean; employeeAdvancePendingAllowed: boolean; employeeAdvanceRejectedAllowed: boolean; employeeAdvanceApprovalFieldsExist: boolean; employeeAdvancePermissionExists: boolean; employeeAdvanceOwnerPermissionAssigned: boolean; employeeAdvanceIndexExists: boolean; employeeAdvanceLimitsMigrationApplied: boolean; employeeAdvanceConfigurePermissionExists: boolean; employeeAdvanceOwnerCanConfigure: boolean }>(`
    SELECT
      EXISTS(SELECT 1 FROM schema_migrations WHERE filename='076_credit_sale_approvals.sql') AS "migrationApplied",
      EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='sales_orders'::regclass AND conname='sales_orders_status_check' AND pg_get_constraintdef(oid) LIKE '%pending_approval%') AS "pendingStatusAllowed",
      EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='sales_orders'::regclass AND conname='sales_orders_status_check' AND pg_get_constraintdef(oid) LIKE '%rejected%') AS "rejectedStatusAllowed",
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='sales_orders' AND column_name='credit_limit_override_approved') AS "overrideColumnExists",
      EXISTS(SELECT 1 FROM permissions WHERE code='sales.approve') AS "approvalPermissionExists",
      EXISTS(SELECT 1 FROM roles r JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE r.system_role=true AND r.code='owner' AND p.code='sales.approve') AS "ownerPermissionAssigned",
      to_regclass('sales_orders_pending_approval_idx') IS NOT NULL AS "approvalIndexExists",
      EXISTS(SELECT 1 FROM schema_migrations WHERE filename='077_employee_advance_approval.sql') AS "employeeAdvanceMigrationApplied",
      EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='employee_advances'::regclass AND conname='employee_advances_status_check' AND pg_get_constraintdef(oid) LIKE '%pending_approval%') AS "employeeAdvancePendingAllowed",
      EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='employee_advances'::regclass AND conname='employee_advances_status_check' AND pg_get_constraintdef(oid) LIKE '%rejected%') AS "employeeAdvanceRejectedAllowed",
      (SELECT count(*)=5 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='employee_advances' AND column_name IN ('approved_by','approved_at','rejected_by','rejected_at','decision_reason')) AS "employeeAdvanceApprovalFieldsExist",
      EXISTS(SELECT 1 FROM permissions WHERE code='employees.advance.approve') AS "employeeAdvancePermissionExists",
      EXISTS(SELECT 1 FROM roles r JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE r.system_role=true AND r.code='owner' AND p.code='employees.advance.approve') AS "employeeAdvanceOwnerPermissionAssigned",
      to_regclass('employee_advances_pending_approval_idx') IS NOT NULL AS "employeeAdvanceIndexExists",
      EXISTS(SELECT 1 FROM schema_migrations WHERE filename='078_employee_advance_approval_limits.sql') AS "employeeAdvanceLimitsMigrationApplied",
      EXISTS(SELECT 1 FROM permissions WHERE code='employees.advance.configure') AS "employeeAdvanceConfigurePermissionExists",
      EXISTS(SELECT 1 FROM roles r JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE r.system_role=true AND r.code='owner' AND p.code='employees.advance.configure') AS "employeeAdvanceOwnerCanConfigure"
  `);
  const checks = result.rows[0];
  const manualJournal = await pool.query<{ migrationApplied: boolean; requestTableExists: boolean; linesTableExists: boolean; balancedLineConstraintExists: boolean; createPermissionExists: boolean; approvePermissionExists: boolean; ownerCanApprove: boolean; requestQueueIndexExists: boolean }>(`
    SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE filename='079_manual_journal_approvals.sql') AS "migrationApplied",
      to_regclass('manual_journal_requests') IS NOT NULL AS "requestTableExists",
      to_regclass('manual_journal_request_lines') IS NOT NULL AS "linesTableExists",
      EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='manual_journal_request_lines'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%debit%credit%') AS "balancedLineConstraintExists",
      EXISTS(SELECT 1 FROM permissions WHERE code='accounting.journal.create') AS "createPermissionExists",
      EXISTS(SELECT 1 FROM permissions WHERE code='accounting.journal.approve') AS "approvePermissionExists",
      EXISTS(SELECT 1 FROM roles r JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE r.system_role=true AND r.code='owner' AND p.code='accounting.journal.approve') AS "ownerCanApprove",
      to_regclass('manual_journal_pending_idx') IS NOT NULL AS "requestQueueIndexExists"
  `);
  const manualJournalQueue = await pool.query<{ id: string }>(`SELECT r.id FROM manual_journal_requests r JOIN users u ON u.company_id=r.company_id AND u.id=r.requested_by WHERE r.company_id=(SELECT id FROM companies ORDER BY created_at LIMIT 1) AND r.status='pending_approval' ORDER BY r.created_at DESC LIMIT 20`);
  const company = await pool.query<{ id: string }>("SELECT id FROM companies ORDER BY created_at LIMIT 1");
  let approvalQueueQueryExecuted = false;
  let pendingCreditSales = 0;
  let employeeAdvanceQueueQueryExecuted = false;
  let pendingEmployeeAdvances = 0;
  if (company.rowCount) {
    const queue = await pool.query<{ id: string }>(`SELECT o.id FROM sales_orders o JOIN business_partners bp ON bp.company_id=o.company_id AND bp.id=o.customer_id JOIN users u ON u.company_id=o.company_id AND u.id=o.created_by WHERE o.company_id=$1 AND o.status='pending_approval' AND ($2::uuid IS NULL OR o.branch_id IS NULL OR o.branch_id=$2)`, [company.rows[0].id, null]);
    approvalQueueQueryExecuted = true;
    pendingCreditSales = queue.rowCount ?? 0;
    const advances = await pool.query<{ id: string }>(`SELECT a.id FROM employee_advances a JOIN employees e ON e.company_id=a.company_id AND e.id=a.employee_id JOIN users u ON u.company_id=a.company_id AND u.id=a.created_by WHERE a.company_id=$1 AND a.status='pending_approval'`, [company.rows[0].id]);
    employeeAdvanceQueueQueryExecuted = true;
    pendingEmployeeAdvances = advances.rowCount ?? 0;
  }
  console.log(JSON.stringify({ check: "approval-schema", ...checks, manualJournal: manualJournal.rows[0], manualJournalQueueQueryExecuted: true, pendingManualJournals: manualJournalQueue.rowCount ?? 0, approvalQueueQueryExecuted, pendingCreditSales, employeeAdvanceQueueQueryExecuted, pendingEmployeeAdvances }));
  if (Object.values(checks).some((value) => !value) || Object.values(manualJournal.rows[0]).some((value) => !value) || !approvalQueueQueryExecuted || !employeeAdvanceQueueQueryExecuted) process.exitCode = 1;
  await pool.end();
}

main().catch(async () => {
  console.error("Credit-sale approval schema verification failed.");
  await pool.end();
  process.exitCode = 1;
});
