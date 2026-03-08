-- Migration: Create daily_home_totals table.
-- Stores per-day revenue / cost / impressions from the XDASH HOME endpoint.
-- This is the source of truth for Financial cards, Daily Progress chart, and Pacing.
-- Partner-level data remains in daily_partner_performance (for Partner Flow, Dependency Mapping, etc.).

CREATE TABLE IF NOT EXISTS daily_home_totals (
  date          date        PRIMARY KEY,
  revenue       numeric     NOT NULL DEFAULT 0,
  cost          numeric     NOT NULL DEFAULT 0,
  impressions   bigint      NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dht_date ON daily_home_totals (date);

ALTER TABLE daily_home_totals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access on daily_home_totals"
  ON daily_home_totals FOR ALL
  USING (true) WITH CHECK (true);
