ALTER TABLE stock_opening_balance_lines
  ADD COLUMN entered_quantity numeric(14,6),
  ADD COLUMN entered_unit_code text,
  ADD COLUMN conversion_to_base numeric(16,6),
  ADD COLUMN entered_unit_cost numeric(14,4),
  ADD COLUMN base_unit_cost numeric(14,4);

UPDATE stock_opening_balance_lines l
SET entered_quantity=l.quantity,
    entered_unit_code=u.code,
    conversion_to_base=1,
    base_unit_cost=COALESCE(m.inventory_cost/NULLIF(l.quantity,0),0),
    entered_unit_cost=COALESCE(m.inventory_cost/NULLIF(l.quantity,0),0)
FROM stock_opening_balances h
JOIN product_units u ON u.company_id=h.company_id AND u.is_base=true
LEFT JOIN stock_movements m ON m.company_id=h.company_id AND m.reference_type='stock_opening_balance'
  AND m.reference_id=h.id AND m.product_id=u.product_id AND m.quality='good'
WHERE h.company_id=l.company_id AND h.id=l.opening_balance_id AND u.product_id=l.product_id
  AND l.quality='good';

UPDATE stock_opening_balance_lines l
SET entered_quantity=l.quantity,
    entered_unit_code=u.code,
    conversion_to_base=1,
    base_unit_cost=COALESCE(m.inventory_cost/NULLIF(l.quantity,0),0),
    entered_unit_cost=COALESCE(m.inventory_cost/NULLIF(l.quantity,0),0)
FROM stock_opening_balances h
JOIN product_units u ON u.company_id=h.company_id AND u.is_base=true
LEFT JOIN stock_movements m ON m.company_id=h.company_id AND m.reference_type='stock_opening_balance'
  AND m.reference_id=h.id AND m.product_id=u.product_id AND m.quality='second'
WHERE h.company_id=l.company_id AND h.id=l.opening_balance_id AND u.product_id=l.product_id
  AND l.quality='second';

ALTER TABLE stock_opening_balance_lines
  ALTER COLUMN entered_quantity SET NOT NULL,
  ALTER COLUMN entered_unit_code SET NOT NULL,
  ALTER COLUMN conversion_to_base SET NOT NULL,
  ALTER COLUMN entered_unit_cost SET NOT NULL,
  ALTER COLUMN base_unit_cost SET NOT NULL,
  ADD CONSTRAINT stock_opening_balance_lines_unit_ck CHECK(
    entered_quantity>0 AND conversion_to_base>0 AND entered_unit_cost>=0 AND base_unit_cost>=0
    AND round(entered_quantity*conversion_to_base,2)=quantity
  );

ALTER TABLE stock_transfers
  ADD COLUMN entered_quantity numeric(14,6),
  ADD COLUMN entered_unit_code text,
  ADD COLUMN conversion_to_base numeric(16,6);

UPDATE stock_transfers t
SET entered_quantity=t.quantity,entered_unit_code=u.code,conversion_to_base=1
FROM product_units u
WHERE u.company_id=t.company_id AND u.product_id=t.product_id AND u.is_base=true;

ALTER TABLE stock_transfers
  ALTER COLUMN entered_quantity SET NOT NULL,
  ALTER COLUMN entered_unit_code SET NOT NULL,
  ALTER COLUMN conversion_to_base SET NOT NULL,
  ADD CONSTRAINT stock_transfers_unit_snapshot_ck CHECK(
    entered_quantity>0 AND conversion_to_base>0 AND round(entered_quantity*conversion_to_base,2)=quantity
  );

UPDATE stock_movements sm
SET entered_quantity=t.entered_quantity,entered_unit_code=t.entered_unit_code,conversion_to_base=t.conversion_to_base
FROM stock_transfers t
WHERE sm.company_id=t.company_id AND sm.reference_type='stock_transfer' AND sm.reference_id=t.id
  AND sm.product_id=t.product_id;

UPDATE stock_movements sm
SET entered_quantity=l.entered_quantity,entered_unit_code=l.entered_unit_code,conversion_to_base=l.conversion_to_base
FROM stock_opening_balance_lines l
WHERE sm.company_id=l.company_id AND sm.reference_type='stock_opening_balance'
  AND sm.reference_id=l.opening_balance_id AND sm.product_id=l.product_id AND sm.quality=l.quality;

COMMENT ON COLUMN stock_opening_balance_lines.quantity IS 'Opening stock quantity converted to product base units';
COMMENT ON COLUMN stock_opening_balance_lines.entered_quantity IS 'Original opening quantity entered by user';
COMMENT ON COLUMN stock_opening_balance_lines.base_unit_cost IS 'Opening inventory cost per product base unit';
COMMENT ON COLUMN stock_transfers.quantity IS 'Transferred quantity converted to product base units';
COMMENT ON COLUMN stock_transfers.entered_quantity IS 'Original transfer quantity entered by user';
