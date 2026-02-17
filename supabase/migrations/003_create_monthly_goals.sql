-- Migration: Create monthly_goals table for Google Sheets financial goals.
-- One row per month; UNIQUE on month for upserts.

CREATE TABLE IF NOT EXISTS monthly_goals (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  month         date        NOT NULL UNIQUE,
  revenue_goal  numeric,
  profit_goal   numeric,
  saas_revenue  numeric     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_monthly_goals_month
  ON monthly_goals (month);
