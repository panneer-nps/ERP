CREATE TABLE purchase_return_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  refund_number text NOT NULL,
  purchase_return_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  refund_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL CHECK (payment_method IN ('cash','upi','bank_transfer','cheque','card','other')),
  reference text,
  reason text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  branch_id uuid,
  FOREIGN KEY (company_id,purchase_return_id,supplier_id)
    REFERENCES purchase_returns(company_id,id,supplier_id),
  FOREIGN KEY (company_id,created_by) REFERENCES users(company_id,id),
  FOREIGN KEY (company_id,branch_id) REFERENCES branches(company_id,id),
  UNIQUE(company_id,refund_number),
  UNIQUE(company_id,id)
);
CREATE INDEX purchase_return_refunds_return_idx
  ON purchase_return_refunds(company_id,purchase_return_id,refund_date);
CREATE INDEX purchase_return_refunds_supplier_idx
  ON purchase_return_refunds(company_id,supplier_id,refund_date DESC);

CREATE FUNCTION enforce_purchase_return_refund_branch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE return_branch uuid;
BEGIN
  SELECT branch_id INTO return_branch FROM purchase_returns
   WHERE company_id=NEW.company_id AND id=NEW.purchase_return_id;
  IF NEW.branch_id IS DISTINCT FROM return_branch THEN
    RAISE EXCEPTION 'supplier refund branch must match its return credit';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER purchase_return_refunds_branch_consistency
  BEFORE INSERT OR UPDATE OF purchase_return_id,branch_id ON purchase_return_refunds
  FOR EACH ROW EXECUTE FUNCTION enforce_purchase_return_refund_branch();

INSERT INTO permissions(code,module,action,description) VALUES
 ('purchases.credit.refund','purchases','credit_refund','Record a supplier refund against an unused return credit')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='purchases.credit.refund'
 WHERE r.system_role=true AND r.code='owner' ON CONFLICT DO NOTHING;

INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
 SELECT id,'supplier_credit_refund','SREF-',1,5 FROM companies ON CONFLICT DO NOTHING;
