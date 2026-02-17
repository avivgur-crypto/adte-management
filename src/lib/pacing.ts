/**
 * MTD Pacing Engine (N-1): uses data through YESTERDAY.
 * - effective_days_passed = current day - 1 (e.g. Feb 12 → 11)
 * - pace_target_ratio (pace_factor) = effective_days_passed / days_in_month (e.g. 11/28 ≈ 39.3%)
 * - Media actual = SUM(revenue) from daily_partner_performance (month start through yesterday)
 * - Projected = (Actual / effective_days_passed) * days_in_month
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface PacingSection {
  actual: number;
  targetMtd: number;
  projected: number;
  goal: number;
  pacePercent: number | null; // (actual / targetMtd) * 100
  projectedVsGoalPercent: number | null; // (projected / goal) * 100
  /** Absolute difference: actual - targetMtd (positive = ahead, negative = behind) */
  delta: number;
  /** (goal - actual) / daysRemaining = revenue needed per day to hit full month goal */
  requiredDailyRunRate: number;
}

export interface PacingSummary {
  month: string; // YYYY-MM
  daysInMonth: number;
  effectiveDaysPassed: number; // current day - 1
  /** Remaining days in month (including today) */
  daysRemaining: number;
  paceTargetRatio: number; // effectiveDaysPassed / daysInMonth
  dataThroughDate: string; // YYYY-MM-DD (yesterday) for caption
  total: PacingSection;
  media: PacingSection;
  saas: PacingSection;
}

function mtdPacePercent(
  actual: number,
  goal: number,
  paceTargetRatio: number
): number | null {
  if (goal === 0 || paceTargetRatio === 0) return null;
  const targetMtd = goal * paceTargetRatio;
  if (targetMtd === 0) return null;
  return Math.round((actual / targetMtd) * 100);
}

function projectedVsGoalPercent(projected: number, goal: number): number | null {
  if (goal === 0) return null;
  return Math.round((projected / goal) * 100);
}

function buildSection(
  actual: number,
  goal: number,
  effectiveDaysPassed: number,
  daysInMonth: number,
  paceTargetRatio: number,
  daysRemaining: number
): PacingSection {
  const targetMtd = goal * paceTargetRatio;
  const projected =
    effectiveDaysPassed > 0
      ? (actual / effectiveDaysPassed) * daysInMonth
      : 0;
  const delta = actual - targetMtd;
  const requiredDailyRunRate =
    daysRemaining > 0 ? Math.max(0, (goal - actual) / daysRemaining) : 0;
  return {
    actual,
    targetMtd,
    projected,
    goal,
    pacePercent: mtdPacePercent(actual, goal, paceTargetRatio),
    projectedVsGoalPercent: projectedVsGoalPercent(projected, goal),
    delta,
    requiredDailyRunRate,
  };
}

/** True if the given month (YYYY-MM or YYYY-MM-01) is before the current month. */
function isClosedMonth(monthKey: string): boolean {
  const [y, m] = monthKey.split("-").map(Number);
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  if (y < currentYear) return true;
  if (y === currentYear && m < currentMonth) return true;
  return false;
}

export async function getPacingSummary(
  supabase: SupabaseClient,
  /** When provided, compute summary as of this date (for trend: pass yesterday to get prior pacing). */
  asOfDate?: Date,
  /** When provided, compute for this month (YYYY-MM or YYYY-MM-01). Closed months get 100% completion, target = goal. */
  monthStartParam?: string
): Promise<PacingSummary> {
  const now = asOfDate ?? new Date();
  let year: number;
  let month: number;
  let monthKey: string;
  let monthStart: string;
  let effectiveDaysPassed: number;
  let daysInMonth: number;
  let daysRemaining: number;
  let paceTargetRatio: number;
  let dataThroughDate: string;

  if (monthStartParam) {
    const normalized = monthStartParam.length === 7 ? `${monthStartParam}-01` : monthStartParam;
    const parts = normalized.split("-").map(Number);
    year = parts[0]!;
    month = parts[1]!;
    monthKey = `${year}-${String(month).padStart(2, "0")}`;
    monthStart = `${monthKey}-01`;
    daysInMonth = new Date(year, month, 0).getDate();
    const lastDay = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
    const closed = isClosedMonth(monthKey);
    if (closed) {
      effectiveDaysPassed = daysInMonth;
      daysRemaining = 0;
      paceTargetRatio = 1;
      dataThroughDate = lastDay;
    } else {
      const currentDay = now.getDate();
      const sameMonth = now.getFullYear() === year && now.getMonth() + 1 === month;
      effectiveDaysPassed = sameMonth ? Math.max(0, currentDay - 1) : daysInMonth;
      daysRemaining = sameMonth ? Math.max(0, daysInMonth - currentDay + 1) : 0;
      paceTargetRatio = daysInMonth > 0 ? effectiveDaysPassed / daysInMonth : 0;
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      dataThroughDate = sameMonth
        ? `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`
        : lastDay;
    }
  } else {
    year = now.getFullYear();
    month = now.getMonth() + 1;
    monthKey = `${year}-${String(month).padStart(2, "0")}`;
    monthStart = `${monthKey}-01`;
    const currentDay = now.getDate();
    effectiveDaysPassed = Math.max(0, currentDay - 1);
    daysInMonth = new Date(year, month, 0).getDate();
    daysRemaining = Math.max(0, daysInMonth - currentDay + 1);
    paceTargetRatio = daysInMonth > 0 ? effectiveDaysPassed / daysInMonth : 0;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    dataThroughDate =
      `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  }

  const { data: perfRows } = await supabase
    .from("daily_partner_performance")
    .select("revenue, cost")
    .gte("date", monthStart)
    .lte("date", dataThroughDate);

  let mediaRevenue = 0;
  let mediaCost = 0;
  if (perfRows) {
    for (const row of perfRows) {
      mediaRevenue += Number(row.revenue ?? 0);
      mediaCost += Number(row.cost ?? 0);
    }
  }

  const { data: goalsRow } = await supabase
    .from("monthly_goals")
    .select("revenue_goal, profit_goal, saas_goal, saas_actual")
    .eq("month", monthStart)
    .maybeSingle();

  const revenueGoal = Number(goalsRow?.revenue_goal ?? 0);
  const profitGoal = Number(goalsRow?.profit_goal ?? 0);
  const saasGoal = Number(goalsRow?.saas_goal ?? 0);
  const saasActual = Number(goalsRow?.saas_actual ?? 0);

  const media = buildSection(
    mediaRevenue,
    revenueGoal,
    effectiveDaysPassed,
    daysInMonth,
    paceTargetRatio,
    daysRemaining
  );
  const saas = buildSection(
    saasActual,
    saasGoal,
    effectiveDaysPassed,
    daysInMonth,
    paceTargetRatio,
    daysRemaining
  );

  const totalActual = mediaRevenue + saasActual;
  const totalGoal = revenueGoal + saasGoal;
  const total = buildSection(
    totalActual,
    totalGoal,
    effectiveDaysPassed,
    daysInMonth,
    paceTargetRatio,
    daysRemaining
  );

  return {
    month: monthKey,
    daysInMonth,
    effectiveDaysPassed,
    daysRemaining,
    paceTargetRatio,
    dataThroughDate,
    total,
    media,
    saas,
  };
}
