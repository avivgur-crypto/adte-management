-- Migration 015: cached_funnel_metrics table
--
-- Pre-computed Monday.com funnel data (written by cron, read by dashboard UI).
-- SQL views for v_monthly_home_totals / v_monthly_dep_pairs were removed —
-- aggregation is done in JS from the raw tables instead.

CREATE TABLE IF NOT EXISTS cached_funnel_metrics (
  id                    text PRIMARY KEY DEFAULT 'latest',
  total_leads           integer  NOT NULL DEFAULT 0,
  qualified_leads       integer  NOT NULL DEFAULT 0,
  ops_approved          integer  NOT NULL DEFAULT 0,
  won_deals             integer  NOT NULL DEFAULT 0,
  lead_to_qualified_pct numeric,
  qualified_to_ops_pct  numeric,
  ops_to_won_pct        numeric,
  win_rate_pct          numeric,
  month_label           text        NOT NULL DEFAULT 'All time',
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cached_funnel_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access on cached_funnel_metrics"
  ON cached_funnel_metrics FOR ALL
  USING (true) WITH CHECK (true);
