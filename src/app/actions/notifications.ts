"use server";

// Temporary global kill-switch for all Web Push notifications (Admin + Viewer).
// Flip back to `false` once infrastructure maintenance is complete.
const DISABLE_ALL_NOTIFICATIONS = false; // Set to false to re-enable.

/**
 * Business alert notifications (Web Push).
 *
 * Data sources (see answers inline in repo docs / this file):
 * - Per-day Revenue & Gross Profit: `daily_home_totals` (`revenue`, `profit` — same XDASH Home mapping as elsewhere).
 * - Monthly goals & pace: `monthly_goals` + MTD logic aligned with `src/lib/pacing.ts` (profit_goal, target ∝ days elapsed).
 * - Yesterday vs day-before: `daily_home_totals` for `getIsraelDateDaysAgo(1)` vs `getIsraelDateDaysAgo(2)`.
 * - Milestone dedupe: `sent_notifications` per user (UNIQUE user_id + notification_type + sent_date).
 * - Daily goal crossing: `daily_goal_sync_snapshot` last_seen_profit vs current row; no daily notify 00:00–07:59 IL.
 *   First observation after quiet hours: if there is no snapshot yet for today and GP is already ≥ daily target,
 *   we still notify once (deduped via `sent_notifications`) so sparse syncs / cron-only paths do not miss the alert.
 * - Low margin: `consecutive_low_margin_count` on same snapshot row; 3 syncs below 20% margin (Israel 12:00+).
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
import { fetchHomeForDate } from "@/lib/xdash-client";
import { syncProLog } from "@/lib/sync-pro-log";
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

type PushResult = {
  ok: number;
  failed: number;
  errors: string[];
  skipped?: boolean;
  message?: string;
};

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

/**
 * Load IDs of every profile with `role = 'admin'`.
 *
 * Used by **operational / technical** alerts (e.g. `notifyCriticalSyncTripleFailure`)
 * to make sure non-admin viewers never receive infrastructure alerts. Business
 * alerts (morning summary, daily/monthly profit goal, low margin) intentionally
 * do NOT use this — they target every subscribed user with the matching
 * notification setting enabled.
 */
async function loadAdminUserIds(): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("role", "admin");
  if (error) {
    console.error("[notifications] loadAdminUserIds", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r) => String(r.id)).filter(Boolean));
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
  | "low_margin_alert"
  | "critical_sync_alert";

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
  if (DISABLE_ALL_NOTIFICATIONS) {
    return {
      ok: 0,
      failed: 0,
      errors: [],
      skipped: true,
      message: "Notifications are temporarily muted",
    };
  }
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

/**
 * High-priority **operational** alert: XDASH totals cron branch failed 3 times in a row.
 *
 * **Recipient policy (admin-only since 2026-05-12):**
 *   1. Load `profiles.id` where `role = 'admin'`.
 *   2. Load `push_subscriptions` filtered to those admin user IDs.
 *   3. Send + dedupe per user (one push per admin per Israel calendar day).
 *
 * Viewers (Uri, Ran, Tal, …) are excluded by design — they get business
 * summaries (morning summary, daily/monthly goal, low margin) but never
 * infrastructure alerts. To grant someone access, set `profiles.role = 'admin'`.
 */
export async function notifyCriticalSyncTripleFailure(
  errorHint: string,
): Promise<{ ok: number; failed: number; log: string; skipped?: boolean; message?: string }> {
  if (DISABLE_ALL_NOTIFICATIONS) {
    return {
      ok: 0,
      failed: 0,
      log: "[criticalSync] muted: Notifications are temporarily muted",
      skipped: true,
      message: "Notifications are temporarily muted",
    };
  }
  try {
    ensureWebPushConfigured();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: 0, failed: 0, log: `[criticalSync] skipped: ${msg}` };
  }

  const sentDate = getIsraelDate();
  const title = "Critical: XDASH totals sync failed 3 times in a row";
  const trimmed = errorHint.trim();
  const body =
    "Dashboard home totals may be stale — check Edge Config / cookie / API keys. " +
    (trimmed.length > 160 ? `${trimmed.slice(0, 157)}…` : trimmed || "(no error detail)");

  const adminIds = await loadAdminUserIds();
  if (adminIds.size === 0) {
    const log = `[criticalSync] skipped: no profiles.role='admin' configured`;
    console.warn(log);
    return { ok: 0, failed: 0, log };
  }

  // Filter at the DB layer: only subscriptions that belong to an admin user.
  // (PostgREST's `.in()` is the simplest equivalent of an inner join here —
  // we already have the admin id list, so a single bounded `IN` is faster
  // than a join + post-filter.)
  const { data: rows, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("user_id")
    .in("user_id", Array.from(adminIds));
  if (error) {
    return { ok: 0, failed: 0, log: `[criticalSync] load admin subscriptions: ${error.message}` };
  }

  const userIds = [...new Set((rows ?? []).map((r) => String(r.user_id)).filter(Boolean))];
  if (userIds.length === 0) {
    const log = `[criticalSync] skipped: ${adminIds.size} admin(s) have no push_subscriptions`;
    console.warn(log);
    return { ok: 0, failed: 0, log };
  }

  let ok = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const userId of userIds) {
    // Defense in depth: never page someone who isn't currently flagged admin,
    // even if a stale subscription row slipped through the IN filter.
    if (!adminIds.has(userId)) continue;
    try {
      if (await wasAlreadySent("critical_sync_alert", sentDate, userId)) continue;
    } catch (e) {
      errors.push(`${userId}: dedupe ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    const { data: subRows, error: subErr } = await supabaseAdmin
      .from("push_subscriptions")
      .select("id, subscription_json")
      .eq("user_id", userId);

    if (subErr) {
      errors.push(`${userId}: ${subErr.message}`);
      continue;
    }
    if (!subRows?.length) continue;

    const payload = JSON.stringify({ title, body });
    const r = await sendPushToRows(subRows, payload);
    ok += r.ok;
    failed += r.failed;
    errors.push(...r.errors);
    if (r.ok > 0) {
      try {
        await recordSent("critical_sync_alert", sentDate, userId);
      } catch (re) {
        errors.push(`${userId}: recordSent ${re instanceof Error ? re.message : String(re)}`);
      }
    }
  }

  const log = `[criticalSync] sentDate=${sentDate} admins=${adminIds.size} targeted=${userIds.length} deliveries_ok=${ok} failed=${failed}${errors.length ? `; ${errors.slice(0, 3).join("; ")}` : ""}`;
  console.warn(log);
  return { ok, failed, log };
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

/**
 * Hybrid fallback used for the "yesterday" headline number in the morning summary.
 *
 * 1. Prefer the persisted row in `daily_home_totals` (fast, deterministic).
 * 2. If the row is missing OR both revenue and profit are 0, hit XDASH live
 *    (`fetchHomeForDate` — external report API for past dates) so a laggy /
 *    skipped sync doesn't cause a "$0 GP" push.
 * 3. When the live fetch returns real data, upsert it back into
 *    `daily_home_totals` so subsequent reads (chart, comparisons) see the
 *    same number we just sent in the push. Best-effort; failures are logged.
 *
 * Returns `null` only if both the DB row is empty AND the live fetch fails or
 * also yields zeros — in which case we explicitly fall through to the existing
 * "$0" path so we never silently swallow a legitimate zero day.
 */
async function fetchDailyRowWithLiveFallback(isoDate: string): Promise<DailyRow | null> {
  const dbRow = await fetchDailyRow(isoDate);
  const dbHasData = dbRow !== null && (dbRow.revenue > 0 || dbRow.profit > 0);
  if (dbHasData) return dbRow;

  syncProLog({
    event: "sync_pro.morning_summary.live_fallback.start",
    branch_type: "refresh_today_home",
    status: "started",
    detail: { isoDate, dbRow },
    message: dbRow ? "daily_home_totals all zeros" : "daily_home_totals missing",
  });

  let live: { revenue: number; cost: number; profit: number; impressions: number };
  try {
    live = await fetchHomeForDate(isoDate, { mode: "internal" });
  } catch (e) {
    syncProLog({
      event: "sync_pro.morning_summary.live_fallback.fetch_failed",
      branch_type: "refresh_today_home",
      status: "error",
      message: e instanceof Error ? e.message : String(e),
      detail: { isoDate },
    });
    return dbRow;
  }

  if (live.revenue === 0 && live.profit === 0) {
    syncProLog({
      event: "sync_pro.morning_summary.live_fallback.zero",
      branch_type: "refresh_today_home",
      status: "error",
      detail: { isoDate, live },
    });
    return dbRow;
  }

  syncProLog({
    event: "sync_pro.morning_summary.live_fallback.upsert",
    branch_type: "refresh_today_home",
    status: "ok",
    detail: { isoDate, revenue: live.revenue, profit: live.profit },
  });

  const { error: upsertErr } = await supabaseAdmin.from("daily_home_totals").upsert(
    {
      date: isoDate,
      revenue: live.revenue,
      cost: live.cost,
      profit: live.profit,
      impressions: live.impressions,
      created_at: new Date().toISOString(),
    },
    { onConflict: "date" },
  );
  if (upsertErr) {
    syncProLog({
      event: "sync_pro.morning_summary.live_fallback.upsert_failed",
      branch_type: "refresh_today_home",
      status: "error",
      message: upsertErr.message,
      detail: { isoDate },
    });
  }

  return { date: isoDate, revenue: live.revenue, profit: live.profit };
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

/** Margin % at or above this resets the low-margin streak; below it increments toward alert. */
const LOW_MARGIN_THRESHOLD_PCT = 20;

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

  if (marginPct >= LOW_MARGIN_THRESHOLD_PCT) {
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
    `Low Margin Warning ⚠️: Margin has been below ${LOW_MARGIN_THRESHOLD_PCT}% for the last 1.5 hours.`,
    "low_margin_enabled",
    { type: "low_margin_alert", sentDate: israelDate },
  );
  return {
    sent: r.ok > 0,
    log: `[lowMargin] alert push ok=${r.ok} failed=${r.failed}`,
  };
}

// ---------------------------------------------------------------------------
// A. Morning summary (05:00 cron — use Israel calendar for "yesterday")
//
// Contract:
//   1. **Force Fetch Before Notify** — first thing we do is a blocking, forced
//      `syncXDASHDataForDates([yesterday], …)` so the row in `daily_home_totals`
//      reflects XDASH's overnight reconciliation (late demand / billing fixes
//      that often land between 23:30 IL and 04:00 IL the next morning).
//   2. After the force-fetch returns (or fails — non-fatal), we read
//      `daily_home_totals` + `monthly_goals` to build the push body.
//   3. The hybrid live-fallback in `fetchDailyRowWithLiveFallback` and the
//      zero-value shield further down are kept as defence-in-depth: if the
//      force-fetch errored or XDASH itself returned 0, we still try one more
//      live read before giving up and aborting the push.
// ---------------------------------------------------------------------------

/** Push title fragment: "Mon 27/04" for an ISO date (YYYY-MM-DD), TZ-stable via UTC. */
function formatSummaryTitleDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
  }).format(dt);
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return `${dow} ${dd}/${mm}`;
}

/** Signed whole percent for compact push lines e.g. "+12%" / "-4%" / "0%". */
function formatSignedPercentInt(pct: number): string {
  const n = Math.round(pct);
  if (n > 0) return `+${n}%`;
  if (n < 0) return `${n}%`;
  return "0%";
}

export async function morningSummary(
  options: { test?: boolean } = {},
): Promise<{ sent: boolean; log: string; skipped?: boolean; message?: string }> {
  if (DISABLE_ALL_NOTIFICATIONS) {
    return {
      sent: false,
      log: "[morningSummary] muted: Notifications are temporarily muted",
      skipped: true,
      message: "Notifications are temporarily muted",
    };
  }
  const isTest = options.test === true;
  const t0 = Date.now();

  const yesterday = getIsraelDateDaysAgo(1);
  const dayBefore = getIsraelDateDaysAgo(2);

  // -- Force Fetch Before Notify -------------------------------------------
  // Before we read anything from `daily_home_totals`, run a blocking, *forced*
  // XDASH sync of yesterday. The morning summary fires at 05:00 IL — by then
  // XDASH has finished its overnight reconciliation (late demand corrections,
  // billing adjustments) and the row in our DB may still reflect the stale
  // last-intraday value from ~23:30 IL the previous day. We always overwrite,
  // bypassing the regression guard, so the push is built from XDASH's final
  // numbers instead of the pre-midnight estimate.
  //
  // Failure is non-fatal: if XDASH is down we still try to build the summary
  // from whatever is in the DB and the existing zero-value shield (below)
  // will abort if the row is genuinely empty.
  //
  // Lazy import avoids a circular dependency (sync/xdash → financials →
  // notifications would otherwise loop at module init).
  const forceFetchT0 = Date.now();
  syncProLog({
    event: "sync_pro.morning_summary.force_fetch_yesterday.start",
    branch_type: "refresh_today_home",
    status: "started",
    detail: { yesterday, isTest },
  });
  try {
    const { syncXDASHDataForDates } = await import("@/lib/sync/xdash");
    const result = await syncXDASHDataForDates([yesterday], {
      force: true,
      mode: "internal",
      skipHourlySnapshots: true,
      skipPartnerPerformance: true,
    });
    syncProLog({
      event: "sync_pro.morning_summary.force_fetch_yesterday.done",
      branch_type: "refresh_today_home",
      status: "ok",
      duration_ms: Date.now() - forceFetchT0,
      detail: {
        yesterday,
        datesSynced: result.datesSynced,
        rowsUpserted: result.rowsUpserted,
      },
    });
  } catch (e) {
    syncProLog({
      event: "sync_pro.morning_summary.force_fetch_yesterday.failed",
      branch_type: "refresh_today_home",
      status: "error",
      duration_ms: Date.now() - forceFetchT0,
      message: e instanceof Error ? e.message : String(e),
      detail: { yesterday },
    });
  }
  // ------------------------------------------------------------------------

  syncProLog({
    event: "sync_pro.morning_summary.start",
    branch_type: "refresh_today_home",
    status: "started",
    detail: { yesterday, dayBefore, isTest },
  });
  // Same day-of-week last week, relative to "yesterday": yesterday is 1 day ago,
  // so the matching weekday last week is 8 days ago (1 + 7).
  const sameDayLastWeek = getIsraelDateDaysAgo(8);

  // Read-only: rely on the periodic sync having already written the 24h totals
  // (00:00–23:59 Israel time) for these dates into `daily_home_totals`.
  const [yY, yM] = yesterday.split("-").map(Number);
  const monthStart = `${yY}-${String(yM).padStart(2, "0")}-01`;

  // "Yesterday" uses the hybrid fallback because that's the headline number in
  // the push and the date most likely to be incomplete in `daily_home_totals`
  // when XDASH is laggy at 05:00 IL. Older dates are stable in DB and don't
  // warrant the extra XDASH round-trip.
  // We discard the parallel MTD result if the zero-value shield triggers below
  // (we'd recompute anyway after writing the corrected yesterday row), so a
  // small placeholder keeps the destructure tidy while still parallelising.
  // eslint-disable-next-line prefer-const
  let [yRow, dRow, wRow, monthlyGoal, mtdActualParallel] = await Promise.all([
    fetchDailyRowWithLiveFallback(yesterday),
    fetchDailyRow(dayBefore),
    fetchDailyRow(sameDayLastWeek),
    fetchMonthlyGoal(monthStart),
    sumProfitMtd(monthStart, yesterday),
  ]);

  // -- Zero-Value Shield ----------------------------------------------------
  // Even after the hybrid fallback, "yesterday" can still be 0 if XDASH wrote a
  // vacuous row OR the live fetch errored out. Force a synchronous, *forced*
  // refresh of `daily_home_totals` for yesterday and re-read. If still 0 →
  // abort instead of pushing a $0 summary.
  if ((yRow?.revenue ?? 0) <= 0) {
    syncProLog({
      event: "sync_pro.morning_summary.zero_shield.start",
      branch_type: "refresh_today_home",
      status: "started",
      detail: { yesterday, dbRevenue: yRow?.revenue ?? 0, dbProfit: yRow?.profit ?? 0 },
    });
    try {
      // Lazy import to avoid a circular import (financials.ts imports notifications).
      // Same recipe as Golden Sync: cookie path (UI parity), hard overwrite,
      // and DO NOT touch hourly_snapshots so Pulse keeps its intraday timeline.
      const { syncXDASHDataForDates } = await import("@/lib/sync/xdash");
      await syncXDASHDataForDates([yesterday], {
        force: true,
        mode: "internal",
        skipHourlySnapshots: true,
        skipPartnerPerformance: true,
      });
    } catch (e) {
      syncProLog({
        event: "sync_pro.morning_summary.zero_shield.refresh_failed",
        branch_type: "refresh_today_home",
        status: "error",
        message: e instanceof Error ? e.message : String(e),
        detail: { yesterday },
      });
    }
    yRow = await fetchDailyRow(yesterday);
    syncProLog({
      event: "sync_pro.morning_summary.zero_shield.after_refresh",
      branch_type: "refresh_today_home",
      status: (yRow?.revenue ?? 0) > 0 ? "ok" : "error",
      detail: { yesterday, dbRevenue: yRow?.revenue ?? 0, dbProfit: yRow?.profit ?? 0 },
    });
  }

  if ((yRow?.revenue ?? 0) <= 0) {
    const log = `[morningSummary] aborted_zero_value yesterday=${yesterday} dbRev=${yRow?.revenue ?? 0}`;
    syncProLog({
      event: "morning_summary.aborted_zero_value",
      branch_type: "refresh_today_home",
      status: "error",
      message: log,
      detail: { yesterday, isTest, dbRevenue: yRow?.revenue ?? 0, dbProfit: yRow?.profit ?? 0 },
    });
    return { sent: false, log };
  }
  // -------------------------------------------------------------------------

  // If the fallback / shield wrote a corrected yesterday row, the cached MTD sum
  // read a moment earlier may still reflect the stale ($0) value. Re-sum (small).
  // The shield guarantees `yRow` is non-null and revenue > 0 by the time we get here.
  const mtdActual = await sumProfitMtd(monthStart, yesterday);
  void mtdActualParallel;

  const yRev = yRow?.revenue ?? 0;
  const yGp = yRow?.profit ?? 0;
  const dRev = dRow?.revenue ?? 0;
  const dGp = dRow?.profit ?? 0;
  const wRev = wRow?.revenue ?? 0;
  const wGp = wRow?.profit ?? 0;

  // Day-over-day (vs Day Before) and Week-over-Week (vs same weekday last week).
  const revPrevPct = percentChangeVsPrior(yRev, dRev);
  const gpPrevPct = percentChangeVsPrior(yGp, dGp);
  const revWowPct = percentChangeVsPrior(yRev, wRev);
  const gpWowPct = percentChangeVsPrior(yGp, wGp);

  // Margin = (profit / revenue) * 100. Defaults to 0 when revenue is 0 to avoid NaN.
  const yMargin = yRev > 0 ? (yGp / yRev) * 100 : 0;
  const dMargin = dRev > 0 ? (dGp / dRev) * 100 : 0;
  const wMargin = wRev > 0 ? (wGp / wRev) * 100 : 0;
  // Percentage-point change vs prior day / same weekday last week (not relative %).
  const marginPrevPp = yMargin - dMargin;
  const marginWowPp = yMargin - wMargin;

  const title = `${isTest ? "[TEST] " : ""}Adtex Summary • ${formatSummaryTitleDate(yesterday)} 📊`;

  // Linear MTD target through "yesterday" (same pro-ration as before pace checks).
  const dim = daysInMonthYm(yY, yM);
  const dayOfMonth = parseInt(yesterday.slice(8, 10), 10);
  const targetMtd =
    monthlyGoal > 0 && dim > 0 ? monthlyGoal * (dayOfMonth / dim) : 0;
  const mtdOnPace =
    monthlyGoal > 0 && mtdActual + 1e-6 >= targetMtd;
  const mtdSuffix = mtdOnPace ? " ✅" : "";

  const mtdLine =
    monthlyGoal > 0
      ? `MTD Profit: ${formatCurrencyShort(mtdActual)} / ${formatCurrencyShort(monthlyGoal)}${mtdSuffix}`
      : `MTD Profit: ${formatCurrencyShort(mtdActual)}`;

  const body = [
    `Rev: ${formatCurrencyShort(yRev)} (Prev: ${formatSignedPercentInt(revPrevPct)} | WoW: ${formatSignedPercentInt(revWowPct)})`,
    `GP: ${formatCurrencyShort(yGp)} (Prev: ${formatSignedPercentInt(gpPrevPct)} | WoW: ${formatSignedPercentInt(gpWowPct)})`,
    `Margin: ${Math.round(yMargin)}% (Prev: ${formatSignedPercentInt(marginPrevPp)} | WoW: ${formatSignedPercentInt(marginWowPp)})`,
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

  syncProLog({
    event: ok > 0 ? "sync_pro.morning_summary.delivered" : "sync_pro.morning_summary.no_subscribers",
    branch_type: "refresh_today_home",
    status: ok > 0 ? "ok" : "error",
    duration_ms: Date.now() - t0,
    detail: { reportDayIsrael, yesterday, ok, failed, isTest, errorsSample: errors.slice(0, 3) },
  });

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
  skipped?: boolean;
  message?: string;
}> {
  if (DISABLE_ALL_NOTIFICATIONS) {
    return {
      sent: false,
      reasons: [],
      log: "[checkPerformance] muted: Notifications are temporarily muted",
      skipped: true,
      message: "Notifications are temporarily muted",
    };
  }
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

  // --- Daily: live crossing detection + quiet window (no send / no snapshot update 00:00–07:59 IL)
  if (dim > 0 && dailyAvgTarget > 0) {
    if (dailyGoalQuietHours) {
      logExtras.push("daily_goal_quiet_hours");
    } else {
      const prevSnap = await getDailyGoalSnapshot(today);
      // Fire ONLY on a genuine live intraday crossing: a prior snapshot strictly below
      // target while current GP is at/above it. A missing snapshot (first sync after
      // quiet hours end at 08:00 IL) is intentionally NOT treated as a crossing — that
      // prevents spammy "already reached" alerts when the day opens above target.
      const crossed =
        prevSnap != null &&
        prevSnap + 1e-6 < dailyAvgTarget &&
        todayGp + 1e-6 >= dailyAvgTarget;

      const notifyDailyGoalReached = async () => {
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
        return r;
      };

      if (crossed) {
        const pushResult = await notifyDailyGoalReached();
        // Snapshot Lock Trap fix: advance the snapshot above target ONLY when the push
        // actually went out (ok > 0) OR there was nothing to retry — every eligible user
        // was already deduped / had no subscription (a clean zero: ok=0, failed=0, no
        // errors). A complete delivery FAILURE leaves the snapshot untouched so the same
        // crossing is re-detected and retried on the next half-hourly sync run.
        const allDedupedOrNoTargets =
          pushResult.ok === 0 &&
          pushResult.failed === 0 &&
          pushResult.errors.length === 0;
        if (pushResult.ok > 0 || allDedupedOrNoTargets) {
          await upsertDailyGoalSnapshot(today, todayGp);
        } else {
          logExtras.push("daily_goal_snapshot_unlocked_for_retry");
        }
      } else {
        // No crossing this run — keep the snapshot tracking the latest GP so the next
        // run can detect a real crossing.
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
