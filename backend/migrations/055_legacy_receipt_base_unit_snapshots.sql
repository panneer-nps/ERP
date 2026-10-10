UPDATE purchase_receipt_lines r
SET entered_quantity=r.quantity,
    entered_unit_code=(SELECT u.code FROM product_units u WHERE u.company_id=r.company_id AND u.product_id=r.product_id AND u.is_base=true LIMIT 1),
    conversion_to_base=1
WHERE EXISTS(SELECT 1 FROM purchase_receipts receipt WHERE receipt.company_id=r.company_id AND receipt.id=r.receipt_id AND receipt.created_at < (SELECT applied_at FROM schema_migrations WHERE filename='054_purchase_receipt_unit_snapshots.sql'));
