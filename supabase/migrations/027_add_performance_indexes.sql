-- Speed up "last sync" timestamp lookups that ORDER BY created_at DESC LIMIT 1.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dht_created_at_desc
  ON daily_home_totals (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dpp_created_at_desc
  ON daily_partner_performance (created_at DESC);

-- Speed up top-N revenue queries sorted by revenue within a month.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crb_month_revenue_desc
  ON client_revenue_breakdown (month, revenue DESC);
