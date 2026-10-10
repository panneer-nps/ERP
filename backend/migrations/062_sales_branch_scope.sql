ALTER TABLE sales_orders ADD COLUMN branch_id uuid;
ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_branch_fk
  FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id);
CREATE INDEX sales_orders_branch_recent_idx
  ON sales_orders(company_id,branch_id,order_date DESC,created_at DESC);

ALTER TABLE sales_invoices ADD COLUMN branch_id uuid;
ALTER TABLE sales_invoices ADD CONSTRAINT sales_invoices_branch_fk
  FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id);
CREATE INDEX sales_invoices_branch_recent_idx
  ON sales_invoices(company_id,branch_id,invoice_date DESC,created_at DESC);
UPDATE sales_invoices i SET branch_id=o.branch_id
FROM sales_orders o WHERE o.company_id=i.company_id AND o.id=i.order_id;

ALTER TABLE sales_returns ADD COLUMN branch_id uuid;
ALTER TABLE sales_returns ADD CONSTRAINT sales_returns_branch_fk
  FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id);
CREATE INDEX sales_returns_branch_recent_idx
  ON sales_returns(company_id,branch_id,return_date DESC,created_at DESC);
UPDATE sales_returns r SET branch_id=i.branch_id
FROM sales_invoices i WHERE i.company_id=r.company_id AND i.id=r.invoice_id;

ALTER TABLE customer_receipts ADD COLUMN branch_id uuid;
ALTER TABLE customer_receipts ADD CONSTRAINT customer_receipts_branch_fk
  FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id);
CREATE INDEX customer_receipts_branch_recent_idx
  ON customer_receipts(company_id,branch_id,receipt_date DESC,created_at DESC);
UPDATE customer_receipts r SET branch_id=i.branch_id
FROM sales_invoices i WHERE i.company_id=r.company_id AND r.invoice_id=i.id;

ALTER TABLE journal_entries ADD COLUMN branch_id uuid;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_branch_fk
  FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id);
CREATE INDEX journal_entries_branch_effective_idx
  ON journal_entries(company_id,branch_id,effective_date DESC,entry_number);

UPDATE journal_entries je SET branch_id=o.branch_id
FROM sales_invoices i JOIN sales_orders o ON o.company_id=i.company_id AND o.id=i.order_id
WHERE je.company_id=i.company_id AND je.source_type='sales_invoice' AND je.source_id=i.id;
UPDATE journal_entries je SET branch_id=i.branch_id
FROM sales_invoices i WHERE je.company_id=i.company_id AND je.source_type='sales_invoice_cogs'
  AND EXISTS(SELECT 1 FROM stock_movements sm WHERE sm.company_id=i.company_id AND sm.id=je.source_id
    AND sm.reference_type='sales_invoice' AND sm.reference_id=i.id);
UPDATE journal_entries je SET branch_id=r.branch_id
FROM sales_returns r WHERE je.company_id=r.company_id AND je.source_type='sales_return' AND je.source_id=r.id;
UPDATE journal_entries je SET branch_id=r.branch_id
FROM customer_receipts r WHERE je.company_id=r.company_id AND je.source_type='customer_receipt' AND je.source_id=r.id;

CREATE OR REPLACE FUNCTION enforce_sales_branch_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF NEW.branch_id IS DISTINCT FROM parent_branch THEN
    RAISE EXCEPTION 'sales document branch must match its parent';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sales_invoices_branch_consistency BEFORE INSERT OR UPDATE OF order_id,branch_id ON sales_invoices
  FOR EACH ROW EXECUTE FUNCTION enforce_sales_branch_consistency();
CREATE TRIGGER sales_returns_branch_consistency BEFORE INSERT OR UPDATE OF invoice_id,branch_id ON sales_returns
  FOR EACH ROW EXECUTE FUNCTION enforce_sales_branch_consistency();
CREATE TRIGGER customer_receipts_branch_consistency BEFORE INSERT OR UPDATE OF invoice_id,branch_id ON customer_receipts
  FOR EACH ROW EXECUTE FUNCTION enforce_sales_branch_consistency();

CREATE OR REPLACE FUNCTION revert_sales_branch_scope() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DROP TRIGGER IF EXISTS customer_receipts_branch_consistency ON customer_receipts;
  DROP TRIGGER IF EXISTS sales_returns_branch_consistency ON sales_returns;
  DROP TRIGGER IF EXISTS sales_invoices_branch_consistency ON sales_invoices;
  DROP FUNCTION IF EXISTS enforce_sales_branch_consistency();
  DROP FUNCTION IF EXISTS revert_sales_branch_scope();
  ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_branch_fk;
  DROP INDEX IF EXISTS journal_entries_branch_effective_idx;
  ALTER TABLE journal_entries DROP COLUMN IF EXISTS branch_id;
  ALTER TABLE customer_receipts DROP CONSTRAINT IF EXISTS customer_receipts_branch_fk;
  DROP INDEX IF EXISTS customer_receipts_branch_recent_idx;
  ALTER TABLE customer_receipts DROP COLUMN IF EXISTS branch_id;
  ALTER TABLE sales_returns DROP CONSTRAINT IF EXISTS sales_returns_branch_fk;
  DROP INDEX IF EXISTS sales_returns_branch_recent_idx;
  ALTER TABLE sales_returns DROP COLUMN IF EXISTS branch_id;
  ALTER TABLE sales_invoices DROP CONSTRAINT IF EXISTS sales_invoices_branch_fk;
  DROP INDEX IF EXISTS sales_invoices_branch_recent_idx;
  ALTER TABLE sales_invoices DROP COLUMN IF EXISTS branch_id;
  ALTER TABLE sales_orders DROP CONSTRAINT IF EXISTS sales_orders_branch_fk;
  DROP INDEX IF EXISTS sales_orders_branch_recent_idx;
  ALTER TABLE sales_orders DROP COLUMN IF EXISTS branch_id;
END;
$$;
