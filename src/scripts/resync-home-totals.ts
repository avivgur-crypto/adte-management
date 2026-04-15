/**
 * Re-sync daily_home_totals for Jan, Feb, Mar 2026 using the Home API.
 * Run: npx tsx src/scripts/resync-home-totals.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { fetchHomeForDate } from "../lib/xdash-client";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const DELAY_MS = 5000;

function datesForMonth(year: number, month: number): string[] {
  const now = new Date();
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  const lastDay = new Date(year, month, 0).getDate();
  const out: string[] = [];
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (dateStr > todayStr) break;
    out.push(dateStr);
  }
  return out;
}

async function main() {
  const months = [
    { year: 2026, month: 1 },
    { year: 2026, month: 2 },
    { year: 2026, month: 3 },
  ];

  const syncedAt = new Date().toISOString();
  let totalWritten = 0;

  for (const { year, month } of months) {
    const dates = datesForMonth(year, month);
    console.log(`\n=== ${year}-${String(month).padStart(2, "0")}: ${dates.length} dates ===`);

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i]!;
      try {
        const { revenue, cost, profit, impressions } = await fetchHomeForDate(date);
        if (revenue === 0 && cost === 0) {
          console.log(`  ${date}: no data (zeros)`);
          continue;
        }
        const { error } = await supabase
          .from("daily_home_totals")
          .upsert(
            { date, revenue, cost, profit, impressions, created_at: syncedAt },
            { onConflict: "date" },
          );
        if (error) {
          console.error(`  ${date}: upsert error: ${error.message}`);
        } else {
          console.log(`  ${date}: revenue=$${revenue.toFixed(2)}, cost=$${cost.toFixed(2)}`);
          totalWritten++;
        }
      } catch (e) {
        console.error(`  ${date}: fetch failed:`, e instanceof Error ? e.message : e);
      }
      if (i < dates.length - 1) {
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
    }
  }

  console.log(`\nDone! ${totalWritten} rows written to daily_home_totals.`);
}

main().catch(console.error);
