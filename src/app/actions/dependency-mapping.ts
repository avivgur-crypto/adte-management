"use server";

import { supabaseAdmin } from "@/lib/supabase";

const RISK_THRESHOLD_PERCENT = 60;
const PAGE_SIZE = 1000;

export interface DependencyMappingRow {
  demandPartner: string;
  supplyPartner: string;
  revenue: number;
  cost: number;
  profit: number;
  profitMarginPercent: number;
}

export interface DependencyMappingResult {
  rows: DependencyMappingRow[];
  riskDemandPartners: string[];
  fromXdash: boolean;
  /** Set when DB has no data or query failed (helps debugging). */
  errorMessage?: string;
}

function getMonthRange(monthKey: string): { start: string; end: string } {
  const [y, m] = monthKey.split("-").map(Number);
  const lastDay = new Date(y!, m!, 0).getDate();
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

/**
 * Fetch all rows from daily_partner_pairs for the given date range (paginated).
 */
async function fetchAllPairRows(start: string, end: string): Promise<
  Array<{ date: string; demand_tag: string; supply_tag: string; revenue: number; cost: number; profit: number }>
> {
  const all: Array<{ date: string; demand_tag: string; supply_tag: string; revenue: number; cost: number; profit: number }> = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("daily_partner_pairs")
      .select("date, demand_tag, supply_tag, revenue, cost, profit")
      .gte("date", start)
      .lte("date", end)
      .order("date", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Dependency mapping query failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      all.push({
        date: String(row.date).slice(0, 10),
        demand_tag: String(row.demand_tag ?? ""),
        supply_tag: String(row.supply_tag ?? ""),
        revenue: Number(row.revenue ?? 0),
        cost: Number(row.cost ?? 0),
        profit: Number(row.profit ?? 0),
      });
    }
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

/**
 * Fetch Dependency Mapping data only from Supabase (daily_partner_pairs).
 * Does not call the XDASH API. Data must be populated by the partner-pairs sync (cron).
 */
export async function getDependencyMappingData(
  monthKeys: string[]
): Promise<DependencyMappingResult> {
  if (monthKeys.length === 0) {
    return { rows: [], riskDemandPartners: [], fromXdash: false };
  }

  const pairSums = new Map<string, { revenue: number; cost: number }>();

  for (const monthKey of monthKeys) {
    const { start, end } = getMonthRange(monthKey);
    try {
      const rows = await fetchAllPairRows(start, end);
      for (const r of rows) {
        const key = `${r.demand_tag}\u0001${r.supply_tag}`;
        const cur = pairSums.get(key) ?? { revenue: 0, cost: 0 };
        cur.revenue += r.revenue;
        cur.cost += r.cost;
        pairSums.set(key, cur);
      }
    } catch (e) {
      return {
        rows: [],
        riskDemandPartners: [],
        fromXdash: false,
        errorMessage: e instanceof Error ? e.message : String(e),
      };
    }
  }

  if (pairSums.size === 0) {
    return {
      rows: [],
      riskDemandPartners: [],
      fromXdash: false,
      errorMessage:
        "No pair data in database. Run the sync (cron) to backfill daily_partner_pairs from XDASH.",
    };
  }

  const rows: DependencyMappingRow[] = [];
  const demandTotalRevenue = new Map<string, number>();
  const demandSupplyRevenue = new Map<string, Map<string, number>>();

  for (const [key, { revenue, cost }] of pairSums) {
    const i = key.indexOf("\u0001");
    const demandPartner = i >= 0 ? key.slice(0, i) : key;
    const supplyPartner = i >= 0 ? key.slice(i + 1) : "Unknown";
    const profit = revenue - cost;
    const profitMarginPercent = revenue > 0 ? (profit / revenue) * 100 : 0;
    rows.push({
      demandPartner,
      supplyPartner,
      revenue,
      cost,
      profit,
      profitMarginPercent,
    });
    demandTotalRevenue.set(
      demandPartner,
      (demandTotalRevenue.get(demandPartner) ?? 0) + revenue
    );
    let supplyMap = demandSupplyRevenue.get(demandPartner);
    if (!supplyMap) {
      supplyMap = new Map();
      demandSupplyRevenue.set(demandPartner, supplyMap);
    }
    supplyMap.set(supplyPartner, (supplyMap.get(supplyPartner) ?? 0) + revenue);
  }

  const riskDemandPartners: string[] = [];
  for (const [demand, totalRev] of demandTotalRevenue) {
    if (totalRev <= 0) continue;
    const supplyMap = demandSupplyRevenue.get(demand);
    if (!supplyMap) continue;
    for (const [, rev] of supplyMap) {
      if ((rev / totalRev) * 100 > RISK_THRESHOLD_PERCENT) {
        riskDemandPartners.push(demand);
        break;
      }
    }
  }

  rows.sort((a, b) => b.profit - a.profit);

  return {
    rows,
    riskDemandPartners,
    fromXdash: false,
  };
}
