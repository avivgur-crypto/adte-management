-- Per-user notification preferences (sidebar toggles).
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS notification_settings jsonb NOT NULL DEFAULT '{"low_margin_enabled": true}'::jsonb;

COMMENT ON COLUMN public.profiles.notification_settings IS 'JSON e.g. {"low_margin_enabled": true}.';

-- Consecutive syncs with margin below 33% (reset when margin recovers or after alert).
ALTER TABLE public.daily_goal_sync_snapshot
ADD COLUMN IF NOT EXISTS consecutive_low_margin_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.daily_goal_sync_snapshot.consecutive_low_margin_count IS 'Low-margin streak; 3 consecutive syncs below 33% triggers push (Israel noon+).';
