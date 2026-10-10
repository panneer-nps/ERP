INSERT INTO permissions(code,module,action,description) VALUES
  ('employees.advance.configure','employees','configure','Configure employee advance approval limits')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='employees.advance.configure'
WHERE r.system_role=true AND r.code='owner'
ON CONFLICT DO NOTHING;
