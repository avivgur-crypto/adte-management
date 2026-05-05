-- Sync-Pro diagnostic table: one row per sync run (cron, auto-sync, refreshTodayHome, …).
-- Used to track sync duration, row counts, and error rate over time without parsing logs.
-- Append-only; older rows can be pruned out-of-band when the table grows.

CREATE TABLE IF NOT EXISTS public.daily_sync_logs (
  id           bigserial PRIMARY KEY,
  source       text        NOT NULL,                -- e.g. cron_sync, auto_sync:manual-recovery, refresh_today_home
  started_at   timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  duration_ms  integer     NOT NULL,
  dates_synced integer     NOT NULL DEFAULT 0,
  rows_upserted integer    NOT NULL DEFAULT 0,
  ok           boolean     NOT NULL,
  error_message text,
  detail       jsonb
);

CREATE INDEX IF NOT EXISTS idx_daily_sync_logs_started_at
  ON public.daily_sync_logs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_daily_sync_logs_source_started_at
  ON public.daily_sync_logs (source, started_at DESC);

COMMENT ON TABLE public.daily_sync_logs
  IS 'One row per sync run. Source identifies which entry point (cron, auto-sync, server action). Used for performance auditing post-Vercel-Pro upgrade.';

ALTER TABLE public.daily_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access on daily_sync_logs"
  ON public.daily_sync_logs FOR ALL
  USING (true) WITH CHECK (true);
