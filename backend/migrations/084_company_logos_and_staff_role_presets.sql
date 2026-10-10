ALTER TABLE companies
  ADD COLUMN logo_data bytea,
  ADD COLUMN logo_storage_key text,
  ADD COLUMN logo_content_type text,
  ADD COLUMN logo_byte_size integer,
  ADD CONSTRAINT companies_logo_location_check
    CHECK (NOT (logo_data IS NOT NULL AND logo_storage_key IS NOT NULL)),
  ADD CONSTRAINT companies_logo_content_type_check
    CHECK (logo_content_type IS NULL OR logo_content_type IN ('image/png','image/jpeg','image/webp')),
  ADD CONSTRAINT companies_logo_byte_size_check
    CHECK (logo_byte_size IS NULL OR logo_byte_size BETWEEN 1 AND 1048576);

CREATE UNIQUE INDEX companies_logo_storage_key_idx
  ON companies(logo_storage_key) WHERE logo_storage_key IS NOT NULL;

-- A Manager can operate business modules but cannot administer users or company settings.
INSERT INTO roles(company_id,code,name,read_only,system_role)
SELECT id,'manager','Manager',false,true FROM companies
ON CONFLICT(company_id,code) DO UPDATE SET name='Manager',read_only=false,system_role=true;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.module NOT IN ('users','company')
WHERE r.code='manager' AND r.system_role=true
ON CONFLICT DO NOTHING;

-- Cashier access supports customer lookup, sales entry/invoicing, and cash close work.
INSERT INTO roles(company_id,code,name,read_only,system_role)
SELECT id,'cashier','Cashier',false,true FROM companies
ON CONFLICT(company_id,code) DO UPDATE SET name='Cashier',read_only=false,system_role=true;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON
  p.code IN ('masters.view','sales.view','sales.create','sales.post','stock.view','cash.close.view','cash.close.record')
WHERE r.code='cashier' AND r.system_role=true
ON CONFLICT DO NOTHING;
