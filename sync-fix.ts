import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

/** Today in Asia/Jerusalem — matches XDASH / sync logic. */
function getTodayIsrael(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

/** Every calendar day from start through end (YYYY-MM-DD), inclusive. Empty if end < start. */
function buildDateRangeInclusive(start: string, end: string): string[] {
  if (end < start) return [];
  const out: string[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    const [y, m, d] = cur.split("-").map(Number);
    const next = new Date(y, m - 1, d + 1);
    cur = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
  }
  return out;
}

const SYNC_RANGE_START = "2026-01-01";

async function runManualSync() {
  console.log("-----------------------------------------");
  console.log("  ADTE MASTER SYNC TOOL (DYNAMIC MODE)");
  console.log("-----------------------------------------");

  if (!process.env.XDASH_AUTH_TOKEN) {
    console.error("ERROR: XDASH_AUTH_TOKEN is missing from .env.local");
    process.exit(1);
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("ERROR: Supabase env vars are missing from .env.local");
    process.exit(1);
  }
  console.log("Keys loaded. Running pre-flight DB check...\n");

  // ── Pre-flight: verify we can actually write to daily_home_totals ──
  const { supabaseAdmin } = await import('./src/lib/supabase');

  const testDate = "1999-01-01";
  const { error: writeErr } = await supabaseAdmin
    .from("daily_home_totals")
    .upsert(
      { date: testDate, revenue: 0, cost: 0, profit: 0, impressions: 0, created_at: new Date().toISOString() },
      { onConflict: "date" },
    );
  if (writeErr) {
    console.error("PRE-FLIGHT FAILED — cannot write to daily_home_totals:");
    console.error(JSON.stringify(writeErr, null, 2));
    process.exit(1);
  }

  // Clean up the dummy row
  await supabaseAdmin.from("daily_home_totals").delete().eq("date", testDate);
  console.log("PRE-FLIGHT PASSED — Supabase write confirmed.\n");

  // ── Verify we can read back existing data ──
  const { data: sample, error: readErr } = await supabaseAdmin
    .from("daily_home_totals")
    .select("date, profit")
    .order("date", { ascending: false })
    .limit(3);
  if (readErr) {
    console.error("PRE-FLIGHT READ FAILED:", JSON.stringify(readErr, null, 2));
    process.exit(1);
  }
  console.log("Latest rows in daily_home_totals:", sample);
  console.log("");

  try {
    const { syncHomeTotalsForDates } = await import('./src/lib/sync/xdash');

    const todayIL = getTodayIsrael();
    const dates = buildDateRangeInclusive(SYNC_RANGE_START, todayIL);

    if (dates.length === 0) {
      console.error(
        `No dates to sync (today in Israel is ${todayIL}; range starts ${SYNC_RANGE_START}).`,
      );
      process.exit(1);
    }

    const syncedAt = new Date().toISOString();
    const force = true;

    console.log(`Date range: ${SYNC_RANGE_START} → ${todayIL} (${dates.length} days, no 2025)`);
    console.log(`Syncing (force=${force}, syncedAt=${syncedAt})...\n`);

    const written = await syncHomeTotalsForDates(dates, syncedAt, force);

    console.log(`\nSYNC COMPLETE — ${written} rows written to daily_home_totals`);

    // ── Post-flight: read back a few rows to verify the data landed ──
    const { data: verify } = await supabaseAdmin
      .from("daily_home_totals")
      .select("date, revenue, cost, profit, impressions, created_at")
      .order("date", { ascending: false })
      .limit(5);
    console.log("\nPost-sync verification (latest 5 rows):");
    console.table(verify);
  } catch (err) {
    console.error("\nFATAL ERROR DURING SYNC:", err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

runManualSync();
