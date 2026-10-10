ALTER TABLE bank_opening_balances ADD COLUMN branch_id uuid;
ALTER TABLE bank_opening_balances ADD CONSTRAINT bank_opening_balances_branch_fk
  FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id);
ALTER TABLE bank_opening_balances DROP CONSTRAINT bank_opening_balances_company_id_key;
CREATE UNIQUE INDEX bank_opening_balances_branch_uq ON bank_opening_balances(company_id,COALESCE(branch_id,'00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE bank_reconciliations ADD COLUMN branch_id uuid;
ALTER TABLE bank_reconciliations ADD CONSTRAINT bank_reconciliations_branch_fk
  FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id);
CREATE INDEX bank_reconciliations_branch_period_idx ON bank_reconciliations(company_id,branch_id,period_from,period_to);

CREATE OR REPLACE FUNCTION enforce_bank_reconciliation_branch_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rec_branch uuid; source_branch uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('bank-reconciliation-overlap:'||NEW.company_id::text,0));
  IF EXISTS(
    SELECT 1 FROM bank_reconciliations r
    WHERE r.company_id=NEW.company_id AND r.id IS DISTINCT FROM NEW.id
      AND (NEW.branch_id IS NULL OR r.branch_id IS NULL OR r.branch_id=NEW.branch_id)
      AND daterange(r.period_from,r.period_to,'[]') && daterange(NEW.period_from,NEW.period_to,'[]')
  ) THEN
    RAISE EXCEPTION 'bank reconciliation period overlaps an existing period for this branch' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bank_reconciliation_branch_overlap
  BEFORE INSERT OR UPDATE OF period_from,period_to,branch_id ON bank_reconciliations
  FOR EACH ROW EXECUTE FUNCTION enforce_bank_reconciliation_branch_scope();

CREATE OR REPLACE FUNCTION enforce_bank_match_branch_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rec_branch uuid; source_branch uuid;
BEGIN
  IF NEW.matched_journal_line_id IS NULL THEN RETURN NEW; END IF;
  SELECT branch_id INTO rec_branch FROM bank_reconciliations WHERE company_id=NEW.company_id AND id=NEW.reconciliation_id;
  SELECT je.branch_id INTO source_branch FROM journal_entry_lines jl
    JOIN journal_entries je ON je.company_id=jl.company_id AND je.id=jl.journal_entry_id
    WHERE jl.company_id=NEW.company_id AND jl.id=NEW.matched_journal_line_id;
  IF rec_branch IS NOT NULL AND source_branch IS NOT NULL AND rec_branch<>source_branch THEN
    RAISE EXCEPTION 'matched bank transaction belongs to another branch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bank_reconciliation_match_branch
  BEFORE INSERT OR UPDATE OF reconciliation_id,matched_journal_line_id ON bank_reconciliation_lines
  FOR EACH ROW EXECUTE FUNCTION enforce_bank_match_branch_scope();

CREATE OR REPLACE FUNCTION revert_bank_reconciliation_branch_scope() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM bank_opening_balances GROUP BY company_id HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Multiple bank opening balances exist for a company; resolve them before reverting branch scope.';
  END IF;
  DROP TRIGGER IF EXISTS bank_reconciliation_branch_overlap ON bank_reconciliations;
  DROP TRIGGER IF EXISTS bank_reconciliation_match_branch ON bank_reconciliation_lines;
  DROP FUNCTION IF EXISTS enforce_bank_reconciliation_branch_scope();
  DROP FUNCTION IF EXISTS enforce_bank_match_branch_scope();
  UPDATE journal_entries SET branch_id=NULL WHERE source_type='bank_opening_balance';
  DROP INDEX IF EXISTS bank_opening_balances_branch_uq;
  ALTER TABLE bank_opening_balances DROP CONSTRAINT IF EXISTS bank_opening_balances_branch_fk;
  ALTER TABLE bank_opening_balances DROP COLUMN IF EXISTS branch_id;
  ALTER TABLE bank_opening_balances ADD CONSTRAINT bank_opening_balances_company_id_key UNIQUE(company_id);
  DROP INDEX IF EXISTS bank_reconciliations_branch_period_idx;
  ALTER TABLE bank_reconciliations DROP CONSTRAINT IF EXISTS bank_reconciliations_branch_fk;
  ALTER TABLE bank_reconciliations DROP COLUMN IF EXISTS branch_id;
END;
$$;
