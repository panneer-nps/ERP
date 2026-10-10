CREATE TABLE cash_closings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 closing_number text NOT NULL,
 closing_date date NOT NULL,
 expected_cash numeric(14,2) NOT NULL,
 actual_cash numeric(14,2) NOT NULL CHECK(actual_cash >= 0),
 difference numeric(14,2) NOT NULL,
 reason text,
 status text NOT NULL CHECK(status IN ('pending','approved')),
 recorded_by uuid NOT NULL,
 approved_by uuid,
 approval_reason text,
 created_at timestamptz NOT NULL DEFAULT now(),
 approved_at timestamptz,
 FOREIGN KEY(company_id) REFERENCES companies(id),
 FOREIGN KEY(company_id,recorded_by) REFERENCES users(company_id,id),
 FOREIGN KEY(company_id,approved_by) REFERENCES users(company_id,id),
 UNIQUE(company_id,id),
 UNIQUE(company_id,closing_number),
 UNIQUE(company_id,closing_date),
 CHECK(difference=actual_cash-expected_cash),
 CHECK(difference=0 OR (reason IS NOT NULL AND length(trim(reason))>=5)),
 CHECK((status='pending' AND difference<>0 AND approved_by IS NULL AND approved_at IS NULL)
    OR (status='approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX cash_closings_recent_idx ON cash_closings(company_id,closing_date DESC);

INSERT INTO accounts(company_id,code,name,account_type)
 SELECT c.id,a.code,a.name,a.account_type FROM companies c CROSS JOIN (VALUES
 ('4300','Cash overage income','income'),('5900','Cash shortage expense','expense')
 ) AS a(code,name,account_type)
 ON CONFLICT(company_id,code) DO NOTHING;

INSERT INTO permissions(code,module,action,description) VALUES
 ('cash.close.view','accounting','cash_close_view','View daily cash closing records'),
 ('cash.close.record','accounting','cash_close_record','Record daily counted cash and any variance reason'),
 ('cash.close.approve','accounting','cash_close_approve','Approve and journal a daily cash variance')
 ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN ('cash.close.view','cash.close.record','cash.close.approve')
 WHERE r.system_role=true AND r.code='owner' ON CONFLICT DO NOTHING;
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
 SELECT id,'cash_closing','CC-',1,5 FROM companies ON CONFLICT DO NOTHING;
