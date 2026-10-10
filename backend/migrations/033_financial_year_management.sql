-- Financial year calendar. Posting remains governed by the existing monthly close
-- until journal entries and all balance reports are explicitly year-scoped.
CREATE TABLE IF NOT EXISTS financial_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closing','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  UNIQUE(company_id,name),
  UNIQUE(company_id,id)
);

CREATE INDEX IF NOT EXISTS financial_years_company_dates_idx ON financial_years(company_id,starts_on,ends_on);

CREATE OR REPLACE FUNCTION reject_overlapping_financial_years() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM financial_years fy
    WHERE fy.company_id=NEW.company_id AND fy.id IS DISTINCT FROM NEW.id
      AND daterange(fy.starts_on,fy.ends_on,'[]') && daterange(NEW.starts_on,NEW.ends_on,'[]')
  ) THEN
    RAISE EXCEPTION 'Financial year date range overlaps an existing year.' USING ERRCODE='23P01';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS financial_years_no_overlap ON financial_years;
CREATE TRIGGER financial_years_no_overlap
BEFORE INSERT OR UPDATE OF company_id,starts_on,ends_on ON financial_years
FOR EACH ROW EXECUTE FUNCTION reject_overlapping_financial_years();

INSERT INTO permissions(code,module,action,description) VALUES
 ('accounting.financial-years.view','accounting','financial_year_view','View financial year calendar'),
 ('accounting.financial-years.configure','accounting','financial_year_configure','Configure financial year calendar')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN ('accounting.financial-years.view','accounting.financial-years.configure')
WHERE r.system_role=true AND r.code='owner' ON CONFLICT DO NOTHING;

-- Seed a practical current year for existing and newly initialized companies.
-- Indian fiscal year runs April 1 to March 31; the year containing today is used.
INSERT INTO financial_years(company_id,name,starts_on,ends_on)
SELECT c.id, CASE WHEN current_date >= make_date(extract(year from current_date)::int,4,1)
  THEN extract(year from current_date)::int::text || '-' || (extract(year from current_date)::int+1)::text
  ELSE (extract(year from current_date)::int-1)::text || '-' || extract(year from current_date)::int::text END,
  CASE WHEN current_date >= make_date(extract(year from current_date)::int,4,1)
    THEN make_date(extract(year from current_date)::int,4,1) ELSE make_date(extract(year from current_date)::int-1,4,1) END,
  CASE WHEN current_date >= make_date(extract(year from current_date)::int,4,1)
    THEN make_date(extract(year from current_date)::int+1,3,31) ELSE make_date(extract(year from current_date)::int,3,31) END
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM financial_years fy WHERE fy.company_id=c.id AND current_date BETWEEN fy.starts_on AND fy.ends_on)
ON CONFLICT(company_id,name) DO NOTHING;
