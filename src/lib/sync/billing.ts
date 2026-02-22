/**
 * Billing sync: Master Billing 2026 — Demand (revenue) + Supply (cost) → monthly_goals.
 * Tabs: exact names 'Demand' and 'Supply'. Column A = month (e.g. 'Jan26'), C = type, H = amount.
 * Demand: Media → media_revenue, SaaS → saas_actual. Supply: Media → media_cost, etc.
 */

import { getSheetValues } from "@/lib/google-sheets";
import { supabaseAdmin } from "@/lib/supabase";

const BILLING_SHEET_ID = "1GKzqtjt-5bk4uBd-MIhkbbgSasfcF86eJ9UR-VQYZdQ";
const RANGE_DEMAND = "Demand!A1:H990";
const RANGE_SUPPLY = "Supply!A1:H990";
const TABLE = "monthly_goals";

const COL_DATE = 0;   // A - Month e.g. 'Jan26'
const COL_TYPE = 2;   // C - Type: 'Media', 'SaaS', etc.
const COL_AMOUNT = 7; // H - Amount e.g. '$157,271.11'

const TYPE_MEDIA = "media";
const TYPE_SAAS = "saas";
const TYPE_TECH_PROVIDER = "tech provider";
const TYPE_BRAND_SAFETY_VENDOR = "brand safety vendor";

const MONTH_ABBR: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Map Column A exactly: 'Jan26' → January 2026 (DB: 2026-01-01), 'Feb26' → February 2026 (2026-02-01), etc.
 */
const SHEET_MONTH_TO_DB: Record<string, string> = {
  jan26: "2026-01-01", feb26: "2026-02-01", mar26: "2026-03-01", apr26: "2026-04-01",
  may26: "2026-05-01", jun26: "2026-06-01", jul26: "2026-07-01", aug26: "2026-08-01",
  sep26: "2026-09-01", oct26: "2026-10-01", nov26: "2026-11-01", dec26: "2026-12-01",
};

function sheetMonthToDbMonth(cell: string | number | undefined): string | null {
  const raw = String(cell ?? "").trim().replace(/\s+/g, " ");
  if (!raw) return null;
  const short = raw.replace(/\s/g, "").toLowerCase();
  const dbMonth = SHEET_MONTH_TO_DB[short];
  if (dbMonth) return dbMonth;
  return null;
}

/**
 * Parse Column A to DB month. Prefer explicit mapping (Jan26 → January 2026); fallback to long/slash formats.
 */
function parseMonthKey(cell: string | number | undefined): string | null {
  const explicit = sheetMonthToDbMonth(cell);
  if (explicit) return explicit;
  const raw = String(cell ?? "").trim().replace(/\s+/g, " ");
  if (!raw) return null;
  const short = raw.replace(/\s/g, "").toLowerCase();

  const longMatch = raw.match(/^(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{2,4})$/i);
  if (longMatch) {
    const monthStr = longMatch[1].slice(0, 3).toLowerCase();
    const monthNum = MONTH_ABBR[monthStr];
    if (monthNum == null) return null;
    const y = parseInt(longMatch[2], 10);
    const fullYear = y < 100 ? 2000 + y : y;
    return `${fullYear}-${String(monthNum).padStart(2, "0")}-01`;
  }

  if (short.length >= 4) {
    const monthStr = short.slice(0, 3);
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

/** Return true if row should be skipped (empty or header). */
function isEmptyOrHeaderRow(row: string[], colA: number): boolean {
  const a = String(row[colA] ?? "").trim();
  if (!a) return true;
  if (a.toLowerCase() === "month") return true;
  return false;
}

/**
 * Column H: use parseFloat(String(val).replace(/[^0-9.-]+/g, '')) to handle '$' and commas.
 */
function parseCurrency(val: string | number | undefined): number {
  if (val == null) return NaN;
  const cleaned = String(val).replace(/[^0-9.-]+/g, "");
  if (!cleaned) return NaN;
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? NaN : n;
}

interface MonthBreakdown {
  media_revenue: number;
  saas_actual: number;
  media_cost: number;
  tech_cost: number;
  bs_cost: number;
}

/**
 * Column C (Type): use .toLowerCase().trim() to match 'media' or 'saas' (and Supply types).
 */
function normalizeType(value: string | number | undefined): string {
  return String(value ?? "")
    .replace(/\uFEFF/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Demand sheet: sum all rows per month. Row validation: if Column A (Month) is empty or doesn't match a month pattern, continue immediately.
 * Column C: .toLowerCase().trim() to match 'media' or 'saas'. Currency: replace(/[^0-9.-]+/g, '') on Column H.
 */
function processDemandRows(
  rows: string[][]
): { byMonth: Map<string, MonthBreakdown>; rowsPerMonth: Map<string, number> } {
  const byMonth = new Map<string, MonthBreakdown>();
  const rowsPerMonth = new Map<string, number>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (!row[0]) break;
    if (isEmptyOrHeaderRow(row, COL_DATE)) continue;
    console.log("Processing:", row[0], row[2], row[7]);
    try {
      const type = normalizeType(row[COL_TYPE]);
      const monthKey = parseMonthKey(row[COL_DATE]);
      if (!monthKey) continue;
      const amount = parseCurrency(row[COL_AMOUNT]);
      if (Number.isNaN(amount)) continue;
      const cur = byMonth.get(monthKey) ?? {
        media_revenue: 0,
        saas_actual: 0,
        media_cost: 0,
        tech_cost: 0,
        bs_cost: 0,
      };
      if (type === TYPE_MEDIA) {
        cur.media_revenue += amount;
        console.log(`[billing sync] Demand row ${i + 1} matched: month=${monthKey} type=${TYPE_MEDIA} amount=${amount}`);
      } else if (type === TYPE_SAAS) {
        cur.saas_actual += amount;
        console.log(`[billing sync] Demand row ${i + 1} matched: month=${monthKey} type=${TYPE_SAAS} amount=${amount}`);
      } else continue;
      byMonth.set(monthKey, cur);
      rowsPerMonth.set(monthKey, (rowsPerMonth.get(monthKey) ?? 0) + 1);
    } catch (err) {
      console.error(`[billing sync] Demand row ${i + 1} error:`, err);
    }
  }
  return { byMonth, rowsPerMonth };
}

/**
 * Supply sheet: same row validation (empty Column A or no month pattern → continue). Try/catch per row.
 * Column C: .toLowerCase().trim(). Column H: parseCurrency (replace /[^0-9.-]+/g, '').
 */
function processSupplyRows(
  rows: string[][],
  byMonth: Map<string, MonthBreakdown>,
  supplyRowsPerMonth: Map<string, number>
): void {
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (!row[0]) break;
    if (isEmptyOrHeaderRow(row, COL_DATE)) continue;
    console.log("Processing:", row[0], row[2], row[7]);
    try {
      const type = normalizeType(row[COL_TYPE]);
      const monthKey = parseMonthKey(row[COL_DATE]);
      if (!monthKey) continue;
      const amount = parseCurrency(row[COL_AMOUNT]);
      if (Number.isNaN(amount)) continue;
      const cur = byMonth.get(monthKey) ?? {
        media_revenue: 0,
        saas_actual: 0,
        media_cost: 0,
        tech_cost: 0,
        bs_cost: 0,
      };
    if (type === TYPE_MEDIA) {
      cur.media_cost += amount;
        console.log(`[billing sync] Supply row ${i + 1} matched: month=${monthKey} type=${TYPE_MEDIA} amount=${amount}`);
      } else if (type === TYPE_TECH_PROVIDER) {
        cur.tech_cost += amount;
        console.log(`[billing sync] Supply row ${i + 1} matched: month=${monthKey} type=${TYPE_TECH_PROVIDER} amount=${amount}`);
      } else if (type === TYPE_BRAND_SAFETY_VENDOR) {
        cur.bs_cost += amount;
        console.log(`[billing sync] Supply row ${i + 1} matched: month=${monthKey} type=${TYPE_BRAND_SAFETY_VENDOR} amount=${amount}`);
      } else continue;
      byMonth.set(monthKey, cur);
      supplyRowsPerMonth.set(monthKey, (supplyRowsPerMonth.get(monthKey) ?? 0) + 1);
    } catch (err) {
      console.error(`[billing sync] Supply row ${i + 1} error:`, err);
    }
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
