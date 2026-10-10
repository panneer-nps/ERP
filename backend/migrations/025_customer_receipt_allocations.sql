CREATE TABLE customer_receipt_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 receipt_id uuid NOT NULL,
 target_invoice_id uuid NOT NULL,
 allocation_date date NOT NULL DEFAULT CURRENT_DATE,
 amount numeric(14,2) NOT NULL CHECK(amount>0),
 reference text,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,receipt_id) REFERENCES customer_receipts(company_id,id),
 FOREIGN KEY(company_id,target_invoice_id) REFERENCES sales_invoices(company_id,id),
 FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
 UNIQUE(company_id,id)
);
CREATE INDEX customer_receipt_allocations_receipt_idx ON customer_receipt_allocations(company_id,receipt_id);
CREATE INDEX customer_receipt_allocations_invoice_idx ON customer_receipt_allocations(company_id,target_invoice_id);
