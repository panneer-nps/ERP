-- Seed the PRD Accountant role without changing anyone's existing role assignments.
INSERT INTO roles(company_id,code,name,read_only,system_role)
SELECT id,'accountant','Accountant',false,true FROM companies
ON CONFLICT(company_id,code) DO NOTHING;

-- Keep this system preset deterministic; Owners can create a separate custom role
-- when their business needs additional approval or configuration rights.
DELETE FROM role_permissions rp
USING roles r
WHERE rp.role_id=r.id AND r.code='accountant' AND r.system_role=true;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.code=ANY(ARRAY[
  'audit.view',
  'masters.view','masters.create',
  'sales.view','sales.create','sales.post','sales.return','sales.credit.settle',
  'purchases.view','purchases.create','purchases.post','purchases.return','purchases.credit.apply','purchases.credit.refund',
  'expenses.view','expenses.create','expense.submit_for_approval',
  'stock.view','inventory.valuation.view',
  'attendance.view','employees.view','employees.advance.view',
  'brokers.commission.view','brokers.commission.pay',
  'payroll.view','payroll.create','payroll.pay',
  'cash.close.view','cash.close.record',
  'bank.reconcile.view','bank.reconcile.create','bank.reconcile.match','bank.reconcile.complete','bank.opening.post',
  'partners.opening.post',
  'accounting.view','accounting.accounts.view','accounting.period.close.view','accounting.financial-years.view','accounting.journal.create'
]::text[])
WHERE r.code='accountant' AND r.system_role=true
ON CONFLICT DO NOTHING;
