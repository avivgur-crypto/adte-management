-- Daily financials: one row per day (upserted by date).
-- Run this in the Supabase SQL Editor to create the table.

CREATE TABLE IF NOT EXISTS daily_financials (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date       date NOT NULL UNIQUE,
  revenue    numeric,
  cost       numeric,
  profit     numeric,
  impressions bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Optional: index on date for fast lookups (UNIQUE already creates an index)
-- CREATE INDEX IF NOT EXISTS idx_daily_financials_date ON daily_financials (date);
