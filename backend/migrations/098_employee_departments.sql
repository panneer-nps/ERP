ALTER TABLE employees
  ADD COLUMN department text NOT NULL DEFAULT ''
  CHECK (char_length(department) <= 120);

ALTER TABLE salary_run_lines
  ADD COLUMN department_snapshot text NOT NULL DEFAULT ''
  CHECK (char_length(department_snapshot) <= 120);

CREATE INDEX salary_run_lines_department_idx
  ON salary_run_lines(company_id, department_snapshot, salary_run_id);
