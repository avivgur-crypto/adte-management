-- Migration 015: SQL views for server-side aggregation + funnel cache table
--
-- v_monthly_home_totals: replaces JS row-by-row SUM in financials.ts
-- v_monthly_dep_pairs:   replaces JS aggregation in dependency-mapping.ts
-- cached_funnel_metrics: pre-computed Monday.com funnel (written by cron, read by UI)

-- ── View: monthly aggregated home totals ──
CREATE OR REPLACE VIEW v_monthly_home_totals AS
SELECT
  date_trunc('month', date)::date AS month,
  SUM(revenue)::numeric           AS revenue,
  SUM(cost)::numeric              AS cost,
  SUM(impressions)::bigint        AS impressions
FROM daily_home_totals
GROUP BY date_trunc('month', date)
ORDER BY month;

GRANT SELECT ON v_monthly_home_totals TO authenticated, anon, service_role;

-- ── View: monthly aggregated dependency pairs ──
CREATE OR REPLACE VIEW v_monthly_dep_pairs AS
SELECT
  date_trunc('month', date)::date AS month,
  demand_tag,
  supply_tag,
  SUM(revenue)::numeric AS revenue,
  SUM(cost)::numeric    AS cost
FROM daily_partner_pairs
GROUP BY date_trunc('month', date), demand_tag, supply_tag;

GRANT SELECT ON v_monthly_dep_pairs TO authenticated, anon, service_role;

-- ── Table: pre-computed funnel metrics (single-row, keyed by id='latest') ──
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
