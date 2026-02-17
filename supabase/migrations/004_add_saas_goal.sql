-- Add saas_goal column to monthly_goals (from Google Sheet "SaaS Goal" row).

ALTER TABLE monthly_goals
  ADD COLUMN IF NOT EXISTS saas_goal numeric;
