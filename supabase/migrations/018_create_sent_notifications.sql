-- Dedupe Web Push milestone alerts.
-- daily_goal_reached: once per Israel calendar day (sent_date = YYYY-MM-DD).
-- monthly_total_goal_reached: once per calendar month (sent_date = YYYY-MM-01).

CREATE TABLE IF NOT EXISTS public.sent_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type text NOT NULL CHECK (notification_type IN ('daily_goal_reached', 'monthly_total_goal_reached')),
  sent_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (notification_type, sent_date)
);

CREATE INDEX IF NOT EXISTS sent_notifications_sent_date_idx ON public.sent_notifications (sent_date);

COMMENT ON TABLE public.sent_notifications IS 'Server-side log of milestone pushes; one daily_goal_reached per day, one monthly_total_goal_reached per month (Israel time).';

ALTER TABLE public.sent_notifications ENABLE ROW LEVEL SECURITY;
