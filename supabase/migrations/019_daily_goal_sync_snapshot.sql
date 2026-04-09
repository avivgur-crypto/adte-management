-- Last-seen daily GP from checkPerformance runs (per Israel calendar day).
-- Used to detect crossing daily_avg_target (prev < target <= current), not midnight false positives.

CREATE TABLE IF NOT EXISTS public.daily_goal_sync_snapshot (
  israel_date date PRIMARY KEY,
  last_seen_profit double precision NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS daily_goal_sync_snapshot_updated_idx ON public.daily_goal_sync_snapshot (updated_at);

COMMENT ON TABLE public.daily_goal_sync_snapshot IS 'Last GP seen for daily_home_totals on israel_date; updated by checkPerformance outside quiet hours.';

ALTER TABLE public.daily_goal_sync_snapshot ENABLE ROW LEVEL SECURITY;
