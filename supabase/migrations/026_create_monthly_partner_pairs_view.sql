-- Migration: Pre-aggregate daily_partner_pairs by month for fast dashboard reads.
-- Replaces the JS-side pagination loop + in-memory aggregation with a single
-- query against this view. The DB handles the GROUP BY in one pass, avoiding
-- multiple sequential round-trips.

CREATE OR REPLACE VIEW monthly_partner_pairs AS
SELECT
  (date_trunc('month', date))::date AS month,
  demand_tag,
  supply_tag,
  SUM(revenue)::numeric            AS revenue,
  SUM(cost)::numeric               AS cost,
  SUM(profit)::numeric             AS profit
FROM daily_partner_pairs
GROUP BY date_trunc('month', date), demand_tag, supply_tag;
