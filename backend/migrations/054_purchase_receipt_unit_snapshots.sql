ALTER TABLE purchase_receipt_lines ADD COLUMN entered_quantity numeric(14,6);
ALTER TABLE purchase_receipt_lines ADD COLUMN entered_unit_code text;
ALTER TABLE purchase_receipt_lines ADD COLUMN conversion_to_base numeric(16,6);

UPDATE purchase_receipt_lines r
SET entered_quantity=r.quantity,
    entered_unit_code=o.entered_unit_code,
    conversion_to_base=o.conversion_to_base
FROM purchase_order_lines o
WHERE o.company_id=r.company_id AND o.id=r.order_line_id;

ALTER TABLE purchase_receipt_lines ALTER COLUMN entered_quantity SET NOT NULL;
ALTER TABLE purchase_receipt_lines ALTER COLUMN entered_unit_code SET NOT NULL;
ALTER TABLE purchase_receipt_lines ALTER COLUMN conversion_to_base SET NOT NULL;
ALTER TABLE purchase_receipt_lines ADD CONSTRAINT purchase_receipt_lines_unit_snapshot_ck
 CHECK(entered_quantity>0 AND conversion_to_base>0);
