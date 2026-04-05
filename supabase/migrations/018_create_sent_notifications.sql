-- Dedupe Web Push milestone alerts: at most one row per (notification_type, Israel calendar day).

CREATE TABLE IF NOT EXISTS public.sent_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type text NOT NULL CHECK (notification_type IN ('goal_reached', 'monthly_record')),
  sent_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (notification_type, sent_date)
);

CREATE INDEX IF NOT EXISTS sent_notifications_sent_date_idx ON public.sent_notifications (sent_date);

COMMENT ON TABLE public.sent_notifications IS 'Server-side log of milestone pushes; one per type per calendar day (Israel).';

ALTER TABLE public.sent_notifications ENABLE ROW LEVEL SECURITY;
