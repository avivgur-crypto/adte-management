-- Client concentration: revenue by partner per month from Master Billing sheet.

CREATE TABLE IF NOT EXISTS client_revenue_breakdown (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  month         date        NOT NULL,
  partner_name  text        NOT NULL,
  partner_type  text        NOT NULL CHECK (partner_type IN ('demand', 'supply')),
  revenue       numeric     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (month, partner_name, partner_type)
);

CREATE INDEX IF NOT EXISTS idx_client_revenue_breakdown_month
  ON client_revenue_breakdown (month);
