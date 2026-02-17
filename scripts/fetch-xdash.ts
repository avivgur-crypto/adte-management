/**
 * Fetches demand & supply partner data from XDASH and upserts into daily_partner_performance.
 * Uses shared sync engine. Usage: npm run fetch:xdash
 */

import { syncXDASHData } from "../src/lib/sync/xdash";

async function main() {
  console.log("\n=== XDASH Partner Fetch ===\n");
  const result = await syncXDASHData();
  console.log(`Dates synced: ${result.datesSynced}`);
  console.log(`Rows upserted: ${result.rowsUpserted}`);
  console.log("\nDone.\n");
}

main().catch((err) => {
  console.error("Failed to fetch XDASH partner data:", err);
  process.exit(1);
});
