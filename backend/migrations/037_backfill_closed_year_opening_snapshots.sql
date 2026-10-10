INSERT INTO financial_year_opening_snapshots(company_id, financial_year_id, source_close_id, reason, captured_by)
SELECT fy.company_id, fy.id, c.id,
       'Opening balances carried forward from ' || c.close_number || ': ' || c.reason,
       c.closed_by
FROM financial_years fy
JOIN financial_year_closures c
  ON c.company_id = fy.company_id AND c.next_financial_year_id = fy.id
WHERE NOT EXISTS (
  SELECT 1 FROM financial_year_opening_snapshots s
  WHERE s.company_id = fy.company_id AND s.financial_year_id = fy.id
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
JOIN financial_year_closures c ON c.company_id = s.company_id AND c.id = s.source_close_id
JOIN accounts a ON a.company_id = s.company_id
JOIN journal_entry_lines jl ON jl.company_id = a.company_id AND jl.account_id = a.id
JOIN journal_entries je ON je.company_id = jl.company_id AND je.id = jl.journal_entry_id
WHERE je.effective_date < fy.starts_on
   OR (je.source_type = 'financial_year_close' AND je.effective_date = fy.starts_on)
GROUP BY s.company_id, s.id, a.id
HAVING ABS(SUM(jl.debit - jl.credit)) >= 0.005
ON CONFLICT(company_id, snapshot_id, account_id) DO NOTHING;
