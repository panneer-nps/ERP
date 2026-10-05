CREATE TABLE employee_advance_repayments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 repayment_number text NOT NULL,
 employee_id uuid NOT NULL,
 repayment_date date NOT NULL DEFAULT CURRENT_DATE,
 amount numeric(14,2) NOT NULL CHECK(amount>0),
 payment_method text NOT NULL CHECK(payment_method IN ('cash','upi','bank_transfer','cheque','other')),
 reference text,
 notes text NOT NULL DEFAULT '',
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,employee_id) REFERENCES employees(company_id,id),
 FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
 UNIQUE(company_id,repayment_number), UNIQUE(company_id,id)
);
CREATE INDEX employee_advance_repayments_employee_idx ON employee_advance_repayments(company_id,employee_id,repayment_date DESC);
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
 SELECT id,'employee_advance_repayment','AREC-',1,5 FROM companies ON CONFLICT DO NOTHING;
INSERT INTO permissions(code,module,action,description)
 VALUES('employees.advance.repay','employees','repay','Record employee advance repayment')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='employees.advance.repay'
 WHERE r.system_role=true AND r.code='owner'
ON CONFLICT DO NOTHING;
