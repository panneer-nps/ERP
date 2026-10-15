-- Restore double-entry records for legacy posted expenses created before the
-- expense route wrote journals. Only backfill expenses whose date and ledger
-- accounts are safe to post under the current period controls.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM expenses e
    WHERE e.status = 'posted'
      AND NOT EXISTS (
        SELECT 1
        FROM journal_entries je
        WHERE je.company_id = e.company_id
          AND je.source_type = 'expense'
          AND je.source_id = e.id
      )
      AND (
        (SELECT count(*) FROM financial_years fy
         WHERE fy.company_id = e.company_id
           AND e.expense_date BETWEEN fy.starts_on AND fy.ends_on) <> 1
        OR NOT EXISTS (
          SELECT 1 FROM financial_years fy
          WHERE fy.company_id = e.company_id
            AND e.expense_date BETWEEN fy.starts_on AND fy.ends_on
            AND fy.status = 'open'
        )
        OR EXISTS (
          SELECT 1 FROM accounting_period_closures pc
          WHERE pc.company_id = e.company_id
            AND e.expense_date BETWEEN pc.period_start AND pc.period_end
        )
        OR NOT EXISTS (
          SELECT 1
          FROM expense_categories ec
          JOIN accounts a ON a.company_id = ec.company_id
            AND a.code = ec.account_code AND a.active = true
          WHERE ec.company_id = e.company_id AND ec.id = e.category_id
        )
        OR NOT EXISTS (
          SELECT 1 FROM accounts a
          WHERE a.company_id = e.company_id
            AND a.code = CASE WHEN e.payment_method = 'cash' THEN '1110' ELSE '1120' END
            AND a.active = true
        )
        OR (e.payment_method = 'cash' AND EXISTS (
          SELECT 1 FROM cash_closings cc
          WHERE cc.company_id = e.company_id AND cc.status = 'approved'
            AND cc.closing_date >= e.expense_date
        ))
        OR (e.payment_method <> 'cash' AND EXISTS (
          SELECT 1 FROM bank_reconciliations br
          WHERE br.company_id = e.company_id AND br.status = 'reconciled'
            AND e.expense_date BETWEEN br.period_from AND br.period_to
        ))
        OR EXISTS (
          SELECT 1 FROM journal_entries je
          WHERE je.company_id = e.company_id
            AND je.entry_number = 'LEGACY-EXP-' || e.expense_number
        )
      )
  ) THEN
    RAISE EXCEPTION 'Posted expenses without journals cannot be safely backfilled. Resolve closed/ambiguous periods, missing accounts, or journal-number collisions with the Owner/accountant, then rerun migration 111.';
  END IF;
END $$;

INSERT INTO journal_entries (
  company_id, entry_number, source_type, source_id, description,
  effective_date, financial_year_id, posted_by, branch_id
)
SELECT e.company_id,
  'LEGACY-EXP-' || e.expense_number,
  'expense', e.id,
  'Expense ' || e.expense_number || ': ' || e.description,
  e.expense_date, fy.id, COALESCE(e.approved_by, e.created_by), e.branch_id
FROM expenses e
JOIN financial_years fy ON fy.company_id = e.company_id
  AND e.expense_date BETWEEN fy.starts_on AND fy.ends_on
  AND fy.status = 'open'
JOIN expense_categories ec ON ec.company_id = e.company_id AND ec.id = e.category_id
JOIN accounts expense_account ON expense_account.company_id = ec.company_id
  AND expense_account.code = ec.account_code AND expense_account.active = true
JOIN accounts payment_account ON payment_account.company_id = e.company_id
  AND payment_account.code = CASE WHEN e.payment_method = 'cash' THEN '1110' ELSE '1120' END
  AND payment_account.active = true
WHERE e.status = 'posted'
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.company_id = e.company_id
      AND je.source_type = 'expense'
      AND je.source_id = e.id
  );

INSERT INTO journal_entry_lines (
  company_id, journal_entry_id, line_number, account_id,
  description, debit, credit
)
SELECT e.company_id, je.id, 1, a.id,
  ec.name || ' · ' || e.expense_number, e.amount, 0
FROM expenses e
JOIN journal_entries je ON je.company_id = e.company_id
  AND je.source_type = 'expense' AND je.source_id = e.id
  AND je.entry_number = 'LEGACY-EXP-' || e.expense_number
JOIN expense_categories ec ON ec.company_id = e.company_id AND ec.id = e.category_id
JOIN accounts a ON a.company_id = ec.company_id AND a.code = ec.account_code
WHERE e.status = 'posted'
  AND NOT EXISTS (
    SELECT 1 FROM journal_entry_lines jl
    WHERE jl.journal_entry_id = je.id AND jl.line_number = 1
  );

INSERT INTO journal_entry_lines (
  company_id, journal_entry_id, line_number, account_id,
  description, debit, credit
)
SELECT e.company_id, je.id, 2, a.id,
  'Payment · ' || e.expense_number, 0, e.amount
FROM expenses e
JOIN journal_entries je ON je.company_id = e.company_id
  AND je.source_type = 'expense' AND je.source_id = e.id
  AND je.entry_number = 'LEGACY-EXP-' || e.expense_number
JOIN accounts a ON a.company_id = e.company_id
  AND a.code = CASE WHEN e.payment_method = 'cash' THEN '1110' ELSE '1120' END
WHERE e.status = 'posted'
  AND NOT EXISTS (
    SELECT 1 FROM journal_entry_lines jl
    WHERE jl.journal_entry_id = je.id AND jl.line_number = 2
  );

INSERT INTO audit_logs (
  company_id, branch_id, actor_user_id, action, entity_type, entity_id,
  reason, after_data
)
SELECT e.company_id, e.branch_id, NULL, 'expense.journal.backfill', 'expense', e.id::text,
  'Legacy posted expense journal recovery by migration 111.',
  jsonb_build_object(
    'expenseNumber', e.expense_number,
    'journalEntryNumber', je.entry_number,
    'expenseDate', e.expense_date,
    'amount', e.amount,
    'paymentMethod', e.payment_method
  )
FROM expenses e
JOIN journal_entries je ON je.company_id = e.company_id
  AND je.source_type = 'expense' AND je.source_id = e.id
  AND je.entry_number = 'LEGACY-EXP-' || e.expense_number
WHERE e.status = 'posted'
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs al
    WHERE al.company_id = e.company_id
      AND al.entity_type = 'expense' AND al.entity_id = e.id::text
      AND al.action = 'expense.journal.backfill'
  );
