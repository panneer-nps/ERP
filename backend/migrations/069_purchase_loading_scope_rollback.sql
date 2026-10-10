CREATE OR REPLACE FUNCTION revert_purchase_loading_branch_scope() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DROP TRIGGER IF EXISTS purchase_receipts_branch_consistency ON purchase_receipts;
  DROP TRIGGER IF EXISTS purchase_bills_branch_consistency ON purchase_bills;
  DROP TRIGGER IF EXISTS purchase_returns_branch_consistency ON purchase_returns;
  DROP TRIGGER IF EXISTS supplier_payments_branch_consistency ON supplier_payments;
  DROP TRIGGER IF EXISTS purchase_return_allocations_branch_consistency ON purchase_return_allocations;
  DROP TRIGGER IF EXISTS loading_sessions_branch_consistency ON loading_sessions;
  DROP FUNCTION IF EXISTS enforce_purchase_branch_consistency();

  UPDATE journal_entries SET branch_id=NULL WHERE source_type IN ('purchase_receipt','purchase_bill','supplier_payment','purchase_return');

  ALTER TABLE purchase_receipts DROP CONSTRAINT IF EXISTS purchase_receipts_branch_fk;
  DROP INDEX IF EXISTS purchase_receipts_branch_recent_idx;
  ALTER TABLE purchase_receipts DROP COLUMN IF EXISTS branch_id;
  ALTER TABLE purchase_bills DROP CONSTRAINT IF EXISTS purchase_bills_branch_fk;
  DROP INDEX IF EXISTS purchase_bills_branch_recent_idx;
  ALTER TABLE purchase_bills DROP COLUMN IF EXISTS branch_id;
  ALTER TABLE supplier_payments DROP CONSTRAINT IF EXISTS supplier_payments_branch_fk;
  DROP INDEX IF EXISTS supplier_payments_branch_recent_idx;
  ALTER TABLE supplier_payments DROP COLUMN IF EXISTS branch_id;
  ALTER TABLE purchase_returns DROP CONSTRAINT IF EXISTS purchase_returns_branch_fk;
  DROP INDEX IF EXISTS purchase_returns_branch_recent_idx;
  ALTER TABLE purchase_returns DROP COLUMN IF EXISTS branch_id;
  ALTER TABLE purchase_return_allocations DROP CONSTRAINT IF EXISTS purchase_return_allocations_branch_fk;
  DROP INDEX IF EXISTS purchase_return_allocations_branch_idx;
  ALTER TABLE purchase_return_allocations DROP COLUMN IF EXISTS branch_id;
  ALTER TABLE loading_sessions DROP CONSTRAINT IF EXISTS loading_sessions_branch_fk;
  DROP INDEX IF EXISTS loading_sessions_branch_recent_idx;
  ALTER TABLE loading_sessions DROP COLUMN IF EXISTS branch_id;
  ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_branch_fk;
  DROP INDEX IF EXISTS purchase_orders_branch_recent_idx;
  ALTER TABLE purchase_orders DROP COLUMN IF EXISTS branch_id;
END;
$$;
