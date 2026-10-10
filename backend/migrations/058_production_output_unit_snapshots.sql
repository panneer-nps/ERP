ALTER TABLE production_batches
  ADD COLUMN entered_good_quantity numeric(14,6),
  ADD COLUMN entered_second_quantity numeric(14,6),
  ADD COLUMN entered_broken_quantity numeric(14,6),
  ADD COLUMN entered_rejected_quantity numeric(14,6),
  ADD COLUMN output_unit_code text,
  ADD COLUMN output_conversion_to_base numeric(16,6);

UPDATE production_batches b
SET entered_good_quantity=b.good_quantity,
    entered_second_quantity=b.second_quantity,
    entered_broken_quantity=b.broken_quantity,
    entered_rejected_quantity=b.rejected_quantity,
    output_unit_code=pu.code,
    output_conversion_to_base=1
FROM product_units pu
WHERE b.company_id=pu.company_id AND b.product_id=pu.product_id AND pu.is_base=true
  AND b.status='completed';

ALTER TABLE production_batches
  ADD CONSTRAINT production_batches_output_unit_snapshot_ck CHECK(
    (status='completed' AND entered_good_quantity>=0 AND entered_second_quantity>=0 AND entered_broken_quantity>=0 AND entered_rejected_quantity>=0 AND output_unit_code IS NOT NULL AND output_conversion_to_base>0)
    OR (status<>'completed' AND entered_good_quantity IS NULL AND entered_second_quantity IS NULL AND entered_broken_quantity IS NULL AND entered_rejected_quantity IS NULL AND output_unit_code IS NULL AND output_conversion_to_base IS NULL)
  );

COMMENT ON COLUMN production_batches.good_quantity IS 'Good output in product base units';
COMMENT ON COLUMN production_batches.entered_good_quantity IS 'Original good output entered in output_unit_code';
