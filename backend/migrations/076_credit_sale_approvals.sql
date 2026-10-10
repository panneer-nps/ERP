ALTER TABLE sales_orders
  DROP CONSTRAINT IF EXISTS sales_orders_status_check,
  ADD CONSTRAINT sales_orders_status_check CHECK (status IN ('open','pending_approval','invoiced','cancelled','rejected')),
  ADD COLUMN credit_limit_override_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN approval_reason text,
  ADD COLUMN approved_by uuid,
  ADD COLUMN approved_at timestamptz,
  ADD CONSTRAINT sales_orders_approved_by_fk FOREIGN KEY(company_id,approved_by) REFERENCES users(company_id,id),
  ADD CONSTRAINT sales_orders_approval_reason_check CHECK(approval_reason IS NULL OR length(approval_reason) BETWEEN 5 AND 500);

CREATE INDEX sales_orders_pending_approval_idx ON sales_orders(company_id,created_at DESC) WHERE status='pending_approval';

INSERT INTO permissions(code,module,action,description) VALUES
  ('sales.approve','sales','approve','Approve credit-limit override sales orders')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='sales.approve'
WHERE r.company_id IS NOT NULL AND r.system_role=true AND r.code='owner'
ON CONFLICT DO NOTHING;
