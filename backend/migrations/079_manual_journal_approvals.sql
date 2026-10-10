CREATE TABLE manual_journal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  request_number text NOT NULL,
  effective_date date NOT NULL,
  description text NOT NULL CHECK (length(description) BETWEEN 3 AND 240),
  reason text NOT NULL CHECK (length(reason) BETWEEN 5 AND 500),
  branch_id uuid,
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','posted','rejected')),
  requested_by uuid NOT NULL,
  decision_by uuid,
  decision_at timestamptz,
  decision_reason text,
  journal_entry_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, requested_by) REFERENCES users(company_id,id),
  FOREIGN KEY (company_id, decision_by) REFERENCES users(company_id,id),
  FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id,id),
  FOREIGN KEY (company_id, journal_entry_id) REFERENCES journal_entries(company_id,id),
  UNIQUE (company_id,id),
  UNIQUE (company_id,request_number),
  UNIQUE (company_id,journal_entry_id)
);

CREATE TABLE manual_journal_request_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  request_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  account_id uuid NOT NULL,
  description text NOT NULL CHECK (length(description) BETWEEN 2 AND 240),
  debit numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)),
  FOREIGN KEY (company_id,request_id) REFERENCES manual_journal_requests(company_id,id) ON DELETE CASCADE,
  FOREIGN KEY (company_id,account_id) REFERENCES accounts(company_id,id),
  UNIQUE (request_id,line_number)
);
CREATE INDEX manual_journal_pending_idx ON manual_journal_requests(company_id,branch_id,created_at) WHERE status='pending_approval';
CREATE INDEX manual_journal_lines_request_idx ON manual_journal_request_lines(company_id,request_id,line_number);

INSERT INTO permissions(code,module,action,description) VALUES
  ('accounting.journal.create','accounting','create','Request a manual journal entry'),
  ('accounting.journal.approve','accounting','approve','Approve or reject manual journal entries')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN ('accounting.journal.create','accounting.journal.approve')
WHERE r.system_role=true AND r.code='owner'
ON CONFLICT DO NOTHING;

INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding)
SELECT id,'manual_journal','MJE-',1,5 FROM companies
ON CONFLICT DO NOTHING;
