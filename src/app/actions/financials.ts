"use server";

import { unstable_cache } from "next/cache";
import { withRetry } from "@/lib/resilience";
import { getPacingSummary } from "@/lib/pacing";
import { supabaseAdmin } from "@/lib/supabase";
import type { PacingSummary } from "@/lib/pacing";

const CACHE_TTL = 60;

export type PacingTrend = "up" | "down" | "stable";

/** When true, section.projected and section.projectedVsGoalPercent are null. */
export interface FinancialPaceWithTrend extends Omit<PacingSummary, "total" | "media" | "saas"> {
  trend: {
    total: PacingTrend;
    media: PacingTrend;
    saas: PacingTrend;
  };
  isMultiMonth?: boolean;
  total: PacingSummary["total"] & { projected?: number | null; projectedVsGoalPercent?: number | null };
  media: PacingSummary["media"] & { projected?: number | null; projectedVsGoalPercent?: number | null };
  saas: PacingSummary["saas"] & { projected?: number | null; projectedVsGoalPercent?: number | null };
}

function comparePace(nowPercent: number | null, prevPercent: number | null): PacingTrend {
  if (nowPercent == null || prevPercent == null) return "stable";
  const diff = nowPercent - prevPercent;
  if (diff > 0) return "up";
  if (diff < 0) return "down";
  return "stable";
}

/**
 * Get pacing summary for given month(s). When monthStarts has more than one month,
 * returns aggregated actual and goal sums; projected is null in that case.
 * When monthStarts is empty or omitted, uses current month only.
 */
async function _getFinancialPace(
  monthStarts?: string[]
): Promise<FinancialPaceWithTrend> {
  return withRetry(async () => {
    const months =
      monthStarts && monthStarts.length > 0
        ? monthStarts
        : [getCurrentMonthKey()];

    if (months.length === 1) {
      const monthStart = months[0]!;
      const summary = await getPacingSummary(supabaseAdmin, undefined, monthStart);
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      let priorSummary: PacingSummary;
      try {
        priorSummary = await getPacingSummary(
          supabaseAdmin,
          undefined,
          priorMonthKey(monthStart)
        );
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
    }

    const summaries = await Promise.all(
      months.map((m) => getPacingSummary(supabaseAdmin, undefined, m))
    );

    function aggSection(
      key: "total" | "media" | "saas"
    ): FinancialPaceWithTrend["total"] {
      let actual = 0;
      let goal = 0;
      let targetMtd = 0;
      let requiredDailyRunRate = 0;
      for (const s of summaries) {
        const sec = s[key];
        actual += sec.actual;
        goal += sec.goal;
        targetMtd += sec.targetMtd;
        requiredDailyRunRate += sec.requiredDailyRunRate;
      }
      const delta = actual - targetMtd;
      const pacePercent =
        targetMtd > 0 ? Math.round((actual / targetMtd) * 100) : null;
      return {
        actual,
        targetMtd,
        projected: null,
        goal,
        pacePercent,
        projectedVsGoalPercent: null,
        delta,
        requiredDailyRunRate,
      } as unknown as FinancialPaceWithTrend["total"];
    }

    const totalEffective = summaries.reduce((s, x) => s + x.effectiveDaysPassed, 0);
    const totalDays = summaries.reduce((s, x) => s + x.daysInMonth, 0);
    const totalRemaining = summaries.reduce((s, x) => s + x.daysRemaining, 0);
    const lastSummary = summaries[summaries.length - 1]!;

    return {
      month: months.map((m) => (m.length === 7 ? m : m.slice(0, 7))).join(", "),
      daysInMonth: totalDays,
      effectiveDaysPassed: totalEffective,
      daysRemaining: totalRemaining,
      paceTargetRatio: totalDays > 0 ? totalEffective / totalDays : 0,
      dataThroughDate: lastSummary.dataThroughDate,
      total: aggSection("total"),
      media: aggSection("media"),
      saas: aggSection("saas"),
      trend: {
        total: "stable",
        media: "stable",
        saas: "stable",
      },
      isMultiMonth: true,
    };
  });
}

export async function getFinancialPace(
  monthStarts?: string[]
): Promise<FinancialPaceWithTrend> {
  const key = (monthStarts ?? []).sort().join(",") || "_current_";
  return unstable_cache(
    () => _getFinancialPace(monthStarts),
    ["financial-pace", key],
    { revalidate: CACHE_TTL },
  )();
}

function getCurrentMonthKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
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
async function _getPartnerConcentration(
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

export async function getPartnerConcentration(
  month: string
): Promise<PartnerConcentrationResult | null> {
  return unstable_cache(
    () => _getPartnerConcentration(month),
    ["partner-concentration", month],
    { revalidate: CACHE_TTL },
  )();
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
async function _getTotalOverviewData(): Promise<MonthOverview[]> {
  return withRetry(async () => {
    const { data: rows, error } = await supabaseAdmin
      .from("monthly_goals")
      .select("month, media_revenue, saas_actual, media_cost, tech_cost, bs_cost")
      .in("month", OVERVIEW_MONTHS)
      .order("month", { ascending: true });

    if (error) throw new Error(`getTotalOverviewData: ${error.message}`);

    const rowsByMonth = new Map((rows ?? []).map((r) => [r.month, r]));

    return OVERVIEW_MONTHS.map((monthKey) => {
      const g = rowsByMonth.get(monthKey);
      return {
        month: monthKey,
        mediaRevenue: Number(g?.media_revenue ?? 0),
        saasRevenue: Number(g?.saas_actual ?? 0),
        mediaCost: Number(g?.media_cost ?? 0),
        techCost: Number(g?.tech_cost ?? 0),
        bsCost: Number(g?.bs_cost ?? 0),
      };
    });
  });
}

export const getTotalOverviewData = unstable_cache(
  _getTotalOverviewData,
  ["total-overview"],
  { revalidate: CACHE_TTL },
);
