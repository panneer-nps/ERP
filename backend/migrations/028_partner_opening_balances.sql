CREATE TABLE partner_opening_balances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 partner_id uuid NOT NULL,
 partner_type text NOT NULL CHECK(partner_type IN ('customer','supplier')),
 opening_number text NOT NULL,
 amount numeric(14,2) NOT NULL CHECK(amount > 0),
 balance_side text NOT NULL CHECK(balance_side IN ('debit','credit')),
 opening_date date NOT NULL,
 reason text NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,partner_id) REFERENCES business_partners(company_id,id),
 FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
 UNIQUE(company_id,id),
 UNIQUE(company_id,partner_id),
 UNIQUE(company_id,opening_number)
);

INSERT INTO accounts(company_id,code,name,account_type)
 SELECT id,'3000','Opening balance equity','equity' FROM companies
 ON CONFLICT(company_id,code) DO NOTHING;
INSERT INTO permissions(code,module,action,description) VALUES
 ('partners.opening.post','accounting','opening_post','Post one audited customer or supplier opening balance') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='partners.opening.post'
 WHERE r.system_role=true AND r.code='owner' ON CONFLICT DO NOTHING;
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
 SELECT id,'partner_opening_balance','POB-',1,5 FROM companies ON CONFLICT DO NOTHING;
