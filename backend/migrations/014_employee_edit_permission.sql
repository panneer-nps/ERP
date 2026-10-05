INSERT INTO permissions(code,module,action,description)
 VALUES('employees.edit','employees','edit','Edit and deactivate employee records')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='employees.edit'
 WHERE r.system_role=true AND r.code='owner'
ON CONFLICT DO NOTHING;
