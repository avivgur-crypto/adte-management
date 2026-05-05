-- PostgREST "schema cache" errors if the live table predates migration 029 or was created
-- without this column. Safe no-op when `dates_synced` already exists.
ALTER TABLE public.daily_sync_logs
  ADD COLUMN IF NOT EXISTS dates_synced integer NOT NULL DEFAULT 0;
