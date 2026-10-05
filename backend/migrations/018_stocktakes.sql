CREATE TABLE stocktakes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 stocktake_number text NOT NULL,
 location_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'counting' CHECK(status IN ('counting','pending','approved','rejected')),
 notes text NOT NULL DEFAULT '',
 created_by uuid NOT NULL,
 submitted_by uuid,
 approved_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 submitted_at timestamptz,
 approved_at timestamptz,
 FOREIGN KEY(company_id,location_id) REFERENCES stock_locations(company_id,id),
 FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
 FOREIGN KEY(company_id,submitted_by) REFERENCES users(company_id,id),
 FOREIGN KEY(company_id,approved_by) REFERENCES users(company_id,id),
 UNIQUE(company_id,stocktake_number), UNIQUE(company_id,id)
);
CREATE INDEX stocktakes_status_idx ON stocktakes(company_id,status,created_at DESC);

CREATE TABLE stocktake_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 stocktake_id uuid NOT NULL,
 product_id uuid NOT NULL,
 quality text NOT NULL CHECK(quality IN ('good','second','broken','rejected','damaged')),
 expected_quantity numeric(14,2) NOT NULL CHECK(expected_quantity>=0),
 counted_quantity numeric(14,2) CHECK(counted_quantity>=0),
 FOREIGN KEY(company_id,stocktake_id) REFERENCES stocktakes(company_id,id),
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 UNIQUE(company_id,stocktake_id,product_id,quality), UNIQUE(company_id,id)
);
CREATE INDEX stocktake_lines_parent_idx ON stocktake_lines(company_id,stocktake_id,product_id);

INSERT INTO permissions(code,module,action,description) VALUES
 ('stocktake.create','stock','create','Create and submit physical stock counts'),
 ('stocktake.approve','stock','approve','Approve or reject physical stock counts')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN ('stocktake.create','stocktake.approve')
 WHERE r.system_role=true AND r.code='owner' ON CONFLICT DO NOTHING;
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
 SELECT id,'stocktake','ST-',1,5 FROM companies ON CONFLICT DO NOTHING;
