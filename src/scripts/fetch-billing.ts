/**
 * Fetches SaaS revenue from Master Billing (Demand) and upserts into monthly_goals.
 * Uses shared sync engine (supports Jan26, January 2026, etc.).
 * Usage: npm run fetch:billing
 */

import { syncBillingData } from "../lib/sync/billing";

async function main() {
  console.log("Fetching Master Billing (Demand) for SaaS revenue...\n");
  const result = await syncBillingData();
  console.log(`Updated saas_actual for ${result.monthsUpdated} month(s).\n`);
  console.log("Done.\n");
}

main().catch((err) => {
  console.error("Failed to fetch billing:", err);
  process.exit(1);
});
