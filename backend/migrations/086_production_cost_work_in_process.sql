ALTER TABLE production_cost_lines
  ADD COLUMN funding_account_code text NOT NULL DEFAULT '1110'
  CHECK (funding_account_code IN ('1110','1120','2100'));

INSERT INTO accounts(company_id,code,name,account_type,group_id,system_managed)
SELECT c.id,'1350','Production work in progress','asset',g.id,true
FROM companies c
JOIN account_groups g ON g.company_id=c.id AND g.account_type='asset'
  AND g.system_managed=true AND g.parent_group_id IS NULL
ON CONFLICT(company_id,code) DO NOTHING;
