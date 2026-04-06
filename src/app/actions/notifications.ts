"use server";

/**
 * Business alert notifications (Web Push).
 *
 * Data sources (see answers inline in repo docs / this file):
 * - Per-day Revenue & Gross Profit: `daily_home_totals` (`revenue`, `profit` — same XDASH Home mapping as elsewhere).
 * - Monthly goals & pace: `monthly_goals` + MTD logic aligned with `src/lib/pacing.ts` (profit_goal, target ∝ days elapsed).
 * - Yesterday vs day-before: `daily_home_totals` for `getIsraelDateDaysAgo(1)` vs `getIsraelDateDaysAgo(2)`.
 * - Milestone dedupe: `sent_notifications` (daily_goal_reached per Israel day, monthly_total_goal_reached per month).
 */

import {
  sendNotification,
  setVapidDetails,
  type PushSubscription,
} from "web-push";
import { supabaseAdmin } from "@/lib/supabase";
import { getIsraelDate, getIsraelDateDaysAgo } from "@/lib/israel-date";

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

type NotificationType = "daily_goal_reached" | "monthly_total_goal_reached";

async function wasAlreadySent(
  notificationType: NotificationType,
  sentDate: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("sent_notifications")
    .select("id")
    .eq("notification_type", notificationType)
    .eq("sent_date", sentDate)
    .maybeSingle();

  if (error) {
    console.error("[notifications] wasAlreadySent", notificationType, error.message);
    throw new Error(`sent_notifications: ${error.message}`);
  }
  return data != null;
}

async function recordSent(
  notificationType: NotificationType,
  sentDate: string,
): Promise<void> {
  const { error } = await supabaseAdmin.from("sent_notifications").insert({
    notification_type: notificationType,
    sent_date: sentDate,
  });

  if (error) {
    if (error.code === "23505") return;
    throw new Error(`sent_notifications insert: ${error.message}`);
  }
}

async function fetchMonthlyGoal(monthStart: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from("monthly_goals")
    .select("profit_goal")
    .eq("month", monthStart)
    .maybeSingle();
  return Number(data?.profit_goal ?? 0);
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
// B. After sync — milestones (two independent checks)
//    1. Daily Goal Reached: today's GP >= daily average target (profit_goal / days_in_month)
//    2. Monthly Total Goal Reached: MTD total profit >= full monthly goal (once per month)
// ---------------------------------------------------------------------------

export async function checkPerformance(): Promise<{
  sent: boolean;
  reasons: string[];
  log: string;
}> {
  const today = getIsraelDate();
  const [y, m] = today.split("-").map(Number);
  const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
  const dim = daysInMonthYm(y, m);

  const profitGoal = await fetchMonthlyGoal(monthStart);
  if (profitGoal <= 0) {
    return { sent: false, reasons: [], log: "[checkPerformance] no monthly goal set" };
  }

  const todayRow = await fetchDailyRow(today);
  const todayGp = todayRow?.profit ?? 0;

  const dailyAvgTarget = profitGoal / dim;
  const dailyGoalReached = todayGp + 1e-6 >= dailyAvgTarget;

  const mtdProfit = await sumProfitMtd(monthStart, today);
  const monthlyGoalReached = mtdProfit + 1e-6 >= profitGoal;

  const reasons: string[] = [];
  if (dailyGoalReached) reasons.push("daily_goal_reached");
  if (monthlyGoalReached) reasons.push("monthly_total_goal_reached");

  if (reasons.length === 0) {
    return {
      sent: false,
      reasons: [],
      log: `[checkPerformance] no milestone (todayGp=${todayGp.toFixed(0)} target=${dailyAvgTarget.toFixed(0)}, mtd=${mtdProfit.toFixed(0)} goal=${profitGoal.toFixed(0)})`,
    };
  }

  let ok = 0;
  let failed = 0;
  const errors: string[] = [];
  const logExtras: string[] = [];

  if (dailyGoalReached) {
    if (await wasAlreadySent("daily_goal_reached", today)) {
      logExtras.push("daily_goal_skipped");
    } else {
      const r = await sendPushToAllSubscribers(
        "Daily Goal Reached! 🎯",
        `Today's GP: ${formatCurrencyShort(todayGp)} vs. ${formatCurrencyShort(dailyAvgTarget)} daily target. Keep it up! 💰`,
      );
      ok += r.ok;
      failed += r.failed;
      errors.push(...r.errors);
      if (r.ok > 0) {
        await recordSent("daily_goal_reached", today);
      }
    }
  }

  if (monthlyGoalReached) {
    if (await wasAlreadySent("monthly_total_goal_reached", monthStart)) {
      logExtras.push("monthly_goal_skipped");
    } else {
      const r = await sendPushToAllSubscribers(
        "Monthly Goal Reached! 🔥",
        `MTD Profit: ${formatCurrencyShort(mtdProfit)} has hit the ${formatCurrencyShort(profitGoal)} monthly goal! 🎉`,
      );
      ok += r.ok;
      failed += r.failed;
      errors.push(...r.errors);
      if (r.ok > 0) {
        await recordSent("monthly_total_goal_reached", monthStart);
      }
    }
  }

  const log = `[checkPerformance] reasons=${reasons.join(",")}${logExtras.length ? ` ${logExtras.join(" ")}` : ""} push ok=${ok} failed=${failed}${errors.length ? ` ${errors[0]}` : ""}`;

  return { sent: ok > 0, reasons, log };
}
