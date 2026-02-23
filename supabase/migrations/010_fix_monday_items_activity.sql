-- Add board_id and created_date columns to monday_items_activity if missing.
-- The original migration (008) defines them, but the table may have been created
-- without them. This migration safely adds them and rebuilds the unique constraint.

-- Add board_id (default empty string so existing rows don't break NOT NULL)
ALTER TABLE monday_items_activity
  ADD COLUMN IF NOT EXISTS board_id text NOT NULL DEFAULT '';

-- Add created_date (derived from created_at for existing rows)
ALTER TABLE monday_items_activity
  ADD COLUMN IF NOT EXISTS created_date date;

-- Backfill created_date from created_at for any rows missing it
UPDATE monday_items_activity
  SET created_date = (created_at AT TIME ZONE 'UTC')::date
  WHERE created_date IS NULL;

-- Make created_date NOT NULL after backfill
ALTER TABLE monday_items_activity
  ALTER COLUMN created_date SET NOT NULL;

-- Drop old unique constraint on item_id alone (if exists) and create the correct one
DO $$
BEGIN
  -- Drop any unique index on just item_id
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'monday_items_activity'
      AND indexdef LIKE '%item_id%'
      AND indexdef NOT LIKE '%board_id%'
      AND indexname LIKE '%unique%' OR indexname LIKE '%key%'
  ) THEN
    EXECUTE (
      SELECT 'DROP INDEX IF EXISTS ' || indexname
      FROM pg_indexes
      WHERE tablename = 'monday_items_activity'
        AND indexdef LIKE '%item_id%'
        AND indexdef NOT LIKE '%board_id%'
      LIMIT 1
    );
  END IF;
END
$$;

-- Create correct unique constraint
ALTER TABLE monday_items_activity
  DROP CONSTRAINT IF EXISTS monday_items_activity_item_id_board_id_key;

ALTER TABLE monday_items_activity
  ADD CONSTRAINT monday_items_activity_item_id_board_id_key UNIQUE (item_id, board_id);

-- Create index for fast queries by board + date
CREATE INDEX IF NOT EXISTS idx_monday_items_activity_board_created
  ON monday_items_activity (board_id, created_date);
