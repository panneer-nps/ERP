ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_movement_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check
 CHECK(movement_type IN ('production_in','sale_out','customer_return','damage','adjustment','purchase_in','purchase_return','transfer','opening_in'));

CREATE TABLE stock_opening_balances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 opening_number text NOT NULL,
 location_id uuid NOT NULL,
 opening_date date NOT NULL,
 notes text NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,location_id) REFERENCES stock_locations(company_id,id),
 FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
 UNIQUE(company_id,id),
 UNIQUE(company_id,opening_number),
 UNIQUE(company_id,location_id)
);
CREATE TABLE stock_opening_balance_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 opening_balance_id uuid NOT NULL,
 product_id uuid NOT NULL,
 quality text NOT NULL CHECK(quality IN ('good','second')),
 quantity numeric(14,2) NOT NULL CHECK(quantity>0),
 FOREIGN KEY(company_id,opening_balance_id) REFERENCES stock_opening_balances(company_id,id),
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 UNIQUE(company_id,opening_balance_id,product_id,quality),
 UNIQUE(company_id,id)
);
CREATE INDEX stock_opening_balance_lines_parent_idx ON stock_opening_balance_lines(company_id,opening_balance_id);

INSERT INTO permissions(code,module,action,description) VALUES
 ('stock.opening.post','stock','opening_post','Post one opening stock transaction per location') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='stock.opening.post' WHERE r.system_role=true AND r.code='owner' ON CONFLICT DO NOTHING;
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
 SELECT id,'stock_opening_balance','OB-',1,5 FROM companies ON CONFLICT DO NOTHING;
