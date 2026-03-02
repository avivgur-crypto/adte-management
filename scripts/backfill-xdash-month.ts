/**
 * Backfill XDASH data for a single month into daily_partner_performance.
 * Usage: npx tsx --env-file=.env.local scripts/backfill-xdash-month.ts <year> <month>
 * Example: npx tsx --env-file=.env.local scripts/backfill-xdash-month.ts 2026 2
 */

import { syncXDASHDataForMonth } from "../src/lib/sync/xdash";

async function main() {
  const year = parseInt(process.argv[2] ?? "0", 10);
  const month = parseInt(process.argv[3] ?? "0", 10);
  if (!year || year < 2020 || year > 2030 || !month || month < 1 || month > 12) {
    console.error("Usage: npx tsx --env-file=.env.local scripts/backfill-xdash-month.ts <year> <month>");
    console.error("Example: npx tsx --env-file=.env.local scripts/backfill-xdash-month.ts 2026 2");
    process.exit(1);
  }
  console.log(`\n=== XDASH backfill ${year}-${String(month).padStart(2, "0")} ===\n`);
  const result = await syncXDASHDataForMonth(year, month);
  console.log(`Dates synced: ${result.datesSynced}`);
  console.log(`Rows upserted: ${result.rowsUpserted}`);
  console.log("\nDone.\n");
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
