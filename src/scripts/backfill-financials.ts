/**
 * Backfill `daily_home_totals` for the last 30 calendar days (Asia/Jerusalem) using
 * `fetchHomeForDate` from `@/lib/xdash-client` — same netCost mapping as `refreshTodayHome`.
 *
 * Usage:
 *   npx tsx --env-file=.env.local src/scripts/backfill-financials.ts
 */

import { config } from "dotenv";

config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { fetchHomeForDate } from "../lib/xdash-client";

const DELAY_MS = 200;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function getIsraelTodayYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

/** Add signed calendar days to a YYYY-MM-DD string (Israel wall-calendar math via UTC date parts). */
function addCalendarDaysYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Last 30 days inclusive: from (today − 29) through today, Israel time, oldest first. */
function last30IsraelDays(): string[] {
  const today = getIsraelTodayYmd();
  const out: string[] = [];
  for (let i = 29; i >= 0; i--) {
    out.push(addCalendarDaysYmd(today, -i));
  }
  return out;
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env.local).");
    process.exit(1);
  }

  const dates = last30IsraelDays();
  const syncedAt = new Date().toISOString();
  let ok = 0;
  let failed = 0;

  console.log(
    `[Backfill] Starting ${dates.length} days (${dates[0]} … ${dates[dates.length - 1]}) Israel time\n`,
  );

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i]!;
    try {
      const { revenue, cost, profit, impressions } = await fetchHomeForDate(date);
      const { error } = await supabase.from("daily_home_totals").upsert(
        { date, revenue, cost, profit, impressions, created_at: syncedAt },
        { onConflict: "date" },
      );
      if (error) {
        failed++;
        console.error(
          `[Backfill] ${date}: Revenue ${formatUsd(revenue)}, Cost ${formatUsd(cost)} - Failed: ${error.message}`,
        );
      } else {
        ok++;
        console.log(
          `[Backfill] ${date}: Revenue ${formatUsd(revenue)}, Cost ${formatUsd(cost)} - Success.`,
        );
      }
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[Backfill] ${date}: Revenue —, Cost — - Failed: ${msg}`);
    }

    if (i < dates.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`\n[Backfill] Done. ${ok} succeeded, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
