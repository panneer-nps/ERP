ALTER TABLE products ADD COLUMN purchase_rate numeric(14,2) NOT NULL DEFAULT 0 CHECK (purchase_rate >= 0);
ALTER TABLE products ADD COLUMN purchase_tax_rate numeric(6,3) NOT NULL DEFAULT 0 CHECK (purchase_tax_rate >= 0 AND purchase_tax_rate <= 100);
ALTER TABLE journal_entry_lines ADD COLUMN supplier_id uuid;
ALTER TABLE journal_entry_lines ADD CONSTRAINT journal_lines_supplier_fk FOREIGN KEY(company_id,supplier_id) REFERENCES business_partners(company_id,id);
ALTER TABLE journal_entry_lines ADD CONSTRAINT journal_lines_one_party_ck CHECK (customer_id IS NULL OR supplier_id IS NULL);
CREATE INDEX journal_lines_supplier_ledger_idx ON journal_entry_lines(company_id,supplier_id,journal_entry_id);

CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  order_number text NOT NULL,
  supplier_id uuid NOT NULL,
  order_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','billed','cancelled')),
  subtotal numeric(14,2) NOT NULL CHECK(subtotal >= 0),
  tax_total numeric(14,2) NOT NULL CHECK(tax_total >= 0),
  total numeric(14,2) NOT NULL CHECK(total >= 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(company_id,supplier_id) REFERENCES business_partners(company_id,id),
  FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
  UNIQUE(company_id,order_number), UNIQUE(company_id,id)
);
CREATE INDEX purchase_orders_recent_idx ON purchase_orders(company_id,order_date DESC,created_at DESC);

CREATE TABLE purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  order_id uuid NOT NULL,
  line_number integer NOT NULL CHECK(line_number > 0),
  product_id uuid NOT NULL,
  quantity numeric(14,2) NOT NULL CHECK(quantity > 0),
  unit_rate numeric(14,2) NOT NULL CHECK(unit_rate >= 0),
  tax_rate numeric(6,3) NOT NULL DEFAULT 0 CHECK(tax_rate >= 0 AND tax_rate <= 100),
  line_subtotal numeric(14,2) NOT NULL CHECK(line_subtotal >= 0),
  tax_amount numeric(14,2) NOT NULL CHECK(tax_amount >= 0),
  line_total numeric(14,2) NOT NULL CHECK(line_total >= 0),
  FOREIGN KEY(company_id,order_id) REFERENCES purchase_orders(company_id,id),
  FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
  UNIQUE(order_id,line_number)
);

CREATE TABLE purchase_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  bill_number text NOT NULL,
  supplier_invoice_number text,
  order_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  bill_date date NOT NULL DEFAULT CURRENT_DATE,
  subtotal numeric(14,2) NOT NULL CHECK(subtotal >= 0),
  tax_total numeric(14,2) NOT NULL CHECK(tax_total >= 0),
  total numeric(14,2) NOT NULL CHECK(total >= 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(company_id,order_id) REFERENCES purchase_orders(company_id,id),
  FOREIGN KEY(company_id,supplier_id) REFERENCES business_partners(company_id,id),
  FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
  UNIQUE(company_id,bill_number), UNIQUE(company_id,order_id), UNIQUE(company_id,id)
);
ALTER TABLE purchase_bills ADD CONSTRAINT purchase_bills_supplier_key UNIQUE(company_id,id,supplier_id);
CREATE INDEX purchase_bills_supplier_idx ON purchase_bills(company_id,supplier_id,bill_date DESC);

CREATE TABLE purchase_bill_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  bill_id uuid NOT NULL,
  line_number integer NOT NULL CHECK(line_number > 0),
  product_id uuid NOT NULL,
  quantity numeric(14,2) NOT NULL CHECK(quantity > 0),
  unit_rate numeric(14,2) NOT NULL CHECK(unit_rate >= 0),
  tax_rate numeric(6,3) NOT NULL CHECK(tax_rate >= 0 AND tax_rate <= 100),
  line_subtotal numeric(14,2) NOT NULL CHECK(line_subtotal >= 0),
  tax_amount numeric(14,2) NOT NULL CHECK(tax_amount >= 0),
  line_total numeric(14,2) NOT NULL CHECK(line_total >= 0),
  FOREIGN KEY(company_id,bill_id) REFERENCES purchase_bills(company_id,id),
  FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
  UNIQUE(bill_id,line_number)
);

CREATE TABLE supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  payment_number text NOT NULL,
  supplier_id uuid NOT NULL,
  bill_id uuid,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(14,2) NOT NULL CHECK(amount > 0),
  payment_method text NOT NULL CHECK(payment_method IN ('cash','upi','bank_transfer','cheque','card','other')),
  reference text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(company_id,supplier_id) REFERENCES business_partners(company_id,id),
  FOREIGN KEY(company_id,bill_id,supplier_id) REFERENCES purchase_bills(company_id,id,supplier_id),
  FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
  UNIQUE(company_id,payment_number), UNIQUE(company_id,id)
);
CREATE INDEX supplier_payments_ledger_idx ON supplier_payments(company_id,supplier_id,payment_date DESC);

INSERT INTO permissions(code,module,action,description) VALUES
 ('purchases.view','purchases','view','View purchase orders, bills, payments and supplier balances'),
 ('purchases.create','purchases','create','Create purchase orders and supplier payments'),
 ('purchases.post','purchases','post','Receive supplier goods and post bills and stock'),
 ('accounting.view','accounting','view','View posted journals and ledgers')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.system_role=true AND r.code='owner' AND p.module IN ('purchases','accounting')
ON CONFLICT DO NOTHING;

INSERT INTO accounts(company_id,code,name,account_type)
SELECT c.id,a.code,a.name,a.account_type FROM companies c CROSS JOIN (VALUES
 ('1200','Input tax recoverable','asset'),('1300','Inventory','asset'),('2100','Accounts payable','liability')
) AS a(code,name,account_type)
ON CONFLICT(company_id,code) DO NOTHING;
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding) SELECT id,'purchase_order','PO-',1,5 FROM companies ON CONFLICT DO NOTHING;
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding) SELECT id,'purchase_bill','PB-',1,5 FROM companies ON CONFLICT DO NOTHING;
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding) SELECT id,'supplier_payment','SPAY-',1,5 FROM companies ON CONFLICT DO NOTHING;
