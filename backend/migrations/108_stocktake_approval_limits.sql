-- Stocktake approval is a monetary action for the built-in Manager role.
-- Migration 106 already created the per-role cap table; without a configured
-- cap, the API fails closed for Managers while Owner review remains unrestricted.
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.code='stocktake.approve'
WHERE r.system_role=true AND r.code='manager'
ON CONFLICT DO NOTHING;
