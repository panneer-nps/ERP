ALTER TABLE business_partners
  ADD COLUMN business_name text NOT NULL DEFAULT '',
  ADD COLUMN whatsapp_number text NOT NULL DEFAULT '',
  ADD COLUMN pan text NOT NULL DEFAULT '',
  ADD COLUMN customer_type text NOT NULL DEFAULT '',
  ADD COLUMN payment_terms text NOT NULL DEFAULT '',
  ADD COLUMN supplied_materials text[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT business_partners_pan_format_ck
    CHECK (pan = '' OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$');
