INSERT INTO permissions(code,module,action,description) VALUES
  ('users.roles.manage','users','manage','Create operational roles and assign role permissions')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r CROSS JOIN permissions p
WHERE r.system_role=true AND r.code='owner' AND p.code='users.roles.manage'
ON CONFLICT DO NOTHING;
