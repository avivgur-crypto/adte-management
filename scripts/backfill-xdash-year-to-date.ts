/**
 * Backfill XDASH data from start of year through last month (and current month through yesterday).
 * Usage: npx tsx --env-file=.env.local scripts/backfill-xdash-year-to-date.ts [year]
 * Example: npx tsx --env-file=.env.local scripts/backfill-xdash-year-to-date.ts 2026
 *
 * Runs syncXDASHDataForMonth for Jan, Feb, ... up to and including the current month.
 * Safe to re-run: uses upsert, no duplicate rows.
 */

import { syncXDASHDataForMonth } from "../src/lib/sync/xdash";

function getYesterday(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}

async function main() {
  const year = parseInt(process.argv[2] ?? String(new Date().getFullYear()), 10);
  if (!year || year < 2020 || year > 2030) {
    console.error("Usage: npx tsx --env-file=.env.local scripts/backfill-xdash-year-to-date.ts [year]");
    process.exit(1);
  }

  const now = new Date();
  const yesterday = getYesterday();
  const currentMonth = now.getFullYear() === year ? now.getMonth() + 1 : 12;

  console.log(`\n=== XDASH backfill ${year} (Jan–${String(currentMonth).padStart(2, "0")}) ===\n`);

  let totalDates = 0;
  let totalRows = 0;

  for (let month = 1; month <= currentMonth; month++) {
    console.log(`--- ${year}-${String(month).padStart(2, "0")} ---`);
    const result = await syncXDASHDataForMonth(year, month);
    totalDates += result.datesSynced;
    totalRows += result.rowsUpserted;
    console.log(`  ${result.datesSynced} dates, ${result.rowsUpserted} rows\n`);
  }

  console.log(`Total: ${totalDates} dates, ${totalRows} rows`);
  console.log("\nDone.\n");
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
