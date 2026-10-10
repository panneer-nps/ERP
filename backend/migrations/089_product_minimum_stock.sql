ALTER TABLE products
  ADD COLUMN minimum_stock numeric(14,2) NOT NULL DEFAULT 0
  CHECK (minimum_stock >= 0);

COMMENT ON COLUMN products.minimum_stock IS 'Company-configured low-stock alert threshold in the product base unit; zero disables the alert.';
