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
// Fetch pre-aggregated pairs from v_monthly_dep_pairs SQL view.
// The view does GROUP BY (month, demand_tag, supply_tag) in Postgres,
// so JS only reshapes — no aggregation needed.
// ---------------------------------------------------------------------------

async function _getAllDependencyPairs(): Promise<Record<string, PairEntry[]>> {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const endMonth = `2026-${String(currentMonth).padStart(2, "0")}-01`;

  const allRows: Array<{ month: string; demand_tag: string; supply_tag: string; revenue: number; cost: number }> = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from("v_monthly_dep_pairs")
      .select("month, demand_tag, supply_tag, revenue, cost")
      .gte("month", "2026-01-01")
      .lte("month", endMonth)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error("[dependency-pairs] view query failed:", error.message);
      return {};
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      allRows.push({
        month: String(row.month).slice(0, 10),
        demand_tag: String(row.demand_tag ?? ""),
        supply_tag: String(row.supply_tag ?? ""),
        revenue: Number(row.revenue ?? 0),
        cost: Number(row.cost ?? 0),
      });
    }
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const result: Record<string, PairEntry[]> = {};
  for (const r of allRows) {
    if (!result[r.month]) result[r.month] = [];
    result[r.month]!.push({
      demandPartner: r.demand_tag,
      supplyPartner: r.supply_tag,
      revenue: r.revenue,
      cost: r.cost,
    });
  }
  return result;
}

export const getAllDependencyPairs = cache(
  unstable_cache(_getAllDependencyPairs, ["all-dep-pairs"], { revalidate: CACHE_TTL }),
);
