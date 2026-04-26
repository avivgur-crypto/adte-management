/**
 * Force-backfill XDASH for a single month.
 *
 * Re-fetches every day from the 1st through min(today, last_of_month) and overwrites
 * existing rows in `daily_partner_performance` AND `daily_home_totals`. Home totals
 * are written via `syncHomeTotalsForDates(..., force=true)`, which overrides the
 * "skip if profit != 0" optimization that normally prevents historical rows from
 * being updated. Use this whenever the chart drifts from XDash and needs to be
 * re-anchored to the live API totals.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-xdash-month.ts <year> <month>
 *   # Default to current month (Israel calendar):
 *   npx tsx --env-file=.env.local scripts/backfill-xdash-month.ts
 *
 * Example:
 *   npx tsx --env-file=.env.local scripts/backfill-xdash-month.ts 2026 4
 */

import { syncXDASHBackfill } from "../src/lib/sync/xdash";

const TIMEZONE_ISRAEL = "Asia/Jerusalem";

function todayIsrael(): { year: number; month: number; iso: string } {
  const iso = new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE_ISRAEL });
  const [y, m] = iso.split("-").map(Number);
  return { year: y!, month: m!, iso };
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

async function main() {
  const today = todayIsrael();

  const argY = process.argv[2];
  const argM = process.argv[3];
  const year = argY ? parseInt(argY, 10) : today.year;
  const month = argM ? parseInt(argM, 10) : today.month;

  if (!Number.isFinite(year) || year < 2020 || year > 2030 || !Number.isFinite(month) || month < 1 || month > 12) {
    console.error("Usage: npx tsx --env-file=.env.local scripts/backfill-xdash-month.ts <year> <month>");
    console.error("Example: npx tsx --env-file=.env.local scripts/backfill-xdash-month.ts 2026 4");
    process.exit(1);
  }

  const start = `${year}-${pad2(month)}-01`;
  const lastOfMonth = `${year}-${pad2(month)}-${pad2(lastDayOfMonth(year, month))}`;
  // For the current month, stop at today (Israel); for past months, go to the last day.
  const end = today.iso < lastOfMonth ? today.iso : lastOfMonth;

  if (end < start) {
    console.error(`Nothing to backfill: end (${end}) is before start (${start}).`);
    process.exit(1);
  }

  console.log(`\n=== XDASH FORCE BACKFILL ${year}-${pad2(month)} ===`);
  console.log(`Range: ${start} → ${end}  (force=true, overwrites existing rows)`);
  console.log(`Source of truth: XDash Home API → daily_home_totals + daily_partner_performance`);
  console.log("");

  const t0 = Date.now();
  const result = await syncXDASHBackfill(start, end);
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

  console.log("");
  console.log("=== SUMMARY ===");
  console.log(`Date range:        ${start} → ${end}`);
  console.log(`Days processed:    ${result.datesSynced}`);
  console.log(`Partner rows:      ${result.rowsUpserted}  (daily_partner_performance)`);
  console.log(`Home totals rows:  ${result.homeRowsWritten ?? 0}  (daily_home_totals, force=true)`);
  console.log(`Elapsed:           ${elapsedSec}s`);
  console.log("");
  console.log("Done. The Home / Financial chart will reflect the new totals after the next");
  console.log("page render (the financial-data cache tag is busted on every sync write).");
  console.log("");
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
