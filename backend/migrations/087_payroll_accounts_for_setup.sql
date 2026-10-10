-- Payroll accounts must exist for companies created after earlier migrations ran.
INSERT INTO accounts(company_id,code,name,account_type,group_id,system_managed)
SELECT c.id,v.code,v.name,v.account_type,g.id,true
FROM companies c
CROSS JOIN (VALUES
  ('2400','Payroll deductions payable','liability'),
  ('2500','Salaries payable','liability'),
  ('5400','Salary expense','expense')
) v(code,name,account_type)
JOIN account_groups g ON g.company_id=c.id
  AND g.account_type=v.account_type
  AND g.system_managed=true
  AND g.parent_group_id IS NULL
ON CONFLICT(company_id,code) DO NOTHING;
