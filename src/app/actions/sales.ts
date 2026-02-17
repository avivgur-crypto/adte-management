"use server";

import { getActivityMetrics } from "@/app/actions/activity";
import { withRetry } from "@/lib/resilience";
import { supabaseAdmin } from "@/lib/supabase";

export interface SalesFunnelMetrics {
  totalLeads: number;
  qualifiedLeads: number;
  opsApprovedLeads: number;
  wonDeals: number;
  leadToQualifiedPercent: number | null;
  qualifiedToWonPercent: number | null;
  overallWinRatePercent: number | null;
  /** Single month for backwards compatibility (first of aggregated months). */
  month: string;
  /** Months used for this aggregate (for "Displaying data for" label). */
  months: string[];
}

function getCurrentMonthStart(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/**
 * Get the latest daily_funnel_metrics row for a given month (snapshot as of last available date in that month).
 */
async function getLatestRowForMonth(monthStart: string): Promise<{
  total_leads: number;
  qualified_leads: number;
  ops_approved_leads: number;
  won_deals: number;
} | null> {
  const [y, m] = monthStart.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  const { data, error } = await supabaseAdmin
    .from("daily_funnel_metrics")
    .select("total_leads, qualified_leads, ops_approved_leads, won_deals")
    .gte("date", monthStart)
    .lt("date", nextMonth)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return {
    total_leads: Number(data.total_leads ?? 0),
    qualified_leads: Number(data.qualified_leads ?? 0),
    ops_approved_leads: Number(data.ops_approved_leads ?? 0),
    won_deals: Number(data.won_deals ?? 0),
  };
}

/**
 * Aggregated funnel for the given month range. If no months selected, defaults to current month.
 * Uses the latest snapshot per month from daily_funnel_metrics and sums counts across months.
 */
export async function getSalesFunnelMetrics(
  monthStarts?: string[]
): Promise<SalesFunnelMetrics | null> {
  return withRetry(async () => {
    const months =
      monthStarts && monthStarts.length > 0 ? monthStarts : [getCurrentMonthStart()];

    let totalLeads = 0;
    let qualifiedLeads = 0;
    let opsApprovedLeads = 0;
    let wonDeals = 0;

    for (const monthStart of months) {
      const row = await getLatestRowForMonth(monthStart);
      if (row) {
        totalLeads += row.total_leads;
        qualifiedLeads += row.qualified_leads;
        opsApprovedLeads += row.ops_approved_leads;
        wonDeals += row.won_deals;
      } else {
        try {
          const activity = await getActivityMetrics([monthStart]);
          totalLeads += activity.newLeads;
          wonDeals += activity.newSignedDeals;
        } catch {
          // Skip this month if activity fetch fails
        }
      }
    }

    const leadToQualifiedPercent =
      totalLeads > 0 ? Number(((qualifiedLeads / totalLeads) * 100).toFixed(1)) : null;
    const qualifiedToWonPercent =
      qualifiedLeads > 0 ? Number(((wonDeals / qualifiedLeads) * 100).toFixed(1)) : null;
    const overallWinRatePercent =
      totalLeads > 0 ? Number(((wonDeals / totalLeads) * 100).toFixed(1)) : null;

    return {
      totalLeads,
      qualifiedLeads,
      opsApprovedLeads,
      wonDeals,
      leadToQualifiedPercent,
      qualifiedToWonPercent,
      overallWinRatePercent,
      month: months[0] ?? getCurrentMonthStart(),
      months,
    };
  });
}
