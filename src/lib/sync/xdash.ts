/**
 * XDASH sync: demand & supply partner data → daily_partner_performance.
 * Syncs current month from 1st through yesterday. Used by cron and npm run fetch:xdash.
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

async function upsertPartnerRows(
  date: string,
  partnerType: "demand" | "supply",
  rows: PartnerRow[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const records = rows.map((r) => ({
    date,
    partner_name: r.name,
    partner_type: partnerType,
    revenue: r.revenue,
    cost: r.cost,
    impressions: r.impressions,
  }));
  const { error } = await supabaseAdmin
    .from(TABLE)
    .upsert(records, { onConflict: "date,partner_name,partner_type" });
  if (error) throw new Error(`${partnerType} upsert failed for ${date}: ${error.message}`);
  return records.length;
}

export interface SyncXDASHResult {
  datesSynced: number;
  rowsUpserted: number;
}

export async function syncXDASHData(): Promise<SyncXDASHResult> {
  const dates = datesFromMonthStartThroughYesterday();
  let rowsUpserted = 0;

  for (const date of dates) {
    const demandRaw = await fetchDemandPartners(date);
    const demandRows = mapDemandPartners(demandRaw);
    rowsUpserted += await upsertPartnerRows(date, "demand", demandRows);

    const supplyRaw = await fetchSupplyPartners(date);
    const supplyRows = mapSupplyPartners(supplyRaw);
    rowsUpserted += await upsertPartnerRows(date, "supply", supplyRows);
  }

  return { datesSynced: dates.length, rowsUpserted };
}
