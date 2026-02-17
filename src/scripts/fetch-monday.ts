/**
 * Fetches Monday.com funnel data and activity. Uses shared sync engine.
 * Usage: npm run fetch:monday
 */

import { syncMondayData } from "../lib/sync/monday";

async function main() {
  console.log("Fetching Monday.com funnel...\n");
  const result = await syncMondayData();
  console.log(`Upserted daily_funnel_metrics: ${result.funnelRows} row(s)`);
  console.log(`Upserted monday_items_activity: ${result.activityRows} row(s)`);
  console.log("\nDone.\n");
}

main().catch((err) => {
  console.error("Failed to fetch Monday funnel data:", err);
  process.exit(1);
});
