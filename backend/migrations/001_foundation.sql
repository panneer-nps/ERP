CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  legal_name text,
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  gstin text,
  pan text,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  code text NOT NULL,
  name text NOT NULL,
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  UNIQUE (company_id, id)
);

CREATE TABLE financial_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closing', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  UNIQUE (company_id, name),
  UNIQUE (company_id, id)
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  email text NOT NULL,
  full_name text NOT NULL,
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, email)
);
CREATE UNIQUE INDEX users_email_lower_uq ON users(lower(email));

CREATE TABLE user_branches (
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  PRIMARY KEY (company_id, user_id, branch_id),
  FOREIGN KEY (company_id, user_id) REFERENCES users(company_id, id),
  FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id, id)
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  code text NOT NULL,
  name text NOT NULL,
  read_only boolean NOT NULL DEFAULT false,
  system_role boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  UNIQUE (company_id, id)
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  module text NOT NULL,
  action text NOT NULL,
  description text NOT NULL
);

CREATE TABLE user_roles (
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id, role_id),
  FOREIGN KEY (company_id, user_id) REFERENCES users(company_id, id),
  FOREIGN KEY (company_id, role_id) REFERENCES roles(company_id, id)
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id),
  permission_id uuid NOT NULL REFERENCES permissions(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid,
  token_hash char(64) NOT NULL UNIQUE,
  ip_address inet,
  user_agent text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, user_id) REFERENCES users(company_id, id),
  FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id, id)
);
CREATE INDEX sessions_user_active_idx ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE company_settings (
  company_id uuid NOT NULL REFERENCES companies(id),
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, key),
  FOREIGN KEY (company_id, updated_by) REFERENCES users(company_id, id)
);

CREATE TABLE number_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  branch_id uuid,
  document_type text NOT NULL,
  prefix text NOT NULL DEFAULT '',
  next_value bigint NOT NULL DEFAULT 1 CHECK (next_value > 0),
  padding integer NOT NULL DEFAULT 0 CHECK (padding >= 0),
  financial_year_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id, id),
  FOREIGN KEY (company_id, financial_year_id) REFERENCES financial_years(company_id, id),
  UNIQUE NULLS NOT DISTINCT (company_id, branch_id, document_type, financial_year_id)
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  branch_id uuid,
  actor_user_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  reason text,
  before_data jsonb,
  after_data jsonb,
  request_id text,
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id, id),
  FOREIGN KEY (company_id, actor_user_id) REFERENCES users(company_id, id)
);
CREATE INDEX audit_logs_company_time_idx ON audit_logs(company_id, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs(company_id, entity_type, entity_id);

INSERT INTO permissions (code, module, action, description) VALUES
  ('users.view', 'users', 'view', 'View user accounts'),
  ('users.create', 'users', 'create', 'Create user accounts'),
  ('users.edit', 'users', 'edit', 'Edit user accounts'),
  ('users.configure', 'users', 'configure', 'Configure roles and permissions'),
  ('audit.view', 'audit', 'view', 'View audit history'),
  ('company.configure', 'company', 'configure', 'Configure company settings');

