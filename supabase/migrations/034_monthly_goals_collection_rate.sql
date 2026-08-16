-- Collection Rate inputs from Master Billing Demand sheet:
--   H = Final Revenue, I = Amount Received (aggregated per month).

ALTER TABLE public.monthly_goals
  ADD COLUMN IF NOT EXISTS final_revenue numeric NOT NULL DEFAULT 0;

ALTER TABLE public.monthly_goals
  ADD COLUMN IF NOT EXISTS amount_received numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.monthly_goals.final_revenue IS
  'Sum of Demand!H (Final Revenue) for the month — denominator for Collection Rate.';

COMMENT ON COLUMN public.monthly_goals.amount_received IS
  'Sum of Demand!I (Amount Received) for the month — numerator for Collection Rate.';
