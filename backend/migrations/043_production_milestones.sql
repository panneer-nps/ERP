ALTER TABLE production_batches DROP CONSTRAINT production_batches_status_check;
UPDATE production_batches SET status='loading' WHERE status='running';
ALTER TABLE production_batches ADD CONSTRAINT production_batches_status_check
  CHECK (status IN ('planned','loading','firing','cooling','unloading','completed','cancelled'));
ALTER TABLE production_batches ADD COLUMN loaded_quantity numeric(14,2) CHECK (loaded_quantity IS NULL OR loaded_quantity>=0);
ALTER TABLE production_batches ADD COLUMN loss_quantity numeric(14,2) CHECK (loss_quantity IS NULL OR loss_quantity>=0);

CREATE TABLE production_batch_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  batch_id uuid NOT NULL,
  milestone text NOT NULL CHECK (milestone IN ('planned','loading','firing','cooling','unloading','completed','cancelled')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  quantity numeric(14,2) CHECK (quantity IS NULL OR quantity>=0),
  notes text NOT NULL DEFAULT '',
  recorded_by uuid NOT NULL,
  FOREIGN KEY(company_id,batch_id) REFERENCES production_batches(company_id,id),
  FOREIGN KEY(company_id,recorded_by) REFERENCES users(company_id,id),
  UNIQUE(company_id,batch_id,milestone),
  UNIQUE(company_id,id)
);
CREATE INDEX production_batch_milestones_history_idx ON production_batch_milestones(company_id,batch_id,occurred_at,id);

INSERT INTO production_batch_milestones(company_id,batch_id,milestone,occurred_at,notes,recorded_by)
SELECT company_id,id,'planned',created_at,'Imported from existing batch record',created_by FROM production_batches;
INSERT INTO production_batch_milestones(company_id,batch_id,milestone,occurred_at,notes,recorded_by)
SELECT company_id,id,status,CASE WHEN status='completed' THEN COALESCE(completed_at,updated_at) ELSE updated_at END,
  CASE WHEN status IN ('completed','cancelled') THEN 'Imported historical terminal state; earlier milestone times were not recorded.' ELSE 'Imported existing in-progress batch.' END,created_by
FROM production_batches WHERE status IN ('loading','completed','cancelled');
