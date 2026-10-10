ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_movement_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check
 CHECK(movement_type IN ('production_in','sale_out','customer_return','damage','adjustment','purchase_in','purchase_return','transfer','opening_in','sale_reversal_in'));
ALTER TABLE broker_commissions ADD COLUMN cancelled_at timestamptz;
ALTER TABLE sales_invoices ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE sales_invoice_reversals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 reversal_number text NOT NULL,
 invoice_id uuid NOT NULL,
 reversal_date date NOT NULL,
 reason text NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,invoice_id) REFERENCES sales_invoices(company_id,id),
 FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
 UNIQUE(company_id,id),
 UNIQUE(company_id,invoice_id),
 UNIQUE(company_id,reversal_number)
);
CREATE INDEX sales_invoice_reversals_date_idx ON sales_invoice_reversals(company_id,reversal_date DESC);

INSERT INTO permissions(code,module,action,description) VALUES
 ('sales.invoice.reverse','sales','invoice_reverse','Reverse an unpaid, unshipped sales invoice') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='sales.invoice.reverse' WHERE r.system_role=true AND r.code='owner' ON CONFLICT DO NOTHING;
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
 SELECT id,'sales_invoice_reversal','IVR-',1,5 FROM companies ON CONFLICT DO NOTHING;
