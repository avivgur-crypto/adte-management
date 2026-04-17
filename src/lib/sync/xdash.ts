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
  dates: string[]
): Promise<{ date: string; demand: PartnerRow[]; supply: PartnerRow[] }[]> {
  const results: { date: string; demand: PartnerRow[]; supply: PartnerRow[] }[] = [];
  for (let i = 0; i < dates.length; i += FETCH_BATCH_SIZE) {
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

/**
 * For each date, fetch the Home API totals and batch-upsert into daily_home_totals.
 * Skips dates that already have a non-zero profit unless `force` is true.
 * Today is always re-fetched (intraday data grows throughout the day).
 */
export async function syncHomeTotalsForDates(
  dates: string[],
  syncedAt: string,
  force = false,
): Promise<number> {
  if (dates.length === 0) return 0;

  const today = getTodayIsrael();
  let toFetch = dates;

  if (!force) {
    const existing = await getHomeDatesWithProfit(dates);
    toFetch = dates.filter((d) => d === today || !existing.has(d));
    const skipped = dates.length - toFetch.length;
    if (skipped > 0) {
      console.log(`[xdash-sync] Skipping ${skipped} date(s) with existing profit data (use force=true to override)`);
    }
  }

  if (toFetch.length === 0) return 0;

  const pending: Array<{ date: string; revenue: number; cost: number; profit: number; impressions: number; created_at: string }> = [];

  for (let i = 0; i < toFetch.length; i++) {
    const date = toFetch[i]!;
    try {
      console.log(`[xdash-sync] Fetching Home totals for ${date}…`);
      const { revenue, cost, profit, impressions } = await fetchHomeForDate(date);
      if (revenue === 0 && cost === 0 && impressions === 0) {
        console.warn(`[xdash-sync] Home returned zeros for ${date} — skipping`);
        continue;
      }
      console.log(`[xdash-sync] Home → DB: ${date} revenue=$${revenue.toFixed(2)}, cost=$${cost.toFixed(2)}, profit=$${profit.toFixed(2)} (daily_home_totals.profit)`);
      pending.push({ date, revenue, cost, profit, impressions, created_at: syncedAt });
      await persistHomeTotalsToLocalBackup({ date, revenue, cost, profit, impressions });
    } catch (e) {
      console.warn(`[xdash-sync] Home fetch failed for ${date} (non-fatal):`, e instanceof Error ? e.message : e);
    }
    if (i < toFetch.length - 1) {
      await new Promise((r) => setTimeout(r, INTER_BATCH_DELAY_MS));
    }
  }

  if (pending.length === 0) return 0;

  console.log(`[xdash-sync] Supabase target: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);

  const BATCH = 50;
  let written = 0;
  for (let i = 0; i < pending.length; i += BATCH) {
    const chunk = pending.slice(i, i + BATCH);
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

  // Additive: record an hourly snapshot for today (fire-and-forget).
  const todayEntry = pending.find((r) => r.date === today);
  if (todayEntry) {
    const hour = getIsraelHour();
    supabaseAdmin
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
      )
      .then(({ error: snapErr }) => {
        if (snapErr) {
          console.warn(`[xdash-sync] hourly snapshot (${todayEntry.date} h${hour}) failed:`, snapErr.message);
        } else {
          console.log(`[xdash-sync] hourly snapshot ${todayEntry.date} h${hour} recorded`);
        }
      });
  }

  return written;
}

export interface SyncXDASHResult {
  datesSynced: number;
  rowsUpserted: number;
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
export async function syncXDASHData(): Promise<SyncXDASHResult> {
  const now = new Date();
  const syncedAt = now.toISOString();
  const today = getTodayIsrael();
  const allDatesThisMonth = datesFromMonthStartThroughToday(now);
  if (allDatesThisMonth.length === 0) {
    return { datesSynced: 0, rowsUpserted: 0 };
  }

  const alreadySynced = await getDatesAlreadySynced(allDatesThisMonth);
  const toFetch = allDatesThisMonth.filter((d) => !alreadySynced.has(d) || d === today);
  toFetch.sort();

  if (toFetch.length === 0) {
    return { datesSynced: 0, rowsUpserted: 0 };
  }

  console.log(`[xdash-sync] Sync (catch-up + today): ${toFetch.join(", ")}`);
  const dayResults = await fetchDatesInBatches(toFetch);
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

  await syncHomeTotalsForDates(toFetch, syncedAt);
  return { datesSynced: toFetch.length, rowsUpserted };
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
 */
export async function syncXDASHDataForDates(
  dates: string[],
  options?: { force?: boolean },
): Promise<SyncXDASHResult> {
  if (dates.length === 0) {
    return { datesSynced: 0, rowsUpserted: 0 };
  }
  const syncedAt = new Date().toISOString();
  console.log(`[xdash-sync] Sync ${dates.length} date(s): ${dates.join(", ")}`);
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
  const rowsUpserted = await batchUpsert(records);
  await syncHomeTotalsForDates(dates, syncedAt, options?.force);
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

  // Backfill always forces re-fetch of home totals
  await syncHomeTotalsForDates(dates, syncedAt, true);
  return { datesSynced: dates.length, rowsUpserted };
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
