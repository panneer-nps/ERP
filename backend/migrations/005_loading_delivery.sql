CREATE TABLE loading_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  loading_number text NOT NULL,
  invoice_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quality text NOT NULL CHECK (quality IN ('good','second')),
  planned_quantity numeric(14,2) NOT NULL CHECK (planned_quantity > 0),
  loaded_quantity numeric(14,2) CHECK (loaded_quantity >= 0),
  verified_quantity numeric(14,2) CHECK (verified_quantity >= 0),
  variance numeric(14,2),
  vehicle_registration text,
  driver_name text,
  driver_phone text,
  destination text,
  status text NOT NULL DEFAULT 'loading' CHECK (status IN ('loading','loaded','mismatch','verified','dispatched','delivered','cancelled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  verified_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  verified_by uuid,
  approved_by uuid,
  approval_reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id,invoice_id) REFERENCES sales_invoices(company_id,id),
  FOREIGN KEY (company_id,customer_id) REFERENCES business_partners(company_id,id),
  FOREIGN KEY (company_id,product_id) REFERENCES products(company_id,id),
  FOREIGN KEY (company_id,created_by) REFERENCES users(company_id,id),
  FOREIGN KEY (company_id,verified_by) REFERENCES users(company_id,id),
  FOREIGN KEY (company_id,approved_by) REFERENCES users(company_id,id),
  UNIQUE (company_id,id),
  UNIQUE (company_id,loading_number),
  UNIQUE (company_id,invoice_id)
);
CREATE INDEX loading_sessions_status_idx ON loading_sessions(company_id,status,started_at DESC);

CREATE TABLE loading_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  loading_session_id uuid NOT NULL,
  photo_type text NOT NULL CHECK (photo_type IN ('before','during','after')),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
  image_data bytea NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 750000),
  captured_by uuid NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id,loading_session_id) REFERENCES loading_sessions(company_id,id),
  FOREIGN KEY (company_id,captured_by) REFERENCES users(company_id,id)
);
CREATE INDEX loading_photos_session_idx ON loading_photos(company_id,loading_session_id,captured_at);

INSERT INTO permissions(code,module,action,description) VALUES
  ('loading.view','loading','view','View loading and delivery records'),
  ('loading.create','loading','create','Create loading jobs for invoices'),
  ('loading.edit','loading','edit','Record actual loading and verification quantities'),
  ('loading.approve','loading','approve','Approve loading quantity mismatches'),
  ('delivery.dispatch','delivery','dispatch','Dispatch verified loading jobs'),
  ('delivery.complete','delivery','complete','Mark dispatched orders delivered')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.system_role=true AND r.code='owner' AND p.module IN ('loading','delivery')
ON CONFLICT DO NOTHING;

INSERT INTO company_settings(company_id,key,value)
SELECT id,'loading_mismatch_tolerance','0'::jsonb FROM companies
ON CONFLICT(company_id,key) DO NOTHING;
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
SELECT id,'loading_session','LOAD-',1,5 FROM companies
ON CONFLICT DO NOTHING;
