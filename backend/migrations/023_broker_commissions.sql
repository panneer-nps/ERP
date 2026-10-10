ALTER TABLE sales_orders
 ADD COLUMN broker_commission_type text CHECK (broker_commission_type IN ('per_brick','per_1000','per_load','percentage','fixed')),
 ADD COLUMN broker_commission_rate numeric(14,4) CHECK (broker_commission_rate IS NULL OR broker_commission_rate>=0),
 ADD COLUMN broker_commission_event text CHECK (broker_commission_event IS NULL OR broker_commission_event IN ('invoice','delivery','payment','approval'));
ALTER TABLE journal_entry_lines ADD COLUMN broker_id uuid;
ALTER TABLE journal_entry_lines ADD CONSTRAINT journal_lines_broker_fk FOREIGN KEY(company_id,broker_id) REFERENCES business_partners(company_id,id);
CREATE INDEX journal_lines_broker_ledger_idx ON journal_entry_lines(company_id,broker_id,journal_entry_id);
CREATE TABLE broker_commission_rules (
 company_id uuid NOT NULL REFERENCES companies(id), broker_id uuid NOT NULL, commission_type text NOT NULL CHECK(commission_type IN ('per_brick','per_1000','per_load','percentage','fixed')),
 rate numeric(14,4) NOT NULL CHECK(rate>=0), accrual_event text NOT NULL CHECK(accrual_event IN ('invoice','delivery','payment','approval')),
 updated_by uuid NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(company_id,broker_id),
 FOREIGN KEY(company_id,broker_id) REFERENCES business_partners(company_id,id)
);
CREATE TABLE broker_commissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), invoice_id uuid NOT NULL,
 broker_id uuid NOT NULL, commission_type text NOT NULL CHECK(commission_type IN ('per_brick','per_1000','per_load','percentage','fixed')),
 rate numeric(14,4) NOT NULL CHECK(rate>=0), quantity numeric(14,2) NOT NULL CHECK(quantity>0), basis_amount numeric(14,2) NOT NULL CHECK(basis_amount>=0),
 accrual_event text NOT NULL CHECK(accrual_event IN ('invoice','delivery','payment','approval')),
 commission_amount numeric(14,2) NOT NULL CHECK(commission_amount>=0), accrued_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK(accrued_amount>=0 AND accrued_amount<=commission_amount),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,invoice_id) REFERENCES sales_invoices(company_id,id), FOREIGN KEY(company_id,broker_id) REFERENCES business_partners(company_id,id),
 UNIQUE(company_id,invoice_id), UNIQUE(company_id,id)
);
CREATE INDEX broker_commissions_ledger_idx ON broker_commissions(company_id,broker_id,created_at DESC);
CREATE TABLE broker_commission_accruals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), commission_id uuid NOT NULL,
 source_type text NOT NULL, source_id uuid NOT NULL, amount numeric(14,2) NOT NULL CHECK(amount>0), accrued_date date NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,commission_id) REFERENCES broker_commissions(company_id,id), UNIQUE(company_id,source_type,source_id)
);
CREATE TABLE broker_commission_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), payment_number text NOT NULL,
 commission_id uuid NOT NULL, payment_date date NOT NULL, amount numeric(14,2) NOT NULL CHECK(amount>0),
 payment_method text NOT NULL CHECK(payment_method IN ('cash','upi','bank_transfer','cheque','card','other')), reference text,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,commission_id) REFERENCES broker_commissions(company_id,id), UNIQUE(company_id,payment_number)
);
CREATE INDEX broker_commission_payments_commission_idx ON broker_commission_payments(company_id,commission_id,payment_date DESC);
INSERT INTO accounts(company_id,code,name,account_type)
 SELECT c.id,a.code,a.name,a.account_type FROM companies c CROSS JOIN (VALUES('2150','Broker commission payable','liability'),('5300','Broker commission expense','expense')) a(code,name,account_type)
 ON CONFLICT(company_id,code) DO NOTHING;
INSERT INTO permissions(code,module,action,description) VALUES
 ('brokers.commission.view','brokers','commission_view','View broker commission accruals and payments'),
 ('brokers.commission.configure','brokers','commission_configure','Configure broker commission rules'),
 ('brokers.commission.approve','brokers','commission_approve','Approve broker commissions'),
 ('brokers.commission.pay','brokers','commission_pay','Record broker commission payments') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.system_role=true AND r.code='owner' AND p.code LIKE 'brokers.commission.%' ON CONFLICT DO NOTHING;
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding) SELECT id,'broker_commission_payment','BCPAY-',1,5 FROM companies ON CONFLICT DO NOTHING;
