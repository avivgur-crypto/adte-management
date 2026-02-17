-- Migration: Create the daily_funnel_metrics table for Monday.com funnel analysis.
-- One row per day; UNIQUE on date for upserts.

CREATE TABLE IF NOT EXISTS daily_funnel_metrics (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  date                date        NOT NULL UNIQUE,
  total_leads         int         NOT NULL DEFAULT 0,
  qualified_leads     int         NOT NULL DEFAULT 0,
  ops_approved_leads  int         NOT NULL DEFAULT 0,
  won_deals           int         NOT NULL DEFAULT 0,
  conversion_rate     numeric,
  win_rate            numeric,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_funnel_metrics_date
  ON daily_funnel_metrics (date);
