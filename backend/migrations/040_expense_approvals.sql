ALTER TABLE expenses
  ADD COLUMN status text NOT NULL DEFAULT 'posted'
    CHECK (status IN ('pending_approval','posted','rejected')),
  ADD COLUMN approved_by uuid,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN rejected_by uuid,
  ADD COLUMN rejected_at timestamptz,
  ADD COLUMN rejection_reason text,
  ADD CONSTRAINT expenses_approved_by_fk FOREIGN KEY(company_id,approved_by) REFERENCES users(company_id,id),
  ADD CONSTRAINT expenses_rejected_by_fk FOREIGN KEY(company_id,rejected_by) REFERENCES users(company_id,id),
  ADD CONSTRAINT expenses_rejection_reason_check CHECK(rejection_reason IS NULL OR length(rejection_reason) BETWEEN 5 AND 500);

CREATE INDEX expenses_pending_approval_idx ON expenses(company_id,created_at DESC) WHERE status='pending_approval';

INSERT INTO permissions(code,module,action,description) VALUES
  ('expenses.approve','expenses','approve','Approve or reject large expenses'),
  ('expenses.configure','expenses','configure','Configure expense approval threshold'),
  ('expenses.categories.manage','expenses','manage','Manage expense categories')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.module='expenses'
WHERE r.system_role=true AND r.code='owner'
ON CONFLICT DO NOTHING;
