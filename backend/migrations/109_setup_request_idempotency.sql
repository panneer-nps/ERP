CREATE TABLE setup_idempotency_keys (
  request_key text PRIMARY KEY CHECK(length(request_key) BETWEEN 16 AND 128),
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  response_status integer NOT NULL CHECK(response_status BETWEEN 200 AND 299),
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
