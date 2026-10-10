CREATE TABLE product_units (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 product_id uuid NOT NULL,
 code text NOT NULL,
 label text NOT NULL,
 conversion_to_base numeric(16,6) NOT NULL CHECK(conversion_to_base>0),
 is_base boolean NOT NULL DEFAULT false,
 active boolean NOT NULL DEFAULT true,
 created_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
 UNIQUE(company_id,id),
 UNIQUE(company_id,product_id,code),
 CHECK(NOT is_base OR conversion_to_base=1)
);
CREATE UNIQUE INDEX product_units_one_base_idx ON product_units(company_id,product_id) WHERE is_base;
CREATE INDEX product_units_product_idx ON product_units(company_id,product_id,active,lower(label));

INSERT INTO product_units(company_id,product_id,code,label,conversion_to_base,is_base)
SELECT company_id,id,COALESCE(NULLIF(upper(left(regexp_replace(unit,'[^A-Za-z0-9_-]+','_','g'),30)),''),'BASE'),unit,1,true FROM products
ON CONFLICT(company_id,product_id,code) DO NOTHING;

INSERT INTO permissions(code,module,action,description) VALUES
 ('products.units.configure','products','units_configure','Configure product sale and purchase unit conversions')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='products.units.configure'
 WHERE r.system_role=true AND r.code='owner' ON CONFLICT DO NOTHING;
