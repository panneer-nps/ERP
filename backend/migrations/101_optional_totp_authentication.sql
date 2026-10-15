CREATE TABLE user_totp (
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  secret_ciphertext text,
  enabled_at timestamptz,
  pending_secret_ciphertext text,
  pending_expires_at timestamptz,
  recovery_code_hashes text[] NOT NULL DEFAULT '{}',
  last_totp_counter bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id),
  FOREIGN KEY (company_id, user_id) REFERENCES users(company_id, id) ON DELETE CASCADE,
  CHECK ((enabled_at IS NULL) = (secret_ciphertext IS NULL)),
  CHECK ((pending_expires_at IS NULL) = (pending_secret_ciphertext IS NULL))
);

CREATE TABLE auth_login_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,
  ip_address inet,
  user_agent text,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  FOREIGN KEY (company_id, user_id) REFERENCES users(company_id, id) ON DELETE CASCADE
);

CREATE INDEX auth_login_challenges_expiry_idx ON auth_login_challenges(expires_at);
