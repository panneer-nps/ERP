CREATE TABLE low_stock_alert_state (
  company_id uuid NOT NULL REFERENCES companies(id),
  branch_id uuid,
  product_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id, id),
  FOREIGN KEY (company_id, product_id) REFERENCES products(company_id, id),
  UNIQUE NULLS NOT DISTINCT (company_id, branch_id, product_id)
);

CREATE OR REPLACE FUNCTION notify_owners_low_stock_from_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE preferences jsonb;
BEGIN
  SELECT value INTO preferences FROM company_settings WHERE company_id=NEW.company_id AND key='notification_preferences';
  IF COALESCE(preferences->'low_stock','true'::jsonb)='false'::jsonb THEN RETURN NEW; END IF;
  INSERT INTO user_notifications(company_id,branch_id,recipient_user_id,source_audit_id,event_type,title_en,title_ta,body_en,body_ta,href,entity_type,entity_id)
  SELECT NEW.company_id,NEW.branch_id,ur.user_id,NEW.id,'low_stock',
    'Low stock: '||COALESCE(NEW.after_data->>'productName',NEW.entity_id),
    'குறைந்த சரக்கு: '||COALESCE(NEW.after_data->>'productName',NEW.entity_id),
    'Available '||COALESCE(NEW.after_data->>'available','0')||' '||COALESCE(NEW.after_data->>'unit','')||'; minimum '||COALESCE(NEW.after_data->>'minimum','0')||'.',
    'கிடைப்பில் '||COALESCE(NEW.after_data->>'available','0')||' '||COALESCE(NEW.after_data->>'unit','')||'; குறைந்தபட்சம் '||COALESCE(NEW.after_data->>'minimum','0')||'.',
    '/masters?kind=products','product',NEW.entity_id
  FROM user_roles ur JOIN roles r ON r.company_id=ur.company_id AND r.id=ur.role_id JOIN users u ON u.company_id=ur.company_id AND u.id=ur.user_id
  WHERE ur.company_id=NEW.company_id AND r.code='owner' AND u.active=true
  ON CONFLICT (recipient_user_id,source_audit_id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_low_stock_owner_notifications AFTER INSERT ON audit_logs
FOR EACH ROW WHEN (NEW.action='inventory.low_stock.alert') EXECUTE FUNCTION notify_owners_low_stock_from_audit();

UPDATE company_settings SET value=jsonb_set(value,'{low_stock}','true'::jsonb,true),updated_at=now()
WHERE key='notification_preferences' AND NOT (value ? 'low_stock');
