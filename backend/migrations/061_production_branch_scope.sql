ALTER TABLE production_batches
  ADD COLUMN branch_id uuid;

ALTER TABLE production_batches
  ADD CONSTRAINT production_batches_branch_fk
  FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id);

CREATE INDEX production_batches_branch_recent_idx
  ON production_batches(company_id,branch_id,started_on DESC,created_at DESC);

INSERT INTO stock_locations(company_id,code,name,branch_id)
SELECT b.company_id,
       'BR-'||substr(replace(b.id::text,'-',''),1,12),
       b.name||' yard',
       b.id
FROM branches b
WHERE b.active=true
ON CONFLICT(company_id,code) DO NOTHING;
