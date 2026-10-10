ALTER TABLE payroll_settings
  ADD COLUMN paid_leave_days smallint NOT NULL DEFAULT 0
    CHECK (paid_leave_days BETWEEN 0 AND 31);

ALTER TABLE salary_run_lines
  ADD COLUMN paid_leave_days numeric(8,2) NOT NULL DEFAULT 0
    CHECK (paid_leave_days >= 0);
