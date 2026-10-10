CREATE OR REPLACE FUNCTION revert_sales_settlement_branch_scope() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DROP TRIGGER IF EXISTS sales_invoice_reversals_branch_consistency ON sales_invoice_reversals;
  DROP TRIGGER IF EXISTS customer_refunds_branch_consistency ON customer_refunds;
  DROP TRIGGER IF EXISTS customer_credit_applications_branch_consistency ON customer_credit_applications;
  DROP TRIGGER IF EXISTS customer_receipt_allocations_branch_consistency ON customer_receipt_allocations;
  CREATE OR REPLACE FUNCTION enforce_sales_branch_consistency() RETURNS trigger LANGUAGE plpgsql AS $inner$
  DECLARE parent_branch uuid;
  BEGIN
    IF TG_TABLE_NAME='sales_invoices' THEN
      SELECT branch_id INTO parent_branch FROM sales_orders WHERE company_id=NEW.company_id AND id=NEW.order_id;
    ELSIF TG_TABLE_NAME='sales_returns' THEN
      SELECT branch_id INTO parent_branch FROM sales_invoices WHERE company_id=NEW.company_id AND id=NEW.invoice_id;
    ELSIF TG_TABLE_NAME='customer_receipts' AND NEW.invoice_id IS NOT NULL THEN
      SELECT branch_id INTO parent_branch FROM sales_invoices WHERE company_id=NEW.company_id AND id=NEW.invoice_id;
    ELSE
      RETURN NEW;
    END IF;
    IF NEW.branch_id IS DISTINCT FROM parent_branch THEN RAISE EXCEPTION 'sales document branch must match its parent'; END IF;
    RETURN NEW;
  END;
  $inner$;
  ALTER TABLE sales_invoice_reversals DROP CONSTRAINT IF EXISTS sales_invoice_reversals_branch_fk;
  DROP INDEX IF EXISTS sales_invoice_reversals_branch_idx;
  ALTER TABLE sales_invoice_reversals DROP COLUMN IF EXISTS branch_id;
  ALTER TABLE customer_refunds DROP CONSTRAINT IF EXISTS customer_refunds_branch_fk;
  DROP INDEX IF EXISTS customer_refunds_branch_idx;
  ALTER TABLE customer_refunds DROP COLUMN IF EXISTS branch_id;
  ALTER TABLE customer_credit_applications DROP CONSTRAINT IF EXISTS customer_credit_applications_branch_fk;
  DROP INDEX IF EXISTS customer_credit_applications_branch_idx;
  ALTER TABLE customer_credit_applications DROP COLUMN IF EXISTS branch_id;
  ALTER TABLE customer_receipt_allocations DROP CONSTRAINT IF EXISTS customer_receipt_allocations_branch_fk;
  DROP INDEX IF EXISTS customer_receipt_allocations_branch_idx;
  ALTER TABLE customer_receipt_allocations DROP COLUMN IF EXISTS branch_id;
END;
$$;
