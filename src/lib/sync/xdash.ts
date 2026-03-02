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
  mapDemandPartners,
  mapSupplyPartners,
  useReportsForSync,
  type PartnerRow,
} from "@/lib/xdash-client";
import { supabaseAdmin } from "@/lib/supabase";

const TABLE = "daily_partner_performance";
const BATCH_UPSERT_SIZE = 2000;

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

function getYesterday(now: Date): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return d;
}

function datesFromMonthStartThroughYesterday(): string[] {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const yesterday = getYesterday(now);
  if (firstOfMonth > yesterday) return [];
  const out: string[] = [];
  const cur = new Date(firstOfMonth);
  while (cur <= yesterday) {
    out.push(formatLocalDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
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
  r: PartnerRow
): Record<string, unknown> {
  return {
    date,
    partner_name: r.name,
    partner_type: partnerType,
    revenue: r.revenue,
    cost: r.cost,
    impressions: r.impressions,
  };
}

/** Fetch demand + supply for one date. Uses Reports API (one call) when XDASH_USE_REPORTS=true, else partners/demand + partners/supply. */
async function fetchDay(
  date: string
): Promise<{ date: string; demand: PartnerRow[]; supply: PartnerRow[] }> {
  if (useReportsForSync()) {
    const { demand, supply } = await fetchReportForDate(date);
    return { date, demand, supply };
  }
  const demandRaw = await fetchDemandPartners(date);
  const supplyRaw = await fetchSupplyPartners(date);
  return {
    date,
    demand: mapDemandPartners(demandRaw),
    supply: mapSupplyPartners(supplyRaw),
  };
}

/** Perform batch upsert in chunks to stay under payload limits. */
async function batchUpsert(records: Record<string, unknown>[]): Promise<number> {
  if (records.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < records.length; i += BATCH_UPSERT_SIZE) {
    const chunk = records.slice(i, i + BATCH_UPSERT_SIZE);
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

const MONTHLY_TOTAL_PARTNER = "__XDASH_MONTHLY_TOTAL__";

/**
 * Fetch the Home API total for a month and upsert as a special row.
 * Uses date = first day of month so _getMonthlyXDASHTotals can pick it up.
 * ONE API call per month — lightweight compared to per-day fetching.
 */
async function syncMonthlyTotal(year: number, month: number): Promise<void> {
  const firstDay = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0);
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;

  console.log(`[xdash-sync] Fetching Home total for ${firstDay} → ${endDate} …`);
  try {
    const raw = await fetchAdServerOverview({ startDate: firstDay, endDate });
    const sd = (raw as Record<string, unknown>).overviewTotals as Record<string, unknown> | undefined;
    const totals = (sd?.selectedDates as Record<string, unknown> | undefined)?.totals as
      | { revenue?: number; cost?: number; impressions?: number }
      | undefined;

    if (!totals) {
      console.warn("[xdash-sync] No totals in Home response for", firstDay);
      return;
    }

    const revenue = Number(totals.revenue ?? 0);
    const cost = Number(totals.cost ?? 0);
    const impressions = Number(totals.impressions ?? 0);

    const records = [
      { date: firstDay, partner_name: MONTHLY_TOTAL_PARTNER, partner_type: "demand", revenue, cost: 0, impressions },
      { date: firstDay, partner_name: MONTHLY_TOTAL_PARTNER, partner_type: "supply", revenue: 0, cost, impressions: 0 },
    ];
    const { error } = await supabaseAdmin
      .from(TABLE)
      .upsert(records, { onConflict: "date,partner_name,partner_type" });
    if (error) console.error("[xdash-sync] Monthly total upsert error:", error.message);
    else console.log(`[xdash-sync] Monthly total saved: revenue=$${revenue.toFixed(2)}, cost=$${cost.toFixed(2)}`);
  } catch (e) {
    console.warn("[xdash-sync] Home total fetch failed (non-fatal):", e instanceof Error ? e.message : e);
  }
}

export interface SyncXDASHResult {
  datesSynced: number;
  rowsUpserted: number;
}

/**
 * Incremental sync — minimal API calls, no redundant fetches.
 *
 * XDASH data is daily granularity; a query for a date returns that day's totals.
 *  - "Today" is the only date whose data is still growing → always fetch it.
 *  - "Yesterday" was last fetched at ~18:00 UTC the day before (missing last 6h).
 *    Finalize it once at the first cron run after midnight (hour < 6 UTC).
 *  - Older dates never change → never re-fetch.
 *
 * With cron every 6h (00:00, 06:00, 12:00, 18:00 UTC):
 *   00:00 → yesterday + today  (4 API calls — finalize yesterday)
 *   06/12/18 → today only      (2 API calls each)
 *   Total: 10 API calls/day, zero wasted overlap.
 *
 * Historical backfills: use syncXDASHDataForMonth() via the CLI script.
 */
export async function syncXDASHData(): Promise<SyncXDASHResult> {
  const now = new Date();
  const today = formatLocalDate(now);
  const dates = [today];

  const hourUTC = now.getUTCHours();
  if (hourUTC < 6) {
    dates.unshift(formatLocalDate(getYesterday(now)));
  }

  console.log(`[xdash-sync] Incremental sync for: ${dates.join(", ")}`);
  const dayResults = await fetchDatesInBatches(dates);
  const records: Record<string, unknown>[] = [];
  for (const { date, demand, supply } of dayResults) {
    for (const r of demand) records.push(rowToRecord(date, "demand", r));
    for (const r of supply) records.push(rowToRecord(date, "supply", r));
  }
  const rowsUpserted = await batchUpsert(records);

  // Refresh the monthly total from the Home API (one lightweight call)
  await syncMonthlyTotal(now.getFullYear(), now.getMonth() + 1);

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
  const dates = datesForMonth(year, month);
  const dayResults = await fetchDatesInBatches(dates);
  const records: Record<string, unknown>[] = [];
  for (const { date, demand, supply } of dayResults) {
    for (const r of demand) records.push(rowToRecord(date, "demand", r));
    for (const r of supply) records.push(rowToRecord(date, "supply", r));
  }
  const rowsUpserted = await batchUpsert(records);

  // Refresh the monthly total from the Home API (one call)
  await syncMonthlyTotal(year, month);

  return { datesSynced: dates.length, rowsUpserted };
}

export { MONTHLY_TOTAL_PARTNER };
