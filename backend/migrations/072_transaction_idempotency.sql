CREATE TABLE transaction_idempotency_keys (
  company_id uuid NOT NULL REFERENCES companies(id),
  user_id uuid NOT NULL REFERENCES users(id),
  operation text NOT NULL CHECK(length(operation) BETWEEN 1 AND 160),
  request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
  request_hash char(64) NOT NULL,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY(company_id,user_id,operation,request_key),
  CHECK((response_status IS NULL)=(response_body IS NULL)),
  CHECK(response_status IS NULL OR response_status BETWEEN 200 AND 299)
);
CREATE INDEX transaction_idempotency_created_idx ON transaction_idempotency_keys(created_at);

CREATE OR REPLACE FUNCTION revert_transaction_idempotency() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM transaction_idempotency_keys) THEN
    RAISE EXCEPTION 'Idempotency keys exist; retain this table to prevent duplicate financial operations.';
  END IF;
  DROP TABLE transaction_idempotency_keys;
END;
$$;
