"use server";

import { unstable_cache } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import type { PairEntry } from "@/lib/dependency-mapping-utils";

export type {
  DependencyMappingRow,
  DependencyMappingResult,
  PairEntry,
} from "@/lib/dependency-mapping-utils";

const PAGE_SIZE = 1000;
/** 15 min TTL — data only changes on cron sync (every 3h). */
const CACHE_TTL = 900;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMonthRange(monthKey: string): { start: string; end: string } {
  const [y, m] = monthKey.split("-").map(Number);
  const lastDay = new Date(y!, m!, 0).getDate();
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

async function fetchAllPairRows(start: string, end: string): Promise<
  Array<{ month_key: string; demand_tag: string; supply_tag: string; revenue: number; cost: number }>
> {
  const all: Array<{ month_key: string; demand_tag: string; supply_tag: string; revenue: number; cost: number }> = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("daily_partner_pairs")
      .select("date, demand_tag, supply_tag, revenue, cost")
      .gte("date", start)
      .lte("date", end)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      console.error("[dependency-mapping] query failed:", error.message);
      throw new Error("Dependency mapping query failed.");
    }
    if (!data || data.length === 0) break;
    for (const row of data) {
      const d = String(row.date ?? "").slice(0, 10);
      all.push({
        month_key: d.slice(0, 7) + "-01",
        demand_tag: String(row.demand_tag ?? ""),
        supply_tag: String(row.supply_tag ?? ""),
        revenue: Number(row.revenue ?? 0),
        cost: Number(row.cost ?? 0),
      });
    }
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

// ---------------------------------------------------------------------------
// Server action: fetch ALL aggregated pairs for a single month (cached).
// Called once per month at page load — not on every filter change.
// ---------------------------------------------------------------------------

/**
 * Fetch ALL dependency pairs (entire year) in ONE DB query,
 * aggregate per month, return Record<monthKey, PairEntry[]>.
 */
async function _getAllDependencyPairs(): Promise<Record<string, PairEntry[]>> {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const endMonthKey = `2026-${String(currentMonth).padStart(2, "0")}`;
  const { end } = getMonthRange(`${endMonthKey}-01`);

  let rawRows: Awaited<ReturnType<typeof fetchAllPairRows>>;
  try {
    rawRows = await fetchAllPairRows("2026-01-01", end);
  } catch (e) {
    console.error("[dependency-pairs-all]", e);
    return {};
  }

  const byMonth = new Map<
    string,
    Map<string, { demand: string; supply: string; revenue: number; cost: number }>
  >();

  for (const r of rawRows) {
    const monthKey = r.month_key;
    let month = byMonth.get(monthKey);
    if (!month) { month = new Map(); byMonth.set(monthKey, month); }
    const key = `${r.demand_tag}\u0001${r.supply_tag}`;
    const cur = month.get(key);
    if (cur) {
      cur.revenue += r.revenue;
      cur.cost += r.cost;
    } else {
      month.set(key, { demand: r.demand_tag, supply: r.supply_tag, revenue: r.revenue, cost: r.cost });
    }
  }

  const result: Record<string, PairEntry[]> = {};
  for (const [mk, pairs] of byMonth) {
    result[mk] = Array.from(pairs.values()).map((s) => ({
      demandPartner: s.demand,
      supplyPartner: s.supply,
      revenue: s.revenue,
      cost: s.cost,
    }));
  }
  return result;
}

export const getAllDependencyPairs = unstable_cache(
  _getAllDependencyPairs,
  ["all-dep-pairs"],
  { revalidate: CACHE_TTL },
);
