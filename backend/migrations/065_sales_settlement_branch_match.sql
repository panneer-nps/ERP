CREATE OR REPLACE FUNCTION enforce_sales_branch_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_branch uuid;
target_branch uuid;
BEGIN
  IF TG_TABLE_NAME='sales_invoices' THEN
    SELECT branch_id INTO parent_branch FROM sales_orders WHERE company_id=NEW.company_id AND id=NEW.order_id;
  ELSIF TG_TABLE_NAME='sales_returns' THEN
    SELECT branch_id INTO parent_branch FROM sales_invoices WHERE company_id=NEW.company_id AND id=NEW.invoice_id;
  ELSIF TG_TABLE_NAME='customer_receipts' AND NEW.invoice_id IS NOT NULL THEN
    SELECT branch_id INTO parent_branch FROM sales_invoices WHERE company_id=NEW.company_id AND id=NEW.invoice_id;
  ELSIF TG_TABLE_NAME='customer_receipt_allocations' THEN
    SELECT branch_id INTO parent_branch FROM customer_receipts WHERE company_id=NEW.company_id AND id=NEW.receipt_id;
    SELECT branch_id INTO target_branch FROM sales_invoices WHERE company_id=NEW.company_id AND id=NEW.target_invoice_id;
    IF NEW.branch_id IS DISTINCT FROM parent_branch OR
       (parent_branch IS NOT NULL AND target_branch IS NOT NULL AND parent_branch<>target_branch) THEN
      RAISE EXCEPTION 'receipt allocation branch must match its receipt and target invoice';
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME='customer_credit_applications' THEN
    SELECT branch_id INTO parent_branch FROM sales_returns WHERE company_id=NEW.company_id AND id=NEW.sales_return_id;
    SELECT branch_id INTO target_branch FROM sales_invoices WHERE company_id=NEW.company_id AND id=NEW.target_invoice_id;
    IF NEW.branch_id IS DISTINCT FROM parent_branch OR
       (parent_branch IS NOT NULL AND target_branch IS NOT NULL AND parent_branch<>target_branch) THEN
      RAISE EXCEPTION 'credit application branch must match its credit note and target invoice';
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME='customer_refunds' THEN
    SELECT branch_id INTO parent_branch FROM sales_returns WHERE company_id=NEW.company_id AND id=NEW.sales_return_id;
    IF NEW.branch_id IS DISTINCT FROM parent_branch THEN RAISE EXCEPTION 'refund branch must match its credit note'; END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME='sales_invoice_reversals' THEN
    SELECT branch_id INTO parent_branch FROM sales_invoices WHERE company_id=NEW.company_id AND id=NEW.invoice_id;
    IF NEW.branch_id IS DISTINCT FROM parent_branch THEN RAISE EXCEPTION 'invoice reversal branch must match its invoice'; END IF;
    RETURN NEW;
  ELSE
    RETURN NEW;
  END IF;
  IF NEW.branch_id IS DISTINCT FROM parent_branch THEN
    RAISE EXCEPTION 'sales document branch must match its parent';
  END IF;
  RETURN NEW;
END;
$$;
