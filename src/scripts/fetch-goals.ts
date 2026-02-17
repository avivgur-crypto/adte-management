/**
 * Fetches 2026 monthly financial goals from Google Sheets (wide format)
 * and upserts into Supabase. Read-only: does not write back to the sheet.
 *
 * Sheet layout: Months in columns B–M (Jan–Dec 2026). Fixed rows:
 *   - Row 28 (index 27): Media Goal → revenue_goal
 *   - Row 29 (index 28): SaaS Goal → saas_goal
 *   - Row 22 (index 21): Profit Goal → profit_goal
 *
 * Usage: npm run fetch:goals
 */

import { getSheetValues } from "../lib/google-sheets";
import { supabaseAdmin } from "../lib/supabase";

const GOALS_SHEET_ID = "1RYBG97dyEsvQ5vulN-ljh1OknlwQpCDgYwBT-OW_uz0";
const RANGE = "Sheet1!A1:M35";
const TABLE = "monthly_goals";
const TARGET_YEAR = 2026;

/** Row indices (0-based) in the sheet */
const ROW_MEDIA_GOAL = 27;   // Row 28 → revenue_goal
const ROW_SAAS_GOAL = 28;    // Row 29 → saas_goal
const ROW_PROFIT_GOAL = 21;  // Row 22 → profit_goal

/** Column B = Jan, C = Feb, ... M = Dec → indexes 1–12 */
const COL_FIRST_MONTH = 1;
const COL_LAST_MONTH = 12;

/**
 * Parse a cell value: strip $ and commas, then parse as number.
 * Empty or non-numeric defaults to 0.
 */
function parseGoalValue(cell: string | undefined): number {
  if (cell == null || String(cell).trim() === "") return 0;
  const s = String(cell).replace(/\$/g, "").replace(/,/g, "").trim();
  if (!s) return 0;
  const n = Number(s);
  return Number.isNaN(n) ? 0 : n;
}

/** Build month date for column index (1 = Jan, 2 = Feb, ... 12 = Dec). */
function monthForColIndex(colIndex: number): string {
  const month = String(colIndex).padStart(2, "0");
  return `${TARGET_YEAR}-${month}-01`;
}

async function main() {
  console.log("Fetching 2026 goals from Google Sheets (wide format)...\n");

  const rows = await getSheetValues(GOALS_SHEET_ID, RANGE);
  if (rows.length < 30) {
    throw new Error(
      `Sheet has only ${rows.length} rows; need at least 30 for Media/SaaS/Profit goal rows.`
    );
  }

  const records: Array<{
    month: string;
    revenue_goal: number;
    saas_goal: number;
    profit_goal: number;
  }> = [];

  for (let col = COL_FIRST_MONTH; col <= COL_LAST_MONTH; col++) {
    const month = monthForColIndex(col);
    const revenue_goal = parseGoalValue(rows[ROW_MEDIA_GOAL]?.[col]);
    const saas_goal = parseGoalValue(rows[ROW_SAAS_GOAL]?.[col]);
    const profit_goal = parseGoalValue(rows[ROW_PROFIT_GOAL]?.[col]);

    records.push({
      month,
      revenue_goal,
      saas_goal,
      profit_goal,
    });
  }

  const rowsForUpsert = records.map((r) => ({
    month: r.month,
    revenue_goal: r.revenue_goal,
    saas_goal: r.saas_goal,
    profit_goal: r.profit_goal,
    saas_revenue: 0,
  }));

  const { error } = await supabaseAdmin
    .from(TABLE)
    .upsert(rowsForUpsert, { onConflict: "month" });

  if (error) {
    throw new Error(`Supabase upsert failed: ${error.message}`);
  }

  console.log(`Upserted ${rowsForUpsert.length} row(s) into ${TABLE}.\n`);
  console.log("=== 2026 Monthly goals ===");
  for (const r of rowsForUpsert) {
    console.log(
      `  ${r.month}  Revenue: ${r.revenue_goal}  SaaS goal: ${r.saas_goal}  Profit: ${r.profit_goal}`
    );
  }
  console.log("\nDone.\n");
}

main().catch((err) => {
  console.error("Failed to fetch goals:", err);
  process.exit(1);
});
