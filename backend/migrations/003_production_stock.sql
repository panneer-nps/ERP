CREATE TABLE production_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  batch_code text NOT NULL,
  chamber_id uuid NOT NULL,
  product_id uuid NOT NULL,
  started_on date NOT NULL DEFAULT CURRENT_DATE,
  planned_quantity numeric(14,2) NOT NULL DEFAULT 0 CHECK (planned_quantity >= 0),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','running','completed','cancelled')),
  good_quantity numeric(14,2),
  second_quantity numeric(14,2),
  broken_quantity numeric(14,2),
  rejected_quantity numeric(14,2),
  completed_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, chamber_id) REFERENCES chambers(company_id, id),
  FOREIGN KEY (company_id, product_id) REFERENCES products(company_id, id),
  FOREIGN KEY (company_id, created_by) REFERENCES users(company_id, id),
  UNIQUE (company_id, id),
  UNIQUE (company_id, batch_code)
);
CREATE INDEX production_batches_recent_idx ON production_batches(company_id, started_on DESC, created_at DESC);

CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  product_id uuid NOT NULL,
  batch_id uuid,
  movement_type text NOT NULL CHECK (movement_type IN ('production_in','sale_out','customer_return','damage','adjustment','purchase_in')),
  quality text NOT NULL DEFAULT 'good' CHECK (quality IN ('good','second','broken','rejected')),
  direction text NOT NULL CHECK (direction IN ('in','out')),
  quantity numeric(14,2) NOT NULL CHECK (quantity > 0),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, product_id) REFERENCES products(company_id, id),
  FOREIGN KEY (company_id, batch_id) REFERENCES production_batches(company_id, id),
  FOREIGN KEY (company_id, actor_user_id) REFERENCES users(company_id, id)
);
CREATE INDEX stock_movements_balance_idx ON stock_movements(company_id, product_id, quality, occurred_at);
CREATE INDEX stock_movements_batch_idx ON stock_movements(company_id, batch_id);

INSERT INTO permissions (code, module, action, description) VALUES
  ('production.view', 'production', 'view', 'View production batches'),
  ('production.create', 'production', 'create', 'Create production batches'),
  ('production.post', 'production', 'post', 'Complete batches and post production stock'),
  ('stock.view', 'stock', 'view', 'View stock balances and movements')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.system_role = true AND r.code = 'owner' AND p.module IN ('production','stock')
ON CONFLICT DO NOTHING;
