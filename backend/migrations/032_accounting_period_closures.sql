CREATE TABLE accounting_period_closures (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 close_number text NOT NULL,
 period_start date NOT NULL,
 period_end date NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason))>=10),
 closed_by uuid NOT NULL,
 closed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,closed_by) REFERENCES users(company_id,id),
 UNIQUE(company_id,id),
 UNIQUE(company_id,close_number),
 UNIQUE(company_id,period_start),
 CHECK(period_start=date_trunc('month',period_start)::date),
 CHECK(period_end=(date_trunc('month',period_start)+interval '1 month - 1 day')::date)
);
CREATE INDEX accounting_period_closures_range_idx ON accounting_period_closures(company_id,period_start,period_end);

INSERT INTO permissions(code,module,action,description) VALUES
 ('accounting.period.close.view','accounting','period_close_view','View accounting period closures'),
 ('accounting.period.close','accounting','period_close','Close a reconciled accounting month')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN ('accounting.period.close.view','accounting.period.close')
WHERE r.system_role=true AND r.code='owner' ON CONFLICT DO NOTHING;
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
SELECT id,'accounting_period_close','MC-',1,5 FROM companies ON CONFLICT DO NOTHING;

CREATE FUNCTION prevent_closed_period_stock_movements() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE company_timezone text; movement_date date;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('accounting-period:'||NEW.company_id::text,0));
  SELECT timezone INTO company_timezone FROM companies WHERE id=NEW.company_id;
  movement_date := (NEW.occurred_at AT TIME ZONE COALESCE(company_timezone,'Asia/Kolkata'))::date;
  IF EXISTS(SELECT 1 FROM accounting_period_closures c WHERE c.company_id=NEW.company_id AND movement_date BETWEEN c.period_start AND c.period_end) THEN
    RAISE EXCEPTION 'Stock movements cannot be backdated into a closed accounting period.' USING ERRCODE='P0001',CONSTRAINT='accounting_period_stock_lock';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stock_movements_accounting_period_lock
BEFORE INSERT ON stock_movements
FOR EACH ROW EXECUTE FUNCTION prevent_closed_period_stock_movements();
