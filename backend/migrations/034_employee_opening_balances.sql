CREATE TABLE employee_opening_balances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 employee_id uuid NOT NULL,
 opening_number text NOT NULL,
 opening_date date NOT NULL,
 amount numeric(14,2) NOT NULL CHECK(amount>0),
 reason text NOT NULL CHECK(length(trim(reason))>=5),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,employee_id) REFERENCES employees(company_id,id),
 FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
 UNIQUE(company_id,employee_id),
 UNIQUE(company_id,opening_number),
 UNIQUE(company_id,id)
);
CREATE INDEX employee_opening_balances_date_idx ON employee_opening_balances(company_id,opening_date);

INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
SELECT id,'employee_opening_balance','EOB-',1,5 FROM companies ON CONFLICT DO NOTHING;
INSERT INTO permissions(code,module,action,description) VALUES
 ('employees.opening.post','employees','opening_post','Post a one-time employee opening receivable')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='employees.opening.post'
WHERE r.system_role=true AND r.code='owner' ON CONFLICT DO NOTHING;
