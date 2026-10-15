CREATE OR REPLACE FUNCTION inherit_audit_entity_branch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  transfer_source_branch uuid;
  transfer_destination_branch uuid;
BEGIN
  IF NEW.branch_id IS NOT NULL OR NEW.entity_id IS NULL OR
     NEW.entity_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NEW;
  END IF;
  CASE NEW.entity_type
    WHEN 'production_batch' THEN SELECT branch_id INTO NEW.branch_id FROM production_batches WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    WHEN 'sales_order' THEN SELECT branch_id INTO NEW.branch_id FROM sales_orders WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    WHEN 'sales_invoice' THEN SELECT branch_id INTO NEW.branch_id FROM sales_invoices WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    WHEN 'sales_return' THEN SELECT branch_id INTO NEW.branch_id FROM sales_returns WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    WHEN 'customer_receipt' THEN SELECT branch_id INTO NEW.branch_id FROM customer_receipts WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    WHEN 'customer_receipt_allocation' THEN SELECT branch_id INTO NEW.branch_id FROM customer_receipt_allocations WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    WHEN 'customer_credit_application' THEN SELECT branch_id INTO NEW.branch_id FROM customer_credit_applications WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    WHEN 'customer_refund' THEN SELECT branch_id INTO NEW.branch_id FROM customer_refunds WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    WHEN 'sales_invoice_reversal' THEN SELECT branch_id INTO NEW.branch_id FROM sales_invoice_reversals WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    WHEN 'purchase_order' THEN SELECT branch_id INTO NEW.branch_id FROM purchase_orders WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    WHEN 'purchase_receipt' THEN SELECT branch_id INTO NEW.branch_id FROM purchase_receipts WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    WHEN 'purchase_bill' THEN SELECT branch_id INTO NEW.branch_id FROM purchase_bills WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    WHEN 'supplier_payment' THEN SELECT branch_id INTO NEW.branch_id FROM supplier_payments WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    WHEN 'purchase_return' THEN SELECT branch_id INTO NEW.branch_id FROM purchase_returns WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    WHEN 'purchase_return_allocation' THEN SELECT branch_id INTO NEW.branch_id FROM purchase_return_allocations WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    WHEN 'purchase_return_refund' THEN SELECT branch_id INTO NEW.branch_id FROM purchase_return_refunds WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    WHEN 'loading_session' THEN SELECT branch_id INTO NEW.branch_id FROM loading_sessions WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    WHEN 'loading_photo' THEN
      SELECT l.branch_id INTO NEW.branch_id FROM loading_photos p JOIN loading_sessions l ON l.company_id=p.company_id AND l.id=p.loading_session_id WHERE p.company_id=NEW.company_id AND p.id=NEW.entity_id::uuid;
    WHEN 'production_cost_line' THEN
      SELECT b.branch_id INTO NEW.branch_id FROM production_cost_lines l JOIN production_batches b ON b.company_id=l.company_id AND b.id=l.batch_id WHERE l.company_id=NEW.company_id AND l.id=NEW.entity_id::uuid;
    WHEN 'stock_location' THEN SELECT branch_id INTO NEW.branch_id FROM stock_locations WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    WHEN 'stock_opening_balance' THEN
      SELECT l.branch_id INTO NEW.branch_id FROM stock_opening_balances o JOIN stock_locations l ON l.company_id=o.company_id AND l.id=o.location_id WHERE o.company_id=NEW.company_id AND o.id=NEW.entity_id::uuid;
    WHEN 'stocktake' THEN
      SELECT l.branch_id INTO NEW.branch_id FROM stocktakes s JOIN stock_locations l ON l.company_id=s.company_id AND l.id=s.location_id WHERE s.company_id=NEW.company_id AND s.id=NEW.entity_id::uuid;
    WHEN 'stock_adjustment' THEN
      SELECT l.branch_id INTO NEW.branch_id FROM stock_movements m JOIN stock_locations l ON l.company_id=m.company_id AND l.id=m.location_id WHERE m.company_id=NEW.company_id AND m.id=NEW.entity_id::uuid;
    WHEN 'stock_transfer' THEN
      SELECT source.branch_id,destination.branch_id INTO transfer_source_branch,transfer_destination_branch
      FROM stock_transfers t
      JOIN stock_locations source ON source.company_id=t.company_id AND source.id=t.source_location_id
      JOIN stock_locations destination ON destination.company_id=t.company_id AND destination.id=t.destination_location_id
      WHERE t.company_id=NEW.company_id AND t.id=NEW.entity_id::uuid;
      IF transfer_source_branch IS NOT DISTINCT FROM transfer_destination_branch THEN
        NEW.branch_id := transfer_source_branch;
      ELSIF transfer_source_branch IS NULL THEN
        NEW.branch_id := transfer_destination_branch;
      ELSIF transfer_destination_branch IS NULL THEN
        NEW.branch_id := transfer_source_branch;
      ELSE
        -- A cross-branch transfer belongs to both branches; leave it shared in the single-branch audit model.
        NEW.branch_id := NULL;
      END IF;
    WHEN 'employee' THEN SELECT branch_id INTO NEW.branch_id FROM employees WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    WHEN 'attendance_record' THEN SELECT branch_id INTO NEW.branch_id FROM attendance_records WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    WHEN 'employee_advance' THEN SELECT branch_id INTO NEW.branch_id FROM employee_advances WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    WHEN 'employee_advance_repayment' THEN SELECT branch_id INTO NEW.branch_id FROM employee_advance_repayments WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    WHEN 'employee_opening_balance' THEN
      SELECT e.branch_id INTO NEW.branch_id FROM employee_opening_balances o JOIN employees e ON e.company_id=o.company_id AND e.id=o.employee_id WHERE o.company_id=NEW.company_id AND o.id=NEW.entity_id::uuid;
    WHEN 'salary_run' THEN SELECT branch_id INTO NEW.branch_id FROM salary_runs WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    WHEN 'salary_payment' THEN
      SELECT r.branch_id INTO NEW.branch_id FROM salary_payments p JOIN salary_runs r ON r.company_id=p.company_id AND r.id=p.salary_run_id WHERE p.company_id=NEW.company_id AND p.id=NEW.entity_id::uuid;
    WHEN 'expense' THEN SELECT branch_id INTO NEW.branch_id FROM expenses WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    ELSE NULL;
  END CASE;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_branch_inheritance ON audit_logs;
CREATE TRIGGER audit_logs_branch_inheritance
  BEFORE INSERT OR UPDATE OF branch_id ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION inherit_audit_entity_branch();

-- Enrich legacy events only where the source branch is stable and unambiguous. Employee ownership
-- can be assigned or changed after an event, so historical employee events keep their event-time scope.
UPDATE audit_logs SET branch_id=NULL
WHERE branch_id IS NULL AND entity_type IN (
  'production_batch','sales_order','sales_invoice','sales_return','customer_receipt',
  'customer_receipt_allocation','customer_credit_application','customer_refund','sales_invoice_reversal',
  'purchase_order','purchase_receipt','purchase_bill','supplier_payment','purchase_return',
  'purchase_return_allocation','purchase_return_refund','loading_session','loading_photo',
  'production_cost_line','stock_location','stock_opening_balance','stocktake','stock_adjustment',
  'stock_transfer','attendance_record','employee_advance','employee_advance_repayment',
  'salary_run','salary_payment','expense'
);
