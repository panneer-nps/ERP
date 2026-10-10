INSERT INTO roles(company_id,code,name,read_only,system_role)
SELECT id,'auditor','Auditor',true,true FROM companies
ON CONFLICT(company_id,code) DO UPDATE SET read_only=true,system_role=true;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.action='view' OR p.code='audit.view'
WHERE r.code='auditor' AND r.system_role=true
ON CONFLICT DO NOTHING;
