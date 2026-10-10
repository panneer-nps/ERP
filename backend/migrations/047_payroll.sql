ALTER TABLE employees
  ADD COLUMN salary_type text NOT NULL DEFAULT 'daily' CHECK(salary_type IN ('daily','monthly','piece_rate')),
  ADD COLUMN monthly_salary numeric(14,2) NOT NULL DEFAULT 0 CHECK(monthly_salary>=0),
  ADD COLUMN piece_rate numeric(14,4) NOT NULL DEFAULT 0 CHECK(piece_rate>=0),
  ADD COLUMN overtime_hourly_rate numeric(14,2) NOT NULL DEFAULT 0 CHECK(overtime_hourly_rate>=0);

CREATE TABLE salary_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  run_number text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'pending_approval' CHECK(status IN ('pending_approval','approved','partially_paid','paid','rejected')),
  total_gross numeric(14,2) NOT NULL DEFAULT 0 CHECK(total_gross>=0),
  total_deductions numeric(14,2) NOT NULL DEFAULT 0 CHECK(total_deductions>=0),
  total_advance_recovery numeric(14,2) NOT NULL DEFAULT 0 CHECK(total_advance_recovery>=0),
  total_net numeric(14,2) NOT NULL DEFAULT 0 CHECK(total_net>=0),
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
  FOREIGN KEY(company_id,approved_by) REFERENCES users(company_id,id),
  UNIQUE(company_id,run_number),
  UNIQUE(company_id,period_start,period_end),
  UNIQUE(company_id,id),
  CHECK(period_end>=period_start)
);

CREATE TABLE salary_run_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  salary_run_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  salary_type text NOT NULL CHECK(salary_type IN ('daily','monthly','piece_rate')),
  present_days numeric(8,2) NOT NULL DEFAULT 0 CHECK(present_days>=0),
  half_days numeric(8,2) NOT NULL DEFAULT 0 CHECK(half_days>=0),
  overtime_hours numeric(8,2) NOT NULL DEFAULT 0 CHECK(overtime_hours>=0),
  piece_quantity numeric(14,2) NOT NULL DEFAULT 0 CHECK(piece_quantity>=0),
  base_earnings numeric(14,2) NOT NULL CHECK(base_earnings>=0),
  overtime_earnings numeric(14,2) NOT NULL DEFAULT 0 CHECK(overtime_earnings>=0),
  bonus numeric(14,2) NOT NULL DEFAULT 0 CHECK(bonus>=0),
  other_deductions numeric(14,2) NOT NULL DEFAULT 0 CHECK(other_deductions>=0),
  advance_recovery numeric(14,2) NOT NULL DEFAULT 0 CHECK(advance_recovery>=0),
  net_pay numeric(14,2) NOT NULL CHECK(net_pay>=0),
  paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK(paid_amount>=0 AND paid_amount<=net_pay),
  adjustment_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(company_id,salary_run_id) REFERENCES salary_runs(company_id,id),
  FOREIGN KEY(company_id,employee_id) REFERENCES employees(company_id,id),
  UNIQUE(company_id,salary_run_id,employee_id),
  UNIQUE(company_id,id)
);
CREATE INDEX salary_run_lines_employee_idx ON salary_run_lines(company_id,employee_id,salary_run_id);

CREATE TABLE salary_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  salary_run_id uuid NOT NULL,
  salary_run_line_id uuid NOT NULL,
  payment_number text NOT NULL,
  payment_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK(amount>0),
  payment_method text NOT NULL CHECK(payment_method IN ('cash','upi','bank_transfer','cheque','other')),
  reference text,
  notes text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(company_id,salary_run_id) REFERENCES salary_runs(company_id,id),
  FOREIGN KEY(company_id,salary_run_line_id) REFERENCES salary_run_lines(company_id,id),
  FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
  UNIQUE(company_id,payment_number),
  UNIQUE(company_id,id)
);

INSERT INTO accounts(company_id,code,name,account_type,group_id,system_managed)
SELECT c.id,v.code,v.name,v.account_type,g.id,true
FROM companies c
CROSS JOIN (VALUES ('2400','Payroll deductions payable','liability'),('2500','Salaries payable','liability'),('5400','Salary expense','expense')) v(code,name,account_type)
JOIN account_groups g ON g.company_id=c.id AND g.account_type=v.account_type AND g.code=CASE v.account_type WHEN 'expense' THEN 'EXPENSES' ELSE 'LIABILITIES' END
ON CONFLICT(company_id,code) DO NOTHING;

INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
SELECT id,'salary_run','PAY-',1,5 FROM companies ON CONFLICT DO NOTHING;
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
SELECT id,'salary_payment','SAL-',1,5 FROM companies ON CONFLICT DO NOTHING;

INSERT INTO permissions(code,module,action,description) VALUES
 ('payroll.view','payroll','view','View salary runs and employee payroll'),
 ('payroll.create','payroll','create','Calculate and submit salary runs'),
 ('payroll.configure','payroll','configure','Configure employee pay rates'),
 ('payroll.approve','payroll','approve','Approve salary runs'),
 ('payroll.pay','payroll','pay','Pay approved salary runs')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code LIKE 'payroll.%'
WHERE r.system_role=true AND r.code='owner' ON CONFLICT DO NOTHING;
