-- Migration: Create daily_partner_pairs for Dependency Mapping (demand × supply per day).
-- Populated by sync; UI reads only from this table (no direct XDASH calls on dashboard).

CREATE TABLE IF NOT EXISTS daily_partner_pairs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  date         date        NOT NULL,
  demand_tag   text        NOT NULL,
  supply_tag   text        NOT NULL,
  revenue      numeric     NOT NULL DEFAULT 0,
  cost         numeric     NOT NULL DEFAULT 0,
  profit       numeric     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),

  UNIQUE (date, demand_tag, supply_tag)
);

CREATE INDEX IF NOT EXISTS idx_dppairs_date
  ON daily_partner_pairs (date);
