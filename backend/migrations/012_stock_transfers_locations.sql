CREATE TABLE stock_transfers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 transfer_number text NOT NULL,
 product_id uuid NOT NULL,
 source_location_id uuid NOT NULL,
 destination_location_id uuid NOT NULL,
 quality text NOT NULL CHECK(quality IN ('good','second','broken','rejected','damaged')),
 quantity numeric(14,2) NOT NULL CHECK(quantity>0),
 reason text NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(source_location_id<>destination_location_id),
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 FOREIGN KEY(company_id,source_location_id) REFERENCES stock_locations(company_id,id),
 FOREIGN KEY(company_id,destination_location_id) REFERENCES stock_locations(company_id,id),
 FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
 UNIQUE(company_id,transfer_number), UNIQUE(company_id,id)
);
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_movement_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check CHECK(movement_type IN ('production_in','sale_out','customer_return','damage','adjustment','purchase_in','transfer'));
INSERT INTO permissions(code,module,action,description) VALUES
 ('stock.location.manage','stock','configure','Create and manage stock locations'),
 ('stock.transfer','stock','transfer','Transfer inventory between company locations') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.system_role=true AND r.code='owner' AND p.code IN ('stock.location.manage','stock.transfer') ON CONFLICT DO NOTHING;
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding) SELECT id,'stock_transfer','TR-',1,5 FROM companies ON CONFLICT DO NOTHING;
