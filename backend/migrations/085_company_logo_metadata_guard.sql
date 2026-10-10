ALTER TABLE companies
  ADD CONSTRAINT companies_logo_metadata_consistency_check
  CHECK (
    (logo_data IS NULL AND logo_storage_key IS NULL AND logo_content_type IS NULL AND logo_byte_size IS NULL)
    OR (
      logo_content_type IS NOT NULL
      AND logo_byte_size BETWEEN 1 AND 1048576
      AND (
        (logo_data IS NOT NULL AND logo_storage_key IS NULL AND logo_byte_size = octet_length(logo_data))
        OR (logo_data IS NULL AND logo_storage_key IS NOT NULL)
      )
    )
  );
