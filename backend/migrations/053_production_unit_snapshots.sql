ALTER TABLE production_batches ADD COLUMN entered_planned_quantity numeric(14,6);
ALTER TABLE production_batches ADD COLUMN entered_unit_code text;
ALTER TABLE production_batches ADD COLUMN planned_conversion_to_base numeric(16,6);
ALTER TABLE production_batches ADD COLUMN entered_loaded_quantity numeric(14,6);
ALTER TABLE production_batches ADD COLUMN loaded_unit_code text;
ALTER TABLE production_batches ADD COLUMN loaded_conversion_to_base numeric(16,6);

UPDATE production_batches b
SET entered_planned_quantity=b.planned_quantity,
    entered_unit_code=u.code,
    planned_conversion_to_base=1,
    entered_loaded_quantity=b.loaded_quantity,
    loaded_unit_code=CASE WHEN b.loaded_quantity IS NOT NULL THEN u.code END,
    loaded_conversion_to_base=CASE WHEN b.loaded_quantity IS NOT NULL THEN 1 END
FROM product_units u
WHERE u.company_id=b.company_id AND u.product_id=b.product_id AND u.is_base=true;

ALTER TABLE production_batches ALTER COLUMN entered_planned_quantity SET NOT NULL;
ALTER TABLE production_batches ALTER COLUMN entered_unit_code SET NOT NULL;
ALTER TABLE production_batches ALTER COLUMN planned_conversion_to_base SET NOT NULL;
ALTER TABLE production_batches ADD CONSTRAINT production_batches_unit_snapshot_ck
 CHECK(entered_planned_quantity>=0 AND planned_conversion_to_base>0 AND
       ((entered_loaded_quantity IS NULL AND loaded_unit_code IS NULL AND loaded_conversion_to_base IS NULL) OR
        (entered_loaded_quantity>0 AND loaded_unit_code IS NOT NULL AND loaded_conversion_to_base>0)));
