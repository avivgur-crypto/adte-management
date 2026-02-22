/**
 * Billing sync: Master Billing 2026 — Demand (revenue) + Supply (cost) → monthly_goals.
 * Tabs: exact names 'Demand' and 'Supply'. Column A = month (e.g. 'Jan26'), C = type, H = amount.
 * Demand: Media → media_revenue, SaaS → saas_actual. Supply: Media → media_cost, etc.
 */

import { getSheetValues } from "@/lib/google-sheets";
import { supabaseAdmin } from "@/lib/supabase";

const BILLING_SHEET_ID = "1GKzqtjt-5bk4uBd-MIhkbbgSasfcF86eJ9UR-VQYZdQ";
const RANGE_DEMAND = "Demand!A:H1000";
const RANGE_SUPPLY = "Supply!A:H1000";
const TABLE = "monthly_goals";

const COL_DATE = 0;   // A - Month e.g. 'Jan26'
const COL_TYPE = 2;   // C - 'Media', 'SaaS', etc.
const COL_AMOUNT = 7; // H - e.g. '$157,271.11'

const MONTH_ABBR: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Map Month column (A) to database format. Handles 'Jan26' → '2026-01-01'.
 * Normalizes: trim, collapse spaces, so 'Jan 26' or 'Jan26' both work.
 */
function parseMonthKey(cell: string | number | undefined): string | null {
  const raw = String(cell ?? "").trim().replace(/\s+/g, " ");
  if (!raw) return null;

  const longMatch = raw.match(/^(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{2,4})$/i);
  if (longMatch) {
    const monthStr = longMatch[1].slice(0, 3).toLowerCase();
    const monthNum = MONTH_ABBR[monthStr];
    if (monthNum == null) return null;
    const y = parseInt(longMatch[2], 10);
    const fullYear = y < 100 ? 2000 + y : y;
    return `${fullYear}-${String(monthNum).padStart(2, "0")}-01`;
  }

  const short = raw.replace(/\s/g, "");
  if (short.length >= 4) {
    const monthStr = short.slice(0, 3).toLowerCase();
    const monthNum = MONTH_ABBR[monthStr];
    if (monthNum != null) {
      const rest = short.slice(3).replace(/\D/g, "");
      if (rest.length >= 2) {
        const yearStr = rest.length >= 4 ? rest.slice(0, 4) : rest;
        const year = parseInt(yearStr, 10);
        const fullYear = year < 100 ? 2000 + year : year;
        return `${fullYear}-${String(monthNum).padStart(2, "0")}-01`;
      }
    }
  }

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const m = parseInt(slashMatch[1], 10);
    const y = parseInt(slashMatch[2], 10);
    if (m >= 1 && m <= 12) {
      const fullYear = y < 100 ? 2000 + y : y;
      return `${fullYear}-${String(m).padStart(2, "0")}-01`;
    }
  }

  return null;
}

/**
 * Column H: remove '$' and ',' with regex, then parse (e.g. '$157,271.11' → 157271.11).
 */
function parseAmount(cell: string | number | undefined): number {
  if (cell == null) return 0;
  const raw = String(cell).trim();
  if (raw === "") return 0;
  const cleaned = raw.replace(/[$,\s]/g, "").trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

interface MonthBreakdown {
  media_revenue: number;
  saas_actual: number;
  media_cost: number;
  tech_cost: number;
  bs_cost: number;
}

/** Column C: trim and uppercase for comparison ('Media' → 'MEDIA', 'SaaS' → 'SAAS'). */
function normalizeType(value: string | undefined): string {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

function processDemandRows(
  rows: string[][]
): { byMonth: Map<string, MonthBreakdown>; rowsPerMonth: Map<string, number> } {
  const byMonth = new Map<string, MonthBreakdown>();
  const rowsPerMonth = new Map<string, number>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const type = normalizeType(row[COL_TYPE]);
    const monthKey = parseMonthKey(row[COL_DATE]);
    if (!monthKey) continue;
    const amount = parseAmount(row[COL_AMOUNT]);
    const cur = byMonth.get(monthKey) ?? {
      media_revenue: 0,
      saas_actual: 0,
      media_cost: 0,
      tech_cost: 0,
      bs_cost: 0,
    };
    if (type === "MEDIA") {
      cur.media_revenue += amount;
      console.log(`[billing sync] Demand row ${i + 1} matched: month=${monthKey} type=MEDIA amount=${amount}`);
    } else if (type === "SAAS") {
      cur.saas_actual += amount;
      console.log(`[billing sync] Demand row ${i + 1} matched: month=${monthKey} type=SAAS amount=${amount}`);
    } else continue;
    byMonth.set(monthKey, cur);
    rowsPerMonth.set(monthKey, (rowsPerMonth.get(monthKey) ?? 0) + 1);
  }
  return { byMonth, rowsPerMonth };
}

function processSupplyRows(
  rows: string[][],
  byMonth: Map<string, MonthBreakdown>,
  supplyRowsPerMonth: Map<string, number>
): void {
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const type = normalizeType(row[COL_TYPE]);
    const monthKey = parseMonthKey(row[COL_DATE]);
    if (!monthKey) continue;
    const amount = parseAmount(row[COL_AMOUNT]);
    const cur = byMonth.get(monthKey) ?? {
      media_revenue: 0,
      saas_actual: 0,
      media_cost: 0,
      tech_cost: 0,
      bs_cost: 0,
    };
    if (type === "MEDIA") {
      cur.media_cost += amount;
      console.log(`[billing sync] Supply row ${i + 1} matched: month=${monthKey} type=MEDIA amount=${amount}`);
    } else if (type === "TECH PROVIDER") {
      cur.tech_cost += amount;
      console.log(`[billing sync] Supply row ${i + 1} matched: month=${monthKey} type=TECH PROVIDER amount=${amount}`);
    } else if (type === "BRAND SAFETY VENDOR") {
      cur.bs_cost += amount;
      console.log(`[billing sync] Supply row ${i + 1} matched: month=${monthKey} type=BRAND SAFETY VENDOR amount=${amount}`);
    } else continue;
    byMonth.set(monthKey, cur);
    supplyRowsPerMonth.set(monthKey, (supplyRowsPerMonth.get(monthKey) ?? 0) + 1);
  }
}

export interface SyncBillingResult {
  monthsUpdated: number;
}

export async function syncBillingData(): Promise<SyncBillingResult> {
  console.log("[billing sync] Fetching Demand and Supply sheets (exact tab names: Demand, Supply)");
  const [demandRows, supplyRows] = await Promise.all([
    getSheetValues(BILLING_SHEET_ID, RANGE_DEMAND),
    getSheetValues(BILLING_SHEET_ID, RANGE_SUPPLY),
  ]);
  console.log(`[billing sync] Demand rows: ${demandRows.length}, Supply rows: ${supplyRows.length}`);

  const { byMonth, rowsPerMonth: demandRowsPerMonth } = processDemandRows(demandRows);
  const supplyRowsPerMonth = new Map<string, number>();
  processSupplyRows(supplyRows, byMonth, supplyRowsPerMonth);

  const months = [...byMonth.keys()].sort();
  for (const month of months) {
    const demandCount = demandRowsPerMonth.get(month) ?? 0;
    const supplyCount = supplyRowsPerMonth.get(month) ?? 0;
    console.log(
      `[billing sync] Month ${month}: ${demandCount} demand row(s), ${supplyCount} supply row(s) processed`
    );
  }

  for (const [month, breakdown] of byMonth) {
    const { error } = await supabaseAdmin
      .from(TABLE)
      .upsert(
        {
          month,
          media_revenue: breakdown.media_revenue,
          saas_actual: breakdown.saas_actual,
          media_cost: breakdown.media_cost,
          tech_cost: breakdown.tech_cost,
          bs_cost: breakdown.bs_cost,
        },
        { onConflict: "month" }
      );
    if (error) throw new Error(`Supabase billing upsert failed for ${month}: ${error.message}`);
  }

  return { monthsUpdated: byMonth.size };
}
