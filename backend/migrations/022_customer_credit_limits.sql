ALTER TABLE business_partners
 ADD COLUMN credit_limit numeric(14,2) CHECK (credit_limit IS NULL OR credit_limit>=0);
