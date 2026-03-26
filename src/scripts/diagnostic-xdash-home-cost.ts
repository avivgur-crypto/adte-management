/**
 * Logs raw Home API cost fields vs our upsert mapping (same as fetchHomeForDate).
 *
 * Usage:
 *   npx tsx --env-file=.env.local src/scripts/diagnostic-xdash-home-cost.ts
 *   npx tsx --env-file=.env.local src/scripts/diagnostic-xdash-home-cost.ts 2026-03-24
 */

import { fetchAdServerOverview, type XDashTotals } from "../lib/xdash-client";

function yesterdayIsrael(): string {
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  const [y, m, d] = todayStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

async function main() {
  const date = process.argv[2]?.trim() || yesterdayIsrael();
  const raw = await fetchAdServerOverview({ startDate: date, endDate: date });
  const sd = (raw as unknown as Record<string, unknown>).overviewTotals as Record<string, unknown> | undefined;
  const selectedDates = sd?.selectedDates as Record<string, unknown> | undefined;
  const totals = selectedDates?.totals as XDashTotals | undefined;

  const grossCost = Number(totals?.cost ?? 0);
  const netCost = Number(totals?.netCost ?? 0);
  const serviceCost = Number(totals?.serviceCost ?? 0);
  const baseCost = grossCost || netCost;
  const mappedCost = baseCost + serviceCost;

  const out = {
    date,
    rawApiTotals: {
      cost: grossCost,
      netCost,
      serviceCost,
      revenue: Number(totals?.revenue ?? 0),
      netRevenue: Number(totals?.netRevenue ?? 0),
      impressions: Number(totals?.impressions ?? 0),
    },
    mappedCostAsUpserted: mappedCost,
    sumNetCostPlusServiceCost: netCost + serviceCost,
    note: "fetchHomeForDate upserts cost = (cost||netCost) + serviceCost.",
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
