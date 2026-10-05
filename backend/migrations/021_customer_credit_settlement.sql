CREATE TABLE customer_credit_applications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
 sales_return_id uuid NOT NULL, target_invoice_id uuid NOT NULL, applied_date date NOT NULL,
 amount numeric(14,2) NOT NULL CHECK(amount>0), reference text, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,sales_return_id) REFERENCES sales_returns(company_id,id),
 FOREIGN KEY(company_id,target_invoice_id) REFERENCES sales_invoices(company_id,id)
);
CREATE INDEX customer_credit_applications_return_idx ON customer_credit_applications(company_id,sales_return_id);
CREATE INDEX customer_credit_applications_invoice_idx ON customer_credit_applications(company_id,target_invoice_id);
CREATE TABLE customer_refunds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
 sales_return_id uuid NOT NULL, refund_number text NOT NULL, refund_date date NOT NULL,
 amount numeric(14,2) NOT NULL CHECK(amount>0), payment_method text NOT NULL CHECK(payment_method IN ('cash','upi','bank_transfer','cheque','card','other')),
 reference text, reason text NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,refund_number), FOREIGN KEY(company_id,sales_return_id) REFERENCES sales_returns(company_id,id)
);
CREATE INDEX customer_refunds_return_idx ON customer_refunds(company_id,sales_return_id);
INSERT INTO permissions(code,module,action,description) VALUES('sales.credit.settle','sales','credit_settle','Apply or refund customer credit notes') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.system_role=true AND r.code IN ('owner','admin') AND p.code='sales.credit.settle' ON CONFLICT DO NOTHING;
