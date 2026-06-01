import fs from "node:fs/promises";
import path from "node:path";

/**
 * XDASH sync: demand & supply partner data → daily_partner_performance.
 * Fetches BOTH demand (revenue) and supply (cost) partners so revenue and cost are captured.
 *
 * After partner-level sync, ONE Home API call per synced month stores the
 * accurate monthly totals (partner_name = '__XDASH_MONTHLY_TOTAL__').
 * The Partners API misses ~5% of revenue/cost that isn't attributed to a
 * specific partner, so the Home total is used for dashboard display.
 *
 * Uses small-batch sequential fetching to avoid overloading the backup server.
 */

import {
  fetchDemandPartners,
  fetchSupplyPartners,
  fetchReportForDate,
  fetchAdServerOverview,
  fetchHomeForDate,
  mapDemandPartners,
  mapSupplyPartners,
  useReportsForSync,
  type PartnerRow,
} from "@/lib/xdash-client";
import type { PostgrestError } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";
import { getIsraelHour } from "@/lib/israel-date";
import { syncProLog } from "@/lib/sync-pro-log";

const TABLE = "daily_partner_performance";

/**
 * If Supabase rejected an upsert (RLS, missing constraint keys, FK, etc.),
 * log full details and throw so the sync stops instead of reporting success.
 */
function assertNoUpsertError(context: string, error: PostgrestError | null): asserts error is null {
  if (!error) return;
  console.error(`[xdash-sync] ${context}`, {
    message: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint,
  });
  throw new Error(`${context}: ${error.message}`);
}
const BATCH_UPSERT_SIZE = 2000;
const TIMEZONE_ISRAEL = "Asia/Jerusalem";

/** Process one date at a time — the backup server is weak. */
const FETCH_BATCH_SIZE = 1;
/** Delay between fetch batches (reduced from 5s; throttle in xdash-client protects the server). */
const INTER_BATCH_DELAY_MS = 2000;

/**
 * Smart regression guard — prevent a partial XDASH response from silently
 * stomping on a previously-correct historical row (the May 8 failure mode).
 *
 * Rule (applied per-date inside `syncHomeTotalsForDates`):
 *   - If `force === true` → bypass entirely (backfill / golden_sync explicitly opt in).
 *   - If existing.revenue == 0 → allow (new date or never-synced).
 *   - If new.revenue ≥ existing.revenue × THRESHOLD → allow (covers growth + small clawbacks).
 *   - If new.revenue <  existing.revenue × THRESHOLD AND date === today → allow (intraday quirk),
 *     but emit a soft `today_dip` log so we can see it.
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
 * Return the set of dates that already have at least one row in daily_partner_performance.
 */
async function getDatesAlreadySynced(dates: string[]): Promise<Set<string>> {
  if (dates.length === 0) return new Set();
  const { data, error } = await supabaseAdmin
    .from(TABLE)
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

function rowToRecord(
  date: string,
  partnerType: "demand" | "supply",
  r: PartnerRow,
  syncedAt: string,
): Record<string, unknown> {
  return {
    date,
    partner_name: r.name,
    partner_type: partnerType,
    revenue: r.revenue,
    cost: r.cost,
    impressions: r.impressions,
    created_at: syncedAt,
  };
}

/**
 * Fetch demand + supply for one date.
 * For today: always use /partners/demand|supply/overview (real-time intraday data).
 * For past dates: uses Reports API when XDASH_USE_REPORTS=true (lighter, one call).
 */
async function fetchDay(
  date: string
): Promise<{ date: string; demand: PartnerRow[]; supply: PartnerRow[] }> {
  const isToday = date === getTodayIsrael();

  if (useReportsForSync() && !isToday) {
    const { demand, supply } = await fetchReportForDate(date);
    return { date, demand, supply };
  }

  if (isToday) {
    console.log(`[xdash-sync] Using Partners endpoints for today (${date}) — live intraday data`);
  }
  const demandRaw = await fetchDemandPartners(date);
  const supplyRaw = await fetchSupplyPartners(date);
  return {
    date,
    demand: mapDemandPartners(demandRaw),
    supply: mapSupplyPartners(supplyRaw),
  };
}

/** Deduplicate by (date, partner_name, partner_type), summing revenue/cost/impressions. */
function aggregateRecords(records: Record<string, unknown>[]): Record<string, unknown>[] {
  const map = new Map<string, { date: string; partner_name: string; partner_type: string; revenue: number; cost: number; impressions: number; created_at: string }>();
  for (const r of records) {
    const key = `${String(r.date)}\u0001${String(r.partner_name)}\u0001${String(r.partner_type)}`;
    const rev = Number(r.revenue ?? 0);
    const cost = Number(r.cost ?? 0);
    const imp = Number(r.impressions ?? 0);
    const ca = String(r.created_at ?? new Date().toISOString());
    const existing = map.get(key);
    if (existing) {
      existing.revenue += rev;
      existing.cost += cost;
      existing.impressions += imp;
    } else {
      map.set(key, {
        date: String(r.date),
        partner_name: String(r.partner_name),
        partner_type: String(r.partner_type),
        revenue: rev,
        cost,
        impressions: imp,
        created_at: ca,
      });
    }
  }
  return Array.from(map.values());
}

/** Perform batch upsert in chunks to stay under payload limits. Deduplicates first to avoid ON CONFLICT row twice. */
async function batchUpsert(records: Record<string, unknown>[]): Promise<number> {
  if (records.length === 0) return 0;
  const unique = aggregateRecords(records);
  let total = 0;
  for (let i = 0; i < unique.length; i += BATCH_UPSERT_SIZE) {
    const chunk = unique.slice(i, i + BATCH_UPSERT_SIZE);
    const { error } = await supabaseAdmin
      .from(TABLE)
      .upsert(chunk, { onConflict: "date,partner_name,partner_type" });
    assertNoUpsertError(
      `Upsert to ${TABLE} failed (${chunk.length} rows, batch ${Math.floor(i / BATCH_UPSERT_SIZE) + 1})`,
      error,
    );
    total += chunk.length;
  }
  return total;
}

/**
 * Process dates in small batches to avoid overwhelming the backup server.
 * Each batch fetches FETCH_BATCH_SIZE dates, then waits INTER_BATCH_DELAY_MS.
 */
async function fetchDatesInBatches(
  dates: string[],
  deadlineMs?: number,
): Promise<{ date: string; demand: PartnerRow[]; supply: PartnerRow[] }[]> {
  const results: { date: string; demand: PartnerRow[]; supply: PartnerRow[] }[] = [];
  for (let i = 0; i < dates.length; i += FETCH_BATCH_SIZE) {
    if (deadlineMs != null && Date.now() >= deadlineMs) {
      console.log(
        `[xdash-sync] Time budget reached; stopping with ${results.length}/${dates.length} date(s) fetched.`,
      );
      break;
    }
    const batch = dates.slice(i, i + FETCH_BATCH_SIZE);
    console.log(`[xdash-sync] Fetching batch ${Math.floor(i / FETCH_BATCH_SIZE) + 1} (${batch.join(", ")}) …`);
    const batchResults = await Promise.all(batch.map((date) => fetchDay(date)));
    results.push(...batchResults);
    if (i + FETCH_BATCH_SIZE < dates.length) {
      await new Promise((r) => setTimeout(r, INTER_BATCH_DELAY_MS));
    }
  }
  return results;
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
        // Today legitimately can't shrink (cumulative), but if it ever does we
        // allow + log soft so the chart doesn't freeze on an old intraday read.
        syncProLog({
          event: "sync_pro.xdash_sync.regression_guard.today_dip",
          branch_type: "xdash_sync",
          status: "ok",
          message:
            `Today (${row.date}) revenue dipped vs prior intraday read: ` +
            `$${row.revenue.toFixed(2)} vs $${existingRev.toFixed(2)} ` +
            `(${(ratio * 100).toFixed(1)}%)`,
          detail: {
            date: row.date,
            new_revenue: row.revenue,
            existing_revenue: existingRev,
            ratio_pct: ratio * 100,
          },
        });
        allowedRows.push(row);
        continue;
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
 * Incremental sync with catch-up so every day from the 1st is synced, daily and in order.
 *
 *  - Fetches all dates from 1st of current month through today that are missing in the DB.
 *  - Always re-fetches today (data grows throughout the day).
 *  - Ensures March 1, March 2, etc. are never skipped (e.g. if cron missed a run).
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
  const toFetch = allDatesThisMonth.filter((d) => !alreadySynced.has(d) || d === today);
  // Live window first (today, yesterday), then older catch-up dates ascending —
  // so a tight cron budget never starves the dashboard-critical dates.
  prioritizeLiveWindow(toFetch, today, yesterday);

  if (toFetch.length === 0) {
    return { datesSynced: 0, rowsUpserted: 0 };
  }

  console.log(`[xdash-sync] Sync (catch-up + today): ${toFetch.join(", ")}`);
  const dayResults = await fetchDatesInBatches(toFetch, options?.deadlineMs);
  // Only the dates we actually fetched before the budget ran out — the rest
  // drain on the next cron run (catch-up is idempotent / skips synced dates).
  const fetchedDates = dayResults.map((d) => d.date);
  const records: Record<string, unknown>[] = [];
  for (const { date, demand, supply } of dayResults) {
    if (demand.length === 0 && supply.length === 0) {
      console.warn(`[xdash-sync] No data returned for ${date} — XDASH may not have this date yet`);
    } else {
      console.log(`[xdash-sync] ${date}: ${demand.length} demand + ${supply.length} supply rows`);
    }
    for (const r of demand) records.push(rowToRecord(date, "demand", r, syncedAt));
    for (const r of supply) records.push(rowToRecord(date, "supply", r, syncedAt));
  }
  const rowsUpserted = await batchUpsert(records);

  await syncHomeTotalsForDates(fetchedDates, syncedAt, false, {
    deadlineMs: options?.deadlineMs,
  });

  // Daily housekeeping: drop hourly_snapshots older than the retention window.
  // syncXDASHData runs once per day from /api/cron/sync, so this fires once a day.
  await purgeOldHourlySnapshots();

  return { datesSynced: fetchedDates.length, rowsUpserted };
}

const DEFAULT_TIME_BUDGET_MS = 45_000;

/**
 * Auto-sync: re-fetches the last N days (default 2 = today + yesterday).
 * Processes days sequentially. If startTime + timeBudgetMs is set and elapsed
 * reaches the budget (e.g. 45s), stops and saves what we have so we don't hit Vercel's 60s limit.
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

  console.log(`[xdash-sync] ${n}-day sync (always re-fetch): ${dates.join(", ")} (time budget ${timeBudgetMs / 1000}s)`);
  const dayResults: { date: string; demand: PartnerRow[]; supply: PartnerRow[] }[] = [];

  for (let i = 0; i < dates.length; i++) {
    if (Date.now() - startTime >= timeBudgetMs) {
      console.log(`[xdash-sync] Time budget reached after ${i} day(s), stopping.`);
      break;
    }
    const date = dates[i]!;
    try {
      const result = await fetchDay(date);
      dayResults.push(result);
      if (result.demand.length === 0 && result.supply.length === 0) {
        console.warn(`[xdash-sync] No data returned for ${date}`);
      } else {
        console.log(`[xdash-sync] ${date}: ${result.demand.length} demand + ${result.supply.length} supply rows`);
      }
    } catch (e) {
      console.warn(`[xdash-sync] Failed for ${date} (skipping):`, e instanceof Error ? e.message : e);
    }
    if (i < dates.length - 1) {
      await new Promise((r) => setTimeout(r, INTER_BATCH_DELAY_MS));
    }
  }

  const records: Record<string, unknown>[] = [];
  for (const { date, demand, supply } of dayResults) {
    for (const r of demand) records.push(rowToRecord(date, "demand", r, syncedAt));
    for (const r of supply) records.push(rowToRecord(date, "supply", r, syncedAt));
  }
  const rowsUpserted = records.length > 0 ? await batchUpsert(records) : 0;
  const syncedDates = dayResults.map((d) => d.date);
  if (syncedDates.length > 0) {
    await syncHomeTotalsForDates(syncedDates, syncedAt, options?.force);
  }
  return { datesSynced: syncedDates.length, rowsUpserted };
}

/**
 * Sync XDASH for an explicit list of dates (e.g. a single date for chunked client-side sync).
 * Same logic as syncXDASHDataLastNDays but with a given date array.
 *
 * Sync-Pro extras (all default false / `mode: "internal"` → behaviour unchanged):
 *   - `mode`: source for `daily_home_totals` fetches. Default `"internal"` →
 *     cookie path / UI parity. `"external"` → External Report API. `"auto"` →
 *     legacy hybrid.
 *   - `forceExternal` (deprecated): equivalent to `mode: "external"`.
 *   - `skipHourlySnapshots`: leave `hourly_snapshots` untouched so the intraday
 *     Pulse timeline is preserved.
 *   - `skipPartnerPerformance`: skip the demand/supply batch fetch + upsert
 *     entirely. Useful for reconciliation jobs that only need finalized
 *     `daily_home_totals` and don't want to repaint partner-level data.
 */
export async function syncXDASHDataForDates(
  dates: string[],
  options?: {
    force?: boolean;
    mode?: "internal" | "external" | "auto";
    /** @deprecated Use `mode: "external"`. */
    forceExternal?: boolean;
    skipHourlySnapshots?: boolean;
    skipPartnerPerformance?: boolean;
  },
): Promise<SyncXDASHResult> {
  if (dates.length === 0) {
    return { datesSynced: 0, rowsUpserted: 0 };
  }
  const syncedAt = new Date().toISOString();
  console.log(`[xdash-sync] Sync ${dates.length} date(s): ${dates.join(", ")}`);

  let rowsUpserted = 0;
  if (!options?.skipPartnerPerformance) {
    const dayResults = await fetchDatesInBatches(dates);
    const records: Record<string, unknown>[] = [];
    for (const { date, demand, supply } of dayResults) {
      if (demand.length === 0 && supply.length === 0) {
        console.warn(`[xdash-sync] No data returned for ${date}`);
      } else {
        console.log(`[xdash-sync] ${date}: ${demand.length} demand + ${supply.length} supply rows`);
      }
      for (const r of demand) records.push(rowToRecord(date, "demand", r, syncedAt));
      for (const r of supply) records.push(rowToRecord(date, "supply", r, syncedAt));
    }
    rowsUpserted = await batchUpsert(records);
  }

  await syncHomeTotalsForDates(dates, syncedAt, options?.force, {
    mode: options?.mode,
    forceExternal: options?.forceExternal,
    skipHourlySnapshots: options?.skipHourlySnapshots,
  });
  return { datesSynced: dates.length, rowsUpserted };
}

/**
 * Full backfill: fetches ALL dates from startDate through endDate (inclusive)
 * and upserts into both daily_partner_performance and daily_home_totals.
 * No skipping — every date is re-fetched and overwritten.
 * Use via ?backfill=true on auto-sync or the CLI script.
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

  console.log(`[xdash-sync] BACKFILL ${startDate} → ${endDate} (${dates.length} days)`);
  const dayResults = await fetchDatesInBatches(dates);
  const records: Record<string, unknown>[] = [];
  for (const { date, demand, supply } of dayResults) {
    if (demand.length === 0 && supply.length === 0) {
      console.warn(`[xdash-sync] Backfill: no data for ${date}`);
    } else {
      console.log(`[xdash-sync] Backfill ${date}: ${demand.length} demand + ${supply.length} supply`);
    }
    for (const r of demand) records.push(rowToRecord(date, "demand", r, syncedAt));
    for (const r of supply) records.push(rowToRecord(date, "supply", r, syncedAt));
  }
  const rowsUpserted = await batchUpsert(records);

  // Backfill always forces re-fetch of home totals (overrides the "skip if profit != 0" optimization)
  const homeRowsWritten = await syncHomeTotalsForDates(dates, syncedAt, true);
  return { datesSynced: dates.length, rowsUpserted, homeRowsWritten };
}

/**
 * Sync XDASH data for a specific month: all days from 1 through end of month,
 * or through yesterday if that month is the current month.
 */
export async function syncXDASHDataForMonth(
  year: number,
  month: number,
  options?: { force?: boolean },
): Promise<SyncXDASHResult> {
  const syncedAt = new Date().toISOString();
  const dates = datesForMonth(year, month);
  const dayResults = await fetchDatesInBatches(dates);
  const records: Record<string, unknown>[] = [];
  for (const { date, demand, supply } of dayResults) {
    for (const r of demand) records.push(rowToRecord(date, "demand", r, syncedAt));
    for (const r of supply) records.push(rowToRecord(date, "supply", r, syncedAt));
  }
  const rowsUpserted = await batchUpsert(records);

  await syncHomeTotalsForDates(dates, syncedAt, options?.force);

  return { datesSynced: dates.length, rowsUpserted };
}
