-- Separate recording actual loaded quantity from independent verification.
INSERT INTO permissions(code,module,action,description,manager_default)
VALUES('loading.verify','loading','verify','Independently verify loaded quantities',true)
ON CONFLICT(code) DO NOTHING;

-- Preserve verification access for roles that already could edit loading records.
INSERT INTO role_permissions(role_id,permission_id)
SELECT existing.role_id, verify_permission.id
FROM role_permissions existing
JOIN permissions edit_permission ON edit_permission.id=existing.permission_id AND edit_permission.code='loading.edit'
CROSS JOIN permissions verify_permission
WHERE verify_permission.code='loading.verify'
ON CONFLICT DO NOTHING;

-- New companies receive this preset during Owner setup/bootstrap as well.
INSERT INTO roles(company_id,code,name,read_only,system_role)
SELECT id,'loading_verifier','Loading Verifier',false,true FROM companies
ON CONFLICT(company_id,code) DO UPDATE SET name='Loading Verifier',read_only=false,system_role=true
WHERE roles.system_role=true;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN ('loading.view','loading.verify')
WHERE r.code='loading_verifier' AND r.system_role=true
ON CONFLICT DO NOTHING;
