ALTER TABLE purchase_orders ADD COLUMN branch_id uuid;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_branch_fk FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id);
CREATE INDEX purchase_orders_branch_recent_idx ON purchase_orders(company_id,branch_id,order_date DESC,created_at DESC);

ALTER TABLE purchase_receipts ADD COLUMN branch_id uuid;
ALTER TABLE purchase_receipts ADD CONSTRAINT purchase_receipts_branch_fk FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id);
CREATE INDEX purchase_receipts_branch_recent_idx ON purchase_receipts(company_id,branch_id,receipt_date DESC,created_at DESC);
UPDATE purchase_receipts r SET branch_id=o.branch_id FROM purchase_orders o WHERE o.company_id=r.company_id AND o.id=r.order_id;

ALTER TABLE purchase_bills ADD COLUMN branch_id uuid;
ALTER TABLE purchase_bills ADD CONSTRAINT purchase_bills_branch_fk FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id);
CREATE INDEX purchase_bills_branch_recent_idx ON purchase_bills(company_id,branch_id,bill_date DESC,created_at DESC);
UPDATE purchase_bills b SET branch_id=o.branch_id FROM purchase_orders o WHERE o.company_id=b.company_id AND o.id=b.order_id;

ALTER TABLE supplier_payments ADD COLUMN branch_id uuid;
ALTER TABLE supplier_payments ADD CONSTRAINT supplier_payments_branch_fk FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id);
CREATE INDEX supplier_payments_branch_recent_idx ON supplier_payments(company_id,branch_id,payment_date DESC,created_at DESC);
UPDATE supplier_payments p SET branch_id=b.branch_id FROM purchase_bills b WHERE b.company_id=p.company_id AND b.id=p.bill_id;

ALTER TABLE purchase_returns ADD COLUMN branch_id uuid;
ALTER TABLE purchase_returns ADD CONSTRAINT purchase_returns_branch_fk FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id);
CREATE INDEX purchase_returns_branch_recent_idx ON purchase_returns(company_id,branch_id,return_date DESC,created_at DESC);
UPDATE purchase_returns r SET branch_id=b.branch_id FROM purchase_bills b WHERE b.company_id=r.company_id AND b.id=r.bill_id;

ALTER TABLE purchase_return_allocations ADD COLUMN branch_id uuid;
ALTER TABLE purchase_return_allocations ADD CONSTRAINT purchase_return_allocations_branch_fk FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id);
CREATE INDEX purchase_return_allocations_branch_idx ON purchase_return_allocations(company_id,branch_id,allocation_date DESC);
UPDATE purchase_return_allocations a SET branch_id=r.branch_id FROM purchase_returns r WHERE r.company_id=a.company_id AND r.id=a.purchase_return_id;

ALTER TABLE loading_sessions ADD COLUMN branch_id uuid;
ALTER TABLE loading_sessions ADD CONSTRAINT loading_sessions_branch_fk FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id);
CREATE INDEX loading_sessions_branch_recent_idx ON loading_sessions(company_id,branch_id,started_at DESC,created_at DESC);
UPDATE loading_sessions l SET branch_id=i.branch_id FROM sales_invoices i WHERE i.company_id=l.company_id AND i.id=l.invoice_id;

UPDATE journal_entries j SET branch_id=r.branch_id FROM purchase_receipts r
  WHERE j.company_id=r.company_id AND j.source_type='purchase_receipt' AND j.source_id=r.id;
UPDATE journal_entries j SET branch_id=b.branch_id FROM purchase_bills b
  WHERE j.company_id=b.company_id AND j.source_type='purchase_bill' AND j.source_id=b.id;
UPDATE journal_entries j SET branch_id=p.branch_id FROM supplier_payments p
  WHERE j.company_id=p.company_id AND j.source_type='supplier_payment' AND j.source_id=p.id;
UPDATE journal_entries j SET branch_id=r.branch_id FROM purchase_returns r
  WHERE j.company_id=r.company_id AND j.source_type='purchase_return' AND j.source_id=r.id;

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
  ELSIF TG_TABLE_NAME='supplier_payments' AND NEW.bill_id IS NOT NULL THEN
    SELECT branch_id INTO parent_branch FROM purchase_bills WHERE company_id=NEW.company_id AND id=NEW.bill_id;
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
CREATE TRIGGER purchase_receipts_branch_consistency BEFORE INSERT OR UPDATE OF order_id,branch_id ON purchase_receipts FOR EACH ROW EXECUTE FUNCTION enforce_purchase_branch_consistency();
CREATE TRIGGER purchase_bills_branch_consistency BEFORE INSERT OR UPDATE OF order_id,branch_id ON purchase_bills FOR EACH ROW EXECUTE FUNCTION enforce_purchase_branch_consistency();
CREATE TRIGGER purchase_returns_branch_consistency BEFORE INSERT OR UPDATE OF bill_id,branch_id ON purchase_returns FOR EACH ROW EXECUTE FUNCTION enforce_purchase_branch_consistency();
CREATE TRIGGER supplier_payments_branch_consistency BEFORE INSERT OR UPDATE OF bill_id,branch_id ON supplier_payments FOR EACH ROW WHEN (NEW.bill_id IS NOT NULL) EXECUTE FUNCTION enforce_purchase_branch_consistency();
CREATE TRIGGER purchase_return_allocations_branch_consistency BEFORE INSERT OR UPDATE OF purchase_return_id,bill_id,branch_id ON purchase_return_allocations FOR EACH ROW EXECUTE FUNCTION enforce_purchase_branch_consistency();
CREATE TRIGGER loading_sessions_branch_consistency BEFORE INSERT OR UPDATE OF invoice_id,branch_id ON loading_sessions FOR EACH ROW EXECUTE FUNCTION enforce_purchase_branch_consistency();
