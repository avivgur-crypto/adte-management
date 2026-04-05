"use server";

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import type { PairEntry } from "@/lib/dependency-mapping-utils";

export type {
  DependencyMappingRow,
  DependencyMappingResult,
  PairEntry,
} from "@/lib/dependency-mapping-utils";

const PAGE_SIZE = 1000;
/** 5-min TTL — data only changes on cron sync (every 30 min). */
const CACHE_TTL = 300;

// ---------------------------------------------------------------------------
// Fetch raw pairs from daily_partner_pairs and aggregate by month in JS.
// (SQL views were unreliable — migration 015 may not be applied.)
// ---------------------------------------------------------------------------

/** YYYY-MM-DD for the last calendar day of `month` (1–12) in `year`. */
function lastDayOfMonthIso(year: number, month: number): string {
  const d = new Date(year, month, 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function _getAllDependencyPairs(): Promise<Record<string, PairEntry[]>> {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const endDate = lastDayOfMonthIso(2026, currentMonth);

  const allRows: Array<{ date: string; demand_tag: string; supply_tag: string; revenue: number; cost: number; profit: number }> = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from("daily_partner_pairs")
      .select("date, demand_tag, supply_tag, revenue, cost, profit")
      .gte("date", "2026-01-01")
      .lte("date", endDate)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error("[dependency-pairs] query failed:", error.message);
      return {};
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      allRows.push({
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

  const aggMap = new Map<string, { demandPartner: string; supplyPartner: string; revenue: number; cost: number; profit: number }>();
  for (const r of allRows) {
    const monthKey = r.date.slice(0, 7) + "-01";
    const key = `${monthKey}\u0001${r.demand_tag}\u0001${r.supply_tag}`;
    const existing = aggMap.get(key);
    if (existing) {
      existing.revenue += r.revenue;
      existing.cost += r.cost;
      existing.profit += r.profit;
    } else {
      aggMap.set(key, {
        demandPartner: r.demand_tag,
        supplyPartner: r.supply_tag,
        revenue: r.revenue,
        cost: r.cost,
        profit: r.profit,
      });
    }
  }

  const result: Record<string, PairEntry[]> = {};
  for (const [key, entry] of aggMap) {
    const monthKey = key.split("\u0001")[0]!;
    if (!result[monthKey]) result[monthKey] = [];
    result[monthKey]!.push(entry);
  }
  return result;
}

export const getAllDependencyPairs = cache(
  unstable_cache(_getAllDependencyPairs, ["all-dep-pairs"], { revalidate: CACHE_TTL }),
);
