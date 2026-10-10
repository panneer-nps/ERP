ALTER TABLE purchase_returns
  ADD CONSTRAINT purchase_returns_company_id_supplier_id_uq UNIQUE(company_id,id,supplier_id);

CREATE TABLE purchase_return_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  purchase_return_id uuid NOT NULL,
  bill_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL CHECK(amount > 0),
  allocation_date date NOT NULL DEFAULT CURRENT_DATE,
  reason text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(company_id,purchase_return_id,supplier_id) REFERENCES purchase_returns(company_id,id,supplier_id),
  FOREIGN KEY(company_id,bill_id,supplier_id) REFERENCES purchase_bills(company_id,id,supplier_id),
  FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
  UNIQUE(company_id,id)
);
CREATE INDEX purchase_return_allocations_return_idx ON purchase_return_allocations(company_id,purchase_return_id,allocation_date);
CREATE INDEX purchase_return_allocations_bill_idx ON purchase_return_allocations(company_id,bill_id,allocation_date);

WITH ranked_returns AS (
  SELECT pr.id,pr.company_id,pr.bill_id,pr.supplier_id,pr.total,pr.return_date,pr.return_number,pr.created_by,
    COALESCE(SUM(pr.total) OVER(PARTITION BY pr.company_id,pr.bill_id ORDER BY pr.return_date,pr.return_number ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) prior_returns,
    b.total-COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.company_id=b.company_id AND sp.bill_id=b.id),0) bill_after_payments
  FROM purchase_returns pr JOIN purchase_bills b ON b.company_id=pr.company_id AND b.id=pr.bill_id
), initial_applications AS (
  SELECT rr.*,LEAST(rr.total,GREATEST(rr.bill_after_payments-rr.prior_returns,0)) applied
  FROM ranked_returns rr
)
INSERT INTO purchase_return_allocations(company_id,purchase_return_id,bill_id,supplier_id,amount,allocation_date,reason,created_by)
SELECT company_id,id,bill_id,supplier_id,applied,return_date,'Automatically applied to originating supplier bill',created_by
FROM initial_applications WHERE applied>0;

INSERT INTO permissions(code,module,action,description) VALUES
 ('purchases.credit.apply','purchases','credit_apply','Apply unused supplier return credit to another bill')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='purchases.credit.apply'
 WHERE r.system_role=true AND r.code='owner' ON CONFLICT DO NOTHING;
