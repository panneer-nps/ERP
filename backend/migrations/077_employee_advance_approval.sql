ALTER TABLE employee_advances
  DROP CONSTRAINT IF EXISTS employee_advances_status_check,
  ADD CONSTRAINT employee_advances_status_check CHECK(status IN ('pending_approval','posted','rejected','voided')),
  ADD COLUMN approved_by uuid,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN rejected_by uuid,
  ADD COLUMN rejected_at timestamptz,
  ADD COLUMN decision_reason text,
  ADD CONSTRAINT employee_advances_approved_by_fk FOREIGN KEY(company_id,approved_by) REFERENCES users(company_id,id),
  ADD CONSTRAINT employee_advances_rejected_by_fk FOREIGN KEY(company_id,rejected_by) REFERENCES users(company_id,id),
  ADD CONSTRAINT employee_advances_decision_reason_check CHECK(decision_reason IS NULL OR length(decision_reason) BETWEEN 5 AND 500);

CREATE INDEX employee_advances_pending_approval_idx ON employee_advances(company_id,created_at DESC) WHERE status='pending_approval';

INSERT INTO permissions(code,module,action,description) VALUES
  ('employees.advance.approve','employees','approve','Approve or reject employee advance requests')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='employees.advance.approve'
WHERE r.system_role=true AND r.code='owner'
ON CONFLICT DO NOTHING;
