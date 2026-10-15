-- Notify Owners when an employee advance needs approval and when a loading
-- verification first discovers a mismatch. Keep prior preferences intact.
UPDATE company_settings
SET value=jsonb_set(value,'{employee_advance}','true'::jsonb,true),updated_at=now()
WHERE key='notification_preferences' AND NOT (value ? 'employee_advance');

CREATE OR REPLACE FUNCTION notify_owners_from_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  event_type_value text;
  title_en_value text;
  title_ta_value text;
  body_en_value text;
  body_ta_value text;
  href_value text;
  preferences jsonb;
BEGIN
  CASE NEW.action
    WHEN 'sales.invoice.post' THEN
      event_type_value := 'sales_invoice'; title_en_value := 'Sales invoice created'; title_ta_value := 'விற்பனை விலைப்பட்டியல் உருவாக்கப்பட்டது';
      body_en_value := 'Invoice ' || COALESCE(NEW.after_data->>'invoiceNumber', NEW.entity_id); body_ta_value := 'விலைப்பட்டியல் ' || COALESCE(NEW.after_data->>'invoiceNumber', NEW.entity_id); href_value := '/sales';
    WHEN 'sales.receipt.post' THEN
      event_type_value := 'payment_received'; title_en_value := 'Customer payment received'; title_ta_value := 'வாடிக்கையாளர் பணம் பெறப்பட்டது';
      body_en_value := 'Receipt ' || COALESCE(NEW.after_data->>'receiptNumber', NEW.entity_id); body_ta_value := 'ரசீது ' || COALESCE(NEW.after_data->>'receiptNumber', NEW.entity_id); href_value := '/sales';
    WHEN 'expense.submit_for_approval' THEN
      event_type_value := 'expense_approval'; title_en_value := 'Expense needs approval'; title_ta_value := 'செலவுக்கு ஒப்புதல் தேவை';
      body_en_value := 'An expense was submitted for review.'; body_ta_value := 'ஒரு செலவு ஒப்புதலுக்காக அனுப்பப்பட்டுள்ளது.'; href_value := '/approvals';
    WHEN 'employee.advance.submit_for_approval' THEN
      event_type_value := 'employee_advance'; title_en_value := 'Employee advance needs approval'; title_ta_value := 'பணியாளர் முன்பணத்திற்கு ஒப்புதல் தேவை';
      body_en_value := COALESCE(NEW.after_data->>'advanceNumber', NEW.entity_id) || ' · ' || COALESCE(NEW.after_data->>'amount', '');
      body_ta_value := 'முன்பணம் ' || COALESCE(NEW.after_data->>'advanceNumber', NEW.entity_id) || ' · ' || COALESCE(NEW.after_data->>'amount', ''); href_value := '/approvals';
    WHEN 'loading.create' THEN
      event_type_value := 'loading_started'; title_en_value := 'Loading started'; title_ta_value := 'ஏற்றுதல் தொடங்கியது';
      body_en_value := 'A new delivery loading session is open.'; body_ta_value := 'புதிய விநியோக ஏற்றுதல் பதிவு தொடங்கப்பட்டது.'; href_value := '/loading';
    WHEN 'loading.complete' THEN
      event_type_value := 'loading_completed'; title_en_value := 'Loading completed'; title_ta_value := 'ஏற்றுதல் முடிந்தது';
      body_en_value := 'A loading session is ready for verification.'; body_ta_value := 'ஏற்றுதல் சரிபார்ப்புக்கு தயாராக உள்ளது.'; href_value := '/loading';
    WHEN 'loading.verify' THEN
      IF NEW.after_data->>'status'='mismatch' THEN
        event_type_value := 'loading_mismatch'; title_en_value := 'Loading mismatch needs attention'; title_ta_value := 'ஏற்றுதல் அளவு வேறுபாட்டைக் கவனிக்கவும்';
        body_en_value := 'Planned ' || COALESCE(NEW.after_data->>'plannedQuantity','?') || ', loaded ' || COALESCE(NEW.after_data->>'loadedQuantity','?') || ', verified ' || COALESCE(NEW.after_data->>'verifiedQuantity','?') || '.';
        body_ta_value := 'திட்டம் ' || COALESCE(NEW.after_data->>'plannedQuantity','?') || ', ஏற்றியது ' || COALESCE(NEW.after_data->>'loadedQuantity','?') || ', சரிபார்த்தது ' || COALESCE(NEW.after_data->>'verifiedQuantity','?') || '.';
      ELSE
        event_type_value := 'loading_verified'; title_en_value := 'Loading verified'; title_ta_value := 'ஏற்றுதல் சரிபார்க்கப்பட்டது';
        body_en_value := 'A loading verification was recorded.'; body_ta_value := 'ஏற்றுதல் சரிபார்ப்பு பதிவு செய்யப்பட்டது.';
      END IF;
      href_value := '/loading';
    WHEN 'delivery.dispatch' THEN
      event_type_value := 'delivery_dispatched'; title_en_value := 'Delivery dispatched'; title_ta_value := 'விநியோகம் அனுப்பப்பட்டது';
      body_en_value := 'A verified delivery left the yard.'; body_ta_value := 'சரிபார்க்கப்பட்ட சரக்கு புறப்பட்டது.'; href_value := '/loading';
    WHEN 'delivery.complete' THEN
      event_type_value := 'delivery_completed'; title_en_value := 'Delivery completed'; title_ta_value := 'விநியோகம் முடிந்தது';
      body_en_value := 'A delivery was marked complete.'; body_ta_value := 'ஒரு விநியோகம் முடிந்ததாக பதிவு செய்யப்பட்டது.'; href_value := '/loading';
    WHEN 'production.batch.complete' THEN
      event_type_value := 'production_completed'; title_en_value := 'Production batch completed'; title_ta_value := 'உற்பத்தித் தொகுதி முடிந்தது';
      body_en_value := 'Saleable production was posted to stock.'; body_ta_value := 'விற்பனைக்கான உற்பத்தி சரக்கில் பதிவு செய்யப்பட்டது.'; href_value := '/production';
    ELSE RETURN NEW;
  END CASE;

  SELECT value INTO preferences FROM company_settings WHERE company_id=NEW.company_id AND key='notification_preferences';
  IF COALESCE(preferences->event_type_value,'true'::jsonb)='false'::jsonb THEN RETURN NEW; END IF;

  INSERT INTO user_notifications(company_id, branch_id, recipient_user_id, source_audit_id, event_type, title_en, title_ta, body_en, body_ta, href, entity_type, entity_id)
  SELECT NEW.company_id, NEW.branch_id, ur.user_id, NEW.id, event_type_value, title_en_value, title_ta_value, body_en_value, body_ta_value, href_value, NEW.entity_type, NEW.entity_id
  FROM user_roles ur JOIN roles r ON r.company_id=ur.company_id AND r.id=ur.role_id JOIN users u ON u.company_id=ur.company_id AND u.id=ur.user_id
  WHERE ur.company_id=NEW.company_id AND r.code='owner' AND u.active=true
  ON CONFLICT (recipient_user_id, source_audit_id) DO NOTHING;
  RETURN NEW;
END;
$$;
