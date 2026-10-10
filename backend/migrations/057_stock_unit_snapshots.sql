ALTER TABLE stocktake_lines
  ADD COLUMN entered_counted_quantity numeric(14,6),
  ADD COLUMN counted_unit_code text,
  ADD COLUMN counted_conversion_to_base numeric(16,6);

UPDATE stocktake_lines sl
SET entered_counted_quantity=sl.counted_quantity,
    counted_unit_code=pu.code,
    counted_conversion_to_base=1
FROM product_units pu
WHERE pu.company_id=sl.company_id AND pu.product_id=sl.product_id AND pu.is_base=true
  AND sl.counted_quantity IS NOT NULL;

ALTER TABLE stocktake_lines
  ADD CONSTRAINT stocktake_lines_count_unit_snapshot_ck CHECK(
    (counted_quantity IS NULL AND entered_counted_quantity IS NULL AND counted_unit_code IS NULL AND counted_conversion_to_base IS NULL)
    OR (counted_quantity>=0 AND entered_counted_quantity>=0 AND counted_unit_code IS NOT NULL AND counted_conversion_to_base>0)
  );

ALTER TABLE stock_movements
  ADD COLUMN entered_quantity numeric(14,6),
  ADD COLUMN entered_unit_code text,
  ADD COLUMN conversion_to_base numeric(16,6);

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_unit_snapshot_ck CHECK(
    (entered_quantity IS NULL AND entered_unit_code IS NULL AND conversion_to_base IS NULL)
    OR (entered_quantity>0 AND entered_unit_code IS NOT NULL AND conversion_to_base>0)
  );

COMMENT ON COLUMN stocktake_lines.counted_quantity IS 'Physical count converted to product base units';
COMMENT ON COLUMN stocktake_lines.entered_counted_quantity IS 'Original count entered in counted_unit_code';
COMMENT ON COLUMN stock_movements.entered_quantity IS 'Original quantity entered by user; quantity remains in base units';
