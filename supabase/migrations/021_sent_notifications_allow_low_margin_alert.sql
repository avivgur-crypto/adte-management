-- Allow low_margin_alert (once per Israel calendar day via UNIQUE + sent_date).

ALTER TABLE public.sent_notifications
DROP CONSTRAINT IF EXISTS sent_notifications_notification_type_check;

ALTER TABLE public.sent_notifications
DROP CONSTRAINT IF EXISTS sent_notifications_check;

ALTER TABLE public.sent_notifications
ADD CONSTRAINT sent_notifications_notification_type_check
CHECK (
  notification_type IN (
    'daily_goal_reached',
    'monthly_total_goal_reached',
    'low_margin_alert'
  )
);

COMMENT ON TABLE public.sent_notifications IS 'Server-side log of milestone pushes; daily_goal_reached & low_margin_alert per Israel day, monthly_total_goal_reached per month.';
