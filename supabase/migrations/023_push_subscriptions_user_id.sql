-- Link push subscriptions to individual users for targeted notifications.

ALTER TABLE public.push_subscriptions
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON public.push_subscriptions (user_id);

COMMENT ON COLUMN public.push_subscriptions.user_id IS 'Owner of this push subscription; NULL for legacy rows.';
