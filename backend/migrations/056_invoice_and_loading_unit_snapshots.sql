ALTER TABLE sales_invoice_lines ADD COLUMN entered_quantity numeric(14,6);
ALTER TABLE sales_invoice_lines ADD COLUMN entered_unit_code text;
ALTER TABLE sales_invoice_lines ADD COLUMN conversion_to_base numeric(16,6);

UPDATE sales_invoice_lines il
SET entered_quantity=sol.entered_quantity,
    entered_unit_code=sol.entered_unit_code,
    conversion_to_base=sol.conversion_to_base
FROM sales_invoices i
JOIN sales_order_lines sol ON sol.company_id=i.company_id AND sol.order_id=i.order_id
WHERE i.company_id=il.company_id AND i.id=il.invoice_id
  AND sol.product_id=il.product_id AND sol.line_number=il.line_number;

ALTER TABLE sales_invoice_lines ALTER COLUMN entered_quantity SET NOT NULL;
ALTER TABLE sales_invoice_lines ALTER COLUMN entered_unit_code SET NOT NULL;
ALTER TABLE sales_invoice_lines ALTER COLUMN conversion_to_base SET NOT NULL;
ALTER TABLE sales_invoice_lines ADD CONSTRAINT sales_invoice_lines_unit_snapshot_ck
 CHECK(entered_quantity>0 AND conversion_to_base>0);

ALTER TABLE loading_sessions ADD COLUMN entered_planned_quantity numeric(14,6);
ALTER TABLE loading_sessions ADD COLUMN entered_unit_code text;
ALTER TABLE loading_sessions ADD COLUMN planned_conversion_to_base numeric(16,6);
ALTER TABLE loading_sessions ADD COLUMN entered_loaded_quantity numeric(14,6);
ALTER TABLE loading_sessions ADD COLUMN loaded_unit_code text;
ALTER TABLE loading_sessions ADD COLUMN loaded_conversion_to_base numeric(16,6);
ALTER TABLE loading_sessions ADD COLUMN entered_verified_quantity numeric(14,6);
ALTER TABLE loading_sessions ADD COLUMN verified_unit_code text;
ALTER TABLE loading_sessions ADD COLUMN verified_conversion_to_base numeric(16,6);

UPDATE loading_sessions l
SET entered_planned_quantity=il.entered_quantity,
    entered_unit_code=il.entered_unit_code,
    planned_conversion_to_base=il.conversion_to_base,
    entered_loaded_quantity=l.loaded_quantity,
    loaded_unit_code=CASE WHEN l.loaded_quantity IS NOT NULL THEN base.code END,
    loaded_conversion_to_base=CASE WHEN l.loaded_quantity IS NOT NULL THEN 1 END,
    entered_verified_quantity=l.verified_quantity,
    verified_unit_code=CASE WHEN l.verified_quantity IS NOT NULL THEN base.code END,
    verified_conversion_to_base=CASE WHEN l.verified_quantity IS NOT NULL THEN 1 END
FROM sales_invoice_lines il
JOIN product_units base ON base.company_id=il.company_id AND base.product_id=il.product_id AND base.is_base=true
WHERE il.company_id=l.company_id AND il.invoice_id=l.invoice_id AND il.product_id=l.product_id;

ALTER TABLE loading_sessions ALTER COLUMN entered_planned_quantity SET NOT NULL;
ALTER TABLE loading_sessions ALTER COLUMN entered_unit_code SET NOT NULL;
ALTER TABLE loading_sessions ALTER COLUMN planned_conversion_to_base SET NOT NULL;
ALTER TABLE loading_sessions ADD CONSTRAINT loading_sessions_unit_snapshot_ck CHECK(
 entered_planned_quantity>0 AND planned_conversion_to_base>0 AND
 ((entered_loaded_quantity IS NULL AND loaded_unit_code IS NULL AND loaded_conversion_to_base IS NULL) OR
  (entered_loaded_quantity>=0 AND loaded_unit_code IS NOT NULL AND loaded_conversion_to_base>0)) AND
 ((entered_verified_quantity IS NULL AND verified_unit_code IS NULL AND verified_conversion_to_base IS NULL) OR
  (entered_verified_quantity>=0 AND verified_unit_code IS NOT NULL AND verified_conversion_to_base>0))
);
