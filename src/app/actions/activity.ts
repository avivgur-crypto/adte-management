"use server";

import { unstable_cache } from "next/cache";
import { withRetry } from "@/lib/resilience";
import { SIGNED_DEALS_BOARD_ID } from "@/lib/monday-client";
import { supabaseAdmin } from "@/lib/supabase";

/** 5-min TTL — data only changes on cron sync (every 30 min). */
const CACHE_TTL = 300;

const ACTIVITY_TABLE = "monday_items_activity";
const LEADS_BOARD_ID = "7832231403";
/**
 * New Signed Deals are now sourced from the CRM Deals board (Closed Won group);
 * see `src/lib/sync/monday.ts`. Activity rows for signed deals carry this board id.
 */
const SIGNED_DEALS_ACTIVITY_BOARD_ID = SIGNED_DEALS_BOARD_ID;

export interface ActivityMetrics {
  newLeads: number;
  newSignedDeals: number;
}

export interface ActivityDailyRow {
  date: string;
  total_leads: number;
  won_deals: number;
}

/**
 * Count new leads and new signed deals per date from the monday_items_activity
 * table, which has one row per item with board_id and created_date.
 * Returns daily rows for 2026 so the client can filter by selected months.
 */
async function _getActivityDataFromFunnel(): Promise<ActivityDailyRow[]> {
  return withRetry(async () => {
    const { data: rows, error } = await supabaseAdmin
      .from(ACTIVITY_TABLE)
      .select("board_id, created_date")
      .in("board_id", [LEADS_BOARD_ID, SIGNED_DEALS_ACTIVITY_BOARD_ID])
      .gte("created_date", "2026-01-01")
      .lt("created_date", "2027-01-01")
      .order("created_date", { ascending: true });

    if (error) {
      console.error("[activity] fetch failed:", error.message);
      throw new Error("Activity data fetch failed.");
    }
    if (!rows?.length) return [];

    const byDate = new Map<string, { leads: number; deals: number }>();
    for (const row of rows) {
      const d = String(row.created_date);
      const entry = byDate.get(d) ?? { leads: 0, deals: 0 };
      if (String(row.board_id) === LEADS_BOARD_ID) {
        entry.leads += 1;
      } else if (String(row.board_id) === SIGNED_DEALS_ACTIVITY_BOARD_ID) {
        entry.deals += 1;
      }
      byDate.set(d, entry);
    }

    return Array.from(byDate.entries()).map(([date, counts]) => ({
      date,
      total_leads: counts.leads,
      won_deals: counts.deals,
    }));
  });
}

export const getActivityDataFromFunnel = unstable_cache(
  _getActivityDataFromFunnel,
  ["activity-funnel"],
  { revalidate: CACHE_TTL },
);

export interface SignedDealCompany {
  created_date: string;
  company_name: string;
}

/**
 * Fetch all signed deals in 2026 with the linked Account name.
 * Sourced from the CRM Deals board (Closed Won group) via the Monday sync;
 * `company_name` comes from the `board_relation_mkwsdcg0` (Accounts) column.
 * Client filters by selected months and displays names under "New Signed Deals".
 */
async function _getSignedDealsCompanies(): Promise<SignedDealCompany[]> {
  return withRetry(async () => {
    const { data: rows, error } = await supabaseAdmin
      .from(ACTIVITY_TABLE)
      .select("created_date, company_name")
      .eq("board_id", SIGNED_DEALS_ACTIVITY_BOARD_ID)
      .gte("created_date", "2026-01-01")
      .lt("created_date", "2027-01-01")
      .not("company_name", "is", null)
      .order("created_date", { ascending: true });

    if (error) {
      console.error("[activity] signed deals fetch failed:", error.message);
      throw new Error("Signed deals data fetch failed.");
    }
    if (!rows?.length) return [];

    return rows.map((row) => ({
      created_date: String(row.created_date),
      company_name: String(row.company_name ?? "").trim(),
    })).filter((r) => r.company_name !== "");
  });
}

export const getSignedDealsCompanies = unstable_cache(
  _getSignedDealsCompanies,
  ["signed-deals-companies"],
  { revalidate: CACHE_TTL },
);
