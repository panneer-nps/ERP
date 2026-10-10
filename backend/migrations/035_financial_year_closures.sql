ALTER TABLE journal_entries ADD COLUMN financial_year_id uuid;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_financial_year_fk
  FOREIGN KEY(company_id,financial_year_id) REFERENCES financial_years(company_id,id);
UPDATE journal_entries je SET financial_year_id=fy.id
FROM financial_years fy
WHERE je.company_id=fy.company_id AND je.effective_date BETWEEN fy.starts_on AND fy.ends_on;
CREATE INDEX journal_entries_financial_year_idx ON journal_entries(company_id,financial_year_id,effective_date);

CREATE TABLE financial_year_closures (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 financial_year_id uuid NOT NULL,
 next_financial_year_id uuid NOT NULL,
 close_number text NOT NULL,
 closing_entry_id uuid,
 net_profit numeric(14,2) NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason))>=10),
 closed_by uuid NOT NULL,
 closed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,financial_year_id) REFERENCES financial_years(company_id,id),
 FOREIGN KEY(company_id,next_financial_year_id) REFERENCES financial_years(company_id,id),
 FOREIGN KEY(company_id,closing_entry_id) REFERENCES journal_entries(company_id,id),
 FOREIGN KEY(company_id,closed_by) REFERENCES users(company_id,id),
 UNIQUE(company_id,financial_year_id),
 UNIQUE(company_id,close_number),
 UNIQUE(company_id,id)
);
CREATE INDEX financial_year_closures_history_idx ON financial_year_closures(company_id,closed_at DESC);

INSERT INTO accounts(company_id,code,name,account_type)
SELECT id,'3100','Retained earnings','equity' FROM companies ON CONFLICT(company_id,code) DO NOTHING;
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
SELECT id,'financial_year_close','YC-',1,5 FROM companies ON CONFLICT DO NOTHING;
INSERT INTO permissions(code,module,action,description) VALUES
 ('accounting.financial-years.close','accounting','financial_year_close','Close a reconciled financial year')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='accounting.financial-years.close'
WHERE r.system_role=true AND r.code='owner' ON CONFLICT DO NOTHING;
