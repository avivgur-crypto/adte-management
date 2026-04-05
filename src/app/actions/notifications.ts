"use server";

/**
 * Business alert notifications (Web Push).
 *
 * Data sources (see answers inline in repo docs / this file):
 * - Per-day Revenue & Gross Profit: `daily_home_totals` (`revenue`, `profit` — same XDASH Home mapping as elsewhere).
 * - Monthly goals & pace: `monthly_goals` + MTD logic aligned with `src/lib/pacing.ts` (profit_goal, target ∝ days elapsed).
 * - Yesterday vs day-before: `daily_home_totals` for `getIsraelDateDaysAgo(1)` vs `getIsraelDateDaysAgo(2)`.
 * - Monthly record (daily GP): max(`profit`) over `daily_home_totals` for the same calendar month with `date` < today.
 */

import {
  sendNotification,
  setVapidDetails,
  type PushSubscription,
} from "web-push";
import { supabaseAdmin } from "@/lib/supabase";
import { getIsraelDateDaysAgo } from "@/lib/israel-date";

// ---------------------------------------------------------------------------
// Web Push (same contract as src/scripts/test-push.ts)
// ---------------------------------------------------------------------------

function vapidContact(email: string): string {
  const e = email.trim();
  if (e.startsWith("mailto:")) return e;
  return `mailto:${e}`;
}

function publicVapidKey(): string {
  return (
    process.env.VAPID_PUBLIC_KEY?.trim() ||
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ||
    ""
  );
}

function ensureWebPushConfigured(): void {
  const pub = publicVapidKey();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const mail = process.env.VAPID_EMAIL?.trim() ?? "";
  if (!pub || !priv || !mail) {
    throw new Error(
      "Missing VAPID keys: set VAPID_PUBLIC_KEY (or NEXT_PUBLIC_VAPID_PUBLIC_KEY), VAPID_PRIVATE_KEY, VAPID_EMAIL",
    );
  }
  setVapidDetails(vapidContact(mail), pub, priv);
}

async function sendPushToAllSubscribers(title: string, body: string): Promise<{
  ok: number;
  failed: number;
  errors: string[];
}> {
  ensureWebPushConfigured();
  const payload = JSON.stringify({ title, body });

  const { data: rows, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, subscription_json");

  if (error) {
    throw new Error(`push_subscriptions: ${error.message}`);
  }

  let ok = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const row of rows ?? []) {
    const raw = row.subscription_json;
    let sub: unknown = raw;
    if (typeof raw === "string") {
      try {
        sub = JSON.parse(raw) as unknown;
      } catch {
        failed++;
        errors.push(`${row.id}: invalid subscription_json string`);
        continue;
      }
    }
    const endpoint =
      sub && typeof sub === "object" && "endpoint" in (sub as object)
        ? String((sub as { endpoint?: string }).endpoint ?? "")
        : "";
    if (!endpoint) {
      failed++;
      errors.push(`${row.id}: missing endpoint`);
      continue;
    }

    try {
      await sendNotification(sub as unknown as PushSubscription, payload, {
        TTL: 3600,
      });
      ok++;
    } catch (e) {
      failed++;
      errors.push(
        `${row.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return { ok, failed, errors };
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

type DailyRow = {
  date: string;
  revenue: number;
  profit: number;
};

async function fetchDailyRow(isoDate: string): Promise<DailyRow | null> {
  const { data, error } = await supabaseAdmin
    .from("daily_home_totals")
    .select("date, revenue, profit")
    .eq("date", isoDate)
    .maybeSingle();

  if (error) {
    console.error("[notifications] fetchDailyRow", isoDate, error.message);
    return null;
  }
  if (!data) return null;
  return {
    date: String(data.date).slice(0, 10),
    revenue: Number(data.revenue ?? 0),
    profit: Number(data.profit ?? 0),
  };
}

function daysInMonthYm(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

/** Percent change for display in push copy; when prior is 0 and current > 0, use 100 as a compact stand-in. */
function percentChangeVsPrior(current: number, prior: number): number {
  if (prior === 0) return current === 0 ? 0 : 100;
  return ((current - prior) / prior) * 100;
}

/**
 * Compact currency for notifications: under $1M as $X.XK, $1M+ as $X.XM (1 decimal).
 */
function formatCurrencyShort(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  }
  return `${sign}$${(abs / 1_000).toFixed(1)}K`;
}

/** MTD sum of `profit` from daily_home_totals between monthStart and end inclusive. */
async function sumProfitMtd(monthStart: string, endInclusive: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("daily_home_totals")
    .select("profit")
    .gte("date", monthStart)
    .lte("date", endInclusive);

  if (error) {
    console.error("[notifications] sumProfitMtd", error.message);
    return 0;
  }
  return (data ?? []).reduce((s, r) => s + Number(r.profit ?? 0), 0);
}

/**
 * Linear MTD profit target through `throughDay` (day-of-month 1..31).
 * targetMtd = profit_goal * (throughDay / daysInMonth)
 */
async function profitGoalMetThroughDay(
  monthStart: string,
  throughDay: number,
  daysInMonth: number,
): Promise<{ met: boolean; profitGoal: number; profitMtd: number; targetMtd: number }> {
  const { data } = await supabaseAdmin
    .from("monthly_goals")
    .select("profit_goal")
    .eq("month", monthStart)
    .maybeSingle();

  const profitGoal = Number(data?.profit_goal ?? 0);
  const [gy, gm] = monthStart.split("-").map(Number);
  const endIso = `${gy}-${String(gm).padStart(2, "0")}-${String(throughDay).padStart(2, "0")}`;
  const profitMtd = await sumProfitMtd(monthStart, endIso);
  if (profitGoal <= 0 || daysInMonth <= 0) {
    return { met: false, profitGoal, profitMtd, targetMtd: 0 };
  }
  const targetMtd = profitGoal * (throughDay / daysInMonth);
  const met = profitMtd + 1e-6 >= targetMtd;
  return { met, profitGoal, profitMtd, targetMtd };
}

/** Max daily gross profit in month before `beforeDate` (same YYYY-MM). */
async function maxDailyProfitInMonthBefore(
  monthStart: string,
  beforeDate: string,
): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from("daily_home_totals")
    .select("profit")
    .gte("date", monthStart)
    .lt("date", beforeDate);

  if (error) {
    console.error("[notifications] maxDailyProfitInMonthBefore", error.message);
    return null;
  }
  let max = -Infinity;
  for (const r of data ?? []) {
    max = Math.max(max, Number(r.profit ?? 0));
  }
  return Number.isFinite(max) ? max : null;
}

// ---------------------------------------------------------------------------
// A. Morning summary (08:00 cron — use Israel calendar for “yesterday”)
// ---------------------------------------------------------------------------

export async function morningSummary(): Promise<{
  sent: boolean;
  log: string;
}> {
  const yesterday = getIsraelDateDaysAgo(1);
  const dayBefore = getIsraelDateDaysAgo(2);

  const [yRow, dRow] = await Promise.all([
    fetchDailyRow(yesterday),
    fetchDailyRow(dayBefore),
  ]);

  const yRev = yRow?.revenue ?? 0;
  const yGp = yRow?.profit ?? 0;
  const dRev = dRow?.revenue ?? 0;
  const dGp = dRow?.profit ?? 0;

  const revChangePercent = percentChangeVsPrior(yRev, dRev);
  const gpChangePercent = percentChangeVsPrior(yGp, dGp);

  const [yY, yM] = yesterday.split("-").map(Number);
  const monthStart = `${yY}-${String(yM).padStart(2, "0")}-01`;
  const dim = daysInMonthYm(yY, yM);
  const dayOfMonth = parseInt(yesterday.slice(8, 10), 10);
  const { met: goalMet } = await profitGoalMetThroughDay(
    monthStart,
    dayOfMonth,
    dim,
  );

  const mtdStatus = goalMet ? "above" : "below";
  const mtdStatusFormatted = goalMet ? "Above pace" : "Below pace";

  const title = "Adtex Daily Report 📊";
  const body = `Yesterday: Rev: ${formatCurrencyShort(yRev)} (${revChangePercent.toFixed(1)}% ${revChangePercent > 0 ? "📈" : "📉"}) | GP: ${formatCurrencyShort(yGp)} (${gpChangePercent.toFixed(1)}% ${gpChangePercent > 0 ? "📈" : "📉"}) | MTD Profit: ${mtdStatusFormatted} ${mtdStatus === "above" ? "✅" : "📉"}`;

  const { ok, failed, errors } = await sendPushToAllSubscribers(title, body);
  const log = `[morningSummary] push ok=${ok} failed=${failed}${errors.length ? ` errors=${errors.slice(0, 3).join("; ")}` : ""}`;

  return { sent: ok > 0, log };
}

// ---------------------------------------------------------------------------
// B. After sync — milestones (daily linear target & monthly daily record)
// ---------------------------------------------------------------------------

export async function checkPerformance(): Promise<{
  sent: boolean;
  reasons: string[];
  log: string;
}> {
  const today = getIsraelDateDaysAgo(0);
  const [y, m] = today.split("-").map(Number);
  const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
  const dim = daysInMonthYm(y, m);

  const todayRow = await fetchDailyRow(today);
  const todayGp = todayRow?.profit ?? 0;

  const { data: goals } = await supabaseAdmin
    .from("monthly_goals")
    .select("profit_goal")
    .eq("month", monthStart)
    .maybeSingle();

  const profitGoal = Number(goals?.profit_goal ?? 0);
  const dailyLinear = profitGoal > 0 && dim > 0 ? profitGoal / dim : 0;

  const exceededDailyPace =
    profitGoal > 0 && dailyLinear > 0 && todayGp + 1e-6 >= dailyLinear;

  const maxPrev = await maxDailyProfitInMonthBefore(monthStart, today);
  const monthlyRecord =
    maxPrev === null
      ? todayGp > 0
      : todayGp > maxPrev + 1e-6;

  const reasons: string[] = [];
  if (exceededDailyPace) reasons.push("daily_linear_pace");
  if (monthlyRecord) reasons.push("monthly_daily_record");

  if (reasons.length === 0) {
    return {
      sent: false,
      reasons: [],
      log: "[checkPerformance] no milestone",
    };
  }

  let ok = 0;
  let failed = 0;
  const errors: string[] = [];

  if (exceededDailyPace) {
    const dayOfMonthToday = parseInt(today.slice(8, 10), 10);
    const { profitMtd: mtdActual, targetMtd: mtdTarget } = await profitGoalMetThroughDay(
      monthStart,
      dayOfMonthToday,
      dim,
    );
    const r = await sendPushToAllSubscribers(
      "Goal Reached! 🎯",
      `Today's GP is Above Pace. MTD Progress: ${formatCurrencyShort(mtdActual)} vs. ${formatCurrencyShort(mtdTarget)} goal. 💰`,
    );
    ok += r.ok;
    failed += r.failed;
    errors.push(...r.errors);
  }

  if (monthlyRecord) {
    const r = await sendPushToAllSubscribers(
      "New Monthly Record! 🔥",
      "Today's GP is your best this month! Keep crushing it.",
    );
    ok += r.ok;
    failed += r.failed;
    errors.push(...r.errors);
  }

  const log = `[checkPerformance] reasons=${reasons.join(",")} push ok=${ok} failed=${failed}${errors.length ? ` ${errors[0]}` : ""}`;

  return { sent: ok > 0, reasons, log };
}
