CREATE TABLE purchase_returns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 return_number text NOT NULL,
 bill_id uuid NOT NULL,
 supplier_id uuid NOT NULL,
 return_date date NOT NULL DEFAULT CURRENT_DATE,
 reason text NOT NULL,
 subtotal numeric(14,2) NOT NULL CHECK(subtotal>=0),
 tax_total numeric(14,2) NOT NULL CHECK(tax_total>=0),
 total numeric(14,2) NOT NULL CHECK(total>0),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,bill_id) REFERENCES purchase_bills(company_id,id),
 FOREIGN KEY(company_id,supplier_id) REFERENCES business_partners(company_id,id),
 FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
 UNIQUE(company_id,return_number),UNIQUE(company_id,id)
);
CREATE INDEX purchase_returns_bill_idx ON purchase_returns(company_id,bill_id,return_date DESC);

ALTER TABLE purchase_bill_lines ADD CONSTRAINT purchase_bill_lines_company_id_uq UNIQUE(company_id,id);
CREATE TABLE purchase_return_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 purchase_return_id uuid NOT NULL,
 bill_line_id uuid NOT NULL,
 product_id uuid NOT NULL,
 quantity numeric(14,2) NOT NULL CHECK(quantity>0),
 unit_rate numeric(14,2) NOT NULL CHECK(unit_rate>=0),
 tax_rate numeric(6,3) NOT NULL CHECK(tax_rate>=0 AND tax_rate<=100),
 line_subtotal numeric(14,2) NOT NULL CHECK(line_subtotal>=0),
 tax_amount numeric(14,2) NOT NULL CHECK(tax_amount>=0),
 line_total numeric(14,2) NOT NULL CHECK(line_total>=0),
 FOREIGN KEY(company_id,purchase_return_id) REFERENCES purchase_returns(company_id,id),
 FOREIGN KEY(company_id,bill_line_id) REFERENCES purchase_bill_lines(company_id,id),
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 UNIQUE(company_id,id)
);
CREATE INDEX purchase_return_lines_bill_idx ON purchase_return_lines(company_id,bill_line_id);

ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_movement_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check
 CHECK(movement_type IN ('production_in','sale_out','customer_return','damage','adjustment','purchase_in','purchase_return','transfer'));
INSERT INTO permissions(code,module,action,description) VALUES
 ('purchases.return','purchases','return','Post supplier returns and payable credits')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='purchases.return'
 WHERE r.system_role=true AND r.code='owner' ON CONFLICT DO NOTHING;
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
 SELECT id,'purchase_return','PR-',1,5 FROM companies ON CONFLICT DO NOTHING;
