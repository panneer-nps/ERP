-- FIFO inventory cost layers. Existing movements are deliberately not assigned a
-- fabricated cost; the valuation report surfaces such quantities as unvalued.
CREATE TABLE inventory_cost_layers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  product_id uuid NOT NULL,
  quality text NOT NULL CHECK (quality IN ('good','second','damaged')),
  location_id uuid NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('purchase_receipt','production_batch','customer_return','opening_balance','adjustment','transfer')),
  source_id uuid NOT NULL,
  source_line_id uuid,
  received_quantity numeric(14,2) NOT NULL CHECK (received_quantity > 0),
  remaining_quantity numeric(14,2) NOT NULL CHECK (remaining_quantity >= 0 AND remaining_quantity <= received_quantity),
  unit_cost numeric(14,4) NOT NULL CHECK (unit_cost >= 0),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
  FOREIGN KEY(company_id,location_id) REFERENCES stock_locations(company_id,id),
  UNIQUE(company_id,id)
);
CREATE INDEX inventory_cost_layers_fifo_idx ON inventory_cost_layers(company_id,product_id,quality,location_id,occurred_at,id) WHERE remaining_quantity > 0;
CREATE INDEX inventory_cost_layers_source_idx ON inventory_cost_layers(company_id,source_type,source_id);

-- The movement table has a global primary key but lacks the composite key needed
-- to enforce company-scoped references from valuation records.
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_company_id_id_key UNIQUE(company_id,id);

CREATE TABLE inventory_cost_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  stock_movement_id uuid NOT NULL,
  cost_layer_id uuid NOT NULL,
  quantity numeric(14,2) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(14,4) NOT NULL CHECK (unit_cost >= 0),
  extended_cost numeric(14,2) NOT NULL CHECK (extended_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(company_id,stock_movement_id) REFERENCES stock_movements(company_id,id),
  FOREIGN KEY(company_id,cost_layer_id) REFERENCES inventory_cost_layers(company_id,id),
  UNIQUE(company_id,id)
);
CREATE INDEX inventory_cost_consumptions_movement_idx ON inventory_cost_consumptions(company_id,stock_movement_id);
CREATE INDEX inventory_cost_consumptions_layer_idx ON inventory_cost_consumptions(company_id,cost_layer_id);

ALTER TABLE stock_movements ADD COLUMN valuation_status text NOT NULL DEFAULT 'unvalued'
  CHECK (valuation_status IN ('valued','unvalued'));
ALTER TABLE stock_movements ADD COLUMN inventory_cost numeric(14,2);
ALTER TABLE stock_movements ADD CONSTRAINT stock_movement_cost_status_ck
  CHECK ((valuation_status='unvalued' AND inventory_cost IS NULL) OR (valuation_status='valued' AND inventory_cost IS NOT NULL AND inventory_cost>=0));

INSERT INTO accounts(company_id,code,name,account_type,group_id,system_managed)
SELECT c.id,'5100','Cost of goods sold','expense',g.id,true
FROM companies c JOIN account_groups g ON g.company_id=c.id AND g.code='EXPENSES'
ON CONFLICT(company_id,code) DO NOTHING;
INSERT INTO accounts(company_id,code,name,account_type,group_id,system_managed)
SELECT c.id,'4300','Inventory return cost variance','income',g.id,true
FROM companies c JOIN account_groups g ON g.company_id=c.id AND g.code='INCOME'
ON CONFLICT(company_id,code) DO NOTHING;

INSERT INTO permissions(code,module,action,description) VALUES
  ('inventory.valuation.view','inventory','view','View FIFO inventory valuation and unvalued stock')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='inventory.valuation.view'
WHERE r.system_role=true AND r.code IN ('owner','auditor') ON CONFLICT DO NOTHING;

ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_movement_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check CHECK(movement_type IN ('production_in','sale_out','customer_return','damage','adjustment','purchase_in','purchase_return','transfer','opening_in','sale_reversal_in'));
