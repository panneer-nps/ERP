-- Keep ordinary operating expenses and production cost of goods sold distinct.
UPDATE accounts
SET name='Operating expenses',account_type='expense'
WHERE code='5100' AND system_managed=true;

INSERT INTO accounts(company_id,code,name,account_type,group_id,system_managed)
SELECT c.id,'5200','Cost of goods sold','expense',g.id,true
FROM companies c
JOIN account_groups g ON g.company_id=c.id AND g.code='EXPENSES' AND g.account_type='expense'
ON CONFLICT(company_id,code) DO UPDATE SET
  name=EXCLUDED.name,
  account_type=EXCLUDED.account_type,
  group_id=EXCLUDED.group_id,
  system_managed=true;
