CREATE TABLE stock_adjustment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  request_number text NOT NULL,
  branch_id uuid,
  location_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quality text NOT NULL CHECK (quality IN ('good','second','broken','rejected','damaged')),
  action text NOT NULL CHECK (action IN ('increase','decrease','damage')),
  entered_quantity numeric(14,2) NOT NULL CHECK (entered_quantity > 0),
  entered_unit_code text NOT NULL,
  conversion_to_base numeric(14,6) NOT NULL CHECK (conversion_to_base > 0),
  base_quantity numeric(14,2) NOT NULL CHECK (base_quantity > 0),
  unit_cost numeric(14,4) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 5),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by uuid NOT NULL,
  decided_by uuid,
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id,id),
  FOREIGN KEY (company_id, location_id) REFERENCES stock_locations(company_id,id),
  FOREIGN KEY (company_id, product_id) REFERENCES products(company_id,id),
  FOREIGN KEY (company_id, requested_by) REFERENCES users(company_id,id),
  FOREIGN KEY (company_id, decided_by) REFERENCES users(company_id,id),
  UNIQUE (company_id,request_number),
  UNIQUE (company_id,id),
  CHECK ((action='damage' AND quality IN ('good','second')) OR action<>'damage'),
  CHECK ((status='pending' AND decided_by IS NULL AND decided_at IS NULL) OR (status<>'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL))
);

CREATE INDEX stock_adjustment_requests_pending_idx
  ON stock_adjustment_requests(company_id,branch_id,created_at DESC)
  WHERE status='pending';

INSERT INTO permissions(code,module,action,description,manager_default) VALUES
  ('stock.adjust.approve','stock','approve','Approve or reject stock adjustment requests',true)
ON CONFLICT(code) DO UPDATE SET manager_default=true;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='stock.adjust.approve'
WHERE r.code IN ('owner','manager')
ON CONFLICT DO NOTHING;

INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
SELECT id,'stock_adjustment_request','SAR-',1,5 FROM companies
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION notify_approvers_from_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  permission_code text;
  title_en_value text;
  title_ta_value text;
  body_en_value text;
  body_ta_value text;
  branch_value uuid := NEW.branch_id;
  preferences jsonb;
BEGIN
  CASE NEW.action
    WHEN 'expense.submit_for_approval' THEN
      permission_code := 'expenses.approve';
      title_en_value := 'Expense needs your approval'; title_ta_value := 'செலவுக்கு உங்கள் ஒப்புதல் தேவை';
      body_en_value := COALESCE(NEW.after_data->>'number','Expense') || ' · ₹' || COALESCE(NEW.after_data->>'amount','');
      body_ta_value := COALESCE(NEW.after_data->>'number','செலவு') || ' · ₹' || COALESCE(NEW.after_data->>'amount','');
      IF branch_value IS NULL THEN SELECT branch_id INTO branch_value FROM expenses WHERE company_id=NEW.company_id AND id::text=NEW.entity_id; END IF;
    WHEN 'employee.advance.submit_for_approval' THEN
      permission_code := 'employees.advance.approve';
      title_en_value := 'Employee advance needs your approval'; title_ta_value := 'பணியாளர் முன்பணத்திற்கு உங்கள் ஒப்புதல் தேவை';
      body_en_value := COALESCE(NEW.after_data->>'advanceNumber','Advance') || ' · ₹' || COALESCE(NEW.after_data->>'amount','');
      body_ta_value := 'முன்பணம் ' || COALESCE(NEW.after_data->>'advanceNumber','') || ' · ₹' || COALESCE(NEW.after_data->>'amount','');
    WHEN 'accounting.manual_journal.request' THEN
      permission_code := 'accounting.journal.approve';
      title_en_value := 'Manual journal needs your approval'; title_ta_value := 'கைமுறை கணக்குப் பதிவுக்கு உங்கள் ஒப்புதல் தேவை';
      body_en_value := COALESCE(NEW.after_data->>'requestNumber','Journal request');
      body_ta_value := 'கணக்குப் பதிவு கோரிக்கை ' || COALESCE(NEW.after_data->>'requestNumber','');
      IF branch_value IS NULL THEN SELECT branch_id INTO branch_value FROM manual_journal_requests WHERE company_id=NEW.company_id AND id::text=NEW.entity_id; END IF;
    WHEN 'payroll.run.create' THEN
      permission_code := 'payroll.approve';
      title_en_value := 'Salary run needs your approval'; title_ta_value := 'சம்பளத் தொகுப்புக்கு உங்கள் ஒப்புதல் தேவை';
      body_en_value := COALESCE(NEW.after_data->>'runNumber','Salary run') || ' · ' || COALESCE(NEW.after_data->>'employeeCount','0') || ' employees';
      body_ta_value := 'சம்பளத் தொகுப்பு ' || COALESCE(NEW.after_data->>'runNumber','') || ' · ' || COALESCE(NEW.after_data->>'employeeCount','0') || ' பணியாளர்கள்';
    WHEN 'sales.order.create' THEN
      IF NEW.after_data->>'status' <> 'pending_approval' THEN RETURN NEW; END IF;
      permission_code := 'sales.approve';
      title_en_value := 'Credit sale needs your approval'; title_ta_value := 'கடன் விற்பனைக்கு உங்கள் ஒப்புதல் தேவை';
      body_en_value := COALESCE(NEW.after_data->>'orderNumber','Sales order') || ' · ₹' || COALESCE(NEW.after_data->>'total','');
      body_ta_value := 'விற்பனை ஆணை ' || COALESCE(NEW.after_data->>'orderNumber','') || ' · ₹' || COALESCE(NEW.after_data->>'total','');
      IF branch_value IS NULL THEN SELECT branch_id INTO branch_value FROM sales_orders WHERE company_id=NEW.company_id AND id::text=NEW.entity_id; END IF;
    WHEN 'cash.close.record' THEN
      IF NEW.after_data->>'status' <> 'pending' THEN RETURN NEW; END IF;
      permission_code := 'cash.close.approve';
      title_en_value := 'Cash difference needs your approval'; title_ta_value := 'ரொக்க வேறுபாட்டிற்கு உங்கள் ஒப்புதல் தேவை';
      body_en_value := COALESCE(NEW.after_data->>'closingNumber','Cash close') || ' · ₹' || COALESCE(NEW.after_data->>'difference','');
      body_ta_value := 'ரொக்க முடிப்பு ' || COALESCE(NEW.after_data->>'closingNumber','') || ' · ₹' || COALESCE(NEW.after_data->>'difference','');
    WHEN 'stocktake.submit' THEN
      permission_code := 'stocktake.approve';
      title_en_value := 'Stock count needs your approval'; title_ta_value := 'சரக்கு எண்ணிக்கைக்கு உங்கள் ஒப்புதல் தேவை';
      body_en_value := 'A physical stock count is ready for review.'; body_ta_value := 'சரக்கு எண்ணிக்கை மதிப்பாய்வுக்குத் தயாராக உள்ளது.';
      IF branch_value IS NULL THEN SELECT l.branch_id INTO branch_value FROM stocktakes s JOIN stock_locations l ON l.company_id=s.company_id AND l.id=s.location_id WHERE s.company_id=NEW.company_id AND s.id::text=NEW.entity_id; END IF;
    WHEN 'stock.adjust.request' THEN
      permission_code := 'stock.adjust.approve';
      title_en_value := 'Stock adjustment needs your approval'; title_ta_value := 'சரக்கு சரிசெய்தலுக்கு உங்கள் ஒப்புதல் தேவை';
      body_en_value := COALESCE(NEW.after_data->>'requestNumber','Stock adjustment') || ' · ' || COALESCE(NEW.after_data->>'productName','Product') || ' · ' || COALESCE(NEW.after_data->>'quantity','');
      body_ta_value := 'சரக்கு சரிசெய்தல் ' || COALESCE(NEW.after_data->>'requestNumber','') || ' · ' || COALESCE(NEW.after_data->>'productName','') || ' · ' || COALESCE(NEW.after_data->>'quantity','');
      IF branch_value IS NULL THEN SELECT l.branch_id INTO branch_value FROM stock_adjustment_requests r JOIN stock_locations l ON l.company_id=r.company_id AND l.id=r.location_id WHERE r.company_id=NEW.company_id AND r.id::text=NEW.entity_id; END IF;
    WHEN 'loading.verify' THEN
      IF NEW.after_data->>'status' <> 'mismatch' THEN RETURN NEW; END IF;
      permission_code := 'loading.approve';
      title_en_value := 'Loading mismatch needs your approval'; title_ta_value := 'ஏற்றுதல் வேறுபாட்டிற்கு உங்கள் ஒப்புதல் தேவை';
      body_en_value := 'Planned ' || COALESCE(NEW.after_data->>'plannedQuantity','?') || ', loaded ' || COALESCE(NEW.after_data->>'loadedQuantity','?') || ', verified ' || COALESCE(NEW.after_data->>'verifiedQuantity','?') || '.';
      body_ta_value := 'திட்டம் ' || COALESCE(NEW.after_data->>'plannedQuantity','?') || ', ஏற்றியது ' || COALESCE(NEW.after_data->>'loadedQuantity','?') || ', சரிபார்த்தது ' || COALESCE(NEW.after_data->>'verifiedQuantity','?') || '.';
      IF branch_value IS NULL THEN SELECT branch_id INTO branch_value FROM loading_sessions WHERE company_id=NEW.company_id AND id::text=NEW.entity_id; END IF;
    ELSE RETURN NEW;
  END CASE;

  SELECT value INTO preferences FROM company_settings WHERE company_id=NEW.company_id AND key='notification_preferences';
  IF COALESCE(preferences->'approval_request','true'::jsonb)='false'::jsonb THEN RETURN NEW; END IF;

  INSERT INTO user_notifications(company_id,branch_id,recipient_user_id,source_audit_id,event_type,title_en,title_ta,body_en,body_ta,href,entity_type,entity_id)
  SELECT NEW.company_id,branch_value,u.id,NEW.id,'approval_request',title_en_value,title_ta_value,body_en_value,body_ta_value,'/approvals',NEW.entity_type,NEW.entity_id
  FROM users u
  JOIN user_roles ur ON ur.company_id=u.company_id AND ur.user_id=u.id
  JOIN roles r ON r.company_id=ur.company_id AND r.id=ur.role_id
  JOIN role_permissions rp ON rp.role_id=r.id
  JOIN permissions p ON p.id=rp.permission_id AND p.code=permission_code
  WHERE u.company_id=NEW.company_id AND u.active=true AND u.id IS DISTINCT FROM NEW.actor_user_id
    AND (branch_value IS NULL OR EXISTS(SELECT 1 FROM user_branches ub JOIN branches b ON b.company_id=ub.company_id AND b.id=ub.branch_id WHERE ub.company_id=u.company_id AND ub.user_id=u.id AND ub.branch_id=branch_value AND b.active=true))
  ON CONFLICT(recipient_user_id,source_audit_id) DO NOTHING;
  RETURN NEW;
END;
$$;
