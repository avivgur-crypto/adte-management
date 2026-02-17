-- Migration: Create the daily_partner_performance table.
-- Stores per-partner revenue (demand) and cost (supply) data ingested from XDASH.

CREATE TABLE IF NOT EXISTS daily_partner_performance (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  date          date        NOT NULL,
  partner_name  text        NOT NULL,
  partner_type  text        NOT NULL
                            CHECK (partner_type IN ('demand', 'supply')),
  revenue       numeric     NOT NULL DEFAULT 0,
  cost          numeric     NOT NULL DEFAULT 0,
  impressions   bigint      NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- Enable upserts: one row per (date, partner_name, partner_type)
  UNIQUE (date, partner_name, partner_type)
);

-- Speed up queries that filter by date
CREATE INDEX IF NOT EXISTS idx_dpp_date
  ON daily_partner_performance (date);
