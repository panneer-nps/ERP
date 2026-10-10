ALTER TABLE loading_photos
  ALTER COLUMN image_data DROP NOT NULL,
  ADD COLUMN storage_key text,
  ADD CONSTRAINT loading_photos_storage_location_check
    CHECK ((image_data IS NULL) <> (storage_key IS NULL));

CREATE UNIQUE INDEX loading_photos_storage_key_idx
  ON loading_photos(company_id, storage_key)
  WHERE storage_key IS NOT NULL;
