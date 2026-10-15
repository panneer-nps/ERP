-- Approval ceilings are configured per role and monetary action. Missing limits
-- intentionally fail closed for non-Owner approval/payment actions.
CREATE TABLE role_approval_limits (
  company_id uuid NOT NULL,
  role_id uuid NOT NULL,
  permission_code text NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  max_amount numeric(14,2) NOT NULL CHECK (max_amount >= 0),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, role_id, permission_code),
  FOREIGN KEY (company_id, role_id) REFERENCES roles(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, updated_by) REFERENCES users(company_id, id)
);

COMMENT ON TABLE role_approval_limits IS
  'Owner-configured maximum INR amounts by staff role and approval/payment permission. No row means the action is blocked for non-Owners.';
