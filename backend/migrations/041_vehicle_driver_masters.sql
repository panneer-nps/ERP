CREATE TABLE vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  code text NOT NULL,
  vehicle_type text NOT NULL DEFAULT '',
  capacity numeric(14,2) CHECK (capacity IS NULL OR capacity >= 0),
  capacity_unit text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,code),
  UNIQUE(company_id,id)
);
CREATE INDEX vehicles_company_active_idx ON vehicles(company_id,active,lower(name));

CREATE TABLE drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  full_name text NOT NULL,
  license_number text NOT NULL,
  license_type text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,license_number),
  UNIQUE(company_id,id)
);
CREATE INDEX drivers_company_active_idx ON drivers(company_id,active,lower(full_name));

ALTER TABLE loading_sessions ADD COLUMN vehicle_id uuid;
ALTER TABLE loading_sessions ADD COLUMN driver_id uuid;
ALTER TABLE loading_sessions ADD CONSTRAINT loading_sessions_vehicle_fk FOREIGN KEY(company_id,vehicle_id) REFERENCES vehicles(company_id,id);
ALTER TABLE loading_sessions ADD CONSTRAINT loading_sessions_driver_fk FOREIGN KEY(company_id,driver_id) REFERENCES drivers(company_id,id);
CREATE INDEX loading_sessions_vehicle_idx ON loading_sessions(company_id,vehicle_id,started_at DESC);
CREATE INDEX loading_sessions_driver_idx ON loading_sessions(company_id,driver_id,started_at DESC);
