CREATE TABLE stock_locations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 code text NOT NULL,
 name text NOT NULL,
 branch_id uuid,
 chamber_id uuid,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id),
 FOREIGN KEY(company_id,chamber_id) REFERENCES chambers(company_id,id),
 UNIQUE(company_id,code), UNIQUE(company_id,id)
);
INSERT INTO stock_locations(company_id,code,name)
SELECT id,'MAIN','Main yard' FROM companies ON CONFLICT(company_id,code) DO NOTHING;
ALTER TABLE stock_movements ADD COLUMN location_id uuid;
UPDATE stock_movements sm SET location_id=sl.id FROM stock_locations sl WHERE sl.company_id=sm.company_id AND sl.code='MAIN';
ALTER TABLE stock_movements ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_location_fk FOREIGN KEY(company_id,location_id) REFERENCES stock_locations(company_id,id);
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_quality_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_quality_check CHECK(quality IN ('good','second','broken','rejected','damaged'));
CREATE INDEX stock_movements_location_idx ON stock_movements(company_id,location_id,product_id,quality,occurred_at);
INSERT INTO permissions(code,module,action,description) VALUES
 ('stock.adjust','stock','adjust','Record reasoned stock adjustments and damage movements') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.system_role=true AND r.code='owner' AND p.code='stock.adjust' ON CONFLICT DO NOTHING;
