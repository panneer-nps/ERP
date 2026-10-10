ALTER TABLE journal_entry_lines ADD CONSTRAINT journal_entry_lines_company_id_uq UNIQUE(company_id,id);

CREATE TABLE bank_opening_balances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 opening_number text NOT NULL,
 opening_date date NOT NULL,
 amount numeric(14,2) NOT NULL CHECK(amount<>0),
 reason text NOT NULL CHECK(length(trim(reason))>=5),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id) REFERENCES companies(id),
 FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
 UNIQUE(company_id,id),
 UNIQUE(company_id,opening_number),
 UNIQUE(company_id)
);

CREATE TABLE bank_reconciliations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 reconciliation_number text NOT NULL,
 period_from date NOT NULL,
 period_to date NOT NULL,
 statement_opening numeric(14,2) NOT NULL,
 statement_closing numeric(14,2) NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','reconciled')),
 created_by uuid NOT NULL,
 completed_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 FOREIGN KEY(company_id) REFERENCES companies(id),
 FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
 FOREIGN KEY(company_id,completed_by) REFERENCES users(company_id,id),
 UNIQUE(company_id,id),
 UNIQUE(company_id,reconciliation_number),
 CHECK(period_to>=period_from),
 CHECK((status='draft' AND completed_by IS NULL AND completed_at IS NULL)
    OR (status='reconciled' AND completed_by IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX bank_reconciliations_period_idx ON bank_reconciliations(company_id,period_from,period_to);

CREATE TABLE bank_reconciliation_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 reconciliation_id uuid NOT NULL,
 line_number integer NOT NULL CHECK(line_number>0),
 transaction_date date NOT NULL,
 description text NOT NULL,
 reference text,
 amount numeric(14,2) NOT NULL CHECK(amount<>0),
 matched_journal_line_id uuid,
 matched_by uuid,
 matched_at timestamptz,
 FOREIGN KEY(company_id,reconciliation_id) REFERENCES bank_reconciliations(company_id,id),
 FOREIGN KEY(company_id,matched_by) REFERENCES users(company_id,id),
 FOREIGN KEY(company_id,matched_journal_line_id) REFERENCES journal_entry_lines(company_id,id),
 UNIQUE(company_id,id),
 UNIQUE(company_id,reconciliation_id,line_number),
 UNIQUE(company_id,matched_journal_line_id),
 CHECK((matched_journal_line_id IS NULL AND matched_by IS NULL AND matched_at IS NULL)
    OR (matched_journal_line_id IS NOT NULL AND matched_by IS NOT NULL AND matched_at IS NOT NULL))
);
CREATE INDEX bank_reconciliation_lines_parent_idx ON bank_reconciliation_lines(company_id,reconciliation_id,line_number);

INSERT INTO permissions(code,module,action,description) VALUES
 ('bank.opening.post','accounting','bank_opening_post','Post the one-time opening balance for the bank ledger'),
 ('bank.reconcile.view','accounting','bank_reconcile_view','View bank statement reconciliations'),
 ('bank.reconcile.create','accounting','bank_reconcile_create','Create a bank statement reconciliation'),
 ('bank.reconcile.match','accounting','bank_reconcile_match','Match statement lines to posted bank transactions'),
 ('bank.reconcile.complete','accounting','bank_reconcile_complete','Complete a balanced bank statement reconciliation')
 ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN ('bank.opening.post','bank.reconcile.view','bank.reconcile.create','bank.reconcile.match','bank.reconcile.complete')
 WHERE r.system_role=true AND r.code='owner' ON CONFLICT DO NOTHING;
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
 SELECT id,'bank_opening_balance','BOB-',1,5 FROM companies ON CONFLICT DO NOTHING;
INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
 SELECT id,'bank_reconciliation','BR-',1,5 FROM companies ON CONFLICT DO NOTHING;
