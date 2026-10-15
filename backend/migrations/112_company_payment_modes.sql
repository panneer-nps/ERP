-- Company-owned configuration for the built-in payment methods.  Keeping the
-- method codes stable preserves historical rows while each company can enable
-- only the methods it accepts and route each one to its ledger account.
CREATE TABLE company_payment_modes (
  company_id uuid NOT NULL REFERENCES companies(id),
  code text NOT NULL CHECK (code IN ('cash','upi','bank_transfer','cheque','card','other')),
  account_code text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, code),
  FOREIGN KEY (company_id, account_code) REFERENCES accounts(company_id, code) ON UPDATE CASCADE ON DELETE RESTRICT
);

INSERT INTO company_payment_modes(company_id,code,account_code)
SELECT c.id,v.code,v.account_code
FROM companies c
CROSS JOIN (VALUES
  ('cash','1110'),
  ('upi','1120'),
  ('bank_transfer','1120'),
  ('cheque','1120'),
  ('card','1120'),
  ('other','1120')
) AS v(code,account_code)
JOIN accounts a ON a.company_id=c.id AND a.code=v.account_code AND a.active=true AND a.account_type='asset'
ON CONFLICT(company_id,code) DO NOTHING;
