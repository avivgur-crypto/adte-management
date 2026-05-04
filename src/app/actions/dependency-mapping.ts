"use server";

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { getIsraelDate } from "@/lib/israel-date";
import { supabaseAdmin } from "@/lib/supabase";
import type { PairEntry } from "@/lib/dependency-mapping-utils";

export type {
  DependencyMappingRow,
  DependencyMappingResult,
  PairEntry,
} from "@/lib/dependency-mapping-utils";

/** 5-min TTL — data only changes on cron sync (every 30 min). */
const CACHE_TTL = 300;
const PAGE_SIZE = 1000;
const FIRST_DATA_DATE = "2026-01-01";

type RawPairRow = {
  date: string | null;
  demand_tag: string | null;
  supply_tag: string | null;
  revenue: number | string | null;
  cost: number | string | null;
  profit: number | string | null;
};

/** Numeric-aware coerce — Supabase returns numerics as strings for big values. */
function n(v: unknown): number {
  const x = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
}

function monthKeyFromDate(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

/**
 * Try the pre-aggregated `monthly_partner_pairs` view first (1 query, server-side
 * GROUP BY). Returns `null` when the view doesn't exist in the live DB so the
 * caller falls back to a paginated read of `daily_partner_pairs`.
 *
 * This dual-path exists because migration 026 (which creates the view) was never
 * applied in production — the view-only code silently returned `{}` and the UI
 * showed "No data" for every month.
 */
async function fetchFromView(
  startMonth: string,
  endMonth: string,
): Promise<Record<string, PairEntry[]> | null> {
  const { data, error } = await supabaseAdmin
    .from("monthly_partner_pairs")
    .select("month, demand_tag, supply_tag, revenue, cost, profit")
    .gte("month", startMonth)
    .lte("month", endMonth);

  if (error) {
    const msg = error.message ?? "";
    const missingRelation =
      /relation .* does not exist/i.test(msg) ||
      /could not find the table/i.test(msg) ||
      /schema cache/i.test(msg);
    if (missingRelation) {
      console.warn(
        "[dependency-pairs] monthly_partner_pairs view not present — falling back to direct read of daily_partner_pairs (apply migration 026 for the perf path).",
      );
      return null;
    }
    console.error("[dependency-pairs] view query failed:", msg);
    return null;
  }
  if (!data) return {};

  const result: Record<string, PairEntry[]> = {};
  for (const row of data) {
    const monthKey = String(row.month).slice(0, 10);
    if (!result[monthKey]) result[monthKey] = [];
    result[monthKey]!.push({
      demandPartner: String(row.demand_tag ?? ""),
      supplyPartner: String(row.supply_tag ?? ""),
      revenue: n(row.revenue),
      cost: n(row.cost),
      profit: n(row.profit),
    });
  }
  return result;
}

/**
 * Direct paginated read of `daily_partner_pairs` + JS-side aggregation by
 * (month, demand_tag, supply_tag). Used when the view is missing.
 */
async function fetchFromDailyTable(
  startDate: string,
  endDate: string,
): Promise<Record<string, PairEntry[]>> {
  const sums = new Map<string, { demand: string; supply: string; rev: number; cost: number; profit: number; month: string }>();
  let offset = 0;
  let totalRows = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from("daily_partner_pairs")
      .select("date, demand_tag, supply_tag, revenue, cost, profit")
      .gte("date", startDate)
      .lte("date", endDate)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error("[dependency-pairs] daily_partner_pairs query failed:", error.message);
      break;
    }
    if (!data || data.length === 0) break;
    totalRows += data.length;

    for (const row of data as RawPairRow[]) {
      const day = String(row.date ?? "").slice(0, 10);
      if (!day) continue;
      const month = monthKeyFromDate(day);
      const demand = String(row.demand_tag ?? "");
      const supply = String(row.supply_tag ?? "");
      const key = `${month}\u0001${demand}\u0001${supply}`;
      const cur = sums.get(key);
      const rev = n(row.revenue);
      const cost = n(row.cost);
      const profit = n(row.profit);
      if (cur) {
        cur.rev += rev;
        cur.cost += cost;
        cur.profit += profit;
      } else {
        sums.set(key, { demand, supply, rev, cost, profit, month });
      }
    }
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const result: Record<string, PairEntry[]> = {};
  for (const { demand, supply, rev, cost, profit, month } of sums.values()) {
    if (!result[month]) result[month] = [];
    result[month]!.push({
      demandPartner: demand,
      supplyPartner: supply,
      revenue: rev,
      cost,
      profit,
    });
  }
  console.log(
    `[dependency-pairs] fallback read: ${totalRows} daily rows → ${sums.size} pair-month rows across ${Object.keys(result).length} months (range ${startDate} → ${endDate})`,
  );
  return result;
}

async function _getAllDependencyPairs(): Promise<Record<string, PairEntry[]>> {
  // Israel-time current month — keeps the upper bound stable around UTC midnight.
  const todayIL = getIsraelDate();
  const currentMonth = `${todayIL.slice(0, 7)}-01`;
  const startMonth = FIRST_DATA_DATE;

  console.log(
    `[dependency-pairs] querying months ${startMonth} → ${currentMonth} (today_IL=${todayIL})`,
  );

  // Primary: view (1 query, server-side aggregation). Falls back to direct read
  // when the view is missing (current state of live DB).
  const viaView = await fetchFromView(startMonth, currentMonth);
  if (viaView != null) {
    const totalPairs = Object.values(viaView).reduce((s, arr) => s + arr.length, 0);
    console.log(
      `[dependency-pairs] view: ${totalPairs} pair-month rows across ${Object.keys(viaView).length} months — ${
        Object.keys(viaView).sort().join(", ") || "(none)"
      }`,
    );
    return viaView;
  }

  // Fallback: paginated daily_partner_pairs + JS aggregation.
  const lastDayOfCurrentMonth = (() => {
    const [y, m] = currentMonth.split("-").map(Number);
    const last = new Date(y!, m!, 0).getDate();
    return `${currentMonth.slice(0, 7)}-${String(last).padStart(2, "0")}`;
  })();
  const result = await fetchFromDailyTable(startMonth, lastDayOfCurrentMonth);
  console.log(
    `[dependency-pairs] result months: ${Object.keys(result).sort().join(", ") || "(none)"}`,
  );
  return result;
}

export const getAllDependencyPairs = cache(
  unstable_cache(_getAllDependencyPairs, ["all-dep-pairs"], { revalidate: CACHE_TTL }),
);
