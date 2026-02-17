/**
 * Fetches actual SaaS revenue from the "Master Billing" sheet (Demand tab)
 * and upserts saas_actual into monthly_goals.
 *
 * Usage: npm run fetch:billing
 */

import { getSheetValues } from "../lib/google-sheets";
import { supabaseAdmin } from "../lib/supabase";

const BILLING_SHEET_ID = "1GKzqtjt-5bk4uBd-MIhkbbgSasfcF86eJ9UR-VQYZdQ";
const RANGE = "Demand!A:H";
const TABLE = "monthly_goals";

const COL_DATE = 0;   // A: "Jan26"
const COL_TYPE = 2;   // C: "SAAS"
const COL_AMOUNT = 7; // H: amount

const MONTH_ABBR: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse "Jan26" style to YYYY-MM-01. Returns null if invalid.
 */
function parseShortMonth(cell: string | undefined): string | null {
  const raw = (cell ?? "").trim();
  if (!raw || raw.length < 4) return null;
  const monthStr = raw.slice(0, 3).toLowerCase();
  const monthNum = MONTH_ABBR[monthStr];
  if (monthNum == null) return null;
  const yy = raw.slice(3).replace(/\D/g, "");
  if (yy.length < 2) return null;
  const year = parseInt(yy, 10);
  const fullYear = year < 100 ? 2000 + year : year;
  const m = String(monthNum).padStart(2, "0");
  return `${fullYear}-${m}-01`;
}

/** Parse amount: strip $ and commas, return 0 for empty/invalid. */
function parseAmount(cell: string | undefined): number {
  if (cell == null || String(cell).trim() === "") return 0;
  const s = String(cell).replace(/\$/g, "").replace(/,/g, "").trim();
  if (!s) return 0;
  const n = Number(s);
  return Number.isNaN(n) ? 0 : n;
}

async function main() {
  console.log("Fetching Master Billing (Demand) for SaaS revenue...\n");

  const rows = await getSheetValues(BILLING_SHEET_ID, RANGE);
  if (rows.length < 2) {
    console.log("No data rows. Nothing to update.");
    return;
  }

  const byMonth = new Map<string, number>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const type = String(row[COL_TYPE] ?? "").trim();
    if (type.toUpperCase() !== "SAAS") continue;

    const monthKey = parseShortMonth(row[COL_DATE]);
    if (!monthKey) continue;

    const amount = parseAmount(row[COL_AMOUNT]);
    byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + amount);
  }

  if (byMonth.size === 0) {
    console.log("No SAAS rows found. Nothing to update.");
    return;
  }

  for (const [month, saas_actual] of byMonth) {
    const { error } = await supabaseAdmin
      .from(TABLE)
      .upsert(
        { month, saas_actual },
        { onConflict: "month" }
      );

    if (error) {
      throw new Error(`Supabase upsert failed for ${month}: ${error.message}`);
    }
  }

  console.log(`Updated saas_actual for ${byMonth.size} month(s).\n`);
  console.log("=== SaaS actual by month ===");
  for (const [month, amount] of [...byMonth.entries()].sort()) {
    console.log(`  ${month}  $${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  }
  console.log("\nDone.\n");
}

main().catch((err) => {
  console.error("Failed to fetch billing:", err);
  process.exit(1);
});
