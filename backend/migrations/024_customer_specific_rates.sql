CREATE TABLE customer_product_rates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
 customer_id uuid NOT NULL, product_id uuid NOT NULL, rate numeric(14,2) NOT NULL CHECK(rate>0),
 valid_from date NOT NULL, valid_to date, active boolean NOT NULL DEFAULT true,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(valid_to IS NULL OR valid_to>=valid_from),
 FOREIGN KEY(company_id,customer_id) REFERENCES business_partners(company_id,id),
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 UNIQUE(company_id,customer_id,product_id,valid_from), UNIQUE(company_id,id)
);
CREATE INDEX customer_product_rates_lookup_idx ON customer_product_rates(company_id,customer_id,product_id,valid_from DESC) WHERE active;
INSERT INTO permissions(code,module,action,description) VALUES
 ('sales.pricing.configure','sales','pricing_configure','Configure customer-specific product rates') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.system_role=true AND r.code='owner' AND p.code='sales.pricing.configure' ON CONFLICT DO NOTHING;
