CREATE TABLE payroll_settings (
  company_id uuid PRIMARY KEY REFERENCES companies(id),
  monthly_proration text NOT NULL DEFAULT 'fixed_days' CHECK(monthly_proration IN ('fixed_days','calendar_days','full_month')),
  monthly_work_days numeric(4,2) NOT NULL DEFAULT 26 CHECK(monthly_work_days>0 AND monthly_work_days<=31),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(company_id,updated_by) REFERENCES users(company_id,id)
);
INSERT INTO payroll_settings(company_id)
SELECT id FROM companies ON CONFLICT(company_id) DO NOTHING;
