-- Payroll and labour data must follow the branch selected for the session.
-- Existing rows stay unassigned until an administrator reviews their ownership.
ALTER TABLE employees
  ADD COLUMN branch_id uuid,
  ADD CONSTRAINT employees_branch_fk FOREIGN KEY(company_id, branch_id) REFERENCES branches(company_id, id);

ALTER TABLE attendance_records
  ADD COLUMN branch_id uuid,
  ADD CONSTRAINT attendance_branch_fk FOREIGN KEY(company_id, branch_id) REFERENCES branches(company_id, id);

ALTER TABLE employee_advances
  ADD COLUMN branch_id uuid,
  ADD CONSTRAINT employee_advances_branch_fk FOREIGN KEY(company_id, branch_id) REFERENCES branches(company_id, id);

ALTER TABLE employee_advance_repayments
  ADD COLUMN branch_id uuid,
  ADD CONSTRAINT employee_advance_repayments_branch_fk FOREIGN KEY(company_id, branch_id) REFERENCES branches(company_id, id);

ALTER TABLE salary_runs
  ADD COLUMN branch_id uuid,
  ADD CONSTRAINT salary_runs_branch_fk FOREIGN KEY(company_id, branch_id) REFERENCES branches(company_id, id);

-- A single active branch is an unambiguous legacy assignment. Multi-branch
-- company data stays unassigned for explicit Owner review.
UPDATE employees e
SET branch_id = only_branch.id
FROM (
  SELECT company_id, min(id::text)::uuid AS id
  FROM branches
  WHERE active = true
  GROUP BY company_id
  HAVING count(*) = 1
) only_branch
WHERE e.company_id = only_branch.company_id AND e.branch_id IS NULL;

UPDATE attendance_records a
SET branch_id = e.branch_id
FROM employees e
WHERE a.company_id = e.company_id AND a.employee_id = e.id AND a.branch_id IS NULL AND e.branch_id IS NOT NULL;

UPDATE employee_advances a
SET branch_id = e.branch_id
FROM employees e
WHERE a.company_id = e.company_id AND a.employee_id = e.id AND a.branch_id IS NULL AND e.branch_id IS NOT NULL;

UPDATE employee_advance_repayments a
SET branch_id = e.branch_id
FROM employees e
WHERE a.company_id = e.company_id AND a.employee_id = e.id AND a.branch_id IS NULL AND e.branch_id IS NOT NULL;

UPDATE salary_runs r
SET branch_id = run_branch.branch_id
FROM (
  SELECT l.company_id, l.salary_run_id, min(e.branch_id::text)::uuid AS branch_id
  FROM salary_run_lines l
  JOIN employees e ON e.company_id = l.company_id AND e.id = l.employee_id
  GROUP BY l.company_id, l.salary_run_id
  HAVING count(*) = count(e.branch_id) AND count(DISTINCT e.branch_id) = 1
) run_branch
WHERE r.company_id = run_branch.company_id AND r.id = run_branch.salary_run_id AND r.branch_id IS NULL;

UPDATE journal_entries je
SET branch_id = a.branch_id
FROM employee_advances a
WHERE je.company_id = a.company_id AND je.source_type = 'employee_advance' AND je.source_id = a.id AND je.branch_id IS NULL AND a.branch_id IS NOT NULL;

UPDATE journal_entries je
SET branch_id = a.branch_id
FROM employee_advance_repayments a
WHERE je.company_id = a.company_id AND je.source_type = 'employee_advance_repayment' AND je.source_id = a.id AND je.branch_id IS NULL AND a.branch_id IS NOT NULL;

UPDATE journal_entries je
SET branch_id = e.branch_id
FROM employees e
JOIN journal_entry_lines l ON l.company_id = e.company_id AND l.employee_id = e.id
WHERE je.company_id = e.company_id AND je.id = l.journal_entry_id AND je.source_type = 'employee_opening_balance'
  AND je.branch_id IS NULL AND e.branch_id IS NOT NULL;

UPDATE journal_entries je
SET branch_id = r.branch_id
FROM salary_runs r
WHERE je.company_id = r.company_id AND je.source_type = 'salary_run' AND je.source_id = r.id AND je.branch_id IS NULL AND r.branch_id IS NOT NULL;

UPDATE journal_entries je
SET branch_id = r.branch_id
FROM salary_payments p
JOIN salary_runs r ON r.company_id = p.company_id AND r.id = p.salary_run_id
WHERE je.company_id = p.company_id AND je.source_type = 'salary_payment' AND je.source_id = p.id AND je.branch_id IS NULL AND r.branch_id IS NOT NULL;

ALTER TABLE salary_runs
  DROP CONSTRAINT salary_runs_company_id_period_start_period_end_key;

CREATE UNIQUE INDEX salary_runs_company_period_uq
  ON salary_runs(company_id, period_start, period_end)
  WHERE branch_id IS NULL;
CREATE UNIQUE INDEX salary_runs_branch_period_uq
  ON salary_runs(company_id, branch_id, period_start, period_end)
  WHERE branch_id IS NOT NULL;

CREATE INDEX employees_branch_active_idx ON employees(company_id, branch_id, active, full_name);
CREATE INDEX attendance_branch_date_idx ON attendance_records(company_id, branch_id, attendance_date DESC);
CREATE INDEX employee_advances_branch_idx ON employee_advances(company_id, branch_id, employee_id, advance_date DESC);
CREATE INDEX employee_advance_repayments_branch_idx ON employee_advance_repayments(company_id, branch_id, employee_id, repayment_date DESC);
CREATE INDEX salary_runs_branch_period_idx ON salary_runs(company_id, branch_id, period_start DESC);

