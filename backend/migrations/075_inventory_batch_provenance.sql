-- Preserve the production batch that originated a remaining FIFO cost layer.
-- Historical production layers can be linked safely from their source fields;
-- older transfers, damage reclassifications, openings, and adjustments stay
-- unassigned because their original batch cannot be proven.
ALTER TABLE inventory_cost_layers
  ADD COLUMN origin_batch_id uuid;

ALTER TABLE inventory_cost_layers
  ADD CONSTRAINT inventory_cost_layers_origin_batch_fk
  FOREIGN KEY(company_id,origin_batch_id)
  REFERENCES production_batches(company_id,id);

UPDATE inventory_cost_layers l
SET origin_batch_id=l.source_id
FROM production_batches b
WHERE l.source_type='production_batch'
  AND b.company_id=l.company_id
  AND b.id=l.source_id;

CREATE INDEX inventory_cost_layers_batch_balance_idx
  ON inventory_cost_layers(company_id,origin_batch_id,product_id,quality,location_id)
  WHERE remaining_quantity>0;
