-- Expand notification_settings default to include all 4 notification toggles.

ALTER TABLE public.profiles
ALTER COLUMN notification_settings
SET DEFAULT '{"morning_summary_enabled": true, "daily_goal_reached_enabled": true, "monthly_goal_reached_enabled": true, "low_margin_enabled": true}'::jsonb;

-- Backfill existing rows that only have the old key.
UPDATE public.profiles
SET notification_settings = jsonb_build_object(
  'morning_summary_enabled', COALESCE((notification_settings->>'morning_summary_enabled')::boolean, true),
  'daily_goal_reached_enabled', COALESCE((notification_settings->>'daily_goal_reached_enabled')::boolean, true),
  'monthly_goal_reached_enabled', COALESCE((notification_settings->>'monthly_goal_reached_enabled')::boolean, true),
  'low_margin_enabled', COALESCE((notification_settings->>'low_margin_enabled')::boolean, true)
)
WHERE NOT (
  notification_settings ? 'morning_summary_enabled'
  AND notification_settings ? 'daily_goal_reached_enabled'
  AND notification_settings ? 'monthly_goal_reached_enabled'
  AND notification_settings ? 'low_margin_enabled'
);
