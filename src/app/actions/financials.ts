"use server";

import { cache } from "react";
import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { getIsraelDate, getIsraelDateDaysAgo, getIsraelHour } from "@/lib/israel-date";
import { withRetry } from "@/lib/resilience";
import { getPacingSummary } from "@/lib/pacing";
import { supabaseAdmin } from "@/lib/supabase";
import {
  fetchAdServerOverview,
  fetchHomeForDate,
  type XDashTotals,
} from "@/lib/xdash-client";
import { monthKeySchema, monthStartsSchema } from "@/lib/validation";
import type { PacingSummary } from "@/lib/pacing";

/**
 * Short TTL: page uses revalidate=0 so every navigation re-renders, but
 * unstable_cache still deduplicates within a burst of concurrent requests.
 * refreshTodayHome / cron sync invalidate the tag immediately after writes,
 * so 60s is only a safety-net, not the primary freshness mechanism.
 */
const CACHE_TTL = 60;
const FINANCIAL_TAG = "financial-data";

export type PacingTrend = "up" | "down" | "stable";

/** When true, section.projected and section.projectedVsGoalPercent are null. */
export interface FinancialPaceWithTrend extends Omit<PacingSummary, "total" | "media" | "saas" | "profit"> {
  trend: {
    total: PacingTrend;
    media: PacingTrend;
    saas: PacingTrend;
    profit: PacingTrend;
  };
  isMultiMonth?: boolean;
  total: PacingSummary["total"] & { projected?: number | null; projectedVsGoalPercent?: number | null };
  media: PacingSummary["media"] & { projected?: number | null; projectedVsGoalPercent?: number | null };
  saas: PacingSummary["saas"] & { projected?: number | null; projectedVsGoalPercent?: number | null };
  profit: PacingSummary["profit"] & { projected?: number | null; projectedVsGoalPercent?: number | null };
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
/** Pacing calls XDASH home API per month; allow time for slow/retried responses. */
const PACING_TIMEOUT_MS = 90_000;

async function _getFinancialPace(
  monthStarts?: string[]
): Promise<FinancialPaceWithTrend> {
  return withRetry(async () => {
    const months =
      monthStarts && monthStarts.length > 0
        ? monthStarts
        : [getCurrentMonthKey()];

    // Fetch XDASH totals ONCE (cached) — same source as Total Overview
    const xdashTotals = await getMonthlyXDASHTotals();

    if (months.length === 1) {
      const monthStart = months[0]!;
      const xdash = xdashTotals[monthStart];
      const summary = await getPacingSummary(
        supabaseAdmin, undefined, monthStart,
        xdash?.mediaRevenue,
        xdash?.mediaProfit,
      );
      let priorSummary: PacingSummary;
      try {
        const priorKey = priorMonthKey(monthStart);
        const priorXdash = xdashTotals[priorKey];
        priorSummary = await getPacingSummary(
          supabaseAdmin, undefined, priorKey,
          priorXdash?.mediaRevenue,
          priorXdash?.mediaProfit,
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
          profit: comparePace(summary.profit.pacePercent, priorSummary.profit.pacePercent),
        },
      };
    }

    const summaries = await Promise.all(
      months.map((m) => {
        const xdash = xdashTotals[m];
        return getPacingSummary(supabaseAdmin, undefined, m, xdash?.mediaRevenue, xdash?.mediaProfit);
      })
    );

    function aggSection(
      key: "total" | "media" | "saas" | "profit"
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
      profit: aggSection("profit"),
      trend: {
        total: "stable",
        media: "stable",
        saas: "stable",
        profit: "stable",
      },
      isMultiMonth: true,
    };
  }, { timeoutMs: PACING_TIMEOUT_MS });
}

export async function getFinancialPace(
  monthStarts?: string[]
): Promise<FinancialPaceWithTrend> {
  const parsed = monthStartsSchema.safeParse(monthStarts);
  const validMonths = parsed.success ? parsed.data : undefined;
  const key = (validMonths ?? []).sort().join(",") || "_current_";
  return unstable_cache(
    () => _getFinancialPace(validMonths),
    ["financial-pace", key],
    { revalidate: CACHE_TTL, tags: [FINANCIAL_TAG] },
  )();
}

export type DualPaceByMonth = {
  xdash: Record<string, FinancialPaceWithTrend>;
  billing: Record<string, FinancialPaceWithTrend>;
};

/**
 * Bulk-fetch pacing for ALL months: XDASH-aligned actuals vs Billing-sheet actuals,
 * both against the same monthly_goals targets.
 */
async function _getDualPaceByMonth(monthKeys: string[]): Promise<DualPaceByMonth> {
  const xdashTotals = await getMonthlyXDASHTotals();
  const allGoals = await getAllMonthlyGoals();

  const goalsMap = new Map<string, MonthlyGoalRow>();
  for (const g of allGoals) {
    goalsMap.set(String(g.month), g);
  }

  const now = new Date();
  const resultXdash: Record<string, FinancialPaceWithTrend> = {};
  const resultBilling: Record<string, FinancialPaceWithTrend> = {};

  for (const monthStart of monthKeys) {
    const [yy, mm] = monthStart.split("-").map(Number);
    const year = yy!;
    const month = mm!;
    const monthKey = `${year}-${String(month).padStart(2, "0")}`;
    const daysInMonth = new Date(year, month, 0).getDate();

    const closed = (() => {
      const cy = now.getFullYear();
      const cm = now.getMonth() + 1;
      return year < cy || (year === cy && month < cm);
    })();

    let effectiveDaysPassed: number;
    let daysRemaining: number;
    let paceTargetRatio: number;
    let dataThroughDate: string;

    if (closed) {
      effectiveDaysPassed = daysInMonth;
      daysRemaining = 0;
      paceTargetRatio = 1;
      dataThroughDate = `${monthKey}-${String(daysInMonth).padStart(2, "0")}`;
    } else {
      const sameMonth = now.getFullYear() === year && now.getMonth() + 1 === month;
      const currentDay = now.getDate();
      effectiveDaysPassed = sameMonth ? Math.max(0, currentDay - 1) : daysInMonth;
      daysRemaining = sameMonth ? Math.max(0, daysInMonth - currentDay + 1) : 0;
      paceTargetRatio = daysInMonth > 0 ? effectiveDaysPassed / daysInMonth : 0;
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      dataThroughDate = sameMonth
        ? `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`
        : `${monthKey}-${String(daysInMonth).padStart(2, "0")}`;
    }

    function buildSec(actual: number, goal: number): PacingSummary["total"] {
      const targetMtd = goal * paceTargetRatio;
      const projected = effectiveDaysPassed > 0 ? (actual / effectiveDaysPassed) * daysInMonth : 0;
      const delta = actual - targetMtd;
      const requiredDailyRunRate = daysRemaining > 0 ? Math.max(0, (goal - actual) / daysRemaining) : 0;
      return {
        actual, targetMtd, projected, goal,
        pacePercent: targetMtd > 0 ? Math.round((actual / targetMtd) * 100) : null,
        projectedVsGoalPercent: goal > 0 ? Math.round((projected / goal) * 100) : null,
        delta, requiredDailyRunRate,
      };
    }

    const goals = goalsMap.get(monthStart);
    const xdash = xdashTotals[monthStart];
    const billingMedia = Number(goals?.media_revenue ?? 0);
    const revenueGoal = Number(goals?.revenue_goal ?? 0);
    const saasGoal = Number(goals?.saas_goal ?? 0);
    const saasActual = Number(goals?.saas_actual ?? 0);
    const mediaCost = Number(goals?.media_cost ?? 0);
    const techCost = Number(goals?.tech_cost ?? 0);
    const bsCost = Number(goals?.bs_cost ?? 0);
    const profitGoal = Number(goals?.profit_goal ?? 0);

    const mediaRevenueXdash =
      (xdash?.mediaRevenue ?? 0) > 0 ? xdash!.mediaRevenue : billingMedia;
    const profitActualXdash =
      xdash != null ? xdash.mediaProfit : mediaRevenueXdash - mediaCost;

    const mediaX = buildSec(mediaRevenueXdash, revenueGoal);
    const saas = buildSec(saasActual, saasGoal);
    const totalX = buildSec(mediaRevenueXdash + saasActual, revenueGoal + saasGoal);
    const profitX = buildSec(profitActualXdash, profitGoal);

    const profitActualBilling =
      billingMedia + saasActual - mediaCost - techCost - bsCost;
    const mediaB = buildSec(billingMedia, revenueGoal);
    const totalB = buildSec(billingMedia + saasActual, revenueGoal + saasGoal);
    const profitB = buildSec(profitActualBilling, profitGoal);

    const priorKey = priorMonthKey(monthStart);
    const priorXd = resultXdash[priorKey];
    const priorBl = resultBilling[priorKey];

    resultXdash[monthStart] = {
      month: monthKey,
      daysInMonth,
      effectiveDaysPassed,
      daysRemaining,
      paceTargetRatio,
      dataThroughDate,
      total: totalX,
      media: mediaX,
      saas,
      profit: profitX,
      trend: {
        total: priorXd ? comparePace(totalX.pacePercent, priorXd.total.pacePercent) : "stable",
        media: priorXd ? comparePace(mediaX.pacePercent, priorXd.media.pacePercent) : "stable",
        saas: priorXd ? comparePace(saas.pacePercent, priorXd.saas.pacePercent) : "stable",
        profit: priorXd ? comparePace(profitX.pacePercent, priorXd.profit.pacePercent) : "stable",
      },
    };

    resultBilling[monthStart] = {
      month: monthKey,
      daysInMonth,
      effectiveDaysPassed,
      daysRemaining,
      paceTargetRatio,
      dataThroughDate,
      total: totalB,
      media: mediaB,
      saas,
      profit: profitB,
      trend: {
        total: priorBl ? comparePace(totalB.pacePercent, priorBl.total.pacePercent) : "stable",
        media: priorBl ? comparePace(mediaB.pacePercent, priorBl.media.pacePercent) : "stable",
        saas: priorBl ? comparePace(saas.pacePercent, priorBl.saas.pacePercent) : "stable",
        profit: priorBl ? comparePace(profitB.pacePercent, priorBl.profit.pacePercent) : "stable",
      },
    };
  }

  return { xdash: resultXdash, billing: resultBilling };
}

export async function getDualPaceByMonth(
  monthKeys: string[],
): Promise<DualPaceByMonth> {
  return unstable_cache(
    () => _getDualPaceByMonth(monthKeys),
    ["dual-pace-by-month"],
    { revalidate: CACHE_TTL, tags: [FINANCIAL_TAG] },
  )();
}

/** @deprecated Prefer getDualPaceByMonth when you need both sources; returns XDASH-aligned pacing only. */
export async function getAllPaceByMonth(
  monthKeys: string[],
): Promise<Record<string, FinancialPaceWithTrend>> {
  const dual = await getDualPaceByMonth(monthKeys);
  return dual.xdash;
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

const TOP_N = 20;
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
  const parsed = monthKeySchema.safeParse(month);
  if (!parsed.success) return null;
  return unstable_cache(
    () => _getPartnerConcentration(parsed.data),
    ["partner-concentration", parsed.data],
    { revalidate: CACHE_TTL, tags: [FINANCIAL_TAG] },
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

export interface XDASHMonthTotals {
  mediaRevenue: number;
  mediaCost: number;
  mediaProfit: number;
}

// ---------------------------------------------------------------------------
// Monthly home totals — aggregate from raw daily_home_totals in JS
// ---------------------------------------------------------------------------

async function _fetchMonthlyXDASHTotals(): Promise<Record<string, XDASHMonthTotals>> {
  const PAGE = 1000;
  const allRows: Array<{ date: string; revenue: number; cost: number; profit: number }> = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from("daily_home_totals")
      .select("date, revenue, cost, profit")
      .gte("date", `${OVERVIEW_YEAR}-01-01`)
      .lte("date", `${OVERVIEW_YEAR}-12-31`)
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`fetchMonthlyXDASHTotals: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      allRows.push({
        date: String(row.date).slice(0, 10),
        revenue: Number(row.revenue ?? 0),
        cost: Number(row.cost ?? 0),
        profit: Number(row.profit ?? 0),
      });
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  const result: Record<string, XDASHMonthTotals> = {};
  for (const row of allRows) {
    const monthKey = row.date.slice(0, 7) + "-01";
    if (!result[monthKey]) result[monthKey] = { mediaRevenue: 0, mediaCost: 0, mediaProfit: 0 };
    result[monthKey]!.mediaRevenue += row.revenue;
    result[monthKey]!.mediaCost += row.cost;
    result[monthKey]!.mediaProfit += row.profit;
  }
  return result;
}

const _cachedMonthlyXDASHTotals = cache(
  unstable_cache(_fetchMonthlyXDASHTotals, ["monthly-xdash-totals"], { revalidate: CACHE_TTL, tags: [FINANCIAL_TAG] }),
);

export async function getMonthlyXDASHTotals(): Promise<Record<string, XDASHMonthTotals>> {
  return _cachedMonthlyXDASHTotals();
}

/** Daily average profit quota: monthly profit_goal ÷ days in month (Israel calendar month). */
export type DailyProfitGoalPace = {
  /** profit_goal / days_in_month — same every day of the month; compare to today’s GP only. */
  dailyAverageTarget: number;
  monthKey: string;
};

async function _fetchDailyProfitGoalPaceForIsraelDate(isoDate: string): Promise<DailyProfitGoalPace | null> {
  const [y, m] = isoDate.split("-").map(Number);
  if (y == null || m == null) return null;
  const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
  const daysInMonth = new Date(y, m, 0).getDate();
  if (daysInMonth <= 0) return null;

  const { data, error } = await supabaseAdmin
    .from("monthly_goals")
    .select("profit_goal")
    .eq("month", monthStart)
    .maybeSingle();
  if (error) {
    console.error("[getDailyProfitGoalPaceIsrael]", error.message);
    return null;
  }
  const profitGoal = Number(data?.profit_goal ?? 0);
  if (profitGoal <= 0) return null;

  const dailyAverageTarget = profitGoal / daysInMonth;
  return { dailyAverageTarget, monthKey: monthStart };
}

/**
 * Daily average gross-profit target for the pulse card: profit_goal / days_in_month (Israel month).
 * Client shows (todayGp / dailyAverageTarget) × 100 so the bar resets against a fixed daily quota.
 */
export async function getDailyProfitGoalPaceIsrael(): Promise<DailyProfitGoalPace | null> {
  const iso = getIsraelDate();
  return unstable_cache(
    () => _fetchDailyProfitGoalPaceForIsraelDate(iso),
    ["daily-profit-goal-pace", iso],
    { revalidate: CACHE_TTL, tags: [FINANCIAL_TAG] },
  )();
}

// ---------------------------------------------------------------------------
// Shared monthly_goals fetch (used by Overview + Pacing)
// ---------------------------------------------------------------------------

const ALL_GOAL_MONTHS = [
  `${OVERVIEW_YEAR - 1}-12-01`,
  ...OVERVIEW_MONTHS,
];

interface MonthlyGoalRow {
  month: string;
  revenue_goal: number;
  saas_goal: number;
  saas_actual: number;
  media_revenue: number;
  media_cost: number;
  tech_cost: number;
  bs_cost: number;
  profit_goal: number;
}

async function _getAllMonthlyGoals(): Promise<MonthlyGoalRow[]> {
  const { data: rows, error } = await supabaseAdmin
    .from("monthly_goals")
    .select("month, revenue_goal, saas_goal, saas_actual, media_revenue, media_cost, tech_cost, bs_cost, profit_goal")
    .in("month", ALL_GOAL_MONTHS)
    .order("month", { ascending: true });
  if (error) throw new Error(`getAllMonthlyGoals: ${error.message}`);
  return (rows ?? []) as MonthlyGoalRow[];
}

const getAllMonthlyGoals = cache(
  unstable_cache(_getAllMonthlyGoals, ["all-monthly-goals"], { revalidate: CACHE_TTL, tags: [FINANCIAL_TAG] }),
);

async function _getTotalOverviewData(): Promise<MonthOverview[]> {
  const allGoals = await getAllMonthlyGoals();
  const rowsByMonth = new Map(allGoals.map((r) => [r.month, r]));

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
}

export const getTotalOverviewData = cache(
  unstable_cache(_getTotalOverviewData, ["total-overview"], { revalidate: CACHE_TTL, tags: [FINANCIAL_TAG] }),
);

// ---------------------------------------------------------------------------
// Daily movement (from XDASH daily_partner_performance — for daily chart)
// ---------------------------------------------------------------------------

export interface DailyMovementDay {
  date: string;
  revenue: number;
  cost: number;
  profit: number;
}

// ---------------------------------------------------------------------------
// Daily movement — simple SELECT from daily_home_totals (≤365 rows/year)
// ---------------------------------------------------------------------------

async function _fetchAllDailyByMonth(): Promise<Record<string, DailyMovementDay[]>> {
  const { data, error } = await supabaseAdmin
    .from("daily_home_totals")
    .select("date, revenue, cost, profit")
    .gte("date", `${OVERVIEW_YEAR}-01-01`)
    .lte("date", `${OVERVIEW_YEAR}-12-31`)
    .order("date", { ascending: true });
  if (error) throw new Error(`fetchDailyByMonth: ${error.message}`);
  const byMonth: Record<string, DailyMovementDay[]> = {};
  for (const row of data ?? []) {
    const monthKey = String(row.date).slice(0, 7) + "-01";
    if (!byMonth[monthKey]) byMonth[monthKey] = [];
    byMonth[monthKey]!.push({
      date: String(row.date).slice(0, 10),
      revenue: Number(row.revenue ?? 0),
      cost: Number(row.cost ?? 0),
      profit: Number(row.profit ?? 0),
    });
  }
  return byMonth;
}

const _cachedDailyByMonth = cache(
  unstable_cache(_fetchAllDailyByMonth, ["all-daily-movement"], { revalidate: CACHE_TTL, tags: [FINANCIAL_TAG] }),
);

export async function getAllDailyMovement(): Promise<Record<string, DailyMovementDay[]>> {
  return _cachedDailyByMonth();
}

/** @deprecated — use getAllDailyMovement() */
export async function getDailyMovement(monthKey: string): Promise<DailyMovementDay[]> {
  const parsed = monthKeySchema.safeParse(monthKey);
  if (!parsed.success) return [];
  const all = await getAllDailyMovement();
  return all[parsed.data] ?? [];
}

async function _getLastDataUpdate(): Promise<{ date: string; syncedAt: string } | null> {
  const { data: homeRow } = await supabaseAdmin
    .from("daily_home_totals")
    .select("date, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (homeRow) return { date: homeRow.date, syncedAt: homeRow.created_at };

  const { data } = await supabaseAdmin
    .from("daily_partner_performance")
    .select("date, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (!data) return null;
  return { date: data.date, syncedAt: data.created_at };
}

export const getLastDataUpdate = cache(
  unstable_cache(_getLastDataUpdate, ["last-data-update"], { revalidate: CACHE_TTL, tags: [FINANCIAL_TAG] }),
);

/** Single row for "today" in Asia/Jerusalem — direct DB read (no unstable_cache). */
export type TodayHomeRow = {
  date: string;
  revenue: number;
  cost: number;
  profit: number;
  impressions: number;
};

function mapDailyHomeRow(data: {
  date: unknown;
  revenue: unknown;
  cost: unknown;
  profit: unknown;
  impressions: unknown;
}): TodayHomeRow {
  return {
    date: String(data.date),
    revenue: Number(data.revenue ?? 0),
    cost: Number(data.cost ?? 0),
    profit: Number(data.profit ?? 0),
    impressions: Number(data.impressions ?? 0),
  };
}

async function getHomeRowForDate(isoDate: string): Promise<TodayHomeRow | null> {
  const { data, error } = await supabaseAdmin
    .from("daily_home_totals")
    .select("date, revenue, cost, profit, impressions")
    .eq("date", isoDate)
    .maybeSingle();
  if (error) {
    console.error("[getHomeRowForDate]", isoDate, error.message);
    return null;
  }
  if (!data) return null;
  return mapDailyHomeRow(data);
}

/**
 * Today’s row in `daily_home_totals` (Israel calendar date). Returns null if missing.
 * Stays fresh via revalidateTag(FINANCIAL_TAG) + AutoSync / refreshTodayHome.
 */
export async function getTodayHomeTotals(): Promise<TodayHomeRow | null> {
  return getHomeRowForDate(getIsraelDate());
}

/** Pulse comparison: today + past rows keyed by day offset (e.g. 1 = yesterday, 7, 28). */
export type ComparisonData = {
  today: TodayHomeRow | null;
  past: Record<number, TodayHomeRow | null>;
};

/**
 * Fetches `daily_home_totals` for today (IL) and for each offset in calendar days ago.
 * Costs include service cost as stored (same as refreshTodayHome / fetchHomeForDate).
 *
 * **Today vs yesterday (1d):** `today.date === getIsraelDateDaysAgo(0)` and
 * `past[1]?.date === getIsraelDateDaysAgo(1)`. Yesterday’s revenue for the pulse UI is
 * `past[1]?.revenue` — that row’s `revenue` column from `daily_home_totals` for
 * `date = getIsraelDateDaysAgo(1)` (no pacing; full stored day).
 */
export async function getComparisonData(offsets: number[] = [1, 7, 28]): Promise<ComparisonData> {
  const todayKey = getIsraelDateDaysAgo(0);
  const pastKeys = offsets.map((o) => getIsraelDateDaysAgo(o));
  const uniqueDates = Array.from(new Set([todayKey, ...pastKeys]));

  const { data: rows, error } = await supabaseAdmin
    .from("daily_home_totals")
    .select("date, revenue, cost, profit, impressions")
    .in("date", uniqueDates);

  if (error) {
    console.error("[getComparisonData]", error.message);
    return {
      today: null,
      past: Object.fromEntries(offsets.map((o) => [o, null])) as Record<
        number,
        TodayHomeRow | null
      >,
    };
  }

  const byDate = new Map<string, TodayHomeRow>();
  for (const r of rows ?? []) {
    const key = String(r.date ?? "").slice(0, 10);
    byDate.set(key, mapDailyHomeRow(r));
  }

  // Same-time comparison for ALL offsets: try the hourly snapshot at the
  // current Israel hour for each comparison date.  Each lookup is a primary-key
  // hit (date, hour) so the batch is cheap.  Falls back to the full-day row
  // when no snapshot exists yet (first 24 h of collection, or gaps).
  const snapshotDates = offsets.map((o) => getIsraelDateDaysAgo(o));
  const snapshots = await Promise.all(
    snapshotDates.map((d) => getHourlyBaselineForDate(d)),
  );

  const past: Record<number, TodayHomeRow | null> = {};
  for (let i = 0; i < offsets.length; i++) {
    const o = offsets[i]!;
    const fullDay = byDate.get(snapshotDates[i]!) ?? null;
    past[o] = snapshots[i] ?? fullDay;
  }

  return {
    today: byDate.get(todayKey) ?? null,
    past,
  };
}

// ---------------------------------------------------------------------------
// Live refresh: fetch Home totals for today + yesterday (Israel) and upsert into Supabase.
// AutoSync calls this on idle: today’s row is considered stale after 60s (intraday); yesterday
// after 5 minutes. Manual “Sync XDASH” passes force:true to bypass stale checks entirely.
// ---------------------------------------------------------------------------

/** Yesterday’s row: avoid hammering XDASH when the calendar day is settled. */
const REFRESH_STALE_MS_YESTERDAY = 5 * 60 * 1000;
/** Today’s intraday row: keep Pulse within ~1 minute of XDASH Home. */
const REFRESH_STALE_MS_TODAY = 60 * 1000;

export type RefreshTodayHomeResult = { updated: boolean };

export type RefreshTodayHomeOptions = {
  /** When true (e.g. manual “Sync XDASH”), skip stale checks and always fetch today + yesterday from XDASH. */
  force?: boolean;
};

/**
 * Returns { updated: true } when at least one date was upserted from XDASH.
 * Default stale rules: today must be older than 60s or missing; yesterday 5m or missing.
 */
export async function refreshTodayHome(
  options?: RefreshTodayHomeOptions,
): Promise<RefreshTodayHomeResult> {
  try {
    const force = options?.force === true;
    const today = getIsraelDateDaysAgo(0);
    const yesterday = getIsraelDateDaysAgo(1);
    const dates = [today, yesterday] as const;

    const { data: existingRows, error: selectError } = await supabaseAdmin
      .from("daily_home_totals")
      .select("date, created_at")
      .in("date", [...dates]);

    if (selectError) {
      console.error("[refreshTodayHome] select failed:", selectError.message);
      return { updated: false };
    }

    if (!force) {
      const needRefresh = dates.some((d) => {
        const row = existingRows?.find((r) => String(r.date).slice(0, 10) === d);
        if (!row?.created_at) return true;
        const ageMs = Date.now() - new Date(row.created_at).getTime();
        const staleMs = d === today ? REFRESH_STALE_MS_TODAY : REFRESH_STALE_MS_YESTERDAY;
        return ageMs >= staleMs;
      });

      if (!needRefresh) return { updated: false };
    }

    const syncedAt = new Date().toISOString();

    let todayValues: { revenue: number; cost: number; profit: number; impressions: number } | null = null;

    for (const date of dates) {
      const { revenue, cost, profit, impressions } = await fetchHomeForDate(date);
      const { error } = await supabaseAdmin.from("daily_home_totals").upsert(
        { date, revenue, cost, profit, impressions, created_at: syncedAt },
        { onConflict: "date" },
      );
      if (error) {
        console.error(`[refreshTodayHome] upsert failed (${date}):`, error.message);
        return { updated: false };
      }
      console.log(
        `[refreshTodayHome] Updated ${date}: $${revenue.toFixed(2)} rev, $${cost.toFixed(2)} cost, $${profit.toFixed(2)} profit`,
      );
      if (date === today) todayValues = { revenue, cost, profit, impressions };
    }

    // Fire-and-forget: record an hourly snapshot for "today" so same-time
    // comparisons can be made tomorrow.  Never blocks or delays the main sync.
    if (todayValues) {
      recordHourlySnapshot(today, todayValues).catch((e) => {
        console.warn("[refreshTodayHome] hourly snapshot (non-fatal):", e instanceof Error ? e.message : e);
      });
    }

    revalidateTag(FINANCIAL_TAG, { expire: 0 });
    revalidatePath("/");
    return { updated: true };
  } catch (e) {
    console.error("[refreshTodayHome]", e instanceof Error ? e.message : e);
    return { updated: false };
  }
}

// ---------------------------------------------------------------------------
// Hourly snapshots — additive, never blocks the main sync
// ---------------------------------------------------------------------------

/**
 * Upsert a single snapshot row into `hourly_snapshots` for the current Israel
 * hour.  Called fire-and-forget after `daily_home_totals` is written; failures
 * are logged but never propagated.
 */
async function recordHourlySnapshot(
  date: string,
  values: { revenue: number; cost: number; profit: number; impressions: number },
): Promise<void> {
  const hour = getIsraelHour();
  const { error } = await supabaseAdmin.from("hourly_snapshots").upsert(
    {
      date,
      hour,
      revenue: values.revenue,
      cost: values.cost,
      profit: values.profit,
      impressions: values.impressions,
    },
    { onConflict: "date,hour" },
  );
  if (error) {
    console.warn(`[hourlySnapshot] upsert (${date} h${hour}) failed:`, error.message);
  } else {
    console.log(
      `[hourlySnapshot] ${date} h${hour}: rev=$${values.revenue.toFixed(2)} profit=$${values.profit.toFixed(2)}`,
    );
  }
}

/**
 * Same-time-of-day baseline for comparison.
 *
 * Tries to find yesterday's snapshot at the **current** Israel hour.
 * If a snapshot exists, it returns that partial-day row so the Pulse % reflects
 * "today at 14:00 vs yesterday at 14:00."
 *
 * **CRITICAL fallback:** when no snapshot is found (first 24 h, gaps, etc.),
 * returns `null` so the caller uses the existing full-day baseline — the UI
 * never breaks.
 */
async function getHourlyBaselineForDate(isoDate: string): Promise<TodayHomeRow | null> {
  const hour = getIsraelHour();
  const { data, error } = await supabaseAdmin
    .from("hourly_snapshots")
    .select("date, revenue, cost, profit, impressions")
    .eq("date", isoDate)
    .eq("hour", hour)
    .maybeSingle();

  if (error) {
    console.warn("[getHourlyBaselineForDate]", isoDate, `h${hour}`, error.message);
    return null;
  }
  if (!data) return null;
  return {
    date: String(data.date),
    revenue: Number(data.revenue ?? 0),
    cost: Number(data.cost ?? 0),
    profit: Number(data.profit ?? 0),
    impressions: Number(data.impressions ?? 0),
  };
}

/** Calendar yesterday in Asia/Jerusalem as YYYY-MM-DD */
function getYesterdayIsraelDate(): string {
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  const [y, m, d] = todayStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export type DiagnosticXdashHomeCostResult =
  | {
      ok: true;
      date: string;
      note: string;
      rawApiTotals: {
        cost: number;
        netCost: number;
        revenue: number;
        netRevenue: number;
        serviceCost: number;
        impressions: number;
      };
      /** Same as fetchHomeForDate: netCost || (cost + serviceCost) */
      mappedCostAsUpserted: number;
      /** Legacy compare: netCost + serviceCost (double-counts service if netCost already includes it) */
      sumNetCostPlusServiceCost: number;
    }
  | { ok: false; error: string };

/**
 * Diagnostics only: fetch Home `/home/overview/adServers` for one date and compare
 * raw cost fields to what we store. Does not write to the DB.
 *
 * - Default `date` = yesterday (Israel calendar).
 * - In production, pass `secret` equal to `CRON_SECRET`.
 */
export async function diagnosticXdashHomeCostFields(
  options: { date?: string; secret?: string } = {},
): Promise<DiagnosticXdashHomeCostResult> {
  const inProd = process.env.NODE_ENV === "production";
  if (inProd && options.secret !== process.env.CRON_SECRET) {
    return { ok: false, error: "In production, pass secret matching CRON_SECRET." };
  }

  const date = options.date?.trim() || getYesterdayIsraelDate();

  try {
    const raw = await fetchAdServerOverview({ startDate: date, endDate: date });
    const sd = (raw as unknown as Record<string, unknown>).overviewTotals as Record<string, unknown> | undefined;
    const selectedDates = sd?.selectedDates as Record<string, unknown> | undefined;
    const totals = selectedDates?.totals as XDashTotals | undefined;

    const grossCost = Number(totals?.cost ?? 0);
    const netCost = Number(totals?.netCost ?? 0);
    const grossRevenue = Number(totals?.revenue ?? 0);
    const netRevenue = Number(totals?.netRevenue ?? 0);
    const serviceCost = Number(totals?.serviceCost ?? 0);
    const impressions = Number(totals?.impressions ?? 0);

    const mappedCostAsUpserted =
      Number(totals?.netCost) ||
      (Number(totals?.cost) + Number(totals?.serviceCost ?? 0));
    const sumNetCostPlusServiceCost = netCost + serviceCost;

    const payload = {
      ok: true as const,
      date,
      note:
        "mappedCostAsUpserted = netCost || (cost + serviceCost) (fetchHomeForDate). netCost includes service in XDASH.",
      rawApiTotals: {
        cost: grossCost,
        netCost,
        revenue: grossRevenue,
        netRevenue,
        serviceCost,
        impressions,
      },
      mappedCostAsUpserted,
      sumNetCostPlusServiceCost,
    };

    console.log("[diagnosticXdashHomeCostFields]", JSON.stringify(payload, null, 2));
    return payload;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[diagnosticXdashHomeCostFields]", msg);
    return { ok: false, error: msg };
  }
}
