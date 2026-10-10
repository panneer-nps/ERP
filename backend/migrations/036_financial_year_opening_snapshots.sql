CREATE TABLE financial_year_opening_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  financial_year_id uuid NOT NULL,
  source_close_id uuid,
  reason text NOT NULL CHECK (length(trim(reason)) >= 10),
  captured_by uuid,
  captured_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(company_id, financial_year_id) REFERENCES financial_years(company_id, id),
  FOREIGN KEY(company_id, source_close_id) REFERENCES financial_year_closures(company_id, id),
  FOREIGN KEY(company_id, captured_by) REFERENCES users(company_id, id),
  UNIQUE(company_id, financial_year_id),
  UNIQUE(company_id, id)
);

CREATE UNIQUE INDEX financial_year_opening_snapshots_source_close_uq
  ON financial_year_opening_snapshots(company_id, source_close_id)
  WHERE source_close_id IS NOT NULL;

CREATE TABLE financial_year_opening_snapshot_lines (
  company_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  account_id uuid NOT NULL,
  account_code text NOT NULL,
  account_name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('asset','liability','equity','income','expense')),
  opening_debit numeric(14,2) NOT NULL DEFAULT 0 CHECK (opening_debit >= 0),
  opening_credit numeric(14,2) NOT NULL DEFAULT 0 CHECK (opening_credit >= 0),
  PRIMARY KEY(company_id, snapshot_id, account_id),
  FOREIGN KEY(company_id, snapshot_id) REFERENCES financial_year_opening_snapshots(company_id, id),
  FOREIGN KEY(company_id, account_id) REFERENCES accounts(company_id, id),
  CHECK (opening_debit = 0 OR opening_credit = 0)
);

CREATE INDEX financial_year_opening_snapshot_lines_account_idx
  ON financial_year_opening_snapshot_lines(company_id, account_code);

-- Create a baseline for each company's first configured year. Later years receive
-- their immutable snapshot atomically when the preceding year is closed.
INSERT INTO financial_year_opening_snapshots(company_id, financial_year_id, reason)
SELECT fy.company_id, fy.id, 'Initial ledger balance baseline'
FROM financial_years fy
WHERE NOT EXISTS (
  SELECT 1 FROM financial_years prior
  WHERE prior.company_id = fy.company_id AND prior.ends_on = fy.starts_on - 1
);

INSERT INTO financial_year_opening_snapshot_lines(
  company_id, snapshot_id, account_id, account_code, account_name, account_type,
  opening_debit, opening_credit
)
SELECT s.company_id, s.id, a.id, a.code, a.name, a.account_type,
       GREATEST(SUM(jl.debit - jl.credit), 0)::numeric(14,2),
       GREATEST(SUM(jl.credit - jl.debit), 0)::numeric(14,2)
FROM financial_year_opening_snapshots s
JOIN financial_years fy ON fy.company_id = s.company_id AND fy.id = s.financial_year_id
JOIN accounts a ON a.company_id = s.company_id
JOIN journal_entry_lines jl ON jl.company_id = a.company_id AND jl.account_id = a.id
JOIN journal_entries je ON je.company_id = jl.company_id AND je.id = jl.journal_entry_id
WHERE je.effective_date < fy.starts_on
   OR (je.source_type = 'financial_year_close' AND je.effective_date = fy.starts_on)
GROUP BY s.company_id, s.id, a.id
HAVING ABS(SUM(jl.debit - jl.credit)) >= 0.005;
