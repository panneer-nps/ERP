-- Mark permissions that should not be granted by the default Manager preset.
-- Owners can still choose these deliberately when building a custom role.
ALTER TABLE permissions
  ADD COLUMN manager_default boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN permissions.manager_default IS
  'When false, exclude this permission from the built-in Manager preset; Owners may grant it through a deliberately configured role.';

UPDATE permissions SET manager_default=true WHERE code IN (
  'audit.view','accounting.view','accounting.accounts.view','accounting.period.close.view','accounting.financial-years.view',
  'masters.view','masters.create','masters.edit',
  'production.view','production.create','production.post','chambers.status.manage',
  'stock.view','stock.adjust','stock.location.manage','stock.transfer','stocktake.create','stocktake.approve','inventory.valuation.view',
  'sales.view','sales.create','sales.post','sales.approve','sales.return','sales.credit.settle',
  'loading.view','loading.create','loading.edit','loading.complete','loading.verify','loading.approve','loading.mismatch.approve',
  'delivery.dispatch','delivery.complete',
  'purchases.view','purchases.create','purchases.post','purchases.receive','purchases.return','purchases.credit.apply','purchases.credit.refund',
  'attendance.view','attendance.record','employees.view','employees.create','employees.edit',
  'employees.advance.view','employees.advance.post','employees.advance.repay','employees.advance.approve',
  'expenses.view','expenses.create','expenses.approve','expense.submit_for_approval',
  'brokers.commission.view','brokers.commission.approve','brokers.commission.pay',
  'cash.close.view','cash.close.record','cash.close.approve',
  'payroll.view','payroll.create','payroll.approve','payroll.pay',
  'accounting.journal.create','accounting.journal.approve'
);

DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id=r.id
  AND rp.permission_id=p.id
  AND r.code='manager'
  AND r.system_role=true
  AND p.manager_default=false;
