"use server";

import { withRetry } from "@/lib/resilience";
import { getPacingSummary } from "@/lib/pacing";
import { supabaseAdmin } from "@/lib/supabase";
import type { PacingSummary } from "@/lib/pacing";

export type PacingTrend = "up" | "down" | "stable";

export interface FinancialPaceWithTrend extends PacingSummary {
  trend: {
    total: PacingTrend;
    media: PacingTrend;
    saas: PacingTrend;
  };
}

function comparePace(nowPercent: number | null, prevPercent: number | null): PacingTrend {
  if (nowPercent == null || prevPercent == null) return "stable";
  const diff = nowPercent - prevPercent;
  if (diff > 0) return "up";
  if (diff < 0) return "down";
  return "stable";
}

/**
 * Get pacing summary for a given month (or current month if omitted).
 * When monthStart is a closed month (in the past), completion is 100% and MTD target = full goal.
 */
export async function getFinancialPace(
  monthStart?: string
): Promise<FinancialPaceWithTrend> {
  return withRetry(async () => {
    const summary = await getPacingSummary(supabaseAdmin, undefined, monthStart);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    let priorSummary: PacingSummary;
    try {
      priorSummary = monthStart
        ? await getPacingSummary(supabaseAdmin, undefined, priorMonthKey(monthStart))
        : await getPacingSummary(supabaseAdmin, yesterday);
    } catch {
      priorSummary = summary;
    }
    return {
      ...summary,
      trend: {
        total: comparePace(summary.total.pacePercent, priorSummary.total.pacePercent),
        media: comparePace(summary.media.pacePercent, priorSummary.media.pacePercent),
        saas: comparePace(summary.saas.pacePercent, priorSummary.saas.pacePercent),
      },
    };
  });
}

function priorMonthKey(monthStart: string): string {
  const [y, m] = monthStart.split("-").map(Number);
  if (m <= 1) return `${(y ?? 0) - 1}-12-01`;
  return `${y}-${String((m ?? 0) - 1).padStart(2, "0")}-01`;
}

// ---------------------------------------------------------------------------
// Partner concentration (client_revenue_breakdown)
// ---------------------------------------------------------------------------

export interface PartnerShare {
  name: string;
  revenue: number;
  percent: number;
}

export interface SideConcentration {
  total: number;
  partners: PartnerShare[];
}

export interface PartnerConcentrationResult {
  month: string;
  demand: SideConcentration;
  supply: SideConcentration;
  concentrationRisk: boolean;
}

const TOP_N = 10;
const CONCENTRATION_THRESHOLD_PERCENT = 30;

/** Fetches concentration for a month; top 10 per type, rest as "Others"; % share. */
export async function getPartnerConcentration(
  month: string
): Promise<PartnerConcentrationResult | null> {
  return withRetry(async () => {
  const { data: rows, error } = await supabaseAdmin
    .from("client_revenue_breakdown")
    .select("partner_name, partner_type, revenue")
    .eq("month", month)
    .order("revenue", { ascending: false });

  if (error || !rows?.length) return null;

  const demandRows = rows.filter((r) => (r.partner_type ?? "").toLowerCase() === "demand");
  const supplyRows = rows.filter((r) => (r.partner_type ?? "").toLowerCase() === "supply");

  function buildSide(list: { partner_name: string; revenue: number }[]): SideConcentration {
    const total = list.reduce((s, r) => s + Number(r.revenue ?? 0), 0);
    const byName = new Map<string, number>();
    for (const r of list) {
      const name = String(r.partner_name ?? "").trim() || "Unknown";
      byName.set(name, (byName.get(name) ?? 0) + Number(r.revenue ?? 0));
    }
    const sorted = Array.from(byName.entries())
      .map(([name, revenue]) => ({ name, revenue: Number(revenue) }))
      .sort((a, b) => b.revenue - a.revenue);
    const top = sorted.slice(0, TOP_N);
    const rest = sorted.slice(TOP_N);
    const othersSum = rest.reduce((s, r) => s + r.revenue, 0);
    const partners: PartnerShare[] = top.map((p) => ({
      name: p.name,
      revenue: Number(p.revenue),
      percent: total > 0 ? Math.round((Number(p.revenue) / total) * 1000) / 10 : 0,
    }));
    if (othersSum > 0) {
      partners.push({
        name: "Others",
        revenue: Number(othersSum),
        percent: total > 0 ? Math.round((Number(othersSum) / total) * 1000) / 10 : 0,
      });
    }
    return { total: Number(total), partners };
  }

  const demand = buildSide(demandRows);
  const supply = buildSide(supplyRows);

  const individualPartners = [
    ...demand.partners.filter((p) => p.name !== "Others"),
    ...supply.partners.filter((p) => p.name !== "Others"),
  ];
  const concentrationRisk = individualPartners.some(
    (p) => Number(p.percent) >= CONCENTRATION_THRESHOLD_PERCENT
  );

  return {
    month,
    demand,
    supply,
    concentrationRisk,
  };
  });
}

// ---------------------------------------------------------------------------
// Total Overview (revenue + cost by month, for filterable dashboard)
// ---------------------------------------------------------------------------

export interface MonthOverview {
  month: string;
  mediaRevenue: number;
  saasRevenue: number;
  mediaCost: number;
  techCost: number;
  bsCost: number;
}

const OVERVIEW_YEAR = 2026;
const OVERVIEW_MONTHS = Array.from({ length: 12 }, (_, i) =>
  `${OVERVIEW_YEAR}-${String(i + 1).padStart(2, "0")}-01`
);

/** Returns per-month revenue and cost for Total Overview from Master Billing 2026 (monthly_goals). */
export async function getTotalOverviewData(): Promise<MonthOverview[]> {
  return withRetry(async () => {
  const results: MonthOverview[] = [];

  for (const monthKey of OVERVIEW_MONTHS) {
    const { data: goalsRow } = await supabaseAdmin
      .from("monthly_goals")
      .select("media_revenue, saas_actual, media_cost, tech_cost, bs_cost")
      .eq("month", monthKey)
      .maybeSingle();

    const mediaRevenue = Number(goalsRow?.media_revenue ?? 0);
    const saasRevenue = Number(goalsRow?.saas_actual ?? 0);
    const mediaCost = Number(goalsRow?.media_cost ?? 0);
    const techCost = Number(goalsRow?.tech_cost ?? 0);
    const bsCost = Number(goalsRow?.bs_cost ?? 0);

    results.push({
      month: monthKey,
      mediaRevenue,
      saasRevenue,
      mediaCost,
      techCost,
      bsCost,
    });
  }

  return results;
  });
}
