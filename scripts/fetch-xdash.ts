/**
 * Syncs XDASH Home totals into daily_home_totals (today + catch-up).
 * Partner performance writes were removed. Usage: npm run fetch:xdash
 */

import { syncXDASHData } from "../src/lib/sync/xdash";

async function main() {
  console.log("\n=== XDASH Home Totals Sync ===\n");
  const result = await syncXDASHData();
  console.log(`Dates synced: ${result.datesSynced}`);
  console.log(`Home rows written: ${result.homeRowsWritten ?? 0}`);
  console.log("\nDone.\n");
}

main().catch((err) => {
  console.error("Failed to sync XDASH home totals:", err);
  process.exit(1);
});
