-- P&L line items synced from Google Sheet "Master Billing 2026" (Consolidated / TMS / Adte tabs).

CREATE TABLE IF NOT EXISTS pnl_data (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity      text NOT NULL CHECK (entity IN ('Consolidated', 'TMS', 'Adte')),
  month       date NOT NULL,
  category    text NOT NULL,
  label       text NOT NULL,
  amount      numeric NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pnl_data_entity_month_label_key
  ON pnl_data (entity, month, label);

CREATE INDEX IF NOT EXISTS idx_pnl_data_entity_month
  ON pnl_data (entity, month);

ALTER TABLE pnl_data ENABLE ROW LEVEL SECURITY;
