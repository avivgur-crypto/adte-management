-- Per-advertiser collection inputs from Master Billing Demand:
--   D = Advertiser Name, H = Final Revenue, I = Amount Received.
-- Used for Collection Rate expand → top unpaid gaps.

CREATE TABLE IF NOT EXISTS public.billing_collection_partners (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  month            date        NOT NULL,
  partner_name     text        NOT NULL,
  final_revenue    numeric     NOT NULL DEFAULT 0,
  amount_received  numeric     NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (month, partner_name)
);

CREATE INDEX IF NOT EXISTS idx_billing_collection_partners_month
  ON public.billing_collection_partners (month);

COMMENT ON TABLE public.billing_collection_partners IS
  'Demand advertisers: Final Revenue (H) and Amount Received (I) per month for collection gap ranking.';

ALTER TABLE public.billing_collection_partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow service role full access on billing_collection_partners"
  ON public.billing_collection_partners;

CREATE POLICY "Allow service role full access on billing_collection_partners"
  ON public.billing_collection_partners FOR ALL
  USING (true) WITH CHECK (true);
