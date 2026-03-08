"use server";

import { unstable_cache } from "next/cache";
import { withRetry } from "@/lib/resilience";
import { getPacingSummary } from "@/lib/pacing";
import { supabaseAdmin } from "@/lib/supabase";
import { monthKeySchema, monthStartsSchema } from "@/lib/validation";
import type { PacingSummary } from "@/lib/pacing";

/** 15 min TTL — data only changes on cron sync (every 3h). */
const CACHE_TTL = 900;

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
      );
      let priorSummary: PacingSummary;
      try {
        const priorKey = priorMonthKey(monthStart);
        const priorXdash = xdashTotals[priorKey];
        priorSummary = await getPacingSummary(
          supabaseAdmin, undefined, priorKey,
          priorXdash?.mediaRevenue,
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
      months.map((m) => {
        const xdash = xdashTotals[m];
        return getPacingSummary(supabaseAdmin, undefined, m, xdash?.mediaRevenue);
      })
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
    { revalidate: CACHE_TTL },
  )();
}

/**
 * Bulk-fetch pacing for ALL months at once (single DB round-trip for goals).
 * Returns Record<monthKey, FinancialPaceWithTrend>.
 */
async function _getAllPaceByMonth(
  monthKeys: string[],
): Promise<Record<string, FinancialPaceWithTrend>> {
  const xdashTotals = await getMonthlyXDASHTotals();
  const allGoals = await getAllMonthlyGoals();

  const goalsMap = new Map<string, MonthlyGoalRow>();
  for (const g of allGoals) {
    goalsMap.set(String(g.month), g);
  }

  const now = new Date();
  const result: Record<string, FinancialPaceWithTrend> = {};

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
    const mediaRevenue = (xdash?.mediaRevenue ?? 0) > 0 ? xdash!.mediaRevenue : billingMedia;
    const revenueGoal = Number(goals?.revenue_goal ?? 0);
    const saasGoal = Number(goals?.saas_goal ?? 0);
    const saasActual = Number(goals?.saas_actual ?? 0);

    const media = buildSec(mediaRevenue, revenueGoal);
    const saas = buildSec(saasActual, saasGoal);
    const total = buildSec(mediaRevenue + saasActual, revenueGoal + saasGoal);

    const priorKey = priorMonthKey(monthStart);
    const priorGoals = goalsMap.get(priorKey);
    const priorXdash = xdashTotals[priorKey];
    const priorMedia = (priorXdash?.mediaRevenue ?? 0) > 0 ? priorXdash!.mediaRevenue : Number(priorGoals?.media_revenue ?? 0);
    const priorRevGoal = Number(priorGoals?.revenue_goal ?? 0);
    const priorSaasGoal = Number(priorGoals?.saas_goal ?? 0);
    const priorSaasActual = Number(priorGoals?.saas_actual ?? 0);
    const pDIM = new Date(yy!, (mm ?? 1) - 1, 0).getDate() || 30;
    const priorMedia2 = { pacePercent: pDIM > 0 && priorRevGoal > 0 ? Math.round((priorMedia / (priorRevGoal * 1)) * 100) : null };
    const priorSaas2 = { pacePercent: pDIM > 0 && priorSaasGoal > 0 ? Math.round((priorSaasActual / (priorSaasGoal * 1)) * 100) : null };
    const priorTotal2 = { pacePercent: pDIM > 0 && (priorRevGoal + priorSaasGoal) > 0 ? Math.round(((priorMedia + priorSaasActual) / ((priorRevGoal + priorSaasGoal) * 1)) * 100) : null };

    result[monthStart] = {
      month: monthKey,
      daysInMonth,
      effectiveDaysPassed,
      daysRemaining,
      paceTargetRatio,
      dataThroughDate,
      total,
      media,
      saas,
      trend: {
        total: comparePace(total.pacePercent, priorTotal2.pacePercent),
        media: comparePace(media.pacePercent, priorMedia2.pacePercent),
        saas: comparePace(saas.pacePercent, priorSaas2.pacePercent),
      },
    };
  }

  return result;
}

export async function getAllPaceByMonth(
  monthKeys: string[],
): Promise<Record<string, FinancialPaceWithTrend>> {
  return unstable_cache(
    () => _getAllPaceByMonth(monthKeys),
    ["all-pace-by-month"],
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

export interface XDASHMonthTotals {
  mediaRevenue: number;
  mediaCost: number;
}

// ---------------------------------------------------------------------------
// Home-based data (daily_home_totals) — source of truth for Financial screen
// ---------------------------------------------------------------------------

interface HomeRow {
  date: string;
  revenue: number;
  cost: number;
  impressions: number;
}

async function fetchAllHomeRows(): Promise<HomeRow[]> {
  const PAGE = 1000;
  const all: HomeRow[] = [];
  let offset = 0;
  const firstDay = `${OVERVIEW_YEAR}-01-01`;
  const lastDay = `${OVERVIEW_YEAR}-12-31`;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("daily_home_totals")
      .select("date, revenue, cost, impressions")
      .gte("date", firstDay)
      .lte("date", lastDay)
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`fetchAllHomeRows: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

interface AllHomeData {
  xdashTotals: Record<string, XDASHMonthTotals>;
  dailyByMonth: Record<string, DailyMovementDay[]>;
}

async function _getAllHomeData(): Promise<AllHomeData> {
  const rows = await fetchAllHomeRows();
  const monthSums: Record<string, XDASHMonthTotals> = {};
  const byMonth = new Map<string, DailyMovementDay[]>();

  for (const r of rows) {
    const monthKey = String(r.date).slice(0, 7) + "-01";
    const rev = Number(r.revenue ?? 0);
    const cos = Number(r.cost ?? 0);

    const cur = monthSums[monthKey] ?? { mediaRevenue: 0, mediaCost: 0 };
    cur.mediaRevenue += rev;
    cur.mediaCost += cos;
    monthSums[monthKey] = cur;

    let dayList = byMonth.get(monthKey);
    if (!dayList) { dayList = []; byMonth.set(monthKey, dayList); }
    dayList.push({ date: String(r.date).slice(0, 10), revenue: rev, cost: cos });
  }

  const dailyByMonth: Record<string, DailyMovementDay[]> = {};
  for (const [mk, days] of byMonth) {
    dailyByMonth[mk] = days.sort((a, b) => a.date.localeCompare(b.date));
  }

  return { xdashTotals: monthSums, dailyByMonth };
}

const getAllHomeData = unstable_cache(
  _getAllHomeData,
  ["all-home-data"],
  { revalidate: CACHE_TTL },
);

export async function getMonthlyXDASHTotals(): Promise<Record<string, XDASHMonthTotals>> {
  const { xdashTotals } = await getAllHomeData();
  return xdashTotals;
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
}

async function _getAllMonthlyGoals(): Promise<MonthlyGoalRow[]> {
  const { data: rows, error } = await supabaseAdmin
    .from("monthly_goals")
    .select("month, revenue_goal, saas_goal, saas_actual, media_revenue, media_cost, tech_cost, bs_cost")
    .in("month", ALL_GOAL_MONTHS)
    .order("month", { ascending: true });
  if (error) throw new Error(`getAllMonthlyGoals: ${error.message}`);
  return (rows ?? []) as MonthlyGoalRow[];
}

const getAllMonthlyGoals = unstable_cache(
  _getAllMonthlyGoals,
  ["all-monthly-goals"],
  { revalidate: CACHE_TTL },
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

export const getTotalOverviewData = unstable_cache(
  _getTotalOverviewData,
  ["total-overview"],
  { revalidate: CACHE_TTL },
);

// ---------------------------------------------------------------------------
// Daily movement (from XDASH daily_partner_performance — for daily chart)
// ---------------------------------------------------------------------------

export interface DailyMovementDay {
  date: string;
  revenue: number;
  cost: number;
}

/** Returns per-day revenue (demand) and cost (supply) for a given month from daily_partner_performance. */
/** @deprecated — use getAllDailyMovement() which reads from daily_home_totals */
export async function getDailyMovement(monthKey: string): Promise<DailyMovementDay[]> {
  const parsed = monthKeySchema.safeParse(monthKey);
  if (!parsed.success) return [];
  return unstable_cache(
    async () => {
      const all = await getAllDailyMovement();
      return all[parsed.data] ?? [];
    },
    ["daily-movement", parsed.data],
    { revalidate: CACHE_TTL },
  )();
}

export async function getAllDailyMovement(): Promise<Record<string, DailyMovementDay[]>> {
  const { dailyByMonth } = await getAllHomeData();
  return dailyByMonth;
}

/** Returns { date, syncedAt } of the most recent data row. Checks daily_home_totals first, falls back to partner data. */
export async function getLastDataUpdate(): Promise<{ date: string; syncedAt: string } | null> {
  return unstable_cache(
    async () => {
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
    },
    ["last-data-update"],
    { revalidate: 60 },
  )();
}
