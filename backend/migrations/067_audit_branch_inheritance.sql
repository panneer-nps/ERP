CREATE OR REPLACE FUNCTION inherit_audit_entity_branch() RETURNS trigger LANGUAGE plpgsql AS $$
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
    WHEN 'loading_session' THEN SELECT branch_id INTO NEW.branch_id FROM loading_sessions WHERE company_id=NEW.company_id AND id=NEW.entity_id::uuid;
    ELSE NULL;
  END CASE;
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_logs_branch_inheritance BEFORE INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION inherit_audit_entity_branch();
