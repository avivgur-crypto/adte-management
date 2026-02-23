-- ============================================================
-- הרץ את כל הסקריפט הזה ב-Supabase: SQL Editor → New query → Paste → Run
-- ============================================================

-- 1. הוספת עמודה board_id (אם לא קיימת)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'monday_items_activity' AND column_name = 'board_id'
  ) THEN
    ALTER TABLE monday_items_activity ADD COLUMN board_id text NOT NULL DEFAULT '';
  END IF;
END $$;

-- 2. הוספת עמודה created_date (אם לא קיימת)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'monday_items_activity' AND column_name = 'created_date'
  ) THEN
    ALTER TABLE monday_items_activity ADD COLUMN created_date date;
  END IF;
END $$;

-- 3. מילוי created_date מתאריך created_at (לשורות שקיימות)
UPDATE monday_items_activity
SET created_date = (created_at AT TIME ZONE 'UTC')::date
WHERE created_date IS NULL;

-- 4. הפיכת created_date ל-NOT NULL
ALTER TABLE monday_items_activity
ALTER COLUMN created_date SET NOT NULL;

-- 5. הסרת אילוץ ייחוד ישן (אם קיים) והוספת (item_id, board_id)
ALTER TABLE monday_items_activity
DROP CONSTRAINT IF EXISTS monday_items_activity_item_id_key;

ALTER TABLE monday_items_activity
DROP CONSTRAINT IF EXISTS monday_items_activity_item_id_board_id_key;

ALTER TABLE monday_items_activity
ADD CONSTRAINT monday_items_activity_item_id_board_id_key UNIQUE (item_id, board_id);

-- 6. אינדקס לחיפוש לפי board + תאריך
CREATE INDEX IF NOT EXISTS idx_monday_items_activity_board_created
ON monday_items_activity (board_id, created_date);

-- 7. עמודת שם חברה לחוזים (בורד Media Contracts, עמודה text_mkpw5mcs)
ALTER TABLE monday_items_activity
ADD COLUMN IF NOT EXISTS company_name text;
