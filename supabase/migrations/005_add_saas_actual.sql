-- Add saas_actual column for actual SaaS revenue from Master Billing sheet.

ALTER TABLE monthly_goals
  ADD COLUMN IF NOT EXISTS saas_actual numeric NOT NULL DEFAULT 0;
