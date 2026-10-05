ALTER TABLE products ADD COLUMN tax_rate numeric(6,3) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100);
ALTER TABLE stock_movements ADD COLUMN reference_type text;
ALTER TABLE stock_movements ADD COLUMN reference_id uuid;
CREATE INDEX stock_movements_reference_idx ON stock_movements(company_id,reference_type,reference_id);

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  code text NOT NULL,
  name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('asset','liability','equity','income','expense')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  UNIQUE (company_id, id)
);

CREATE TABLE journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  entry_number text NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  description text NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  posted_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, posted_by) REFERENCES users(company_id, id),
  UNIQUE (company_id, entry_number),
  UNIQUE (company_id, source_type, source_id),
  UNIQUE (company_id, id)
);

CREATE TABLE journal_entry_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  journal_entry_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  account_id uuid NOT NULL,
  customer_id uuid,
  description text NOT NULL,
  debit numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)),
  FOREIGN KEY (company_id, journal_entry_id) REFERENCES journal_entries(company_id, id),
  FOREIGN KEY (company_id, account_id) REFERENCES accounts(company_id, id),
  FOREIGN KEY (company_id, customer_id) REFERENCES business_partners(company_id, id),
  UNIQUE (journal_entry_id, line_number)
);
CREATE INDEX journal_lines_customer_ledger_idx ON journal_entry_lines(company_id, customer_id, journal_entry_id);

CREATE TABLE sales_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  order_number text NOT NULL,
  customer_id uuid NOT NULL,
  broker_id uuid,
  order_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','invoiced','cancelled')),
  subtotal numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  tax_total numeric(14,2) NOT NULL CHECK (tax_total >= 0),
  total numeric(14,2) NOT NULL CHECK (total >= 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, customer_id) REFERENCES business_partners(company_id, id),
  FOREIGN KEY (company_id, broker_id) REFERENCES business_partners(company_id, id),
  FOREIGN KEY (company_id, created_by) REFERENCES users(company_id, id),
  UNIQUE (company_id, order_number),
  UNIQUE (company_id, id)
);
CREATE INDEX sales_orders_recent_idx ON sales_orders(company_id, order_date DESC, created_at DESC);

CREATE TABLE sales_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  order_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  product_id uuid NOT NULL,
  quality text NOT NULL DEFAULT 'good' CHECK (quality IN ('good','second')),
  quantity numeric(14,2) NOT NULL CHECK (quantity > 0),
  unit_rate numeric(14,2) NOT NULL CHECK (unit_rate >= 0),
  tax_rate numeric(6,3) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  line_subtotal numeric(14,2) NOT NULL CHECK (line_subtotal >= 0),
  tax_amount numeric(14,2) NOT NULL CHECK (tax_amount >= 0),
  line_total numeric(14,2) NOT NULL CHECK (line_total >= 0),
  FOREIGN KEY (company_id, order_id) REFERENCES sales_orders(company_id, id),
  FOREIGN KEY (company_id, product_id) REFERENCES products(company_id, id),
  UNIQUE (order_id, line_number)
);

CREATE TABLE sales_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  invoice_number text NOT NULL,
  order_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  invoice_date date NOT NULL DEFAULT CURRENT_DATE,
  subtotal numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  tax_total numeric(14,2) NOT NULL CHECK (tax_total >= 0),
  total numeric(14,2) NOT NULL CHECK (total >= 0),
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, order_id) REFERENCES sales_orders(company_id, id),
  FOREIGN KEY (company_id, customer_id) REFERENCES business_partners(company_id, id),
  FOREIGN KEY (company_id, created_by) REFERENCES users(company_id, id),
  UNIQUE (company_id, invoice_number),
  UNIQUE (company_id, id),
  UNIQUE (company_id, id, customer_id),
  UNIQUE (company_id, order_id)
);
CREATE INDEX sales_invoices_customer_idx ON sales_invoices(company_id, customer_id, invoice_date DESC);

CREATE TABLE sales_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  invoice_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  product_id uuid NOT NULL,
  quality text NOT NULL CHECK (quality IN ('good','second')),
  quantity numeric(14,2) NOT NULL CHECK (quantity > 0),
  unit_rate numeric(14,2) NOT NULL CHECK (unit_rate >= 0),
  tax_rate numeric(6,3) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  line_subtotal numeric(14,2) NOT NULL CHECK (line_subtotal >= 0),
  tax_amount numeric(14,2) NOT NULL CHECK (tax_amount >= 0),
  line_total numeric(14,2) NOT NULL CHECK (line_total >= 0),
  FOREIGN KEY (company_id, invoice_id) REFERENCES sales_invoices(company_id, id),
  FOREIGN KEY (company_id, product_id) REFERENCES products(company_id, id),
  UNIQUE (invoice_id, line_number)
);

CREATE TABLE customer_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  receipt_number text NOT NULL,
  customer_id uuid NOT NULL,
  invoice_id uuid,
  receipt_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL CHECK (payment_method IN ('cash','upi','bank_transfer','cheque','card','other')),
  reference text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, customer_id) REFERENCES business_partners(company_id, id),
  FOREIGN KEY (company_id, invoice_id, customer_id) REFERENCES sales_invoices(company_id, id, customer_id),
  FOREIGN KEY (company_id, created_by) REFERENCES users(company_id, id),
  UNIQUE (company_id, receipt_number),
  UNIQUE (company_id, id)
);
CREATE INDEX customer_receipts_customer_idx ON customer_receipts(company_id, customer_id, receipt_date DESC);

INSERT INTO permissions (code, module, action, description) VALUES
  ('sales.view','sales','view','View orders, invoices, receipts and customer ledgers'),
  ('sales.create','sales','create','Create customer orders and record receipts'),
  ('sales.post','sales','post','Issue sales invoices and post stock and ledger transactions'),
  ('accounting.view','accounting','view','View posted journal entries and customer balances')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.system_role=true AND r.code='owner' AND p.module IN ('sales','accounting')
ON CONFLICT DO NOTHING;

INSERT INTO accounts(company_id,code,name,account_type)
SELECT c.id,a.code,a.name,a.account_type FROM companies c CROSS JOIN (VALUES
  ('1100','Accounts receivable','asset'),('1110','Cash on hand','asset'),('1120','Bank and UPI','asset'),
  ('2200','Output tax payable','liability'),('4100','Sales revenue','income')
) AS a(code,name,account_type)
ON CONFLICT (company_id,code) DO NOTHING;

INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
SELECT id,'sales_order','SO-',1,5 FROM companies
ON CONFLICT DO NOTHING;
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
SELECT id,'sales_invoice','INV-',1,5 FROM companies
ON CONFLICT DO NOTHING;
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
SELECT id,'customer_receipt','RCPT-',1,5 FROM companies
ON CONFLICT DO NOTHING;
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
SELECT id,'journal_entry','JE-',1,6 FROM companies
ON CONFLICT DO NOTHING;
