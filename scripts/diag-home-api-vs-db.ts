/**
 * Compare XDASH Home API (fetchHomeForDate) vs daily_home_totals for one date.
 * Usage: npx tsx --env-file=.env.local scripts/diag-home-api-vs-db.ts [YYYY-MM-DD]
 * Default: today (Asia/Jerusalem).
 */

import { createClient } from "@supabase/supabase-js";
import { fetchHomeForDate } from "../src/lib/xdash-client";

function todayIsrael(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

async function main() {
  const date = (process.argv[2]?.trim() || todayIsrael()).slice(0, 10);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  console.log(`\n=== Home API vs daily_home_totals for ${date} ===\n`);

  const api = await fetchHomeForDate(date);

  const sb = createClient(url, key);
  const { data: row, error } = await sb
    .from("daily_home_totals")
    .select("date, revenue, cost, profit, impressions, created_at")
    .eq("date", date)
    .maybeSingle();

  if (error) {
    console.error("Supabase error:", error.message);
    process.exit(1);
  }

  const db = row
    ? {
        revenue: Number(row.revenue),
        cost: Number(row.cost),
        profit: Number(row.profit),
        impressions: Number(row.impressions),
        created_at: row.created_at,
      }
    : null;

  console.log("XDASH Home API (fetchHomeForDate → mapAdServerOverviewToHomeTotals):");
  console.log(JSON.stringify(api, null, 2));
  console.log("\ndaily_home_totals row:");
  console.log(db ? JSON.stringify(db, null, 2) : "(no row)");

  if (db) {
    const dRev = api.revenue - db.revenue;
    const dProfit = api.profit - db.profit;
    console.log("\nDelta (API − DB):");
    console.log(`  revenue: ${dRev >= 0 ? "+" : ""}${dRev.toFixed(4)}`);
    console.log(`  profit:  ${dProfit >= 0 ? "+" : ""}${dProfit.toFixed(4)}`);
  }

  const apply = process.argv.includes("--upsert-if-diff");
  if (apply && db && (Math.abs(api.revenue - db.revenue) > 0.01 || Math.abs(api.profit - db.profit) > 0.01)) {
    const syncedAt = new Date().toISOString();
    const { error: upErr } = await sb.from("daily_home_totals").upsert(
      {
        date,
        revenue: api.revenue,
        cost: api.cost,
        profit: api.profit,
        impressions: api.impressions,
        created_at: syncedAt,
      },
      { onConflict: "date" },
    );
    if (upErr) {
      console.error("\nManual upsert failed:", upErr.message);
      process.exit(1);
    }
    console.log("\n--upsert-if-diff: row updated from API values.");
  }

  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
