ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_status_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
 CHECK(status IN ('open','partially_received','received','partially_billed','billed','cancelled'));
ALTER TABLE purchase_bills DROP CONSTRAINT purchase_bills_company_id_order_id_key;
ALTER TABLE purchase_order_lines ADD CONSTRAINT purchase_order_lines_company_id_uq UNIQUE(company_id,id);
ALTER TABLE purchase_order_lines ADD COLUMN received_quantity numeric(14,2) NOT NULL DEFAULT 0 CHECK(received_quantity>=0);
ALTER TABLE purchase_order_lines ADD COLUMN billed_quantity numeric(14,2) NOT NULL DEFAULT 0 CHECK(billed_quantity>=0);
ALTER TABLE purchase_order_lines ADD CONSTRAINT purchase_order_quantities_ck CHECK(billed_quantity<=received_quantity AND received_quantity<=quantity);

CREATE TABLE purchase_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 receipt_number text NOT NULL,
 order_id uuid NOT NULL,
 supplier_id uuid NOT NULL,
 receipt_date date NOT NULL DEFAULT CURRENT_DATE,
 notes text NOT NULL DEFAULT '',
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,order_id) REFERENCES purchase_orders(company_id,id),
 FOREIGN KEY(company_id,supplier_id) REFERENCES business_partners(company_id,id),
 FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
 UNIQUE(company_id,receipt_number), UNIQUE(company_id,id)
);
CREATE INDEX purchase_receipts_order_idx ON purchase_receipts(company_id,order_id,receipt_date DESC);

CREATE TABLE purchase_receipt_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 receipt_id uuid NOT NULL,
 order_line_id uuid NOT NULL,
 product_id uuid NOT NULL,
 quantity numeric(14,2) NOT NULL CHECK(quantity>0),
 unit_rate numeric(14,2) NOT NULL CHECK(unit_rate>=0),
 tax_rate numeric(6,3) NOT NULL CHECK(tax_rate>=0 AND tax_rate<=100),
 line_subtotal numeric(14,2) NOT NULL CHECK(line_subtotal>=0),
 FOREIGN KEY(company_id,receipt_id) REFERENCES purchase_receipts(company_id,id),
 FOREIGN KEY(company_id,order_line_id) REFERENCES purchase_order_lines(company_id,id),
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 UNIQUE(company_id,id)
);
CREATE INDEX purchase_receipt_lines_parent_idx ON purchase_receipt_lines(company_id,receipt_id);

ALTER TABLE purchase_bill_lines ADD COLUMN order_line_id uuid;
ALTER TABLE purchase_bill_lines ADD CONSTRAINT purchase_bill_lines_order_line_fk FOREIGN KEY(company_id,order_line_id) REFERENCES purchase_order_lines(company_id,id);
UPDATE purchase_order_lines pol SET received_quantity=pol.quantity,billed_quantity=pol.quantity
 FROM purchase_orders po WHERE po.company_id=pol.company_id AND po.id=pol.order_id AND po.status='billed';

INSERT INTO accounts(company_id,code,name,account_type)
 SELECT id,'2300','Goods received not invoiced','liability' FROM companies
 ON CONFLICT(company_id,code) DO NOTHING;
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
 SELECT id,'purchase_receipt','GR-',1,5 FROM companies ON CONFLICT DO NOTHING;
INSERT INTO permissions(code,module,action,description) VALUES
 ('purchases.receive','purchases','receive','Record partial and full supplier goods receipts')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='purchases.receive'
 WHERE r.system_role=true AND r.code='owner' ON CONFLICT DO NOTHING;
