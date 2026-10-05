CREATE TABLE expense_categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 code text NOT NULL,
 name text NOT NULL,
 account_code text NOT NULL DEFAULT '5100',
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,account_code) REFERENCES accounts(company_id,code),
 UNIQUE(company_id,code), UNIQUE(company_id,id)
);
CREATE TABLE expenses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 expense_number text NOT NULL,
 category_id uuid NOT NULL,
 expense_date date NOT NULL DEFAULT CURRENT_DATE,
 amount numeric(14,2) NOT NULL CHECK(amount>0),
 payment_method text NOT NULL CHECK(payment_method IN ('cash','upi','bank_transfer','cheque','card','other')),
 description text NOT NULL,
 reference text,
 branch_id uuid,
 chamber_id uuid,
 batch_id uuid,
 vehicle_reference text,
 employee_reference text,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,category_id) REFERENCES expense_categories(company_id,id),
 FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id),
 FOREIGN KEY(company_id,chamber_id) REFERENCES chambers(company_id,id),
 FOREIGN KEY(company_id,batch_id) REFERENCES production_batches(company_id,id),
 FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
 UNIQUE(company_id,expense_number), UNIQUE(company_id,id)
);
CREATE INDEX expenses_date_idx ON expenses(company_id,expense_date DESC,created_at DESC);
INSERT INTO accounts(company_id,code,name,account_type) SELECT id,'5100','Operating expenses','expense' FROM companies ON CONFLICT(company_id,code) DO NOTHING;
INSERT INTO expense_categories(company_id,code,name) SELECT c.id,x.code,x.name FROM companies c CROSS JOIN (VALUES
 ('FUEL','Fuel and energy'),('UTILITIES','Utilities'),('MAINTENANCE','Repairs and maintenance'),('TRANSPORT','Transport'),('OFFICE','Office and administration'),('OTHER','Other operating expense')
) AS x(code,name) ON CONFLICT(company_id,code) DO NOTHING;
INSERT INTO permissions(code,module,action,description) VALUES
 ('expenses.view','expenses','view','View expense records'),('expenses.create','expenses','create','Record operating expenses') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.system_role=true AND r.code='owner' AND p.module='expenses' ON CONFLICT DO NOTHING;
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding) SELECT id,'expense','EXP-',1,5 FROM companies ON CONFLICT DO NOTHING;
