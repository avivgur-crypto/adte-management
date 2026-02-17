-- Activity summary: one row per Monday item from Leads (7832231403) and Contracts (8280704003).
-- Used to count "New Leads" and "New Signed Deals" by creation date within selected months.

CREATE TABLE IF NOT EXISTS monday_items_activity (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      text        NOT NULL,
  board_id     text        NOT NULL,
  created_at   timestamptz NOT NULL,
  created_date date        NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, board_id)
);

CREATE INDEX IF NOT EXISTS idx_monday_items_activity_board_created
  ON monday_items_activity (board_id, created_date);
