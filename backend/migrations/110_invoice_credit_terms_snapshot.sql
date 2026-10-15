-- Preserve the customer's agreed credit period on each invoice so aging is stable
-- when the customer profile is edited later. Existing invoices inherit the
-- customer's current credit_days as a best-effort historical estimate.
ALTER TABLE sales_invoices
  ADD COLUMN credit_days_snapshot integer NOT NULL DEFAULT 0
  CHECK (credit_days_snapshot BETWEEN 0 AND 3650);

UPDATE sales_invoices i
SET credit_days_snapshot = COALESCE(bp.credit_days, 0)
FROM business_partners bp
WHERE bp.company_id = i.company_id
  AND bp.id = i.customer_id;
