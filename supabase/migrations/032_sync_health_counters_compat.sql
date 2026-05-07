-- Idempotent schema fix for `public.sync_health_counters`.
--
-- Earlier 031 migration shipped with `consecutive_xdash_totals_failures` but
-- some environments already had a table with `consecutive_failures` (or no
-- counter column at all). This migration makes the schema canonical without
-- losing any existing data.

CREATE TABLE IF NOT EXISTS public.sync_health_counters (
  id text PRIMARY KEY,
  consecutive_xdash_totals_failures integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sync_health_counters'
      AND column_name = 'consecutive_failures'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sync_health_counters'
      AND column_name = 'consecutive_xdash_totals_failures'
  ) THEN
    EXECUTE 'ALTER TABLE public.sync_health_counters
             RENAME COLUMN consecutive_failures TO consecutive_xdash_totals_failures';
  END IF;
END $$;

ALTER TABLE public.sync_health_counters
  ADD COLUMN IF NOT EXISTS consecutive_xdash_totals_failures integer NOT NULL DEFAULT 0;

ALTER TABLE public.sync_health_counters
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now());

INSERT INTO public.sync_health_counters (id, consecutive_xdash_totals_failures)
VALUES ('cron_xdash_totals', 0)
ON CONFLICT (id) DO NOTHING;
