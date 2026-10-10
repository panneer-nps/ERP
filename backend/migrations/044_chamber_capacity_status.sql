ALTER TABLE chambers ADD COLUMN sections integer NOT NULL DEFAULT 1 CHECK (sections > 0);
ALTER TABLE chambers ADD COLUMN location text NOT NULL DEFAULT '';
ALTER TABLE chambers ADD COLUMN operational_status text NOT NULL DEFAULT 'available'
  CHECK (operational_status IN ('available','maintenance','out_of_service'));
CREATE INDEX chambers_capacity_status_idx ON chambers(company_id,operational_status,active);

INSERT INTO permissions(code,module,action,description) VALUES
  ('chambers.status.manage','masters','manage','Set chamber operational status')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='chambers.status.manage'
WHERE r.system_role=true AND r.code='owner' ON CONFLICT DO NOTHING;
