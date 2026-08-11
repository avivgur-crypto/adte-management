import fs from "node:fs/promises";
import path from "node:path";

/**
 * XDASH sync: Home API totals → daily_home_totals (+ hourly_snapshots).
 *
 * Partner-level demand/supply writes to `daily_partner_performance` were removed —
 * the Partners UI is gone and those fetches overloaded the backup server. The table
 * is retained in Supabase for historical queries; this module no longer writes it.
 *
 * Uses sequential per-date Home fetches to avoid overloading the backup server.
 */

import {
  fetchHomeForDate,
} from "@/lib/xdash-client";
import { supabaseAdmin } from "@/lib/supabase";
import { getIsraelHour } from "@/lib/israel-date";
import { syncProLog } from "@/lib/sync-pro-log";

const TIMEZONE_ISRAEL = "Asia/Jerusalem";

/** Delay between Home API date fetches — backup server is weak. */
const INTER_BATCH_DELAY_MS = 2000;

/**
 * Smart regression guard — prevent a partial XDASH response from silently
 * stomping on a previously-correct historical row (the May 8 failure mode).
 *
 * Rule (applied per-date inside `syncHomeTotalsForDates`):
 *   - If `force === true` → bypass entirely (backfill / golden_sync explicitly opt in).
 *   - If existing.revenue == 0 → allow (new date or never-synced).
 *   - If new.revenue ≥ existing.revenue × THRESHOLD → allow (covers growth + small clawbacks).
 *   - If new.revenue <  existing.revenue × THRESHOLD AND date === today → BLOCK: a cumulative
 *     total can't shrink >15% intraday, so treat it as a partial response and preserve the
 *     last-known-good row (`today_regression_blocked`).
 *   - Otherwise → BLOCK the upsert for that date and emit a high-priority error log.
 *
 * Threshold tunable by env (`XDASH_REGRESSION_THRESHOLD`, e.g. `0.85`).
 */
const REVENUE_REGRESSION_THRESHOLD = (() => {
  const raw = process.env.XDASH_REGRESSION_THRESHOLD;
  const n = raw ? Number.parseFloat(raw) : NaN;
  return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.85;
})();

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today's date in Israel (YYYY-MM-DD). Use this so sync aligns with XDASH dashboard. */
function getTodayIsrael(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE_ISRAEL });
}

/** Yesterday's date in Israel (YYYY-MM-DD). XDash keeps reattributing recent days, so the
 *  row for "yesterday" must keep being re-fetched until the morning summary anchors it. */
function getYesterdayIsrael(): string {
  const today = getTodayIsrael();
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function getYesterday(now: Date): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return d;
}

/** Dates from 1st of current month through today in Israel timezone. */
function datesFromMonthStartThroughToday(_now: Date): string[] {
  const todayStr = getTodayIsrael();
  const [y, m, d] = todayStr.split("-").map(Number);
  const out: string[] = [];
  for (let day = 1; day <= d; day++) {
    out.push(`${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return out;
}

/** Last N days in Israel timezone (including today). */
function lastNDaysIsrael(n: number): string[] {
  const todayStr = getTodayIsrael();
  const [y, m, day] = todayStr.split("-").map(Number);
  const todayDate = new Date(y, m - 1, day);
  const out: string[] = [];
  for (let offset = n - 1; offset >= 0; offset--) {
    const d = new Date(todayDate);
    d.setDate(d.getDate() - offset);
    out.push(formatLocalDate(d));
  }
  return out;
}

/** Generate all dates from startDate through endDate (inclusive, YYYY-MM-DD strings). */
function dateRange(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const cur = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  while (cur <= end) {
    out.push(formatLocalDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/**
 * Return the set of dates that already have a row in daily_home_totals.
 */
async function getDatesAlreadySynced(dates: string[]): Promise<Set<string>> {
  if (dates.length === 0) return new Set();
  const { data, error } = await supabaseAdmin
    .from("daily_home_totals")
    .select("date")
    .in("date", dates);
  if (error) throw new Error(`XDASH date check failed: ${error.message}`);
  const set = new Set<string>();
  for (const row of data ?? []) {
    const d = row?.date;
    if (d) set.add(typeof d === "string" ? d.slice(0, 10) : String(d).slice(0, 10));
  }
  return set;
}

/** Dates from 1st through last day of the given month, or through yesterday if that month is the current month. */
function datesForMonth(year: number, month: number): string[] {
  const now = new Date();
  const yesterday = getYesterday(now);
  const firstOfMonth = new Date(year, month - 1, 1);
  const lastDayOfMonth = new Date(year, month, 0);
  const endDate = lastDayOfMonth <= yesterday ? lastDayOfMonth : yesterday;
  if (firstOfMonth > endDate) return [];
  const out: string[] = [];
  const cur = new Date(firstOfMonth);
  while (cur <= endDate) {
    out.push(formatLocalDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/**
 * Reorder a date list in place so the live window (today, then yesterday) is
 * processed first, with the remaining catch-up dates ascending. Under a tight
 * cron time budget this guarantees the dashboard-critical dates are synced
 * before older backfill dates, which drain across subsequent runs.
 */
function prioritizeLiveWindow(dates: string[], today: string, yesterday: string): void {
  const rank = (d: string) => (d === today ? 0 : d === yesterday ? 1 : 2);
  dates.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

const HOME_TABLE = "daily_home_totals";

/** Local JSON backup of raw Home API rows (survives DB issues). Written to project root when running Node (e.g. sync-fix). */
const HOME_TOTALS_LOCAL_BACKUP_FILE = "xdash_backup_2026.json";

type HomeTotalsBackupRow = {
  date: string;
  revenue: number;
  cost: number;
  profit: number;
  impressions: number;
  savedAt: string;
};

/**
 * Merge one day's XDASH Home totals into `xdash_backup_2026.json` (by date, sorted).
 * Non-fatal on failure (e.g. read-only serverless FS).
 */
async function persistHomeTotalsToLocalBackup(
  row: Omit<HomeTotalsBackupRow, "savedAt">,
): Promise<void> {
  // Vercel's FS is read-only (/var/task) — the write below can never succeed
  // there and only produces an EROFS warning per upsert. The local JSON backup
  // is for local runs (sync-fix / CLI scripts) only.
  if (process.env.VERCEL) return;
  try {
    const filePath = path.join(process.cwd(), HOME_TOTALS_LOCAL_BACKUP_FILE);
    let existing: HomeTotalsBackupRow[] = [];
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) existing = parsed as HomeTotalsBackupRow[];
    } catch {
      /* missing or invalid — start fresh */
    }
    const byDate = new Map<string, HomeTotalsBackupRow>();
    for (const r of existing) {
      if (r?.date) byDate.set(r.date, r);
    }
    byDate.set(row.date, {
      ...row,
      savedAt: new Date().toISOString(),
    });
    const merged = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    await fs.writeFile(filePath, JSON.stringify(merged, null, 2), "utf8");
    console.log(`[xdash-sync] Local backup updated: ${HOME_TOTALS_LOCAL_BACKUP_FILE} (${merged.length} day(s))`);
  } catch (e) {
    console.warn(
      "[xdash-sync] Local backup write failed (non-fatal):",
      e instanceof Error ? e.message : e,
    );
  }
}

type ExistingHomeRow = {
  revenue: number;
  cost: number;
  profit: number;
  impressions: number;
};

/**
 * Read existing `daily_home_totals` rows for the given dates. Returns a map
 * keyed by `YYYY-MM-DD`. Used by the regression guard to compare what's
 * already in the DB against what XDASH just returned.
 *
 * Fail-open: if the read itself errors (RLS, network), we log + return an
 * empty map. The guard then has nothing to compare against and allows the
 * write — better to risk an overwrite than to block all syncs on a transient
 * Supabase blip.
 */
async function readExistingHomeTotals(
  dates: string[],
): Promise<Map<string, ExistingHomeRow>> {
  const out = new Map<string, ExistingHomeRow>();
  if (dates.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from(HOME_TABLE)
    .select("date, revenue, cost, profit, impressions")
    .in("date", dates);
  if (error) {
    syncProLog({
      event: "sync_pro.xdash_sync.regression_guard.read_failed",
      branch_type: "xdash_sync",
      status: "error",
      message: `Regression guard could not read existing rows (failing open): ${error.message}`,
      detail: { dates },
    });
    return out;
  }
  for (const row of data ?? []) {
    if (!row?.date) continue;
    const date = String(row.date).slice(0, 10);
    out.set(date, {
      revenue: Number(row.revenue ?? 0),
      cost: Number(row.cost ?? 0),
      profit: Number(row.profit ?? 0),
      impressions: Number(row.impressions ?? 0),
    });
  }
  return out;
}

/**
 * Return the set of dates that already have a row in daily_home_totals with profit != 0.
 * These dates can be safely skipped during non-force syncs.
 */
async function getHomeDatesWithProfit(dates: string[]): Promise<Set<string>> {
  if (dates.length === 0) return new Set();
  const { data, error } = await supabaseAdmin
    .from(HOME_TABLE)
    .select("date, profit")
    .in("date", dates)
    .neq("profit", 0);
  if (error) {
    console.warn(`[xdash-sync] Home date check failed (will fetch all):`, error.message);
    return new Set();
  }
  const set = new Set<string>();
  for (const row of data ?? []) {
    if (row?.date) set.add(String(row.date).slice(0, 10));
  }
  return set;
}

export type SyncHomeTotalsOptions = {
  /**
   * Source mode for every Home-totals fetch in this run.
   *   - `"internal"` (default): cookie path → 1:1 parity with the XDASH UI.
   *   - `"external"`: External Report API (only for >7-day-old historical research).
   *   - `"auto"`: legacy hybrid (today→cookie, history→external).
   */
  mode?: "internal" | "external" | "auto";
  /** @deprecated Use `mode: "external"`. Kept for back-compat. */
  forceExternal?: boolean;
  /**
   * When true, do NOT touch `hourly_snapshots` even if `today` is in the date
   * list. Used by reconciliation + Golden Sync so we preserve the genuine
   * intraday timeline that powers Pulse's "live vs live" comparison.
   */
  skipHourlySnapshots?: boolean;
  /**
   * Absolute wall-clock deadline (epoch ms). When set, the per-date fetch loop
   * stops before starting a new date once `Date.now()` reaches it, flushing
   * whatever was already fetched. Used by the cron to stay under Vercel's 300s
   * function ceiling; unset elsewhere so behaviour is unchanged.
   */
  deadlineMs?: number;
};

/**
 * For each date, fetch the Home API totals and batch-upsert into daily_home_totals.
 * Skips dates that already have a non-zero profit unless `force` is true.
 * Today AND yesterday are always re-fetched: today grows intraday, and XDash keeps
 * reattributing yesterday for several hours after midnight (this caused the
 * dashboard chart to freeze at the last intraday value while the XDash dashboard
 * and the morning summary kept showing the final, larger total).
 */
export async function syncHomeTotalsForDates(
  dates: string[],
  syncedAt: string,
  force = false,
  options?: SyncHomeTotalsOptions,
): Promise<number> {
  if (dates.length === 0) return 0;

  const today = getTodayIsrael();
  const yesterday = getYesterdayIsrael();
  let toFetch = dates;

  if (!force) {
    const existing = await getHomeDatesWithProfit(dates);
    toFetch = dates.filter((d) => d === today || d === yesterday || !existing.has(d));
    const skipped = dates.length - toFetch.length;
    if (skipped > 0) {
      syncProLog({
        event: "sync_pro.xdash_sync.home_totals.fetch_plan",
        branch_type: "xdash_sync",
        status: "ok",
        detail: {
          skipped_settled: skipped,
          today,
          yesterday,
          force,
        },
      });
    } else {
      syncProLog({
        event: "sync_pro.xdash_sync.home_totals.fetch_plan",
        branch_type: "xdash_sync",
        status: "ok",
        detail: { to_fetch: toFetch.length, today, yesterday, force },
      });
    }
  } else {
    syncProLog({
      event: "sync_pro.xdash_sync.home_totals.fetch_plan",
      branch_type: "xdash_sync",
      status: "ok",
      detail: { force: true, to_fetch: toFetch.length },
    });
  }

  if (toFetch.length === 0) return 0;

  const pending: Array<{ date: string; revenue: number; cost: number; profit: number; impressions: number; created_at: string }> = [];

  const resolvedMode: "internal" | "external" | "auto" =
    options?.mode ?? (options?.forceExternal ? "external" : "internal");

  for (let i = 0; i < toFetch.length; i++) {
    if (options?.deadlineMs != null && Date.now() >= options.deadlineMs) {
      console.log(
        `[xdash-sync] Home totals time budget reached after ${i}/${toFetch.length} date(s); flushing partial.`,
      );
      break;
    }
    const date = toFetch[i]!;
    console.log(
      `[xdash-sync] Fetching Home totals for ${date}… (mode=${resolvedMode})`,
    );
    let homeRow: { revenue: number; cost: number; profit: number; impressions: number };
    try {
      homeRow = await fetchHomeForDate(date, { mode: resolvedMode });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Previously: console.warn + continue (silent skip — the May 8 failure mode).
      // Now: emit high-priority log and re-throw so the cron health counter sees it.
      syncProLog({
        event: "sync_pro.xdash_sync.home_totals.fetch_failed",
        branch_type: "xdash_sync",
        status: "error",
        message: `Home totals fetch failed for ${date}: ${msg}`,
        detail: { date, mode: resolvedMode },
      });
      throw e instanceof Error ? e : new Error(msg);
    }

    const { revenue, cost, profit, impressions } = homeRow;
    if (revenue === 0 && cost === 0 && impressions === 0) {
      const israelHour = getIsraelHour();
      // Before 08:00 IL, "today" often legitimately reads 0 on XDASH — do not
      // page ops or fail the cron. After 08:00 (or any non-today date), zeros
      // are treated as a broken/partial response.
      if (date === today && israelHour < 8) {
        console.info(
          "[xdash-sync] Normal early morning zeros for today, skipping silently.",
          { date, israelHour },
        );
        if (i < toFetch.length - 1) {
          await new Promise((r) => setTimeout(r, INTER_BATCH_DELAY_MS));
        }
        continue;
      }
      syncProLog({
        event: "sync_pro.xdash_sync.home_totals.empty_response",
        branch_type: "xdash_sync",
        status: "error",
        message: `XDASH returned all-zero row for ${date} — refusing to silently skip (was a silent skip before May-8 fix)`,
        detail: { date, mode: resolvedMode, israelHour },
      });
      throw new Error(
        `XDASH home totals returned all-zeros for ${date} (revenue=0, cost=0, impressions=0). ` +
          `Likely a partial/empty response from the backup server — investigate before retrying.`,
      );
    }

    console.log(
      `[xdash-sync] Home → DB: ${date} revenue=$${revenue.toFixed(2)}, cost=$${cost.toFixed(2)}, profit=$${profit.toFixed(2)} (daily_home_totals.profit)`,
    );
    pending.push({ date, revenue, cost, profit, impressions, created_at: syncedAt });
    await persistHomeTotalsToLocalBackup({ date, revenue, cost, profit, impressions });

    if (i < toFetch.length - 1) {
      await new Promise((r) => setTimeout(r, INTER_BATCH_DELAY_MS));
    }
  }

  if (pending.length === 0) return 0;

  // ---------------------------------------------------------------------------
  // Smart regression guard (the May-8 fix).
  //
  // Compare every fetched row against what's already in `daily_home_totals` and
  // skip the upsert for any historical date where revenue dropped below the
  // configured threshold (default 85%). `force === true` bypasses entirely so
  // backfill-home / golden-sync can still legitimately overwrite with a lower
  // number when an operator has confirmed the new value is correct.
  // ---------------------------------------------------------------------------
  type PendingRow = (typeof pending)[number];
  const allowedRows: PendingRow[] = [];
  type BlockedRow = {
    date: string;
    new_revenue: number;
    existing_revenue: number;
    ratio_pct: number;
  };
  const blockedRows: BlockedRow[] = [];

  if (force) {
    // Backfill / golden_sync explicitly opted in. Audit-log so we can grep
    // for unexpected force-overwrites in production.
    syncProLog({
      event: "sync_pro.xdash_sync.regression_guard.bypassed",
      branch_type: "xdash_sync",
      status: "ok",
      message: "force=true → regression guard skipped",
      detail: {
        dates: pending.map((p) => p.date),
        threshold_pct: REVENUE_REGRESSION_THRESHOLD * 100,
      },
    });
    allowedRows.push(...pending);
  } else {
    const existingMap = await readExistingHomeTotals(pending.map((p) => p.date));
    for (const row of pending) {
      const existing = existingMap.get(row.date);
      const existingRev = existing?.revenue ?? 0;

      if (existingRev <= 0) {
        allowedRows.push(row);
        continue;
      }

      const ratio = row.revenue / existingRev;
      if (ratio >= REVENUE_REGRESSION_THRESHOLD) {
        allowedRows.push(row);
        continue;
      }

      if (row.date === today) {
        // Reaching here means ratio < THRESHOLD: a >15% drop on a CUMULATIVE
        // metric. That can't legitimately happen intraday — it's the partial /
        // degraded XDASH response failure mode (a present totals object with a
        // too-low revenue because only some shards answered). Block it like a
        // historical regression, but with a today-specific event so it's
        // greppable and distinguishable from a historical partial.
        blockedRows.push({
          date: row.date,
          new_revenue: row.revenue,
          existing_revenue: existingRev,
          ratio_pct: ratio * 100,
        });
        syncProLog({
          event: "sync_pro.xdash_sync.today_regression_blocked",
          branch_type: "xdash_sync",
          status: "error",
          message:
            `BLOCKED today (${row.date}): cumulative revenue dropped to ` +
            `$${row.revenue.toFixed(2)} from $${existingRev.toFixed(2)} ` +
            `(${(ratio * 100).toFixed(1)}%, threshold ${(REVENUE_REGRESSION_THRESHOLD * 100).toFixed(0)}%). ` +
            `A cumulative daily total cannot legitimately shrink this much — treating as a ` +
            `partial XDASH response and preserving the last-known-good row.`,
          detail: {
            date: row.date,
            new_revenue: row.revenue,
            existing_revenue: existingRev,
            ratio_pct: ratio * 100,
            threshold_pct: REVENUE_REGRESSION_THRESHOLD * 100,
          },
        });
        continue; // do NOT push to allowedRows
      }

      // Block: historical date with a ≥15% revenue drop and no force flag.
      blockedRows.push({
        date: row.date,
        new_revenue: row.revenue,
        existing_revenue: existingRev,
        ratio_pct: ratio * 100,
      });
      syncProLog({
        event: "sync_pro.xdash_sync.regression_blocked",
        branch_type: "xdash_sync",
        status: "error",
        message:
          `BLOCKED ${row.date}: new revenue $${row.revenue.toFixed(2)} is only ` +
          `${(ratio * 100).toFixed(1)}% of existing $${existingRev.toFixed(2)} ` +
          `(threshold ${(REVENUE_REGRESSION_THRESHOLD * 100).toFixed(0)}%). ` +
          `Likely a partial XDASH response — investigate before forcing.`,
        detail: {
          date: row.date,
          new_revenue: row.revenue,
          existing_revenue: existingRev,
          ratio_pct: ratio * 100,
          threshold_pct: REVENUE_REGRESSION_THRESHOLD * 100,
          hint:
            `Verify via /api/admin/audit-compare?startDate=${row.date}&endDate=${row.date} ` +
            `then, if the new value is genuinely correct, retry with force=true.`,
        },
      });
    }

    if (blockedRows.length > 0) {
      syncProLog({
        event: "sync_pro.xdash_sync.regression_guard.summary",
        branch_type: "xdash_sync",
        status: "error",
        message: `Regression guard blocked ${blockedRows.length}/${pending.length} date(s)`,
        detail: {
          blocked: blockedRows,
          allowed_count: allowedRows.length,
          threshold_pct: REVENUE_REGRESSION_THRESHOLD * 100,
        },
      });
    }
  }

  if (allowedRows.length === 0) {
    // Everything we fetched was blocked. Log already emitted above; return 0
    // so the caller knows nothing was written.
    return 0;
  }

  console.log(`[xdash-sync] Supabase target: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);

  const BATCH = 50;
  let written = 0;
  for (let i = 0; i < allowedRows.length; i += BATCH) {
    const chunk = allowedRows.slice(i, i + BATCH);
    const { data: returned, error } = await supabaseAdmin
      .from("daily_home_totals")
      .upsert(chunk, { onConflict: "date" })
      .select("date, revenue, cost, profit, impressions");
    if (error) {
      console.error("DATABASE ERROR:", error);
      throw error;
    }
    written += chunk.length;

    // Log a sample row from each batch so we can verify what Supabase actually stored
    const sample = (returned ?? []).find((r: { date: string }) => r.date === "2026-01-01")
      ?? (returned ?? [])[0];
    if (sample) {
      console.log(`[xdash-sync] DB returned sample:`, JSON.stringify(sample));
    }
  }

  syncProLog({
    event: "sync_pro.xdash_sync.daily_home_totals.upserted",
    branch_type: "xdash_sync",
    status: "ok",
    detail: {
      written,
      fetched_dates: pending.length,
      allowed_dates: allowedRows.length,
      blocked_dates: blockedRows.length,
    },
  });

  // Final read-back for 2026-01-01 to confirm what the DB actually holds
  const { data: proof, error: proofErr } = await supabaseAdmin
    .from("daily_home_totals")
    .select("date, revenue, cost, profit, impressions, created_at")
    .eq("date", "2026-01-01")
    .maybeSingle();
  if (proofErr) {
    console.error("[xdash-sync] Read-back failed:", proofErr);
  } else {
    console.log(`[xdash-sync] READ-BACK 2026-01-01:`, JSON.stringify(proof));
  }

  // Always record an hourly snapshot for today on every successful sync. This
  // is what `getComparisonData` reads to render "live vs live" without an
  // asterisk — fire-and-forget here used to mean cron runs sometimes finished
  // before the snapshot landed and the dashboard showed an estimate. Awaiting
  // costs ~1 round-trip (<200ms) and is cheap relative to the XDASH fetches.
  //
  // Reconciliation / Golden Sync pass `skipHourlySnapshots: true` so the
  // intraday Pulse timeline is preserved exactly as it happened in real time —
  // overwriting it with the finalised day-end number would erase the pre-noon
  // "live vs live" comparison.
  if (options?.skipHourlySnapshots) {
    syncProLog({
      event: "sync_pro.xdash_sync.hourly_snapshot.skipped",
      branch_type: "xdash_sync",
      status: "ok",
      message: "skipHourlySnapshots=true (reconciliation / golden_sync) — preserving intraday timeline",
      detail: { today, dates },
    });
    return written;
  }

  const todayEntry = allowedRows.find((r) => r.date === today);
  if (todayEntry) {
    const hour = getIsraelHour();
    const { error: snapErr } = await supabaseAdmin
      .from("hourly_snapshots")
      .upsert(
        {
          date: todayEntry.date,
          hour,
          revenue: todayEntry.revenue,
          cost: todayEntry.cost,
          profit: todayEntry.profit,
          impressions: todayEntry.impressions,
        },
        { onConflict: "date,hour" },
      );
    if (snapErr) {
      syncProLog({
        event: "sync_pro.xdash_sync.hourly_snapshot.upsert_failed",
        branch_type: "xdash_sync",
        status: "error",
        message: snapErr.message,
        detail: { date: todayEntry.date, hour },
      });
    } else {
      syncProLog({
        event: "sync_pro.xdash_sync.hourly_snapshot.recorded",
        branch_type: "xdash_sync",
        status: "ok",
        detail: {
          date: todayEntry.date,
          hour,
          revenue: todayEntry.revenue,
          profit: todayEntry.profit,
        },
      });
    }
  } else {
    syncProLog({
      event: "sync_pro.xdash_sync.hourly_snapshot.skipped",
      branch_type: "xdash_sync",
      status: "ok",
      message: "no today row in pending — pulse may show estimate until next sync",
      detail: { today },
    });
  }

  return written;
}

export interface SyncXDASHResult {
  datesSynced: number;
  rowsUpserted: number;
  /** Count of rows written to `daily_home_totals` during this run. Optional for back-compat. */
  homeRowsWritten?: number;
}

/** Pulse comparisons only need 28 days of history; older snapshots are dead weight. */
const HOURLY_SNAPSHOT_RETENTION_DAYS = 28;

/**
 * Delete `hourly_snapshots` rows older than the retention window (28 days).
 * Date arithmetic is in Israel calendar to match how snapshot dates are stored.
 * Safe to call repeatedly; never throws (logs and returns 0 on failure).
 */
export async function purgeOldHourlySnapshots(): Promise<number> {
  const today = getTodayIsrael();
  const [y, m, d] = today.split("-").map(Number);
  const cutoff = new Date(Date.UTC(y!, m! - 1, d!));
  cutoff.setUTCDate(cutoff.getUTCDate() - HOURLY_SNAPSHOT_RETENTION_DAYS);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const { error, count } = await supabaseAdmin
    .from("hourly_snapshots")
    .delete({ count: "exact" })
    .lt("date", cutoffIso);

  if (error) {
    console.warn(`[xdash-sync] hourly_snapshots purge failed (non-fatal):`, error.message);
    return 0;
  }
  console.log(
    `[xdash-sync] hourly_snapshots purge: removed ${count ?? 0} rows older than ${cutoffIso} (retention=${HOURLY_SNAPSHOT_RETENTION_DAYS}d)`,
  );
  return count ?? 0;
}

/**
 * Incremental home-totals sync with catch-up so every day from the 1st is synced.
 *
 *  - Catch-up: current-month dates missing from `daily_home_totals`.
 *  - Always re-fetches today AND yesterday (rolling 2-day window).
 *  - Partner demand/supply fetches are no longer performed.
 *
 * Historical backfills: use syncXDASHDataForMonth() via the CLI script.
 */
export async function syncXDASHData(
  options?: { deadlineMs?: number },
): Promise<SyncXDASHResult> {
  const now = new Date();
  const syncedAt = now.toISOString();
  const today = getTodayIsrael();
  const yesterday = getYesterdayIsrael();
  const allDatesThisMonth = datesFromMonthStartThroughToday(now);
  if (allDatesThisMonth.length === 0) {
    return { datesSynced: 0, rowsUpserted: 0 };
  }

  const alreadySynced = await getDatesAlreadySynced(allDatesThisMonth);
  const toFetchSet = new Set<string>(
    allDatesThisMonth.filter((d) => !alreadySynced.has(d)),
  );
  toFetchSet.add(today);
  toFetchSet.add(yesterday);
  const toFetch = Array.from(toFetchSet);
  prioritizeLiveWindow(toFetch, today, yesterday);

  if (toFetch.length === 0) {
    return { datesSynced: 0, rowsUpserted: 0 };
  }

  console.log(`[xdash-sync] Home-totals sync (catch-up + today): ${toFetch.join(", ")}`);
  const homeRowsWritten = await syncHomeTotalsForDates(toFetch, syncedAt, false, {
    deadlineMs: options?.deadlineMs,
  });

  await purgeOldHourlySnapshots();

  return { datesSynced: toFetch.length, rowsUpserted: 0, homeRowsWritten };
}

const DEFAULT_TIME_BUDGET_MS = 45_000;

/**
 * Auto-sync: re-fetches Home totals for the last N days (default 2 = today + yesterday).
 * Respects a time budget so we don't hit Vercel's function ceiling.
 */
export async function syncXDASHDataLastNDays(
  n = 2,
  options?: { startTime?: number; timeBudgetMs?: number; force?: boolean },
): Promise<SyncXDASHResult> {
  const syncedAt = new Date().toISOString();
  const dates = lastNDaysIsrael(n);
  if (dates.length === 0) {
    return { datesSynced: 0, rowsUpserted: 0 };
  }

  const startTime = options?.startTime ?? Date.now();
  const timeBudgetMs = options?.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const deadlineMs = startTime + timeBudgetMs;

  console.log(
    `[xdash-sync] Home-totals ${n}-day sync: ${dates.join(", ")} (time budget ${timeBudgetMs / 1000}s)`,
  );
  const homeRowsWritten = await syncHomeTotalsForDates(dates, syncedAt, options?.force, {
    deadlineMs,
  });
  return { datesSynced: dates.length, rowsUpserted: 0, homeRowsWritten };
}

/**
 * Sync Home totals for an explicit list of dates (home-totals only).
 *
 * Sync-Pro extras:
 *   - `mode` / `forceExternal` / `skipHourlySnapshots` — passed through to syncHomeTotalsForDates.
 *   - `skipPartnerPerformance` — no-op (partner writes are gone; kept for call-site back-compat).
 */
export async function syncXDASHDataForDates(
  dates: string[],
  options?: {
    force?: boolean;
    mode?: "internal" | "external" | "auto";
    /** @deprecated Use `mode: "external"`. */
    forceExternal?: boolean;
    skipHourlySnapshots?: boolean;
    /** @deprecated Partner performance sync removed; ignored. */
    skipPartnerPerformance?: boolean;
  },
): Promise<SyncXDASHResult> {
  if (dates.length === 0) {
    return { datesSynced: 0, rowsUpserted: 0 };
  }
  const syncedAt = new Date().toISOString();
  console.log(`[xdash-sync] Home-totals sync ${dates.length} date(s): ${dates.join(", ")}`);

  const homeRowsWritten = await syncHomeTotalsForDates(dates, syncedAt, options?.force, {
    mode: options?.mode,
    forceExternal: options?.forceExternal,
    skipHourlySnapshots: options?.skipHourlySnapshots,
  });
  return { datesSynced: dates.length, rowsUpserted: 0, homeRowsWritten };
}

/**
 * Full backfill of daily_home_totals for [startDate, endDate] (inclusive).
 * Forces overwrite of existing home rows. Does not write partner performance.
 */
export async function syncXDASHBackfill(
  startDate: string,
  endDate: string,
): Promise<SyncXDASHResult> {
  const syncedAt = new Date().toISOString();
  const dates = dateRange(startDate, endDate);
  if (dates.length === 0) {
    return { datesSynced: 0, rowsUpserted: 0 };
  }

  console.log(`[xdash-sync] HOME BACKFILL ${startDate} → ${endDate} (${dates.length} days)`);
  const homeRowsWritten = await syncHomeTotalsForDates(dates, syncedAt, true);
  return { datesSynced: dates.length, rowsUpserted: 0, homeRowsWritten };
}

/**
 * Sync Home totals for a specific month: all days from 1 through end of month,
 * or through yesterday if that month is the current month.
 */
export async function syncXDASHDataForMonth(
  year: number,
  month: number,
  options?: { force?: boolean },
): Promise<SyncXDASHResult> {
  const syncedAt = new Date().toISOString();
  const dates = datesForMonth(year, month);
  console.log(`[xdash-sync] Home-totals month sync ${year}-${String(month).padStart(2, "0")}: ${dates.length} day(s)`);
  const homeRowsWritten = await syncHomeTotalsForDates(dates, syncedAt, options?.force);
  return { datesSynced: dates.length, rowsUpserted: 0, homeRowsWritten };
}
