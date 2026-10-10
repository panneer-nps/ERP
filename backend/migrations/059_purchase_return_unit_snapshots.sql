ALTER TABLE purchase_return_lines
  ADD COLUMN entered_quantity numeric(14,6),
  ADD COLUMN entered_unit_code text,
  ADD COLUMN conversion_to_base numeric(16,6);

UPDATE purchase_return_lines rl
SET entered_quantity=rl.quantity,
    entered_unit_code=pu.code,
    conversion_to_base=1
FROM product_units pu
WHERE pu.company_id=rl.company_id AND pu.product_id=rl.product_id AND pu.is_base=true;

ALTER TABLE purchase_return_lines
  ALTER COLUMN entered_quantity SET NOT NULL,
  ALTER COLUMN entered_unit_code SET NOT NULL,
  ALTER COLUMN conversion_to_base SET NOT NULL,
  ADD CONSTRAINT purchase_return_lines_unit_snapshot_ck CHECK(
    entered_quantity>0 AND conversion_to_base>0
    AND round(entered_quantity*conversion_to_base,2)=quantity
  );

COMMENT ON COLUMN purchase_return_lines.quantity IS 'Returned quantity converted to product base units';
COMMENT ON COLUMN purchase_return_lines.entered_quantity IS 'Original return quantity entered in entered_unit_code';
