CREATE TABLE cash_opening_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid,
  opening_number text NOT NULL,
  opening_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL CHECK (length(trim(reason)) >= 5),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id) REFERENCES companies(id),
  FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id, id),
  FOREIGN KEY (company_id, created_by) REFERENCES users(company_id, id),
  UNIQUE (company_id, id),
  UNIQUE (company_id, opening_number)
);

CREATE UNIQUE INDEX cash_opening_balances_branch_uq
  ON cash_opening_balances(company_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX cash_opening_balances_branch_date_idx
  ON cash_opening_balances(company_id, branch_id, opening_date);

INSERT INTO permissions(code, module, action, description)
VALUES ('cash.opening.post', 'accounting', 'cash_opening_post', 'Post the one-time opening balance for the cash ledger')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'cash.opening.post'
WHERE r.system_role = true AND r.code IN ('owner', 'accountant')
ON CONFLICT DO NOTHING;

INSERT INTO number_sequences(company_id, document_type, prefix, next_value, padding)
SELECT id, 'cash_opening_balance', 'COB-', 1, 5
FROM companies
ON CONFLICT DO NOTHING;
