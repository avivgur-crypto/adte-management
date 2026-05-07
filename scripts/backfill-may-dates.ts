/**
 * One-off backfill: force-fetch May 5/6/7 (or any explicit list of dates) from
 * the External XDASH API and upsert into `daily_home_totals` + partner perf.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-may-dates.ts
 *   npx tsx --env-file=.env.local scripts/backfill-may-dates.ts 2026-05-05 2026-05-06 2026-05-07
 *
 * All logs use logger:"sync-pro" so they show up in Vercel Log Insights when
 * promoted to a route, and in stdout when run locally.
 */

import { syncXDASHDataForDates } from "../src/lib/sync/xdash";
import { syncProLog } from "../src/lib/sync-pro-log";

const DEFAULT_DATES = ["2026-05-05", "2026-05-06", "2026-05-07"];

function parseArgs(argv: string[]): string[] {
  const args = argv.slice(2).filter(Boolean);
  if (args.length === 0) return DEFAULT_DATES;
  return args.map((d) => d.trim());
}

async function main() {
  const dates = parseArgs(process.argv);
  const t0 = Date.now();

  syncProLog({
    event: "sync_pro.backfill.start",
    branch_type: "totals",
    status: "started",
    detail: { dates, force: true },
  });

  try {
    const result = await syncXDASHDataForDates(dates, { force: true });
    const durationMs = Date.now() - t0;
    syncProLog({
      event: "sync_pro.backfill.complete",
      branch_type: "totals",
      status: "ok",
      duration_ms: durationMs,
      detail: { dates, datesSynced: result.datesSynced, rowsUpserted: result.rowsUpserted },
    });
    console.log("\nBackfill complete:", JSON.stringify(result, null, 2));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    syncProLog({
      event: "sync_pro.backfill.failed",
      branch_type: "totals",
      status: "error",
      duration_ms: Date.now() - t0,
      message: msg,
      detail: { dates },
    });
    console.error("Backfill failed:", msg);
    process.exit(1);
  }
}

main();
