CREATE TABLE stock_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  return_number text NOT NULL,
  customer_id uuid NOT NULL,
  location_id uuid NOT NULL,
  return_date date NOT NULL,
  reference text,
  reason text NOT NULL,
  branch_id uuid,
  total_cost numeric(14,2) NOT NULL CHECK (total_cost > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(company_id,customer_id) REFERENCES business_partners(company_id,id),
  FOREIGN KEY(company_id,location_id) REFERENCES stock_locations(company_id,id),
  FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id),
  FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
  UNIQUE(company_id,return_number),
  UNIQUE(company_id,id)
);
CREATE INDEX stock_returns_recent_idx ON stock_returns(company_id,return_date DESC,created_at DESC);

CREATE TABLE stock_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  stock_return_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quality text NOT NULL CHECK (quality IN ('good','second','damaged')),
  quantity numeric(14,2) NOT NULL CHECK (quantity > 0),
  entered_quantity numeric(14,2) NOT NULL CHECK (entered_quantity > 0),
  entered_unit_code text NOT NULL,
  conversion_to_base numeric(16,6) NOT NULL CHECK (conversion_to_base > 0),
  unit_cost numeric(14,4) NOT NULL CHECK (unit_cost > 0),
  line_cost numeric(14,2) NOT NULL CHECK (line_cost > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(company_id,stock_return_id) REFERENCES stock_returns(company_id,id),
  FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
  UNIQUE(company_id,id),
  UNIQUE(company_id,stock_return_id,product_id,quality)
);
CREATE INDEX stock_return_lines_parent_idx ON stock_return_lines(company_id,stock_return_id);

INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
SELECT id,'stock_return','SRET-',1,5 FROM companies ON CONFLICT DO NOTHING;

INSERT INTO permissions(code,module,action,description,manager_default) VALUES
  ('stock.return.create','stock','return','Record customer stock returns without an invoice',true)
ON CONFLICT(code) DO UPDATE SET manager_default=true;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='stock.return.create'
WHERE r.system_role=true AND r.code IN ('owner','manager')
ON CONFLICT DO NOTHING;
