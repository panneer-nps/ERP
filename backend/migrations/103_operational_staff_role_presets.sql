-- Built-in task roles from the Master PRD. These roles remain separate from
-- Owner/Manager and do not receive approval, company, or user administration.
INSERT INTO roles(company_id,code,name,read_only,system_role)
SELECT c.id,preset.code,preset.name,false,true
FROM companies c
CROSS JOIN (VALUES
  ('sales_staff','Sales Staff'),
  ('production_staff','Production Staff'),
  ('loading_staff','Loading Staff'),
  ('store_staff','Store Staff')
) AS preset(code,name)
ON CONFLICT(company_id,code) DO UPDATE
  SET name=EXCLUDED.name,read_only=false,system_role=true
  WHERE roles.system_role=true;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN (VALUES
  ('sales_staff',ARRAY['masters.view','sales.view','sales.create','sales.post']::text[]),
  ('production_staff',ARRAY['masters.view','production.view','production.create','production.post','stock.view']::text[]),
  ('loading_staff',ARRAY['loading.view','loading.create','loading.edit']::text[]),
  ('store_staff',ARRAY['masters.view','stock.view','stock.adjust','stock.transfer','purchases.view','purchases.receive']::text[])
) AS preset(code,permissions) ON preset.code=r.code
CROSS JOIN LATERAL unnest(preset.permissions) AS granted(code)
JOIN permissions p ON p.code=granted.code
WHERE r.system_role=true
ON CONFLICT DO NOTHING;

DELETE FROM role_permissions rp
USING roles r,permissions p,
  (VALUES
    ('sales_staff',ARRAY['masters.view','sales.view','sales.create','sales.post']::text[]),
    ('production_staff',ARRAY['masters.view','production.view','production.create','production.post','stock.view']::text[]),
    ('loading_staff',ARRAY['loading.view','loading.create','loading.edit']::text[]),
    ('store_staff',ARRAY['masters.view','stock.view','stock.adjust','stock.transfer','purchases.view','purchases.receive']::text[])
  ) AS preset(code,permissions)
WHERE rp.role_id=r.id AND rp.permission_id=p.id
  AND r.code=preset.code AND r.system_role=true
  AND NOT (p.code=ANY(preset.permissions));
