ALTER TABLE journal_entries ADD COLUMN effective_date date;
UPDATE journal_entries SET effective_date=posted_at::date;
ALTER TABLE journal_entries ALTER COLUMN effective_date SET NOT NULL;
ALTER TABLE journal_entries ALTER COLUMN effective_date SET DEFAULT CURRENT_DATE;
CREATE INDEX journal_entries_effective_date_idx ON journal_entries(company_id,effective_date,entry_number);
