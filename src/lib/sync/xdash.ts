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
import { supabaseAdmin } from "@/lib/supabase";

const TABLE = "daily_partner_performance";
const BATCH_UPSERT_SIZE = 2000;
const TIMEZONE_ISRAEL = "Asia/Jerusalem";

/** Process one date at a time — the backup server is very weak. */
const FETCH_BATCH_SIZE = 1;
/** Delay between fetch batches to give the backup server breathing room. */
const INTER_BATCH_DELAY_MS = 5000;

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
    if (error) throw new Error(`XDASH upsert failed: ${error.message}`);
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

/**
 * For each date, fetch the Home API totals (revenue/cost/impressions) and
 * upsert into daily_home_totals. This is the source of truth for Financial
 * dashboard cards, Daily Progress chart, and Pacing.
 * Processes sequentially with delays to protect the backup server.
 */
async function syncHomeTotalsForDates(dates: string[], syncedAt: string): Promise<number> {
  if (dates.length === 0) return 0;
  let written = 0;
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i]!;
    try {
      console.log(`[xdash-sync] Fetching Home totals for ${date}…`);
      const { revenue, cost, impressions } = await fetchHomeForDate(date);
      if (revenue === 0 && cost === 0 && impressions === 0) {
        console.warn(`[xdash-sync] Home returned zeros for ${date} — skipping upsert`);
        continue;
      }
      const { error } = await supabaseAdmin
        .from(HOME_TABLE)
        .upsert(
          { date, revenue, cost, impressions, created_at: syncedAt },
          { onConflict: "date" },
        );
      if (error) {
        console.error(`[xdash-sync] Home upsert failed for ${date}:`, error.message);
      } else {
        console.log(`[xdash-sync] Home totals ${date}: revenue=$${revenue.toFixed(2)}, cost=$${cost.toFixed(2)}`);
        written++;
      }
    } catch (e) {
      console.warn(`[xdash-sync] Home fetch failed for ${date} (non-fatal):`, e instanceof Error ? e.message : e);
    }
    if (i < dates.length - 1) {
      await new Promise((r) => setTimeout(r, INTER_BATCH_DELAY_MS));
    }
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

  // Fetch Home API totals per date → daily_home_totals (source of truth for Financial screen)
  await syncHomeTotalsForDates(toFetch, syncedAt);
  return { datesSynced: toFetch.length, rowsUpserted };
}

/**
 * Auto-sync: always re-fetches the last 7 days (today through 6 days ago).
 * Does NOT skip "already synced" dates — XDASH adjusts past-day numbers,
 * so we always overwrite with the latest values to prevent stale data.
 */
export async function syncXDASHDataLast7Days(): Promise<SyncXDASHResult> {
  const syncedAt = new Date().toISOString();
  const dates = lastNDaysIsrael(7);
  if (dates.length === 0) {
    return { datesSynced: 0, rowsUpserted: 0 };
  }

  console.log(`[xdash-sync] 7-day sync (always re-fetch): ${dates.join(", ")}`);
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

  await syncHomeTotalsForDates(dates, syncedAt);
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

  await syncHomeTotalsForDates(dates, syncedAt);
  return { datesSynced: dates.length, rowsUpserted };
}

/**
 * Sync XDASH data for a specific month: all days from 1 through end of month,
 * or through yesterday if that month is the current month.
 */
export async function syncXDASHDataForMonth(
  year: number,
  month: number
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

  // Fetch Home API totals per date → daily_home_totals
  await syncHomeTotalsForDates(dates, syncedAt);

  return { datesSynced: dates.length, rowsUpserted };
}
