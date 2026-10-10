ALTER TABLE cash_closings ADD COLUMN branch_id uuid;
ALTER TABLE cash_closings ADD CONSTRAINT cash_closings_branch_fk
  FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id);
ALTER TABLE cash_closings DROP CONSTRAINT cash_closings_company_id_closing_date_key;
CREATE UNIQUE INDEX cash_closings_branch_date_uq ON cash_closings(company_id,closing_date,COALESCE(branch_id,'00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX cash_closings_branch_recent_idx ON cash_closings(company_id,branch_id,closing_date DESC);

CREATE OR REPLACE FUNCTION revert_cash_closing_branch_scope() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM cash_closings GROUP BY company_id,closing_date HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Cash close dates overlap across branches; resolve duplicates before reverting branch scope.';
  END IF;
  UPDATE journal_entries SET branch_id=NULL WHERE source_type='cash_closing';
  DROP INDEX IF EXISTS cash_closings_branch_date_uq;
  DROP INDEX IF EXISTS cash_closings_branch_recent_idx;
  ALTER TABLE cash_closings DROP CONSTRAINT IF EXISTS cash_closings_branch_fk;
  ALTER TABLE cash_closings DROP COLUMN IF EXISTS branch_id;
  ALTER TABLE cash_closings ADD CONSTRAINT cash_closings_company_id_closing_date_key UNIQUE(company_id,closing_date);
END;
$$;
