/**
 * One-off: print raw /home/overview/adServers totals vs mapAdServerOverviewToHomeTotals.
 * Usage: npx tsx --env-file=.env.local scripts/audit-home-totals-raw.ts [YYYY-MM-DD]
 */

import { fetchAdServerOverview, mapAdServerOverviewToHomeTotals } from "../src/lib/xdash-client";

async function main() {
  const date = (process.argv[2]?.trim() || "2026-04-15").slice(0, 10);
  const raw = await fetchAdServerOverview({ startDate: date, endDate: date });
  const t = raw.overviewTotals?.selectedDates?.totals;
  console.log("\n--- raw overviewTotals.selectedDates.totals (subset) ---\n");
  console.log(
    JSON.stringify(
      {
        revenue: t?.revenue,
        netRevenue: t?.netRevenue,
        cost: t?.cost,
        netCost: t?.netCost,
        serviceCost: t?.serviceCost,
        impressions: t?.impressions,
      },
      null,
      2,
    ),
  );
  const gross = Number(t?.revenue ?? 0);
  const netRev = Number(t?.netRevenue ?? 0);
  console.log("\n--- interpretation ---");
  console.log("gross revenue (totals.revenue):", gross);
  console.log("netRevenue (totals.netRevenue):", netRev);
  console.log("current mapper uses: gross || net →", gross || netRev);

  const mapped = mapAdServerOverviewToHomeTotals(raw, date);
  console.log("\nmapAdServerOverviewToHomeTotals:", mapped);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
