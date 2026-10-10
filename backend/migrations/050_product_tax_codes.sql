CREATE TABLE product_tax_codes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 code text NOT NULL,
 hsn_code text NOT NULL DEFAULT '',
 description text NOT NULL,
 sales_tax_rate numeric(6,3) NOT NULL DEFAULT 0 CHECK(sales_tax_rate>=0 AND sales_tax_rate<=100),
 purchase_tax_rate numeric(6,3) NOT NULL DEFAULT 0 CHECK(purchase_tax_rate>=0 AND purchase_tax_rate<=100),
 active boolean NOT NULL DEFAULT true,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
 UNIQUE(company_id,code),
 UNIQUE(company_id,id)
);
CREATE INDEX product_tax_codes_active_idx ON product_tax_codes(company_id,active,lower(code));

ALTER TABLE products ADD COLUMN tax_code_id uuid;
ALTER TABLE products ADD CONSTRAINT products_tax_code_fk FOREIGN KEY(company_id,tax_code_id) REFERENCES product_tax_codes(company_id,id);
CREATE INDEX products_tax_code_idx ON products(company_id,tax_code_id) WHERE tax_code_id IS NOT NULL;

INSERT INTO permissions(code,module,action,description) VALUES
 ('products.tax.configure','products','tax_configure','Configure company HSN and product tax codes')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='products.tax.configure'
 WHERE r.system_role=true AND r.code='owner' ON CONFLICT DO NOTHING;
