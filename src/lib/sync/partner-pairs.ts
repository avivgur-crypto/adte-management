/**
 * Partner-pairs sync: XDASH report pair data → daily_partner_pairs.
 * Fetches from XDASH only for dates that have no rows in Supabase (persistence model).
 * Uses batch upserts to minimize DB connections.
 */

import {
  fetchReportPairsForDateRange,
  fetchReportPairsDayByDay,
  isReportApi404,
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
    profit: p.profit ?? (p.revenue - p.cost),
  }));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

type PairRecord = { demand_tag: string; supply_tag: string; revenue: number; cost: number; profit: number };

/**
 * Deduplicate by (demand_tag, supply_tag), summing revenue/cost/profit for duplicates.
 * Rounds to 4 decimal places.
 */
function aggregateRecords(records: PairRecord[]): PairRecord[] {
  const map = new Map<string, PairRecord>();
  for (const r of records) {
    const key = `${r.demand_tag}\u0001${r.supply_tag}`;
    const existing = map.get(key);
    if (existing) {
      existing.revenue += r.revenue;
      existing.cost += r.cost;
      existing.profit += r.profit;
    } else {
      map.set(key, { ...r });
    }
  }
  for (const rec of map.values()) {
    rec.revenue = round4(rec.revenue);
    rec.cost = round4(rec.cost);
    rec.profit = round4(rec.profit);
  }
  return Array.from(map.values());
}

/**
 * Batch upsert records into daily_partner_pairs. Aggregates duplicates first to avoid
 * "ON CONFLICT DO UPDATE command cannot affect row a second time".
 */
async function batchUpsert(
  date: string,
  records: PairRecord[]
): Promise<number> {
  const unique = aggregateRecords(records);
  if (unique.length === 0) return 0;
  const rows = unique.map((r) => ({
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
 * Sync partner pairs for the current month.
 *
 * Strategy:
 *  - Always re-sync today (partial day, data grows throughout the day).
 *  - Sync any other day in the current month that has no rows yet (catch-up).
 *  - On 404 from Report API: log and skip that date, but continue with others.
 */
export async function syncPartnerPairsData(): Promise<SyncPartnerPairsResult> {
  const now = new Date();
  const today = formatLocalDate(now);
  const y = now.getFullYear();
  const m = now.getMonth() + 1;

  let allDatesThisMonth = datesForMonth(y, m);
  const isCurrentMonth = y === now.getFullYear() && m === now.getMonth() + 1;
  if (isCurrentMonth && (allDatesThisMonth.length === 0 || allDatesThisMonth[allDatesThisMonth.length - 1] !== today)) {
    allDatesThisMonth = [...allDatesThisMonth, today];
  }
  if (allDatesThisMonth.length === 0) {
    return { datesRequested: 0, datesSynced: 0, rowsUpserted: 0 };
  }

  const alreadySynced = await getDatesAlreadySynced(allDatesThisMonth);
  const toFetch = allDatesThisMonth.filter((d) => d === today || !alreadySynced.has(d));

  if (toFetch.length === 0) {
    return { datesRequested: allDatesThisMonth.length, datesSynced: 0, rowsUpserted: 0 };
  }

  let rowsUpserted = 0;
  let datesSynced = 0;
  for (let i = 0; i < toFetch.length; i++) {
    const date = toFetch[i]!;
    try {
      const pairs = await fetchPairsForDate(date);
      const n = await batchUpsert(date, pairs);
      rowsUpserted += n;
      datesSynced += 1;
    } catch (e) {
      if (isReportApi404(e)) {
        console.error(`[partner-pairs-sync] 404 for ${date}, skipping.`);
      } else {
        console.error(`[partner-pairs-sync] Failed for ${date}:`, e instanceof Error ? e.message : e);
      }
    }
    if (i < toFetch.length - 1) {
      await new Promise((r) => setTimeout(r, INTER_DATE_DELAY_MS));
    }
  }

  return {
    datesRequested: allDatesThisMonth.length,
    datesSynced,
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
  let datesSynced = 0;
  for (let i = 0; i < toFetch.length; i++) {
    const date = toFetch[i]!;
    try {
      const pairs = await fetchPairsForDate(date);
      rowsUpserted += await batchUpsert(date, pairs);
      datesSynced += 1;
    } catch (e) {
      if (isReportApi404(e)) {
        console.error("[partner-pairs-sync]", e instanceof Error ? e.message : e);
        console.error("[partner-pairs-sync] Stopping: Report API not available. Set XDASH_REPORT_PATH to the path from your XDASH Reports page (DevTools > Network).");
        break;
      }
      console.error(`[partner-pairs-sync] Failed for ${date}:`, e instanceof Error ? e.message : e);
    }
    if (i < toFetch.length - 1) {
      await new Promise((r) => setTimeout(r, INTER_DATE_DELAY_MS));
    }
  }
  return {
    datesRequested: dates.length,
    datesSynced,
    rowsUpserted,
  };
}
