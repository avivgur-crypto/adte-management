"use server";

/**
 * Business alert notifications (Web Push).
 *
 * Data sources (see answers inline in repo docs / this file):
 * - Per-day Revenue & Gross Profit: `daily_home_totals` (`revenue`, `profit` — same XDASH Home mapping as elsewhere).
 * - Monthly goals & pace: `monthly_goals` + MTD logic aligned with `src/lib/pacing.ts` (profit_goal, target ∝ days elapsed).
 * - Yesterday vs day-before: `daily_home_totals` for `getIsraelDateDaysAgo(1)` vs `getIsraelDateDaysAgo(2)`.
 * - Milestone dedupe: `sent_notifications` per user (UNIQUE user_id + notification_type + sent_date).
 * - Daily goal crossing: `daily_goal_sync_snapshot` last_seen_profit vs current row; no daily notify 00:00–07:59 IL.
 * - Low margin: `consecutive_low_margin_count` on same snapshot row; 3 syncs below 33% margin (Israel 12:00+).
 * - Per-user targeting: each push type sent only to users whose `profiles.notification_settings` has the flag enabled.
 *   Legacy subscriptions (user_id IS NULL) receive all notifications.
 */

import {
  sendNotification,
  setVapidDetails,
  type PushSubscription,
} from "web-push";
import { revalidatePath, revalidateTag } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { getIsraelDate, getIsraelDateDaysAgo, getIsraelHour } from "@/lib/israel-date";
import type { NotificationSettingKey } from "@/app/actions/notification-settings";

/** Same tag used by `@/app/actions/financials` and `/api/auto-sync` so the chart
 *  re-reads `daily_home_totals` after we've confirmed yesterday's source-of-truth. */
const FINANCIAL_TAG = "financial-data";

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

type PushResult = { ok: number; failed: number; errors: string[] };

type NotificationSettingsRow = {
  morning_summary_enabled?: boolean;
  daily_goal_reached_enabled?: boolean;
  monthly_goal_reached_enabled?: boolean;
  low_margin_enabled?: boolean;
};

type UserProfile = {
  id: string;
  notification_settings: NotificationSettingsRow;
};

function normalizeFlag(
  settings: NotificationSettingsRow | null | undefined,
  key: NotificationSettingKey,
): boolean {
  if (!settings) return true;
  return (settings as Record<string, unknown>)[key] !== false;
}

/** Load all profiles with their notification preferences. */
async function loadUserProfiles(): Promise<UserProfile[]> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, notification_settings");
  if (error) {
    console.error("[notifications] loadUserProfiles", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: String(r.id),
    notification_settings: (r.notification_settings ?? {}) as NotificationSettingsRow,
  }));
}

/** Send push to specific subscription rows. */
async function sendPushToRows(
  rows: { id: string; subscription_json: unknown }[],
  payload: string,
): Promise<PushResult> {
  let ok = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const row of rows) {
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

type SentNotificationType =
  | "morning_summary"
  | "daily_goal_reached"
  | "monthly_total_goal_reached"
  | "low_margin_alert";

/**
 * For each profile with `settingKey` enabled: skip if already deduped for this user/date;
 * send only to that user's push_subscriptions; record after ≥1 successful delivery.
 */
async function sendPushTargetedWithDedupe(
  title: string,
  body: string,
  settingKey: NotificationSettingKey,
  dedupe: { type: SentNotificationType; sentDate: string },
  options: { skipDedupe?: boolean } = {},
): Promise<PushResult> {
  ensureWebPushConfigured();
  const payload = JSON.stringify({ title, body });
  const skipDedupe = options.skipDedupe === true;

  const profiles = await loadUserProfiles();
  let ok = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const p of profiles) {
    if (!normalizeFlag(p.notification_settings, settingKey)) continue;
    if (!skipDedupe && (await wasAlreadySent(dedupe.type, dedupe.sentDate, p.id))) continue;

    const { data: rows, error } = await supabaseAdmin
      .from("push_subscriptions")
      .select("id, subscription_json")
      .eq("user_id", p.id);

    if (error) {
      errors.push(`${p.id}: ${error.message}`);
      continue;
    }
    if (!rows?.length) continue;

    const r = await sendPushToRows(rows, payload);
    ok += r.ok;
    failed += r.failed;
    errors.push(...r.errors);
    if (!skipDedupe && r.ok > 0) {
      await recordSent(dedupe.type, dedupe.sentDate, p.id);
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

async function wasAlreadySent(
  notificationType: SentNotificationType,
  sentDate: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("sent_notifications")
    .select("id")
    .eq("notification_type", notificationType)
    .eq("sent_date", sentDate)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[notifications] wasAlreadySent", notificationType, error.message);
    throw new Error(`sent_notifications: ${error.message}`);
  }
  return data != null;
}

async function recordSent(
  notificationType: SentNotificationType,
  sentDate: string,
  userId: string,
): Promise<void> {
  const { error } = await supabaseAdmin.from("sent_notifications").insert({
    notification_type: notificationType,
    sent_date: sentDate,
    user_id: userId,
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
  const { data: existing } = await supabaseAdmin
    .from("daily_goal_sync_snapshot")
    .select("consecutive_low_margin_count")
    .eq("israel_date", israelDate)
    .maybeSingle();

  const { error } = await supabaseAdmin.from("daily_goal_sync_snapshot").upsert(
    {
      israel_date: israelDate,
      last_seen_profit: profit,
      consecutive_low_margin_count: existing?.consecutive_low_margin_count ?? 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "israel_date" },
  );
  if (error) {
    throw new Error(`daily_goal_sync_snapshot upsert: ${error.message}`);
  }
}


async function resetLowMarginCount(israelDate: string): Promise<void> {
  const { data: row } = await supabaseAdmin
    .from("daily_goal_sync_snapshot")
    .select("israel_date")
    .eq("israel_date", israelDate)
    .maybeSingle();
  if (!row) return;
  const { error } = await supabaseAdmin
    .from("daily_goal_sync_snapshot")
    .update({ consecutive_low_margin_count: 0 })
    .eq("israel_date", israelDate);
  if (error) {
    console.error("[notifications] resetLowMarginCount", error.message);
  }
}

/**
 * Low margin streak: margin = (profit/revenue)*100. Only evaluates when israelHour >= 12.
 * Persists streak in `daily_goal_sync_snapshot.consecutive_low_margin_count`.
 */
export async function checkLowMarginAlert(
  revenue: number,
  profit: number,
  israelHour: number,
  israelDate: string,
): Promise<{ sent: boolean; log: string }> {
  if (israelHour < 12) {
    return { sent: false, log: "[lowMargin] skipped hour<12" };
  }

  if (revenue <= 0) {
    await resetLowMarginCount(israelDate);
    return { sent: false, log: "[lowMargin] revenue<=0 reset" };
  }

  const marginPct = (profit / revenue) * 100;

  if (marginPct >= 33) {
    await resetLowMarginCount(israelDate);
    return { sent: false, log: `[lowMargin] ok margin=${marginPct.toFixed(1)}%` };
  }

  const { data: row, error: selErr } = await supabaseAdmin
    .from("daily_goal_sync_snapshot")
    .select("last_seen_profit, consecutive_low_margin_count")
    .eq("israel_date", israelDate)
    .maybeSingle();

  if (selErr) {
    console.error("[notifications] checkLowMarginAlert select", selErr.message);
    return { sent: false, log: `[lowMargin] err ${selErr.message}` };
  }

  const currentCount = row?.consecutive_low_margin_count ?? 0;
  const nextCount = currentCount >= 3 ? 3 : currentCount + 1;
  const lastSeen = row?.last_seen_profit ?? profit;

  const { error: upErr } = await supabaseAdmin.from("daily_goal_sync_snapshot").upsert(
    {
      israel_date: israelDate,
      last_seen_profit: lastSeen,
      consecutive_low_margin_count: nextCount,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "israel_date" },
  );

  if (upErr) {
    console.error("[notifications] checkLowMarginAlert upsert", upErr.message);
    return { sent: false, log: `[lowMargin] upsert ${upErr.message}` };
  }

  if (nextCount < 3) {
    return {
      sent: false,
      log: `[lowMargin] count=${nextCount} margin=${marginPct.toFixed(1)}%`,
    };
  }

  const r = await sendPushTargetedWithDedupe(
    "Low Margin Warning ⚠️",
    "Low Margin Warning ⚠️: Margin has been below 33% for the last 1.5 hours.",
    "low_margin_enabled",
    { type: "low_margin_alert", sentDate: israelDate },
  );
  return {
    sent: r.ok > 0,
    log: `[lowMargin] alert push ok=${r.ok} failed=${r.failed}`,
  };
}

// ---------------------------------------------------------------------------
// A. Morning summary (08:00 cron — use Israel calendar for “yesterday”)
//
// Read-only contract: DB-only reads from `daily_home_totals` + `monthly_goals`.
// Periodic auto-syncs (every ~5 minutes) populate `daily_home_totals` so the
// 24h totals for "yesterday" are already finalized by the time this runs at
// 08:00 IL. We do NOT call XDash here — that would blow past cron-job.org's
// 30s and Vercel Hobby's 10s limits and cause a timeout (no notification).
// ---------------------------------------------------------------------------

/** Format an ISO calendar date (YYYY-MM-DD) as "April 25, 2026" without TZ shifts. */
function formatHumanDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(dt);
}

/** Signed percent string e.g. "+12.3%" / "-4.1%" / "0.0%". */
function formatSignedPercent(pct: number): string {
  const fixed = pct.toFixed(1);
  if (pct > 0) return `+${fixed}%`;
  return `${fixed}%`;
}

export async function morningSummary(
  options: { test?: boolean } = {},
): Promise<{ sent: boolean; log: string }> {
  const isTest = options.test === true;

  const yesterday = getIsraelDateDaysAgo(1);
  const dayBefore = getIsraelDateDaysAgo(2);

  // Read-only: rely on the periodic sync having already written the 24h totals
  // (00:00–23:59 Israel time) for both dates into `daily_home_totals`.
  const [yY, yM] = yesterday.split("-").map(Number);
  const monthStart = `${yY}-${String(yM).padStart(2, "0")}-01`;

  const [yRow, dRow, monthlyGoal, mtdActual] = await Promise.all([
    fetchDailyRow(yesterday),
    fetchDailyRow(dayBefore),
    fetchMonthlyGoal(monthStart),
    sumProfitMtd(monthStart, yesterday),
  ]);

  const yRev = yRow?.revenue ?? 0;
  const yGp = yRow?.profit ?? 0;
  const dGp = dRow?.profit ?? 0;
  const gpChangePercent = percentChangeVsPrior(yGp, dGp);

  const title = `${isTest ? "[TEST] " : ""}Good Morning! ☕ Here is your summary for Yesterday (${formatHumanDate(yesterday)})`;
  const mtdLine =
    monthlyGoal > 0
      ? `MTD Profit: ${formatCurrencyShort(mtdActual)} vs ${formatCurrencyShort(monthlyGoal)} Goal`
      : `MTD Profit: ${formatCurrencyShort(mtdActual)}`;
  const body = [
    `Revenue: ${formatCurrencyShort(yRev)}`,
    `GP: ${formatCurrencyShort(yGp)} (${formatSignedPercent(gpChangePercent)} vs Day Before)`,
    mtdLine,
  ].join("\n");

  const reportDayIsrael = getIsraelDate();
  const { ok, failed, errors } = await sendPushTargetedWithDedupe(
    title,
    body,
    "morning_summary_enabled",
    { type: "morning_summary", sentDate: reportDayIsrael },
    { skipDedupe: isTest },
  );

  // Bust the financial cache so the Home / Financial chart immediately reflects
  // the same numbers that just went out in the push. The cron sync already
  // re-fetches today + yesterday (see syncHomeTotalsForDates), but the chart's
  // server segment / unstable_cache may still hold a snapshot taken before the
  // last intraday update. Skip during test runs so we don't churn the cache.
  if (!isTest) {
    try { revalidateTag(FINANCIAL_TAG, { expire: 0 }); } catch { /* non-fatal */ }
    try { revalidatePath("/"); } catch { /* non-fatal */ }
  }

  const log = `[morningSummary]${isTest ? " test=true" : ""} reportDay=${reportDayIsrael} yesterday=${yesterday} push ok=${ok} failed=${failed}${errors.length ? ` errors=${errors.slice(0, 3).join("; ")}` : ""}`;

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
  const hourIL = getIsraelHour();
  const todayRow = await fetchDailyRow(today);
  const todayGp = todayRow?.profit ?? 0;
  const todayRev = todayRow?.revenue ?? 0;

  const [y, m] = today.split("-").map(Number);
  const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
  const dim = daysInMonthYm(y, m);

  const profitGoal = await fetchMonthlyGoal(monthStart);
  if (profitGoal <= 0) {
    const low = await checkLowMarginAlert(todayRev, todayGp, hourIL, today);
    return {
      sent: low.sent,
      reasons: [],
      log: `[checkPerformance] no monthly goal set ${low.log}`,
    };
  }

  const dailyAvgTarget = dim > 0 ? profitGoal / dim : 0;
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
        const r = await sendPushTargetedWithDedupe(
          "Daily Goal Reached! 🎯",
          `Today's GP: ${formatCurrencyShort(todayGp)} vs. ${formatCurrencyShort(dailyAvgTarget)} daily target. Keep it up! 💰`,
          "daily_goal_reached_enabled",
          { type: "daily_goal_reached", sentDate: today },
        );
        ok += r.ok;
        failed += r.failed;
        errors.push(...r.errors);
        if (r.ok === 0) {
          logExtras.push("daily_goal_no_delivery");
        }
        await upsertDailyGoalSnapshot(today, todayGp);
      } else {
        await upsertDailyGoalSnapshot(today, todayGp);
      }
    }
  }

  if (monthlyGoalReached) {
    reasons.push("monthly_total_goal_reached");
    const r = await sendPushTargetedWithDedupe(
      "Monthly Goal Reached! 🔥",
      `MTD Profit: ${formatCurrencyShort(mtdProfit)} has hit the ${formatCurrencyShort(profitGoal)} monthly goal! 🎉`,
      "monthly_goal_reached_enabled",
      { type: "monthly_total_goal_reached", sentDate: monthStart },
    );
    ok += r.ok;
    failed += r.failed;
    errors.push(...r.errors);
    if (r.ok === 0) {
      logExtras.push("monthly_goal_no_delivery");
    }
  }

  const lowMargin = await checkLowMarginAlert(todayRev, todayGp, hourIL, today);
  if (lowMargin.sent) reasons.push("low_margin_alert");

  const log = `[checkPerformance] israelDate=${today} hourIL=${hourIL}${dailyGoalQuietHours ? " [daily quiet]" : ""} reasons=${reasons.join(",") || "none"}${logExtras.length ? ` ${logExtras.join(" ")}` : ""} push ok=${ok} failed=${failed}${errors.length ? ` ${errors[0]}` : ""} todayGp=${todayGp.toFixed(0)} dailyTarget=${dailyAvgTarget.toFixed(0)} mtd=${mtdProfit.toFixed(0)} ${lowMargin.log}`;

  return { sent: ok > 0 || lowMargin.sent, reasons, log };
}
