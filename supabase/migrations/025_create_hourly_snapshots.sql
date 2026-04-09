-- Hourly financial snapshots: one row per (date, hour) recording cumulative
-- XDASH Home totals at the time of sync.  Used for same-time-of-day comparisons
-- (e.g. "today 14:00 vs yesterday 14:00").  The existing daily_home_totals
-- pipeline is untouched; this table is populated as a fire-and-forget side-effect.

CREATE TABLE IF NOT EXISTS public.hourly_snapshots (
  date       date    NOT NULL,
  hour       smallint NOT NULL CHECK (hour >= 0 AND hour <= 23),
  revenue    numeric NOT NULL DEFAULT 0,
  cost       numeric NOT NULL DEFAULT 0,
  profit     numeric NOT NULL DEFAULT 0,
  impressions numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (date, hour)
);

CREATE INDEX IF NOT EXISTS idx_hourly_snapshots_date
  ON public.hourly_snapshots (date);

COMMENT ON TABLE public.hourly_snapshots
  IS 'Cumulative intraday totals snapped once per Israel-hour. Written after daily_home_totals upsert; never blocks the main sync.';

ALTER TABLE public.hourly_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access on hourly_snapshots"
  ON public.hourly_snapshots FOR ALL
  USING (true) WITH CHECK (true);
