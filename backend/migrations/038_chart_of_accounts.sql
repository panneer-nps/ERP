CREATE TABLE account_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  code text NOT NULL,
  name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('asset','liability','equity','income','expense')),
  parent_group_id uuid,
  system_managed boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(company_id, parent_group_id) REFERENCES account_groups(company_id, id),
  UNIQUE(company_id, code),
  UNIQUE(company_id, id),
  CHECK(parent_group_id IS NULL OR parent_group_id <> id)
);

CREATE INDEX account_groups_company_type_idx ON account_groups(company_id, account_type, active);

ALTER TABLE accounts ADD COLUMN group_id uuid;
ALTER TABLE accounts ADD COLUMN system_managed boolean NOT NULL DEFAULT false;
ALTER TABLE accounts ADD CONSTRAINT accounts_group_fk
  FOREIGN KEY(company_id, group_id) REFERENCES account_groups(company_id, id);
CREATE FUNCTION validate_account_group_type() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE group_type text; group_active boolean;
BEGIN
  IF NEW.group_id IS NULL THEN RETURN NEW; END IF;
  SELECT account_type,active INTO group_type,group_active FROM account_groups
    WHERE company_id=NEW.company_id AND id=NEW.group_id AND active=true;
  IF group_type IS NULL OR group_type<>NEW.account_type OR (NEW.active AND NOT group_active) THEN
    RAISE EXCEPTION 'Account group must be active and match the account type.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER accounts_group_type_guard BEFORE INSERT OR UPDATE OF company_id,group_id,account_type,active ON accounts
FOR EACH ROW EXECUTE FUNCTION validate_account_group_type();

INSERT INTO account_groups(company_id, code, name, account_type, system_managed)
SELECT c.id, g.code, g.name, g.account_type, true
FROM companies c
CROSS JOIN (VALUES
  ('ASSETS','Assets','asset'),
  ('LIABILITIES','Liabilities','liability'),
  ('EQUITY','Equity','equity'),
  ('INCOME','Income','income'),
  ('EXPENSES','Expenses','expense')
) AS g(code,name,account_type)
ON CONFLICT(company_id,code) DO NOTHING;

UPDATE accounts a SET group_id=g.id
FROM account_groups g
WHERE g.company_id=a.company_id AND g.account_type=a.account_type AND g.system_managed=true
  AND a.group_id IS NULL;

ALTER TABLE accounts ALTER COLUMN group_id SET NOT NULL;

UPDATE accounts SET system_managed=true
WHERE code IN ('1100','1110','1120','1200','1300','1400','2100','2150','2200','2300','3000','3100','4100','4200','4300','5100','5300','5900');

INSERT INTO permissions(code,module,action,description) VALUES
  ('accounting.accounts.view','accounting','view','View chart of accounts and account groups'),
  ('accounting.accounts.configure','accounting','configure','Configure chart of accounts and account groups')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN ('accounting.accounts.view','accounting.accounts.configure')
WHERE r.system_role=true AND r.code='owner'
ON CONFLICT DO NOTHING;
