ALTER TABLE inventory_cost_layers
  DROP CONSTRAINT inventory_cost_layers_source_type_check;
ALTER TABLE inventory_cost_layers
  ADD CONSTRAINT inventory_cost_layers_source_type_check
  CHECK (source_type IN ('purchase_receipt','production_batch','customer_return','opening_balance','adjustment','transfer','valuation_reconciliation'));

CREATE TABLE inventory_valuation_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  reconciliation_number text NOT NULL,
  location_id uuid NOT NULL,
  branch_id uuid,
  effective_date date NOT NULL,
  reason text NOT NULL,
  total_value numeric(14,2) NOT NULL CHECK (total_value > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(company_id,location_id) REFERENCES stock_locations(company_id,id),
  FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id),
  FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
  UNIQUE(company_id,id),
  UNIQUE(company_id,reconciliation_number)
);
CREATE INDEX inventory_valuation_reconciliations_location_idx
  ON inventory_valuation_reconciliations(company_id,location_id,effective_date DESC);

CREATE TABLE inventory_valuation_reconciliation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  reconciliation_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quality text NOT NULL CHECK (quality IN ('good','second','damaged')),
  quantity numeric(14,2) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(14,4) NOT NULL CHECK (unit_cost > 0),
  total_value numeric(14,2) NOT NULL CHECK (total_value > 0),
  FOREIGN KEY(company_id,reconciliation_id) REFERENCES inventory_valuation_reconciliations(company_id,id),
  FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
  UNIQUE(company_id,reconciliation_id,product_id,quality),
  UNIQUE(company_id,id)
);

CREATE FUNCTION enforce_inventory_valuation_reconciliation_branch() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE location_branch uuid;
BEGIN
  SELECT branch_id INTO location_branch
    FROM stock_locations
   WHERE company_id = NEW.company_id AND id = NEW.location_id;
  IF NOT FOUND OR location_branch IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION 'Reconciliation branch must match its stock location'
      USING ERRCODE = '23514', CONSTRAINT = 'inventory_valuation_reconciliation_branch_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inventory_valuation_reconciliation_branch_check
  BEFORE INSERT OR UPDATE OF company_id, location_id, branch_id
  ON inventory_valuation_reconciliations
  FOR EACH ROW EXECUTE FUNCTION enforce_inventory_valuation_reconciliation_branch();

INSERT INTO permissions(code,module,action,description) VALUES
 ('inventory.valuation.reconcile','inventory','valuation_reconcile','Reconcile the cost of existing unvalued stock')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='inventory.valuation.reconcile'
 WHERE r.system_role=true AND r.code='owner' ON CONFLICT DO NOTHING;

INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
 SELECT id,'inventory_valuation_reconciliation','IVR-',1,5 FROM companies ON CONFLICT DO NOTHING;
