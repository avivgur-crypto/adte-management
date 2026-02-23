-- Add company name for contract items (Media Contracts board column text_mkpw5mcs).
ALTER TABLE monday_items_activity
  ADD COLUMN IF NOT EXISTS company_name text;
