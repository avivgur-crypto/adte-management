"use server";

import { withRetry } from "@/lib/resilience";
import { supabaseAdmin } from "@/lib/supabase";

const FUNNEL_TABLE = "daily_funnel_metrics";

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
 * Fetch all daily_funnel_metrics rows for 2026 for the Activity summary.
 * New Leads = SUM(total_leads), New Signed Deals = SUM(won_deals) over selected months.
 */
export async function getActivityDataFromFunnel(): Promise<ActivityDailyRow[]> {
  return withRetry(async () => {
    const { data, error } = await supabaseAdmin
      .from(FUNNEL_TABLE)
      .select("date, total_leads, won_deals")
      .gte("date", "2026-01-01")
      .lt("date", "2027-01-01")
      .order("date", { ascending: true });

    if (error) throw new Error(`Activity data fetch failed: ${error.message}`);
    return (data ?? []).map((row) => ({
      date: String(row.date),
      total_leads: Number(row.total_leads ?? 0),
      won_deals: Number(row.won_deals ?? 0),
    }));
  });
}
