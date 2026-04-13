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

/** 5-min TTL — data only changes on cron sync (every 30 min). */
const CACHE_TTL = 300;

/**
 * Fetch monthly-aggregated partner pairs from the `monthly_partner_pairs` view.
 * A single query replaces the old pagination loop + JS aggregation.
 */
async function _getAllDependencyPairs(): Promise<Record<string, PairEntry[]>> {
  const now = new Date();
  const currentMonth = `2026-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const { data, error } = await supabaseAdmin
    .from("monthly_partner_pairs")
    .select("month, demand_tag, supply_tag, revenue, cost, profit")
    .gte("month", "2026-01-01")
    .lte("month", currentMonth);

  if (error) {
    console.error("[dependency-pairs] query failed:", error.message);
    return {};
  }
  if (!data || data.length === 0) return {};

  const result: Record<string, PairEntry[]> = {};
  for (const row of data) {
    const monthKey = String(row.month).slice(0, 10);
    if (!result[monthKey]) result[monthKey] = [];
    result[monthKey]!.push({
      demandPartner: String(row.demand_tag ?? ""),
      supplyPartner: String(row.supply_tag ?? ""),
      revenue: Number(row.revenue ?? 0),
      cost: Number(row.cost ?? 0),
      profit: Number(row.profit ?? 0),
    });
  }
  return result;
}

export const getAllDependencyPairs = cache(
  unstable_cache(_getAllDependencyPairs, ["all-dep-pairs"], { revalidate: CACHE_TTL }),
);
