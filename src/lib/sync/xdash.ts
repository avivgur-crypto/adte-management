/**
 * XDASH sync: demand & supply partner data → daily_partner_performance.
 * Fetches BOTH demand (revenue) and supply (cost) partners so revenue and cost are captured.
 * Optimized: parallel fetches for all dates, single batch upsert.
 */

import {
  fetchDemandPartners,
  fetchSupplyPartners,
  mapDemandPartners,
  mapSupplyPartners,
  type PartnerRow,
} from "@/lib/xdash-client";
import { supabaseAdmin } from "@/lib/supabase";

const TABLE = "daily_partner_performance";
const BATCH_UPSERT_SIZE = 2000;

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

/** Fetch demand + supply for one date. */
async function fetchDay(
  date: string
): Promise<{ date: string; demand: PartnerRow[]; supply: PartnerRow[] }> {
  const [demandRaw, supplyRaw] = await Promise.all([
    fetchDemandPartners(date),
    fetchSupplyPartners(date),
  ]);
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

export interface SyncXDASHResult {
  datesSynced: number;
  rowsUpserted: number;
}

export async function syncXDASHData(): Promise<SyncXDASHResult> {
  const dates = datesFromMonthStartThroughYesterday();
  const dayResults = await Promise.all(dates.map((date) => fetchDay(date)));
  const records: Record<string, unknown>[] = [];
  for (const { date, demand, supply } of dayResults) {
    for (const r of demand) records.push(rowToRecord(date, "demand", r));
    for (const r of supply) records.push(rowToRecord(date, "supply", r));
  }
  const rowsUpserted = await batchUpsert(records);
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
  const dayResults = await Promise.all(dates.map((date) => fetchDay(date)));
  const records: Record<string, unknown>[] = [];
  for (const { date, demand, supply } of dayResults) {
    for (const r of demand) records.push(rowToRecord(date, "demand", r));
    for (const r of supply) records.push(rowToRecord(date, "supply", r));
  }
  const rowsUpserted = await batchUpsert(records);
  return { datesSynced: dates.length, rowsUpserted };
}
