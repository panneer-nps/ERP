CREATE TABLE payment_reminder_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  branch_id uuid,
  customer_id uuid NOT NULL,
  customer_name_snapshot text NOT NULL,
  outstanding_amount numeric(14,2) NOT NULL CHECK (outstanding_amount > 0),
  language text NOT NULL CHECK (language IN ('en','ta')),
  message text NOT NULL CHECK (length(message) BETWEEN 20 AND 2000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','archived')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id),
  FOREIGN KEY(company_id,customer_id) REFERENCES business_partners(company_id,id),
  FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
  UNIQUE(company_id,id)
);
CREATE INDEX payment_reminder_drafts_recent_idx ON payment_reminder_drafts(company_id,created_at DESC);
CREATE INDEX payment_reminder_drafts_customer_idx ON payment_reminder_drafts(company_id,customer_id,created_at DESC);
