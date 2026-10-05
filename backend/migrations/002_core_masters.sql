CREATE TABLE business_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  partner_type text NOT NULL CHECK (partner_type IN ('customer','supplier','broker')),
  name text NOT NULL,
  code text NOT NULL,
  phone text,
  email text,
  address text,
  gstin text,
  credit_days integer NOT NULL DEFAULT 0 CHECK (credit_days >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, partner_type, code),
  UNIQUE (company_id, id)
);
CREATE INDEX business_partners_search_idx ON business_partners(company_id, partner_type, lower(name));

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  code text NOT NULL,
  unit text NOT NULL DEFAULT 'pieces',
  selling_rate numeric(14,2) NOT NULL DEFAULT 0 CHECK (selling_rate >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  UNIQUE (company_id, id)
);
CREATE INDEX products_search_idx ON products(company_id, lower(name));

CREATE TABLE chambers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  code text NOT NULL,
  capacity numeric(14,2) NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  capacity_unit text NOT NULL DEFAULT 'pieces',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  UNIQUE (company_id, id)
);
CREATE INDEX chambers_search_idx ON chambers(company_id, lower(name));

INSERT INTO permissions (code, module, action, description) VALUES
  ('masters.view', 'masters', 'view', 'View business master records'),
  ('masters.create', 'masters', 'create', 'Create business master records'),
  ('masters.edit', 'masters', 'edit', 'Edit and deactivate business master records')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.system_role = true AND r.code = 'owner' AND p.module = 'masters'
ON CONFLICT DO NOTHING;
