/**
 * 1) Verify XDASH responds for TODAY (Israel) within client timeouts (90s home overview).
 * 2) Force-fetch and upsert daily_home_totals for given dates (default Apr 15–17, 2026).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/verify-and-backfill-home.ts
 *   npx tsx --env-file=.env.local scripts/verify-and-backfill-home.ts --verify-only
 *   npx tsx --env-file=.env.local scripts/verify-and-backfill-home.ts --date=2026-04-14
 */

import { createClient } from "@supabase/supabase-js";
import { fetchHomeForDate } from "../src/lib/xdash-client";
import { syncHomeTotalsForDates } from "../src/lib/sync/xdash";

function todayIsrael(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

function datesFromArgv(argv: string[]): string[] {
  const out: string[] = [];
  for (const a of argv) {
    const m = /^--date=(\d{4}-\d{2}-\d{2})$/.exec(a);
    if (m) {
      out.push(m[1]!);
      continue;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(a)) out.push(a);
  }
  return [...new Set(out)].slice(0, 10);
}

async function main() {
  const verifyOnly = process.argv.includes("--verify-only");
  const datesFromArgs = datesFromArgv(process.argv.slice(2));

  const backfillDates =
    datesFromArgs.length > 0
      ? datesFromArgs
      : ["2026-04-15", "2026-04-16", "2026-04-17"];

  const today = todayIsrael();

  console.log("\n=== STEP 1: TODAY (verification) ===\n");
  console.log(`Israel today: ${today}`);
  const t0 = Date.now();
  try {
    const row = await fetchHomeForDate(today);
    const ms = Date.now() - t0;
    console.log(`fetchHomeForDate OK in ${ms}ms (HOME_OVERVIEW_TIMEOUT_MS is 90s in xdash-client)`);
    console.log(
      JSON.stringify(
        {
          date: today,
          revenue: row.revenue,
          cost: row.cost,
          profit: row.profit,
          impressions: row.impressions,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    const ms = Date.now() - t0;
    console.error(`fetchHomeForDate FAILED after ${ms}ms:`, e instanceof Error ? e.message : e);
    if (verifyOnly) process.exit(1);
  }

  if (verifyOnly) {
    console.log("\n--verify-only: skipping backfill.\n");
    return;
  }

  console.log("\n=== STEP 2: Backfill daily_home_totals (force) ===\n");
  console.log(`Dates: ${backfillDates.join(", ")}`);
  const syncedAt = new Date().toISOString();
  const written = await syncHomeTotalsForDates(backfillDates, syncedAt, true);
  console.log(`\nsyncHomeTotalsForDates rows written: ${written}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const sb = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: rows, error } = await sb
    .from("daily_home_totals")
    .select("date, revenue, cost, profit, impressions, created_at")
    .in("date", backfillDates)
    .order("date", { ascending: true });

  if (error) {
    console.error("Supabase read-back error:", error.message);
    process.exit(1);
  }

  console.log("\n=== SUMMARY (revenue per day) ===\n");
  for (const d of backfillDates) {
    const r = rows?.find((x) => String(x.date).slice(0, 10) === d);
    if (!r) {
      console.log(`  ${d}: (no row — fetch may have failed or returned all zeros and was skipped)`);
      continue;
    }
    console.log(
      `  ${d}: revenue=$${Number(r.revenue).toFixed(2)}  profit=$${Number(r.profit).toFixed(2)}  cost=$${Number(r.cost).toFixed(2)}  imp=${r.impressions}  created_at=${r.created_at}`,
    );
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
