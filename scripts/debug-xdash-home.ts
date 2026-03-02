/**
 * Debug: call getHomeRevenueForRange to trigger XDASH backup raw response log (January 2026).
 * Run: npx tsx --env-file=.env.local scripts/debug-xdash-home.ts [startDate] [endDate]
 * The full JSON from /home/overview/adServers is logged via console.log inside getHomeRevenueForRange.
 */
import { getHomeRevenueForRange } from "../src/lib/xdash-client";

const startDate = process.argv[2] ?? "2026-01-01";
const endDate = process.argv[3] ?? "2026-01-31";

async function main() {
  console.log(`Calling getHomeRevenueForRange('${startDate}', '${endDate}')...\n`);
  const revenue = await getHomeRevenueForRange(startDate, endDate);
  console.log("\nExtracted revenue:", revenue);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
