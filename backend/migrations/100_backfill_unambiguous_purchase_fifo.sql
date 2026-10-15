-- Backfill only legacy purchase receipts whose quantity, cost, stock movement,
-- and original inventory-control journal agree. Reconstructing any FIFO issue
-- history would require a complete, ordered cost source for all prior stock, so
-- receipts with a later outbound movement remain unvalued for manual review.
WITH receipt_line_candidates AS (
  SELECT
    sm.company_id,
    sm.id AS movement_id,
    sm.product_id,
    sm.location_id,
    sm.quality,
    sm.quantity,
    sm.occurred_at,
    pr.id AS receipt_id,
    prl.id AS receipt_line_id,
    prl.line_subtotal,
    prl.line_subtotal / NULLIF(prl.quantity, 0) AS unit_cost,
    COUNT(*) OVER (PARTITION BY sm.company_id, sm.id) AS matching_line_count,
    COUNT(*) OVER (PARTITION BY prl.company_id, prl.id) AS matching_movement_count,
    COUNT(*) OVER (PARTITION BY sm.company_id, pr.id) AS matched_receipt_line_count,
    (SELECT COUNT(*) FROM purchase_receipt_lines all_lines
      WHERE all_lines.company_id = pr.company_id AND all_lines.receipt_id = pr.id) AS receipt_line_count,
    (SELECT SUM(all_lines.line_subtotal) FROM purchase_receipt_lines all_lines
      WHERE all_lines.company_id = pr.company_id AND all_lines.receipt_id = pr.id) AS receipt_subtotal
  FROM stock_movements sm
  JOIN purchase_receipts pr
    ON pr.company_id = sm.company_id
   AND pr.id = sm.reference_id
  JOIN purchase_receipt_lines prl
    ON prl.company_id = pr.company_id
   AND prl.receipt_id = pr.id
   AND prl.product_id = sm.product_id
   AND prl.quantity = sm.quantity
  WHERE sm.movement_type = 'purchase_in'
    AND sm.direction = 'in'
    AND sm.quality = 'good'
    AND sm.reference_type = 'purchase_receipt'
    AND sm.location_id IS NOT NULL
    AND sm.valuation_status = 'unvalued'
    AND NOT EXISTS (
      SELECT 1
      FROM inventory_cost_layers cl
      WHERE cl.company_id = sm.company_id
        AND cl.source_type = 'purchase_receipt'
        AND cl.source_id = pr.id
        AND cl.source_line_id = sm.id
    )
    -- Do not assume which layer an earlier sale/transfer/adjustment consumed.
    AND NOT EXISTS (
      SELECT 1
      FROM stock_movements outbound
      WHERE outbound.company_id = sm.company_id
        AND outbound.product_id = sm.product_id
        AND outbound.location_id = sm.location_id
        AND outbound.quality = sm.quality
        AND outbound.direction = 'out'
        AND outbound.occurred_at >= sm.occurred_at
    )
), journal_checked AS (
  SELECT c.*,
    COUNT(DISTINCT je.id) AS matching_journal_count,
    COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE a.code = '1300'), 0) AS inventory_debit,
    COALESCE(SUM(jl.debit - jl.credit), 0) AS journal_net
  FROM receipt_line_candidates c
  LEFT JOIN journal_entries je
    ON je.company_id = c.company_id
   AND je.source_type = 'purchase_receipt'
   AND je.source_id = c.receipt_id
  LEFT JOIN journal_entry_lines jl
    ON jl.company_id = je.company_id
   AND jl.journal_entry_id = je.id
  LEFT JOIN accounts a
    ON a.company_id = jl.company_id
   AND a.id = jl.account_id
  GROUP BY c.company_id, c.movement_id, c.product_id, c.location_id, c.quality,
    c.quantity, c.occurred_at, c.receipt_id, c.receipt_line_id, c.line_subtotal,
    c.unit_cost, c.matching_line_count, c.matching_movement_count, c.receipt_subtotal
    ,c.matched_receipt_line_count, c.receipt_line_count
), eligible AS (
  SELECT *
  FROM journal_checked
  WHERE matching_line_count = 1
    AND matching_movement_count = 1
    AND matched_receipt_line_count = receipt_line_count
    AND matching_journal_count = 1
    AND inventory_debit = receipt_subtotal
    AND journal_net = 0
    AND ROUND(unit_cost, 4) >= 0
    -- Preserve the source subtotal exactly when the FIFO layer is extended.
    AND ROUND(ROUND(unit_cost, 4) * quantity, 2) = line_subtotal
), inserted_layers AS (
  INSERT INTO inventory_cost_layers
    (company_id, product_id, quality, location_id, source_type, source_id,
     source_line_id, received_quantity, remaining_quantity, unit_cost, occurred_at)
  SELECT company_id, product_id, quality, location_id, 'purchase_receipt',
    receipt_id, movement_id, quantity, quantity, ROUND(unit_cost, 4), occurred_at
  FROM eligible
  RETURNING company_id, source_line_id
)
UPDATE stock_movements sm
SET valuation_status = 'valued',
    inventory_cost = e.line_subtotal
FROM eligible e
JOIN inserted_layers il
  ON il.company_id = e.company_id
 AND il.source_line_id = e.movement_id
WHERE sm.company_id = e.company_id
  AND sm.id = e.movement_id;
