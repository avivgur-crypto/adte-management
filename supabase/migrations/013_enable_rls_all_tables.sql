-- Migration: Enable RLS on all tables with default-deny.
-- The service_role key bypasses RLS, so existing server-side code is unaffected.
-- If an anon-key client is ever introduced, explicit GRANT + policies must be added.

ALTER TABLE daily_partner_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_partner_pairs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_goals             ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_revenue_breakdown  ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_funnel_metrics      ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_financials          ENABLE ROW LEVEL SECURITY;
ALTER TABLE monday_items_activity     ENABLE ROW LEVEL SECURITY;
