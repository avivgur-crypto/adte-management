-- Consecutive XDASH totals (cron) failure counter + critical push dedupe type.

CREATE TABLE IF NOT EXISTS public.sync_health_counters (
  id text PRIMARY KEY,
  consecutive_xdash_totals_failures integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

INSERT INTO public.sync_health_counters (id, consecutive_xdash_totals_failures)
VALUES ('cron_xdash_totals', 0)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.sync_health_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access on sync_health_counters"
  ON public.sync_health_counters FOR ALL
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.sync_health_counters IS
  'Operational counters for cron sync health (e.g. consecutive XDASH totals failures).';

ALTER TABLE public.sent_notifications
  DROP CONSTRAINT IF EXISTS sent_notifications_notification_type_check;

ALTER TABLE public.sent_notifications
  ADD CONSTRAINT sent_notifications_notification_type_check
  CHECK (
    notification_type IN (
      'morning_summary',
      'daily_goal_reached',
      'monthly_total_goal_reached',
      'low_margin_alert',
      'critical_sync_alert'
    )
  );

COMMENT ON TABLE public.sent_notifications IS
  'Per-user dedupe of push alerts; includes critical_sync_alert for repeated XDASH totals cron failures.';
