-- Notify Owners when a broker commission accrues and becomes payable.
-- Preserve all existing notification preferences for each company.
UPDATE company_settings
SET value=jsonb_set(value,'{broker_commission_pending}','true'::jsonb,true),updated_at=now()
WHERE key='notification_preferences' AND NOT (value ? 'broker_commission_pending');

CREATE FUNCTION notify_owners_broker_commission_pending() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  preferences jsonb;
BEGIN
  IF NEW.action <> 'broker.commission.accrue' THEN RETURN NEW; END IF;

  SELECT value INTO preferences FROM company_settings WHERE company_id=NEW.company_id AND key='notification_preferences';
  IF COALESCE(preferences->'broker_commission_pending','true'::jsonb)='false'::jsonb THEN RETURN NEW; END IF;

  INSERT INTO user_notifications(company_id,branch_id,recipient_user_id,source_audit_id,event_type,title_en,title_ta,body_en,body_ta,href,entity_type,entity_id)
  SELECT NEW.company_id,NEW.branch_id,ur.user_id,NEW.id,'broker_commission_pending',
    'Broker commission is payable','தரகர் கமிஷன் செலுத்த வேண்டியுள்ளது',
    'Commission accrued: ₹'||COALESCE(NEW.after_data->>'amount','0'),
    'கமிஷன் சேர்க்கப்பட்டது: ₹'||COALESCE(NEW.after_data->>'amount','0'),
    '/brokers',NEW.entity_type,NEW.entity_id
  FROM user_roles ur
  JOIN roles r ON r.company_id=ur.company_id AND r.id=ur.role_id
  JOIN users u ON u.company_id=ur.company_id AND u.id=ur.user_id
  WHERE ur.company_id=NEW.company_id AND r.code='owner' AND u.active=true
  ON CONFLICT(recipient_user_id,source_audit_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_owner_broker_commission_notifications
AFTER INSERT ON audit_logs
FOR EACH ROW WHEN (NEW.action='broker.commission.accrue')
EXECUTE FUNCTION notify_owners_broker_commission_pending();
