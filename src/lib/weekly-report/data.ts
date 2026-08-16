/**
 * Weekly C-level exec report data (XDASH Media + goals + signed contracts).
 */

import { addCalendarDaysToIsoDate } from "@/lib/israel-date";
import { supabaseAdmin } from "@/lib/supabase";
import {
  getLastCompletedReportWeek,
  getPriorReportWeek,
  type ReportWeek,
} from "@/lib/weekly-report/period";

const CONTRACTS_BOARD_ID = "8280704003";
const REPORT_YEAR = 2026;

export type PaceStatus = "on_pace" | "slightly_behind" | "behind_plan";

export type HorizonTotals = {
  revenue: number;
  profit: number;
  cost: number;
  marginPct: number;
};

export type PaceBlock = {
  actual: number;
  targetMtd: number;
  goal: number;
  pacePercent: number | null;
  projected: number;
  projectedVsGoalPercent: number | null;
  delta: number;
  requiredDailyRunRate: number;
  daysRemaining: number;
  effectiveDaysPassed: number;
  daysInMonth: number;
};

export type MonthlyBar = {
  month: string; // YYYY-MM
  label: string;
  actual: number;
  goal: number;
};

export type DailyBar = {
  date: string;
  label: string;
  revenue: number;
  profit: number;
};

export type SignedContract = {
  date: string;
  companyName: string;
};

export type WeeklyExecReport = {
  generatedAt: string;
  week: ReportWeek;
  priorWeek: ReportWeek;
  dataThrough: string;
  sourceNote: string;
  status: PaceStatus;
  statusLabel: string;
  headline: {
    driverDays: string[];
  };
  weekTotals: HorizonTotals;
  priorWeekTotals: HorizonTotals;
  weekWoW: {
    revenuePct: number | null;
    profitPct: number | null;
    marginPoints: number;
  };
  mtd: HorizonTotals & { monthLabel: string; pace: { revenue: PaceBlock; profit: PaceBlock } };
  ytd: HorizonTotals & {
    revenueGoalYtd: number;
    profitGoalYtd: number;
    revenuePacePct: number | null;
    profitPacePct: number | null;
    annualRevenueGoal: number;
    annualProfitGoal: number;
    annualRevenuePacePct: number | null;
    annualProfitPacePct: number | null;
  };
  dailyBars: DailyBar[];
  monthlyBars: MonthlyBar[];
  ytdCumulative: { date: string; actual: number; target: number }[];
  contracts: SignedContract[];
  trust: {
    daysPresent: number;
    daysExpected: number;
    syncedAt: string | null;
    xdashSyncStale: boolean;
  };
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function marginPct(revenue: number, profit: number): number {
  if (revenue === 0) return 0;
  return Math.round((profit / revenue) * 1000) / 10;
}

function pctChange(current: number, prior: number): number | null {
  if (prior === 0) return current === 0 ? 0 : null;
  return Math.round(((current - prior) / prior) * 1000) / 10;
}

function sumHorizon(
  rows: Array<{ revenue: number; cost: number; profit: number }>,
): HorizonTotals {
  const revenue = rows.reduce((s, r) => s + r.revenue, 0);
  const cost = rows.reduce((s, r) => s + r.cost, 0);
  const profit = rows.reduce((s, r) => s + r.profit, 0);
  return {
    revenue: round2(revenue),
    cost: round2(cost),
    profit: round2(profit),
    marginPct: marginPct(revenue, profit),
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function buildPaceBlock(
  actual: number,
  goal: number,
  effectiveDaysPassed: number,
  daysInMonthCount: number,
  daysRemaining: number,
): PaceBlock {
  const paceTargetRatio =
    daysInMonthCount > 0 ? effectiveDaysPassed / daysInMonthCount : 0;
  const targetMtd = goal * paceTargetRatio;
  const projected =
    effectiveDaysPassed > 0 ? (actual / effectiveDaysPassed) * daysInMonthCount : 0;
  const pacePercent =
    targetMtd > 0 ? Math.round((actual / targetMtd) * 100) : null;
  const projectedVsGoalPercent =
    goal > 0 ? Math.round((projected / goal) * 100) : null;
  return {
    actual: round2(actual),
    targetMtd: round2(targetMtd),
    goal: round2(goal),
    pacePercent,
    projected: round2(projected),
    projectedVsGoalPercent,
    delta: round2(actual - targetMtd),
    requiredDailyRunRate:
      daysRemaining > 0 ? round2(Math.max(0, (goal - actual) / daysRemaining)) : 0,
    daysRemaining,
    effectiveDaysPassed,
    daysInMonth: daysInMonthCount,
  };
}

function statusFromPace(pacePercent: number | null): {
  status: PaceStatus;
  statusLabel: string;
} {
  if (pacePercent == null) {
    return { status: "on_pace", statusLabel: "On pace" };
  }
  if (pacePercent >= 100) {
    return { status: "on_pace", statusLabel: "On pace" };
  }
  if (pacePercent >= 90) {
    return { status: "slightly_behind", statusLabel: "Slightly behind" };
  }
  return { status: "behind_plan", statusLabel: "Behind plan" };
}

function monthLabel(monthStart: string): string {
  const [y, m] = monthStart.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function shortMonth(monthStart: string): string {
  const [y, m] = monthStart.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
}

function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

async function fetchDailyRange(
  from: string,
  to: string,
): Promise<
  Array<{
    date: string;
    revenue: number;
    cost: number;
    profit: number;
    createdAt: string | null;
  }>
> {
  const { data, error } = await supabaseAdmin
    .from("daily_home_totals")
    .select("date, revenue, cost, profit, created_at")
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: true });
  if (error) throw new Error(`daily_home_totals: ${error.message}`);
  return (data ?? []).map((r) => ({
    date: String(r.date),
    revenue: Number(r.revenue ?? 0),
    cost: Number(r.cost ?? 0),
    profit: Number(r.profit ?? 0),
    createdAt: r.created_at != null ? String(r.created_at) : null,
  }));
}

export async function getWeeklyExecReport(options?: {
  asOf?: string;
  week?: ReportWeek;
}): Promise<WeeklyExecReport> {
  const week = options?.week ?? getLastCompletedReportWeek(options?.asOf);
  const priorWeek = getPriorReportWeek(week);
  const dataThrough = week.end;

  const ytdStart = `${REPORT_YEAR}-01-01`;
  const [y, m] = week.end.split("-").map(Number);
  const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
  const dim = daysInMonth(y!, m!);
  const dayOfMonth = Number(week.end.slice(8, 10));
  const effectiveDaysPassed = dayOfMonth; // through Wednesday inclusive
  const daysRemaining = Math.max(0, dim - dayOfMonth);

  const [
    weekRows,
    priorRows,
    ytdRows,
    goalsRes,
    contractsRes,
    latestXDashSyncRes,
  ] = await Promise.all([
    fetchDailyRange(week.start, week.end),
    fetchDailyRange(priorWeek.start, priorWeek.end),
    fetchDailyRange(ytdStart, week.end),
    supabaseAdmin
      .from("monthly_goals")
      .select("month, revenue_goal, profit_goal")
      .gte("month", `${REPORT_YEAR}-01-01`)
      .lte("month", `${REPORT_YEAR}-12-01`),
    supabaseAdmin
      .from("monday_items_activity")
      .select("created_date, company_name")
      .eq("board_id", CONTRACTS_BOARD_ID)
      .gte("created_date", week.start)
      .lte("created_date", week.end)
      .order("created_date", { ascending: true }),
    supabaseAdmin
      .from("daily_sync_logs")
      .select("created_at")
      .eq("source", "cron_sync")
      .eq("ok", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const weekTotals = sumHorizon(weekRows);
  const priorWeekTotals = sumHorizon(priorRows);
  const ytdTotals = sumHorizon(ytdRows);

  const mtdRows = ytdRows.filter((r) => r.date >= monthStart && r.date <= week.end);
  const mtdTotals = sumHorizon(mtdRows);

  const goals = (goalsRes.data ?? []).map((g) => ({
    month: String(g.month).slice(0, 10),
    revenueGoal: Number(g.revenue_goal ?? 0),
    profitGoal: Number(g.profit_goal ?? 0),
  }));
  const goalsByMonth = new Map(goals.map((g) => [g.month, g]));

  const currentGoal = goalsByMonth.get(monthStart) ?? {
    month: monthStart,
    revenueGoal: 0,
    profitGoal: 0,
  };

  const revenuePace = buildPaceBlock(
    mtdTotals.revenue,
    currentGoal.revenueGoal,
    effectiveDaysPassed,
    dim,
    daysRemaining,
  );
  const profitPace = buildPaceBlock(
    mtdTotals.profit,
    currentGoal.profitGoal,
    effectiveDaysPassed,
    dim,
    daysRemaining,
  );

  // Primary status from revenue MTD pace (Media goal).
  const { status, statusLabel } = statusFromPace(revenuePace.pacePercent);

  // Headline context: 1–2 weekdays with the largest same-weekday WoW move.
  const priorByDate = new Map(priorRows.map((row) => [row.date, row]));
  const weekdayMoves = weekRows.map((row) => ({
    label: dayLabel(row.date).split(",")[0]!,
    delta:
      row.revenue -
      (priorByDate.get(addCalendarDaysToIsoDate(row.date, -7))?.revenue ?? 0),
  }));
  const weeklyRevenueDelta = weekTotals.revenue - priorWeekTotals.revenue;
  const driverDays = weekdayMoves
    .filter((move) =>
      weeklyRevenueDelta < 0 ? move.delta < 0 : move.delta > 0,
    )
    .sort((a, b) =>
      weeklyRevenueDelta < 0 ? a.delta - b.delta : b.delta - a.delta,
    )
    .slice(0, 2)
    .map((move) => move.label);

  // YTD goal = full goals for closed months + pro-rata current month through week end.
  let revenueGoalYtd = 0;
  let profitGoalYtd = 0;
  let annualRevenueGoal = 0;
  let annualProfitGoal = 0;
  for (const g of goals) {
    annualRevenueGoal += g.revenueGoal;
    annualProfitGoal += g.profitGoal;
    const gm = g.month.slice(0, 7);
    const cur = monthStart.slice(0, 7);
    if (gm < cur) {
      revenueGoalYtd += g.revenueGoal;
      profitGoalYtd += g.profitGoal;
    } else if (gm === cur) {
      const ratio = dim > 0 ? effectiveDaysPassed / dim : 0;
      revenueGoalYtd += g.revenueGoal * ratio;
      profitGoalYtd += g.profitGoal * ratio;
    }
  }

  const revenuePacePct =
    revenueGoalYtd > 0
      ? Math.round((ytdTotals.revenue / revenueGoalYtd) * 100)
      : null;
  const profitPacePct =
    profitGoalYtd > 0
      ? Math.round((ytdTotals.profit / profitGoalYtd) * 100)
      : null;
  const annualRevenuePacePct =
    annualRevenueGoal > 0
      ? Math.round((ytdTotals.revenue / annualRevenueGoal) * 100)
      : null;
  const annualProfitPacePct =
    annualProfitGoal > 0
      ? Math.round((ytdTotals.profit / annualProfitGoal) * 100)
      : null;

  // Monthly bars: Jan → current month
  const monthlyBars: MonthlyBar[] = [];
  for (let mi = 1; mi <= m!; mi++) {
    const mk = `${REPORT_YEAR}-${String(mi).padStart(2, "0")}-01`;
    const monthEnd =
      mi === m
        ? week.end
        : `${REPORT_YEAR}-${String(mi).padStart(2, "0")}-${String(daysInMonth(REPORT_YEAR, mi)).padStart(2, "0")}`;
    const monthStartKey = mk;
    const rows = ytdRows.filter((r) => r.date >= monthStartKey && r.date <= monthEnd);
    const actual = round2(rows.reduce((s, r) => s + r.revenue, 0));
    const goal = goalsByMonth.get(mk)?.revenueGoal ?? 0;
    monthlyBars.push({
      month: mk.slice(0, 7),
      label: shortMonth(mk),
      actual,
      goal: round2(goal),
    });
  }

  // YTD cumulative daily (sample weekly points to keep chart light — every day is fine for ~8 months)
  const sortedYtd = [...ytdRows].sort((a, b) => a.date.localeCompare(b.date));
  let runActual = 0;
  const ytdCumulative: { date: string; actual: number; target: number }[] = [];
  // Build target curve: sum full prior months + pro-rata within month by day
  for (const row of sortedYtd) {
    runActual += row.revenue;
    const [yy, mm, dd] = row.date.split("-").map(Number);
    let target = 0;
    for (let mi = 1; mi < mm!; mi++) {
      const mk = `${yy}-${String(mi).padStart(2, "0")}-01`;
      target += goalsByMonth.get(mk)?.revenueGoal ?? 0;
    }
    const thisGoal =
      goalsByMonth.get(`${yy}-${String(mm).padStart(2, "0")}-01`)?.revenueGoal ?? 0;
    const dimM = daysInMonth(yy!, mm!);
    target += thisGoal * (dd! / dimM);
    ytdCumulative.push({
      date: row.date,
      actual: round2(runActual),
      target: round2(target),
    });
  }

  // Downsample cumulative to ~1 point / week for SVG (keep last)
  const sampledCumulative =
    ytdCumulative.length <= 40
      ? ytdCumulative
      : ytdCumulative.filter((_, i) => i % 7 === 0 || i === ytdCumulative.length - 1);

  const dailyBars: DailyBar[] = [];
  for (let d = week.start; d <= week.end; d = addCalendarDaysToIsoDate(d, 1)) {
    const row = weekRows.find((r) => r.date === d);
    dailyBars.push({
      date: d,
      label: dayLabel(d),
      revenue: round2(row?.revenue ?? 0),
      profit: round2(row?.profit ?? 0),
    });
  }

  const contracts: SignedContract[] = (contractsRes.data ?? [])
    .map((r) => ({
      date: String(r.created_date),
      companyName: String(r.company_name ?? "").trim(),
    }))
    .filter((c) => c.companyName !== "");

  const generatedAt = new Date();
  const syncedAt =
    weekRows
      .map((row) => row.createdAt)
      .filter((value): value is string => value != null)
      .sort()
      .at(-1) ?? null;
  const latestXDashSyncAt = latestXDashSyncRes.data?.created_at
    ? new Date(String(latestXDashSyncRes.data.created_at)).getTime()
    : NaN;
  const xdashSyncStale =
    !Number.isFinite(latestXDashSyncAt) ||
    generatedAt.getTime() - latestXDashSyncAt > 6 * 60 * 60 * 1000;

  return {
    generatedAt: generatedAt.toISOString(),
    week,
    priorWeek,
    dataThrough,
    sourceNote:
      "Figures: Media (XDASH). SaaS is tracked in Billing and excluded from this weekly view.",
    status,
    statusLabel,
    headline: { driverDays },
    weekTotals,
    priorWeekTotals,
    weekWoW: {
      revenuePct: pctChange(weekTotals.revenue, priorWeekTotals.revenue),
      profitPct: pctChange(weekTotals.profit, priorWeekTotals.profit),
      marginPoints: round2(
        weekTotals.marginPct - priorWeekTotals.marginPct,
      ),
    },
    mtd: {
      ...mtdTotals,
      monthLabel: monthLabel(monthStart),
      pace: { revenue: revenuePace, profit: profitPace },
    },
    ytd: {
      ...ytdTotals,
      revenueGoalYtd: round2(revenueGoalYtd),
      profitGoalYtd: round2(profitGoalYtd),
      revenuePacePct,
      profitPacePct,
      annualRevenueGoal: round2(annualRevenueGoal),
      annualProfitGoal: round2(annualProfitGoal),
      annualRevenuePacePct,
      annualProfitPacePct,
    },
    dailyBars,
    monthlyBars,
    ytdCumulative: sampledCumulative,
    contracts,
    trust: {
      daysPresent: new Set(weekRows.map((row) => row.date)).size,
      daysExpected: 7,
      syncedAt,
      xdashSyncStale,
    },
  };
}
