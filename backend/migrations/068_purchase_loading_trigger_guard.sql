CREATE OR REPLACE FUNCTION enforce_purchase_branch_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_branch uuid;
target_branch uuid;
BEGIN
  IF TG_TABLE_NAME='purchase_receipts' THEN
    SELECT branch_id INTO parent_branch FROM purchase_orders WHERE company_id=NEW.company_id AND id=NEW.order_id;
  ELSIF TG_TABLE_NAME='purchase_bills' THEN
    SELECT branch_id INTO parent_branch FROM purchase_orders WHERE company_id=NEW.company_id AND id=NEW.order_id;
  ELSIF TG_TABLE_NAME='purchase_returns' THEN
    SELECT branch_id INTO parent_branch FROM purchase_bills WHERE company_id=NEW.company_id AND id=NEW.bill_id;
  ELSIF TG_TABLE_NAME='supplier_payments' THEN
    IF NEW.bill_id IS NOT NULL THEN
      SELECT branch_id INTO parent_branch FROM purchase_bills WHERE company_id=NEW.company_id AND id=NEW.bill_id;
    END IF;
  ELSIF TG_TABLE_NAME='purchase_return_allocations' THEN
    SELECT branch_id INTO parent_branch FROM purchase_returns WHERE company_id=NEW.company_id AND id=NEW.purchase_return_id;
    SELECT branch_id INTO target_branch FROM purchase_bills WHERE company_id=NEW.company_id AND id=NEW.bill_id;
    IF NEW.branch_id IS DISTINCT FROM parent_branch OR
       (parent_branch IS NOT NULL AND target_branch IS NOT NULL AND parent_branch<>target_branch) THEN
      RAISE EXCEPTION 'supplier credit allocation branch must match its return and target bill';
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME='loading_sessions' THEN
    SELECT branch_id INTO parent_branch FROM sales_invoices WHERE company_id=NEW.company_id AND id=NEW.invoice_id;
  ELSE
    RETURN NEW;
  END IF;
  IF NEW.branch_id IS DISTINCT FROM parent_branch THEN RAISE EXCEPTION 'transaction branch must match its parent'; END IF;
  RETURN NEW;
END;
$$;
