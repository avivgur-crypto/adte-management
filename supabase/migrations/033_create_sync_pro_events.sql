-- Persist syncProLog events beyond Vercel log retention.
-- Used by System Health (guard activity) and stale-sync alert throttling.

CREATE TABLE IF NOT EXISTS public.sync_pro_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  event       text        NOT NULL,
  branch_type text,
  status      text,
  message     text,
  detail      jsonb
);

CREATE INDEX IF NOT EXISTS idx_sync_pro_events_created_at
  ON public.sync_pro_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_pro_events_event_created_at
  ON public.sync_pro_events (event, created_at DESC);

COMMENT ON TABLE public.sync_pro_events IS
  'Append-only syncProLog events (guards, fetch failures, alerts). Retained 30 days.';

ALTER TABLE public.sync_pro_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow service role full access on sync_pro_events"
  ON public.sync_pro_events;

CREATE POLICY "Allow service role full access on sync_pro_events"
  ON public.sync_pro_events FOR ALL
  USING (true) WITH CHECK (true);
