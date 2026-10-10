ALTER TABLE customer_receipt_allocations ADD COLUMN branch_id uuid;
ALTER TABLE customer_receipt_allocations ADD CONSTRAINT customer_receipt_allocations_branch_fk
  FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id);
CREATE INDEX customer_receipt_allocations_branch_idx
  ON customer_receipt_allocations(company_id,branch_id,allocation_date DESC);
UPDATE customer_receipt_allocations a SET branch_id=r.branch_id
FROM customer_receipts r WHERE r.company_id=a.company_id AND r.id=a.receipt_id;

ALTER TABLE customer_credit_applications ADD COLUMN branch_id uuid;
ALTER TABLE customer_credit_applications ADD CONSTRAINT customer_credit_applications_branch_fk
  FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id);
CREATE INDEX customer_credit_applications_branch_idx
  ON customer_credit_applications(company_id,branch_id,applied_date DESC);
UPDATE customer_credit_applications a SET branch_id=r.branch_id
FROM sales_returns r WHERE r.company_id=a.company_id AND r.id=a.sales_return_id;

ALTER TABLE customer_refunds ADD COLUMN branch_id uuid;
ALTER TABLE customer_refunds ADD CONSTRAINT customer_refunds_branch_fk
  FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id);
CREATE INDEX customer_refunds_branch_idx
  ON customer_refunds(company_id,branch_id,refund_date DESC);
UPDATE customer_refunds f SET branch_id=r.branch_id
FROM sales_returns r WHERE r.company_id=f.company_id AND r.id=f.sales_return_id;

ALTER TABLE sales_invoice_reversals ADD COLUMN branch_id uuid;
ALTER TABLE sales_invoice_reversals ADD CONSTRAINT sales_invoice_reversals_branch_fk
  FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id);
CREATE INDEX sales_invoice_reversals_branch_idx
  ON sales_invoice_reversals(company_id,branch_id,reversal_date DESC);
UPDATE sales_invoice_reversals r SET branch_id=i.branch_id
FROM sales_invoices i WHERE i.company_id=r.company_id AND i.id=r.invoice_id;

CREATE OR REPLACE FUNCTION enforce_sales_branch_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_branch uuid;
BEGIN
  IF TG_TABLE_NAME='sales_invoices' THEN
    SELECT branch_id INTO parent_branch FROM sales_orders WHERE company_id=NEW.company_id AND id=NEW.order_id;
  ELSIF TG_TABLE_NAME='sales_returns' THEN
    SELECT branch_id INTO parent_branch FROM sales_invoices WHERE company_id=NEW.company_id AND id=NEW.invoice_id;
  ELSIF TG_TABLE_NAME='customer_receipts' AND NEW.invoice_id IS NOT NULL THEN
    SELECT branch_id INTO parent_branch FROM sales_invoices WHERE company_id=NEW.company_id AND id=NEW.invoice_id;
  ELSIF TG_TABLE_NAME='customer_receipt_allocations' THEN
    SELECT branch_id INTO parent_branch FROM customer_receipts WHERE company_id=NEW.company_id AND id=NEW.receipt_id;
    IF NEW.branch_id IS DISTINCT FROM parent_branch THEN RAISE EXCEPTION 'receipt allocation branch must match its receipt'; END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME='customer_credit_applications' THEN
    SELECT branch_id INTO parent_branch FROM sales_returns WHERE company_id=NEW.company_id AND id=NEW.sales_return_id;
    IF NEW.branch_id IS DISTINCT FROM parent_branch THEN RAISE EXCEPTION 'credit application branch must match its credit note'; END IF;
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

CREATE TRIGGER customer_receipt_allocations_branch_consistency BEFORE INSERT OR UPDATE OF receipt_id,branch_id ON customer_receipt_allocations
  FOR EACH ROW EXECUTE FUNCTION enforce_sales_branch_consistency();
CREATE TRIGGER customer_credit_applications_branch_consistency BEFORE INSERT OR UPDATE OF sales_return_id,branch_id ON customer_credit_applications
  FOR EACH ROW EXECUTE FUNCTION enforce_sales_branch_consistency();
CREATE TRIGGER customer_refunds_branch_consistency BEFORE INSERT OR UPDATE OF sales_return_id,branch_id ON customer_refunds
  FOR EACH ROW EXECUTE FUNCTION enforce_sales_branch_consistency();
CREATE TRIGGER sales_invoice_reversals_branch_consistency BEFORE INSERT OR UPDATE OF invoice_id,branch_id ON sales_invoice_reversals
  FOR EACH ROW EXECUTE FUNCTION enforce_sales_branch_consistency();
