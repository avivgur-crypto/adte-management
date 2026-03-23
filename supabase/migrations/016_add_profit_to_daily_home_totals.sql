-- Add profit column to daily_home_totals.
-- Stores the raw net profit from XDASH (netprofit param) instead of calculating revenue - cost.
ALTER TABLE daily_home_totals
  ADD COLUMN IF NOT EXISTS profit numeric NOT NULL DEFAULT 0;
