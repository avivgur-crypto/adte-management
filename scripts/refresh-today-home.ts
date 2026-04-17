/**
 * Force-refresh daily_home_totals from XDASH Home API (today + yesterday).
 * Usage: npx tsx --env-file=.env.local scripts/refresh-today-home.ts
 */

import { refreshTodayHome } from "../src/app/actions/financials";

async function main() {
  console.log("Calling refreshTodayHome()…\n");
  const result = await refreshTodayHome();
  console.log("Result:", JSON.stringify(result, null, 2));
  if (!result.updated) {
    console.warn("Note: updated=false (check server logs for upsert errors).");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
