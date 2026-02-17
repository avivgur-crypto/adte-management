/**
 * CLI script to fetch demand & supply partner data from XDASH
 * and upsert into the `daily_partner_performance` table in Supabase.
 *
 * Syncs the entire current month (1st through yesterday) so the dashboard
 * MTD totals match XDASH. Uses upsert so existing rows are updated.
 *
 * Usage:
 *   npm run fetch:xdash
 *   npx tsx --env-file=.env.local scripts/fetch-xdash.ts
 */

import {
  fetchDemandPartners,
  fetchSupplyPartners,
  mapDemandPartners,
  mapSupplyPartners,
  type PartnerRow,
} from "../src/lib/xdash-client";
import { supabaseAdmin } from "../src/lib/supabase";

const TABLE = "daily_partner_performance";

// ---------------------------------------------------------------------------
// Helpers — use LOCAL date components so timezone doesn't shift boundaries
// ---------------------------------------------------------------------------

/** YYYY-MM-DD from local date (avoids UTC shift from toISOString). */
function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Yesterday in local time (same as subDays(now, 1)). */
function getYesterday(now: Date): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return d;
}

/** Dates from 1st of current month through yesterday (inclusive). */
function datesFromMonthStartThroughYesterday(): string[] {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const yesterday = getYesterday(now);

  if (firstOfMonth > yesterday) return [];

  const out: string[] = [];
  const cur = new Date(firstOfMonth);
  while (cur <= yesterday) {
    out.push(formatLocalDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** Upsert an array of PartnerRows into Supabase for a given date & type. */
async function upsertPartnerRows(
  date: string,
  partnerType: "demand" | "supply",
  rows: PartnerRow[]
) {
  if (rows.length === 0) {
    return;
  }

  const records = rows.map((r) => ({
    date,
    partner_name: r.name,
    partner_type: partnerType,
    revenue: r.revenue,
    cost: r.cost,
    impressions: r.impressions,
  }));

  const { error } = await supabaseAdmin
    .from(TABLE)
    .upsert(records, { onConflict: "date,partner_name,partner_type" });

  if (error) {
    throw new Error(
      `Supabase upsert (${partnerType}) failed for ${date}: ${error.message}`
    );
  }
}

function currency(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const dates = datesFromMonthStartThroughYesterday();
  if (dates.length === 0) {
    console.log("\nNo dates to sync (month just started and today is the 1st).\n");
    return;
  }

  const [monthStart, lastDate] = [dates[0], dates[dates.length - 1]];
  console.log(`\n=== XDASH Partner Fetch — ${monthStart} through ${lastDate} (${dates.length} days) ===\n`);

  // Accumulate MTD across all days and all partners (never reset inside loop)
  let totalDemandRevenue = 0;
  let totalSupplyCost = 0;

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    console.log(
      dates.length > 1 ? `Syncing [${i + 1}/${dates.length}] ${date}...` : `Syncing ${date}...`
    );

    try {
      const demandRaw = await fetchDemandPartners(date);
      const demandRows = mapDemandPartners(demandRaw);
      await upsertPartnerRows(date, "demand", demandRows);
      totalDemandRevenue += demandRows.reduce((s, r) => s + r.revenue, 0);

      const supplyRaw = await fetchSupplyPartners(date);
      const supplyRows = mapSupplyPartners(supplyRaw);
      await upsertPartnerRows(date, "supply", supplyRows);
      totalSupplyCost += supplyRows.reduce((s, r) => s + r.cost, 0);
    } catch (err) {
      console.error(`ERROR syncing ${date}:`, err);
      throw err;
    }
  }

  console.log("\n=== Summary ===");
  console.log(`  Dates synced: ${monthStart} → ${lastDate} (${dates.length} days)`);
  console.log(`  Total Revenue (demand, MTD): ${currency(totalDemandRevenue)}`);
  console.log(`  Total Cost    (supply, MTD): ${currency(totalSupplyCost)}`);
  console.log(`  Gross Profit (MTD):         ${currency(totalDemandRevenue - totalSupplyCost)}`);
  console.log("\nDone.\n");
}

main().catch((err) => {
  console.error("Failed to fetch XDASH partner data:", err);
  process.exit(1);
});
