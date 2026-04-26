/**
 * Full Monday sync: daily_funnel_metrics + monday_items_activity (New Leads / New Signed Deals).
 * No date cap — fetches all items on the Leads and Media Contracts boards (paginated).
 *
 * Usage:
 *   npm run fetch:monday
 *   MONDAY_SYNC_DEBUG=true npm run fetch:monday   # logs Monday API page sizes per board
 *   npx tsx --env-file=.env.local src/scripts/fetch-monday.ts
 *
 * After running, wait up to ~5 minutes for cached activity API, or redeploy / invalidate cache.
 *
 * Check Anzu / April 2026 activity rows:
 *   npm run verify:anzu-april
 */

import { syncMondayData } from "../lib/sync/monday";

async function main() {
  console.log("Fetching Monday.com funnel + activity (full board sync)…\n");
  const result = await syncMondayData();
  console.log(`Upserted daily_funnel_metrics: ${result.funnelRows} row(s)`);
  console.log(`Upserted monday_items_activity: ${result.activityRows} row(s)`);
  console.log(
    "\nTip: Dashboard activity is cached (~5 min). Refresh the page after a short wait.\n",
  );
}

main().catch((err) => {
  console.error("Failed to fetch Monday funnel data:", err);
  process.exit(1);
});
