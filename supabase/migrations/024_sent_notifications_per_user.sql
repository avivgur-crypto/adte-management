-- Per-user dedupe: UNIQUE (user_id, notification_type, sent_date).

TRUNCATE public.sent_notifications;

ALTER TABLE public.sent_notifications
DROP CONSTRAINT IF EXISTS sent_notifications_notification_type_sent_date_key;

ALTER TABLE public.sent_notifications
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

DELETE FROM public.sent_notifications WHERE user_id IS NULL;

ALTER TABLE public.sent_notifications
ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.sent_notifications
DROP CONSTRAINT IF EXISTS sent_notifications_user_type_date_key;

ALTER TABLE public.sent_notifications
ADD CONSTRAINT sent_notifications_user_type_date_key UNIQUE (user_id, notification_type, sent_date);

CREATE INDEX IF NOT EXISTS sent_notifications_user_id_idx ON public.sent_notifications (user_id);

ALTER TABLE public.sent_notifications
DROP CONSTRAINT IF EXISTS sent_notifications_notification_type_check;

ALTER TABLE public.sent_notifications
ADD CONSTRAINT sent_notifications_notification_type_check
CHECK (
  notification_type IN (
    'morning_summary',
    'daily_goal_reached',
    'monthly_total_goal_reached',
    'low_margin_alert'
  )
);

COMMENT ON TABLE public.sent_notifications IS 'Per-user dedupe of push alerts: UNIQUE (user_id, notification_type, sent_date).';
