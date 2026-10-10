ALTER TABLE sales_order_lines ADD COLUMN entered_quantity numeric(14,6);
ALTER TABLE sales_order_lines ADD COLUMN entered_unit_code text;
ALTER TABLE sales_order_lines ADD COLUMN conversion_to_base numeric(16,6);
UPDATE sales_order_lines l SET entered_quantity=l.quantity,entered_unit_code=pu.code,conversion_to_base=1 FROM product_units pu WHERE pu.company_id=l.company_id AND pu.product_id=l.product_id AND pu.is_base=true;
ALTER TABLE sales_order_lines ALTER COLUMN entered_quantity SET NOT NULL;
ALTER TABLE sales_order_lines ALTER COLUMN entered_unit_code SET NOT NULL;
ALTER TABLE sales_order_lines ALTER COLUMN conversion_to_base SET NOT NULL;
ALTER TABLE sales_order_lines ADD CONSTRAINT sales_order_lines_entered_quantity_ck CHECK(entered_quantity>0 AND conversion_to_base>0);

ALTER TABLE purchase_order_lines ADD COLUMN entered_quantity numeric(14,6);
ALTER TABLE purchase_order_lines ADD COLUMN entered_unit_code text;
ALTER TABLE purchase_order_lines ADD COLUMN conversion_to_base numeric(16,6);
UPDATE purchase_order_lines l SET entered_quantity=l.quantity,entered_unit_code=pu.code,conversion_to_base=1 FROM product_units pu WHERE pu.company_id=l.company_id AND pu.product_id=l.product_id AND pu.is_base=true;
ALTER TABLE purchase_order_lines ALTER COLUMN entered_quantity SET NOT NULL;
ALTER TABLE purchase_order_lines ALTER COLUMN entered_unit_code SET NOT NULL;
ALTER TABLE purchase_order_lines ALTER COLUMN conversion_to_base SET NOT NULL;
ALTER TABLE purchase_order_lines ADD CONSTRAINT purchase_order_lines_entered_quantity_ck CHECK(entered_quantity>0 AND conversion_to_base>0);
