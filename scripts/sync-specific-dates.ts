/**
 * One-off / CLI: sync XDASH for explicit YYYY-MM-DD list (partners + daily_home_totals).
 * Usage: npx tsx --env-file=.env.local scripts/sync-specific-dates.ts 2026-04-14 2026-04-15
 * Add --force to pass force: true (re-fetch home totals even when profit exists).
 */

import { syncXDASHDataForDates } from "../src/lib/sync/xdash";

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--force");
  const force = process.argv.includes("--force");
  if (args.length === 0) {
    console.error("Usage: sync-specific-dates.ts [--force] <YYYY-MM-DD> [...]");
    process.exit(1);
  }
  const dates = args.map((d) => d.trim()).filter(Boolean);
  console.log(`\n=== syncXDASHDataForDates: ${dates.join(", ")} (force=${force}) ===\n`);
  const result = await syncXDASHDataForDates(dates, { force });
  console.log("\nResult:", JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
