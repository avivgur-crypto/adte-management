"use server";

import { withRetry } from "@/lib/resilience";
import { supabaseAdmin } from "@/lib/supabase";

export interface SalesFunnelMetrics {
  totalLeads: number;
  qualifiedLeads: number;
  opsApprovedLeads: number;
  wonDeals: number;
  leadToQualifiedPercent: number | null;
  /** Qualified → Ops Approved (ops/qualified); capped at 100%. */
  qualifiedToOpsPercent: number | null;
  /** Ops Approved → Won (won/ops); capped at 100%. */
  opsToWonPercent: number | null;
  overallWinRatePercent: number | null;
  /** "All time" or first month for display. */
  month: string;
  /** Empty = all-time; otherwise months used for label. */
  months: string[];
}

/**
 * All-time funnel: sum all daily_funnel_metrics rows (current pipeline state from Monday).
 * Does NOT depend on date filters. Bottom cards (New Leads, New Signed Deals) stay filtered.
 */
export async function getSalesFunnelMetricsAllTime(): Promise<SalesFunnelMetrics | null> {
  return withRetry(async () => {
    const { data: rows, error } = await supabaseAdmin
      .from("daily_funnel_metrics")
      .select("total_leads, qualified_leads, ops_approved_leads, won_deals");

    if (error) throw new Error(`Funnel fetch failed: ${error.message}`);

    let totalLeads = 0;
    let qualifiedLeads = 0;
    let opsApprovedLeads = 0;
    let wonDeals = 0;
    for (const row of rows ?? []) {
      totalLeads += Number(row.total_leads ?? 0);
      qualifiedLeads += Number(row.qualified_leads ?? 0);
      opsApprovedLeads += Number(row.ops_approved_leads ?? 0);
      wonDeals += Number(row.won_deals ?? 0);
    }

    /* Enforce cumulative funnel: total ≥ qualified ≥ ops ≥ won (each stage includes the next). */
    opsApprovedLeads = Math.max(opsApprovedLeads, wonDeals);
    qualifiedLeads = Math.max(qualifiedLeads, opsApprovedLeads);
    totalLeads = Math.max(totalLeads, qualifiedLeads);

    const leadToQualifiedPercent =
      totalLeads > 0 ? Number(((qualifiedLeads / totalLeads) * 100).toFixed(1)) : null;
    const qualifiedToOpsPercent =
      qualifiedLeads > 0
        ? Math.min(100, Number(((opsApprovedLeads / qualifiedLeads) * 100).toFixed(1)))
        : null;
    const opsToWonPercent =
      opsApprovedLeads > 0
        ? Math.min(100, Number(((wonDeals / opsApprovedLeads) * 100).toFixed(1)))
        : null;
    const overallWinRatePercent =
      totalLeads > 0 ? Number(((wonDeals / totalLeads) * 100).toFixed(1)) : null;

    return {
      totalLeads,
      qualifiedLeads,
      opsApprovedLeads,
      wonDeals,
      leadToQualifiedPercent,
      qualifiedToOpsPercent,
      opsToWonPercent,
      overallWinRatePercent,
      month: "All time",
      months: [],
    };
  });
}
