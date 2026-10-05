ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_supplier_key UNIQUE(company_id,id,supplier_id);
ALTER TABLE purchase_bills ADD CONSTRAINT purchase_bills_order_supplier_fk FOREIGN KEY(company_id,order_id,supplier_id) REFERENCES purchase_orders(company_id,id,supplier_id);
