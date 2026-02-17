-- Add type, business_entity, category to client_revenue_breakdown.

ALTER TABLE client_revenue_breakdown
  ADD COLUMN IF NOT EXISTS type text CHECK (type IN ('demand', 'supply'));

ALTER TABLE client_revenue_breakdown
  ADD COLUMN IF NOT EXISTS business_entity text;

ALTER TABLE client_revenue_breakdown
  ADD COLUMN IF NOT EXISTS category text;

-- Backfill type from partner_type where type is null
UPDATE client_revenue_breakdown SET type = partner_type WHERE type IS NULL;
