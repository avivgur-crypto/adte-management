/**
 * One-off reconciliation: force-fetch a date range from the External Report
 * API (always-upsert) into `daily_home_totals`, preserving `hourly_snapshots`.
 *
 * Defaults to **2026-05-01 → 2026-05-07** (the May reconciliation task).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-may-dates.ts
 *   npx tsx --env-file=.env.local scripts/backfill-may-dates.ts 2026-05-05 2026-05-06 2026-05-07
 *   npx tsx --env-file=.env.local scripts/backfill-may-dates.ts --from 2026-05-01 --to 2026-05-07
 *
 * All logs flow through logger:"sync-pro" so they're greppable in Vercel Log
 * Insights when promoted to a route, and in stdout when run locally.
 */

import { syncXDASHDataForDates } from "../src/lib/sync/xdash";
import { syncProLog } from "../src/lib/sync-pro-log";

const DEFAULT_FROM = "2026-05-01";
const DEFAULT_TO = "2026-05-07";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const start = new Date(Date.UTC(fy!, fm! - 1, fd!));
  const end = new Date(Date.UTC(ty!, tm! - 1, td!));
  if (end < start) return out;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function parseArgs(argv: string[]): string[] {
  const args = argv.slice(2);
  let from: string | undefined;
  let to: string | undefined;
  const explicit: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--from" && args[i + 1]) {
      from = args[++i];
    } else if (a === "--to" && args[i + 1]) {
      to = args[++i];
    } else if (ISO_DATE.test(a)) {
      explicit.push(a);
    }
  }
  if (explicit.length > 0) return explicit;
  if (from && to && ISO_DATE.test(from) && ISO_DATE.test(to)) return dateRange(from, to);
  return dateRange(DEFAULT_FROM, DEFAULT_TO);
}

async function main() {
  const dates = parseArgs(process.argv);
  const t0 = Date.now();

  syncProLog({
    event: "sync_pro.reconcile.cli.start",
    branch_type: "totals",
    status: "started",
    detail: { dates, forceExternal: true, skipHourlySnapshots: true, force: true },
  });

  try {
    const result = await syncXDASHDataForDates(dates, {
      force: true,
      forceExternal: true,
      skipHourlySnapshots: true,
      skipPartnerPerformance: true,
    });
    const durationMs = Date.now() - t0;
    syncProLog({
      event: "sync_pro.reconcile.cli.complete",
      branch_type: "totals",
      status: "ok",
      duration_ms: durationMs,
      detail: { dates, datesSynced: result.datesSynced, rowsUpserted: result.rowsUpserted },
    });
    console.log("\nReconciliation complete:", JSON.stringify(result, null, 2));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    syncProLog({
      event: "sync_pro.reconcile.cli.failed",
      branch_type: "totals",
      status: "error",
      duration_ms: Date.now() - t0,
      message: msg,
      detail: { dates },
    });
    console.error("Reconciliation failed:", msg);
    process.exit(1);
  }
}

main();
