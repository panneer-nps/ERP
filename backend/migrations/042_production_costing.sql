CREATE TABLE production_cost_settings (
  company_id uuid PRIMARY KEY REFERENCES companies(id),
  overhead_method text NOT NULL DEFAULT 'none' CHECK (overhead_method IN ('none','percentage','fixed_per_batch')),
  overhead_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (overhead_value >= 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(company_id,updated_by) REFERENCES users(company_id,id),
  CHECK ((overhead_method='none' AND overhead_value=0) OR overhead_method<>'none')
);

ALTER TABLE production_batches ADD COLUMN overhead_method text NOT NULL DEFAULT 'none'
  CHECK (overhead_method IN ('none','percentage','fixed_per_batch'));
ALTER TABLE production_batches ADD COLUMN overhead_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (overhead_value>=0);

CREATE TABLE production_cost_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  batch_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('material','fuel','labour','electricity','water','loading_unloading','maintenance','other')),
  description text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount>0),
  incurred_on date NOT NULL DEFAULT CURRENT_DATE,
  reference text NOT NULL DEFAULT '',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(company_id,batch_id) REFERENCES production_batches(company_id,id),
  FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
  UNIQUE(company_id,id)
);
CREATE INDEX production_cost_lines_batch_date_idx ON production_cost_lines(company_id,batch_id,incurred_on,created_at);

INSERT INTO production_cost_settings(company_id) SELECT id FROM companies ON CONFLICT DO NOTHING;
INSERT INTO permissions(code,module,action,description) VALUES
  ('production.costs.manage','production','manage','Configure production overhead allocation')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='production.costs.manage'
WHERE r.system_role=true AND r.code='owner' ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION snapshot_production_overhead_policy() RETURNS trigger AS $$
BEGIN
  SELECT overhead_method,overhead_value INTO NEW.overhead_method,NEW.overhead_value
  FROM production_cost_settings WHERE company_id=NEW.company_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER production_batches_overhead_snapshot
BEFORE INSERT ON production_batches FOR EACH ROW EXECUTE FUNCTION snapshot_production_overhead_policy();
