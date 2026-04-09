"use server";

/**
 * Business alert notifications (Web Push).
 *
 * Data sources (see answers inline in repo docs / this file):
 * - Per-day Revenue & Gross Profit: `daily_home_totals` (`revenue`, `profit` — same XDASH Home mapping as elsewhere).
 * - Monthly goals & pace: `monthly_goals` + MTD logic aligned with `src/lib/pacing.ts` (profit_goal, target ∝ days elapsed).
 * - Yesterday vs day-before: `daily_home_totals` for `getIsraelDateDaysAgo(1)` vs `getIsraelDateDaysAgo(2)`.
 * - Milestone dedupe: `sent_notifications` (daily_goal_reached per Israel day, monthly_total_goal_reached per month).
 * - Daily goal crossing: `daily_goal_sync_snapshot` last_seen_profit vs current row; no daily notify 00:00–07:59 IL.
 */

import {
  sendNotification,
  setVapidDetails,
  type PushSubscription,
} from "web-push";
import { supabaseAdmin } from "@/lib/supabase";
import { getIsraelDate, getIsraelDateDaysAgo, getIsraelHour } from "@/lib/israel-date";

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
  const rowDate = String(data.date).slice(0, 10);
  if (rowDate !== isoDate) {
    console.warn("[notifications] fetchDailyRow date mismatch", { isoDate, rowDate });
    return null;
  }
  return {
    date: rowDate,
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

/** Last GP seen for this Israel date on a prior checkPerformance (outside quiet hours). */
async function getDailyGoalSnapshot(israelDate: string): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from("daily_goal_sync_snapshot")
    .select("last_seen_profit")
    .eq("israel_date", israelDate)
    .maybeSingle();

  if (error) {
    console.error("[notifications] getDailyGoalSnapshot", error.message);
    throw new Error(`daily_goal_sync_snapshot: ${error.message}`);
  }
  if (data == null) return null;
  return Number(data.last_seen_profit);
}

async function upsertDailyGoalSnapshot(israelDate: string, profit: number): Promise<void> {
  const { error } = await supabaseAdmin.from("daily_goal_sync_snapshot").upsert(
    {
      israel_date: israelDate,
      last_seen_profit: profit,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "israel_date" },
  );
  if (error) {
    throw new Error(`daily_goal_sync_snapshot upsert: ${error.message}`);
  }
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
  const { met: goalMet, profitMtd: mtdActual, targetMtd: mtdTarget } =
    await profitGoalMetThroughDay(monthStart, dayOfMonth, dim);

  const revEmoji = revChangePercent > 0 ? "📈" : "📉";
  const gpEmoji = gpChangePercent > 0 ? "📈" : "📉";
  const mtdEmoji = goalMet ? "✅" : "📉";

  const title = "Adtex Daily Report 📊";
  const body = [
    `Yesterday (vs Prev Day):`,
    `Rev ${formatCurrencyShort(yRev)} (${revChangePercent.toFixed(1)}% ${revEmoji}) · GP ${formatCurrencyShort(yGp)} (${gpChangePercent.toFixed(1)}% ${gpEmoji})`,
    `MTD Profit: ${formatCurrencyShort(mtdActual)} vs ${formatCurrencyShort(mtdTarget)} Goal ${mtdEmoji}`,
  ].join("\n");

  const { ok, failed, errors } = await sendPushToAllSubscribers(title, body);
  const log = `[morningSummary] push ok=${ok} failed=${failed}${errors.length ? ` errors=${errors.slice(0, 3).join("; ")}` : ""}`;

  return { sent: ok > 0, log };
}

// ---------------------------------------------------------------------------
// B. After sync — milestones (two independent checks)
//    1. Daily Goal Reached: previous snapshot < daily target <= today's GP (crossing), not 00–08 IL
//    2. Monthly Total Goal Reached: MTD total profit >= full monthly goal (once per month)
// ---------------------------------------------------------------------------

const DAILY_GOAL_QUIET_HOUR_END = 8;

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

  const dailyAvgTarget = dim > 0 ? profitGoal / dim : 0;
  const hourIL = getIsraelHour();
  const dailyGoalQuietHours = hourIL >= 0 && hourIL < DAILY_GOAL_QUIET_HOUR_END;

  const mtdProfit = await sumProfitMtd(monthStart, today);
  const monthlyGoalReached = mtdProfit + 1e-6 >= profitGoal;

  const reasons: string[] = [];
  const logExtras: string[] = [];
  let ok = 0;
  let failed = 0;
  const errors: string[] = [];

  // --- Daily: crossing detection + quiet window (no send / no snapshot update 00:00–07:59 IL)
  if (dim > 0 && dailyAvgTarget > 0) {
    if (dailyGoalQuietHours) {
      logExtras.push("daily_goal_quiet_hours");
    } else {
      const prevSnap = await getDailyGoalSnapshot(today);
      const crossed =
        prevSnap != null &&
        prevSnap + 1e-6 < dailyAvgTarget &&
        todayGp + 1e-6 >= dailyAvgTarget;

      if (prevSnap == null) {
        await upsertDailyGoalSnapshot(today, todayGp);
      } else if (crossed) {
        reasons.push("daily_goal_reached");
        if (await wasAlreadySent("daily_goal_reached", today)) {
          logExtras.push("daily_goal_skipped_already_sent");
          await upsertDailyGoalSnapshot(today, todayGp);
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
            await upsertDailyGoalSnapshot(today, todayGp);
          }
        }
      } else {
        await upsertDailyGoalSnapshot(today, todayGp);
      }
    }
  }

  if (monthlyGoalReached) {
    reasons.push("monthly_total_goal_reached");
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

  const log = `[checkPerformance] israelDate=${today} hourIL=${hourIL}${dailyGoalQuietHours ? " [daily quiet]" : ""} reasons=${reasons.join(",") || "none"}${logExtras.length ? ` ${logExtras.join(" ")}` : ""} push ok=${ok} failed=${failed}${errors.length ? ` ${errors[0]}` : ""} todayGp=${todayGp.toFixed(0)} dailyTarget=${dailyAvgTarget.toFixed(0)} mtd=${mtdProfit.toFixed(0)}`;

  return { sent: ok > 0, reasons, log };
}
