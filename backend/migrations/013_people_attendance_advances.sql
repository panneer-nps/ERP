CREATE TABLE employees (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 employee_number text NOT NULL,
 full_name text NOT NULL,
 phone text,
 email text,
 job_title text NOT NULL DEFAULT '',
 employment_type text NOT NULL DEFAULT 'staff' CHECK(employment_type IN ('staff','labour','driver','supervisor','other')),
 joined_on date NOT NULL DEFAULT CURRENT_DATE,
 base_daily_rate numeric(14,2) NOT NULL DEFAULT 0 CHECK(base_daily_rate>=0),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,employee_number), UNIQUE(company_id,id)
);
CREATE INDEX employees_search_idx ON employees(company_id,lower(full_name));

CREATE TABLE attendance_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 employee_id uuid NOT NULL,
 attendance_date date NOT NULL,
 status text NOT NULL CHECK(status IN ('present','half_day','absent','leave')),
 overtime_hours numeric(6,2) NOT NULL DEFAULT 0 CHECK(overtime_hours>=0),
 notes text NOT NULL DEFAULT '',
 recorded_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,employee_id) REFERENCES employees(company_id,id),
 FOREIGN KEY(company_id,recorded_by) REFERENCES users(company_id,id),
 UNIQUE(company_id,employee_id,attendance_date), UNIQUE(company_id,id)
);
CREATE INDEX attendance_date_idx ON attendance_records(company_id,attendance_date DESC);

CREATE TABLE employee_advances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 advance_number text NOT NULL,
 employee_id uuid NOT NULL,
 advance_date date NOT NULL DEFAULT CURRENT_DATE,
 amount numeric(14,2) NOT NULL CHECK(amount>0),
 payment_method text NOT NULL CHECK(payment_method IN ('cash','upi','bank_transfer','cheque','other')),
 reference text,
 notes text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','voided')),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,employee_id) REFERENCES employees(company_id,id),
 FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
 UNIQUE(company_id,advance_number), UNIQUE(company_id,id)
);
CREATE INDEX employee_advances_employee_idx ON employee_advances(company_id,employee_id,advance_date DESC);

ALTER TABLE journal_entry_lines ADD COLUMN employee_id uuid;
ALTER TABLE journal_entry_lines ADD CONSTRAINT journal_entry_lines_employee_fk FOREIGN KEY(company_id,employee_id) REFERENCES employees(company_id,id);
CREATE INDEX journal_lines_employee_ledger_idx ON journal_entry_lines(company_id,employee_id,journal_entry_id);

INSERT INTO accounts(company_id,code,name,account_type)
 SELECT id,'1400','Employee advances','asset' FROM companies ON CONFLICT(company_id,code) DO NOTHING;
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
 SELECT id,'employee_advance','ADV-',1,5 FROM companies ON CONFLICT DO NOTHING;
INSERT INTO permissions(code,module,action,description) VALUES
 ('employees.view','employees','view','View employee and attendance records'),
 ('employees.create','employees','create','Create employee records'),
 ('attendance.view','attendance','view','View attendance records'),
 ('attendance.record','attendance','record','Record employee attendance'),
 ('employees.advance.view','employees','view','View employee advances'),
 ('employees.advance.post','employees','post','Issue employee advances')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
 WHERE r.system_role=true AND r.code='owner' AND p.code IN ('employees.view','employees.create','attendance.view','attendance.record','employees.advance.view','employees.advance.post')
ON CONFLICT DO NOTHING;