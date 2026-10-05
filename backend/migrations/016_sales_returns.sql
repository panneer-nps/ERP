CREATE TABLE sales_returns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 credit_note_number text NOT NULL,
 invoice_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 return_date date NOT NULL DEFAULT CURRENT_DATE,
 reason text NOT NULL,
 subtotal numeric(14,2) NOT NULL CHECK(subtotal>0),
 tax_total numeric(14,2) NOT NULL CHECK(tax_total>=0),
 total numeric(14,2) NOT NULL CHECK(total=subtotal+tax_total),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,invoice_id,customer_id) REFERENCES sales_invoices(company_id,id,customer_id),
 FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
 UNIQUE(company_id,credit_note_number), UNIQUE(company_id,id)
);
CREATE INDEX sales_returns_invoice_idx ON sales_returns(company_id,invoice_id,return_date DESC);

ALTER TABLE sales_invoice_lines ADD CONSTRAINT sales_invoice_lines_company_id_uq UNIQUE(company_id,id);
CREATE TABLE sales_return_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 sales_return_id uuid NOT NULL,
 invoice_line_id uuid NOT NULL,
 product_id uuid NOT NULL,
 sold_quality text NOT NULL CHECK(sold_quality IN ('good','second')),
 restock_quality text NOT NULL CHECK(restock_quality IN ('good','second','damaged')),
 quantity numeric(14,2) NOT NULL CHECK(quantity>0),
 unit_rate numeric(14,2) NOT NULL CHECK(unit_rate>=0),
 tax_rate numeric(6,3) NOT NULL CHECK(tax_rate>=0 AND tax_rate<=100),
 line_subtotal numeric(14,2) NOT NULL CHECK(line_subtotal>=0),
 tax_amount numeric(14,2) NOT NULL CHECK(tax_amount>=0),
 line_total numeric(14,2) NOT NULL CHECK(line_total=line_subtotal+tax_amount),
 FOREIGN KEY(company_id,sales_return_id) REFERENCES sales_returns(company_id,id),
 FOREIGN KEY(company_id,invoice_line_id) REFERENCES sales_invoice_lines(company_id,id),
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 UNIQUE(company_id,id)
);
CREATE INDEX sales_return_lines_invoice_idx ON sales_return_lines(company_id,invoice_line_id);

INSERT INTO accounts(company_id,code,name,account_type)
 SELECT id,'4200','Sales returns','expense' FROM companies ON CONFLICT(company_id,code) DO NOTHING;
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
 SELECT id,'sales_return','CN-',1,5 FROM companies ON CONFLICT DO NOTHING;
INSERT INTO permissions(code,module,action,description)
 VALUES('sales.return','sales','return','Record controlled customer invoice returns')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='sales.return'
 WHERE r.system_role=true AND r.code='owner'
ON CONFLICT DO NOTHING;
