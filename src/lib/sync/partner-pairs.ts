/**
 * Partner-pairs sync: XDASH report pair data → daily_partner_pairs.
 * Fetches from XDASH only for dates that have no rows in Supabase (persistence model).
 * Uses batch upserts to minimize DB connections.
 */

import {
  fetchReportPairsForDateRange,
  fetchReportPairsDayByDay,
} from "@/lib/xdash-client";
import { supabaseAdmin } from "@/lib/supabase";

const TABLE = "daily_partner_pairs";
const BATCH_UPSERT_SIZE = 500;

/** Delay between XDASH requests when syncing multiple dates (reduce load on unstable API). */
const INTER_DATE_DELAY_MS = 3000;

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

/**
 * Return the set of dates that already have at least one row in daily_partner_pairs.
 */
export async function getDatesAlreadySynced(dates: string[]): Promise<Set<string>> {
  if (dates.length === 0) return new Set();
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("date")
    .in("date", dates);
  if (error) throw new Error(`Partner pairs date check failed: ${error.message}`);
  const set = new Set<string>();
  for (const row of data ?? []) {
    const d = row?.date;
    if (d) set.add(typeof d === "string" ? d.slice(0, 10) : String(d).slice(0, 10));
  }
  return set;
}

/**
 * Fetch pair data from XDASH for one date. Tries range first, then day-by-day for that single day.
 */
async function fetchPairsForDate(date: string): Promise<
  Array<{ demand_tag: string; supply_tag: string; revenue: number; cost: number; profit: number }>
> {
  let rows = await fetchReportPairsForDateRange(date, date);
  if (rows.length === 0) {
    rows = await fetchReportPairsDayByDay(date, date);
  }
  return rows.map((p) => ({
    demand_tag: p.demandPartner,
    supply_tag: p.supplyPartner,
    revenue: p.revenue,
    cost: p.cost,
    profit: p.revenue - p.cost,
  }));
}

/**
 * Batch upsert records into daily_partner_pairs. Minimizes DB round-trips.
 */
async function batchUpsert(
  date: string,
  records: Array<{ demand_tag: string; supply_tag: string; revenue: number; cost: number; profit: number }>
): Promise<number> {
  if (records.length === 0) return 0;
  const rows = records.map((r) => ({
    date,
    demand_tag: r.demand_tag,
    supply_tag: r.supply_tag,
    revenue: r.revenue,
    cost: r.cost,
    profit: r.profit,
  }));
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH_UPSERT_SIZE) {
    const chunk = rows.slice(i, i + BATCH_UPSERT_SIZE);
    const { error } = await supabaseAdmin
      .from(TABLE)
      .upsert(chunk, { onConflict: "date,demand_tag,supply_tag" });
    if (error) throw new Error(`Partner pairs upsert failed: ${error.message}`);
    total += chunk.length;
  }
  return total;
}

export interface SyncPartnerPairsResult {
  datesRequested: number;
  datesSynced: number;
  rowsUpserted: number;
}

/**
 * Incremental sync: only fetch from XDASH for dates that don't exist in Supabase.
 * Same date strategy as XDASH sync: today always; yesterday only when hour UTC < 6.
 */
export async function syncPartnerPairsData(): Promise<SyncPartnerPairsResult> {
  const now = new Date();
  const today = formatLocalDate(now);
  const datesToConsider = [today];
  if (now.getUTCHours() < 6) {
    datesToConsider.unshift(formatLocalDate(getYesterday(now)));
  }

  const alreadySynced = await getDatesAlreadySynced(datesToConsider);
  const toFetch = datesToConsider.filter((d) => !alreadySynced.has(d));
  if (toFetch.length === 0) {
    return { datesRequested: datesToConsider.length, datesSynced: 0, rowsUpserted: 0 };
  }

  let rowsUpserted = 0;
  for (let i = 0; i < toFetch.length; i++) {
    const date = toFetch[i]!;
    try {
      const pairs = await fetchPairsForDate(date);
      const n = await batchUpsert(date, pairs);
      rowsUpserted += n;
      if (i < toFetch.length - 1) {
        await new Promise((r) => setTimeout(r, INTER_DATE_DELAY_MS));
      }
    } catch (e) {
      console.error(`[partner-pairs-sync] Failed for ${date}:`, e instanceof Error ? e.message : e);
      // Continue with other dates
    }
  }

  return {
    datesRequested: datesToConsider.length,
    datesSynced: toFetch.length,
    rowsUpserted,
  };
}

/** Dates from 1st through last day of the given month, or through yesterday if that month is current. */
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
 * Backfill partner pairs for a month: only fetches dates that don't exist in Supabase.
 * Use for historical months (e.g. from a script or admin API).
 */
export async function syncPartnerPairsDataForMonth(
  year: number,
  month: number
): Promise<SyncPartnerPairsResult> {
  const dates = datesForMonth(year, month);
  if (dates.length === 0) {
    return { datesRequested: 0, datesSynced: 0, rowsUpserted: 0 };
  }
  const alreadySynced = await getDatesAlreadySynced(dates);
  const toFetch = dates.filter((d) => !alreadySynced.has(d));
  if (toFetch.length === 0) {
    return { datesRequested: dates.length, datesSynced: 0, rowsUpserted: 0 };
  }
  let rowsUpserted = 0;
  for (let i = 0; i < toFetch.length; i++) {
    const date = toFetch[i]!;
    try {
      const pairs = await fetchPairsForDate(date);
      rowsUpserted += await batchUpsert(date, pairs);
    } catch (e) {
      console.error(`[partner-pairs-sync] Failed for ${date}:`, e instanceof Error ? e.message : e);
    }
    if (i < toFetch.length - 1) {
      await new Promise((r) => setTimeout(r, INTER_DATE_DELAY_MS));
    }
  }
  return {
    datesRequested: dates.length,
    datesSynced: toFetch.length,
    rowsUpserted,
  };
}
