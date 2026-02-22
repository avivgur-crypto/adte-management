-- Add Master Billing 2026 breakdown columns (DEMAND: media/saas revenue; SUPPLY: media/tech/brand safety cost).

ALTER TABLE monthly_goals ADD COLUMN IF NOT EXISTS media_revenue numeric NOT NULL DEFAULT 0;
ALTER TABLE monthly_goals ADD COLUMN IF NOT EXISTS media_cost numeric NOT NULL DEFAULT 0;
ALTER TABLE monthly_goals ADD COLUMN IF NOT EXISTS tech_cost numeric NOT NULL DEFAULT 0;
ALTER TABLE monthly_goals ADD COLUMN IF NOT EXISTS bs_cost numeric NOT NULL DEFAULT 0;
