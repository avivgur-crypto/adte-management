/**
 * Billing sync: Master Billing 2026 — Demand (revenue) + Supply (cost) → monthly_goals.
 * Tabs: exact names 'Demand' and 'Supply'. Column A = month (e.g. 'Jan26'), C = type,
 * H = Final Revenue / amount, I = Amount Received (Demand only, for Collection Rate).
 * Demand: Media → media_revenue, SaaS → saas_actual; also sums H→final_revenue, I→amount_received.
 * Supply: Media → media_cost, etc.
 */

import { getSheetValues } from "@/lib/google-sheets";
import { supabaseAdmin } from "@/lib/supabase";

const BILLING_SHEET_ID = "1GKzqtjt-5bk4uBd-MIhkbbgSasfcF86eJ9UR-VQYZdQ";
/** Demand includes col I (Amount Received) for Collection Rate. */
const RANGE_DEMAND = "Demand!A1:I990";
const RANGE_SUPPLY = "Supply!A1:H990";
const TABLE = "monthly_goals";

const COL_DATE = 0;   // A - Month e.g. 'Jan26'
const COL_TYPE = 2;   // C - Type: 'Media', 'SaaS', etc.
const COL_PARTNER = 3; // D - Advertiser Name (Demand)
const COL_AMOUNT = 7; // H - Final Revenue (Demand) / amount (Supply)
const COL_RECEIVED = 8; // I - Amount Received (Demand only)
const PARTNERS_TABLE = "billing_collection_partners";

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
 * Parse currency: strip '$' and ',' (and any other non-numeric except minus and decimal point).
 * Preserves cents (e.g. "$1,234.56" -> 1234.56).
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
  /** Sum of Demand!H (Final Revenue) — Collection Rate denominator. */
  final_revenue: number;
  /** Sum of Demand!I (Amount Received) — Collection Rate numerator. */
  amount_received: number;
}

function emptyBreakdown(): MonthBreakdown {
  return {
    media_revenue: 0,
    saas_actual: 0,
    media_cost: 0,
    tech_cost: 0,
    bs_cost: 0,
    final_revenue: 0,
    amount_received: 0,
  };
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

interface PartnerCollection {
  final_revenue: number;
  amount_received: number;
}

/**
 * Demand sheet: iterate ALL rows (skip blanks, don't break on them).
 * - Sums Column H into media_revenue / saas_actual by type (existing Main Stats).
 * - Sums Column H → final_revenue and Column I → amount_received for Collection Rate
 *   across every Demand row with a valid month (all income types).
 * - Also aggregates H/I by Advertiser Name (D) for top collection gaps.
 */
function processDemandRows(
  rows: string[][]
): {
  byMonth: Map<string, MonthBreakdown>;
  byPartner: Map<string, Map<string, PartnerCollection>>;
  rowsPerMonth: Map<string, number>;
  skippedTypes: Map<string, number>;
} {
  const byMonth = new Map<string, MonthBreakdown>();
  const byPartner = new Map<string, Map<string, PartnerCollection>>();
  const rowsPerMonth = new Map<string, number>();
  const skippedTypes = new Map<string, number>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (isEmptyOrHeaderRow(row, COL_DATE)) continue;
    try {
      const type = normalizeType(row[COL_TYPE]);
      const monthKey = parseMonthKey(row[COL_DATE]);
      if (!monthKey) continue;
      const finalRev = parseCurrency(row[COL_AMOUNT]);
      const receivedRaw = parseCurrency(row[COL_RECEIVED]);
      const received = Number.isNaN(receivedRaw) ? 0 : receivedRaw;

      const cur = byMonth.get(monthKey) ?? emptyBreakdown();

      // Collection Rate totals: every Demand line with a numeric Final Revenue.
      if (!Number.isNaN(finalRev)) {
        cur.final_revenue += finalRev;
        cur.amount_received += received;

        const partnerName = String(row[COL_PARTNER] ?? "").trim() || "(Unnamed)";
        let monthPartners = byPartner.get(monthKey);
        if (!monthPartners) {
          monthPartners = new Map();
          byPartner.set(monthKey, monthPartners);
        }
        const prev = monthPartners.get(partnerName) ?? {
          final_revenue: 0,
          amount_received: 0,
        };
        prev.final_revenue += finalRev;
        prev.amount_received += received;
        monthPartners.set(partnerName, prev);
      }

      if (Number.isNaN(finalRev) || finalRev === 0) {
        byMonth.set(monthKey, cur);
        continue;
      }

      if (type === TYPE_MEDIA) {
        cur.media_revenue += finalRev;
        rowsPerMonth.set(monthKey, (rowsPerMonth.get(monthKey) ?? 0) + 1);
      } else if (type === TYPE_SAAS) {
        cur.saas_actual += finalRev;
        rowsPerMonth.set(monthKey, (rowsPerMonth.get(monthKey) ?? 0) + 1);
      } else {
        skippedTypes.set(type, (skippedTypes.get(type) ?? 0) + 1);
      }
      byMonth.set(monthKey, cur);
    } catch (err) {
      console.error(`[billing sync] Demand row ${i + 1} error:`, err);
    }
  }
  return { byMonth, byPartner, rowsPerMonth, skippedTypes };
}

/**
 * Supply sheet: iterate ALL rows (skip blanks, don't break on them).
 * Sums Column H for matching cost types across all entities.
 */
function processSupplyRows(
  rows: string[][],
  byMonth: Map<string, MonthBreakdown>,
  supplyRowsPerMonth: Map<string, number>,
  skippedTypes: Map<string, number>,
): void {
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (isEmptyOrHeaderRow(row, COL_DATE)) continue;
    try {
      const type = normalizeType(row[COL_TYPE]);
      const monthKey = parseMonthKey(row[COL_DATE]);
      if (!monthKey) continue;
      const amount = parseCurrency(row[COL_AMOUNT]);
      if (Number.isNaN(amount) || amount === 0) continue;
      const cur = byMonth.get(monthKey) ?? emptyBreakdown();
      if (type === TYPE_MEDIA) {
        cur.media_cost += amount;
      } else if (type === TYPE_TECH_PROVIDER) {
        cur.tech_cost += amount;
      } else if (type === TYPE_BRAND_SAFETY_VENDOR) {
        cur.bs_cost += amount;
      } else {
        skippedTypes.set(type, (skippedTypes.get(type) ?? 0) + 1);
        continue;
      }
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
  console.log("[billing sync] Fetching Demand and Supply sheets…");
  const [demandRows, supplyRows] = await Promise.all([
    getSheetValues(BILLING_SHEET_ID, RANGE_DEMAND),
    getSheetValues(BILLING_SHEET_ID, RANGE_SUPPLY),
  ]);
  console.log(`[billing sync] Raw rows: Demand=${demandRows.length}, Supply=${supplyRows.length}`);

  const {
    byMonth,
    byPartner,
    rowsPerMonth: demandRowsPerMonth,
    skippedTypes: demandSkipped,
  } = processDemandRows(demandRows);

  const supplyRowsPerMonth = new Map<string, number>();
  const supplySkipped = new Map<string, number>();
  processSupplyRows(supplyRows, byMonth, supplyRowsPerMonth, supplySkipped);

  // Log skipped types so we can see if important data is being missed
  if (demandSkipped.size > 0) {
    console.log("[billing sync] Demand skipped types:", Object.fromEntries(demandSkipped));
  }
  if (supplySkipped.size > 0) {
    console.log("[billing sync] Supply skipped types:", Object.fromEntries(supplySkipped));
  }

  // Per-month summary with final totals — compare these against the sheet
  const months = [...byMonth.keys()].sort();
  for (const month of months) {
    const b = byMonth.get(month)!;
    const dCount = demandRowsPerMonth.get(month) ?? 0;
    const sCount = supplyRowsPerMonth.get(month) ?? 0;
    console.log(
      `[billing sync] ${month}: ${dCount} demand + ${sCount} supply rows` +
      ` | revenue=$${b.media_revenue.toFixed(2)} saas=$${b.saas_actual.toFixed(2)}` +
      ` | cost=$${b.media_cost.toFixed(2)} tech=$${b.tech_cost.toFixed(2)} bs=$${b.bs_cost.toFixed(2)}` +
      ` | collection final=$${b.final_revenue.toFixed(2)} received=$${b.amount_received.toFixed(2)}`,
    );
  }

  const batch = Array.from(byMonth.entries()).map(([month, breakdown]) => ({
    month,
    media_revenue: breakdown.media_revenue,
    saas_actual: breakdown.saas_actual,
    media_cost: breakdown.media_cost,
    tech_cost: breakdown.tech_cost,
    bs_cost: breakdown.bs_cost,
    final_revenue: breakdown.final_revenue,
    amount_received: breakdown.amount_received,
  }));

  if (batch.length > 0) {
    console.log(`[billing sync] Upserting ${batch.length} month(s) into ${TABLE}…`);
    const { error } = await supabaseAdmin
      .from(TABLE)
      .upsert(batch, { onConflict: "month" });
    if (error) throw new Error(`Supabase billing upsert failed: ${error.message}`);
  }

  // Replace partner collection rows for synced months (avoids stale advertisers).
  // Soft-fail if migration 035 has not been applied yet.
  const partnerMonths = [...byPartner.keys()];
  if (partnerMonths.length > 0) {
    const partnerBatch = partnerMonths.flatMap((month) => {
      const partners = byPartner.get(month)!;
      return [...partners.entries()].map(([partner_name, amounts]) => ({
        month,
        partner_name,
        final_revenue: amounts.final_revenue,
        amount_received: amounts.amount_received,
      }));
    });
    console.log(
      `[billing sync] Replacing ${partnerBatch.length} partner row(s) in ${PARTNERS_TABLE}…`,
    );
    const { error: delErr } = await supabaseAdmin
      .from(PARTNERS_TABLE)
      .delete()
      .in("month", partnerMonths);
    if (delErr) {
      console.warn(
        `[billing sync] Partner collection table unavailable (${delErr.message}). ` +
          `Apply migration 035_billing_collection_partners.sql.`,
      );
    } else if (partnerBatch.length > 0) {
      const { error: insErr } = await supabaseAdmin
        .from(PARTNERS_TABLE)
        .insert(partnerBatch);
      if (insErr) {
        console.warn(
          `[billing sync] Partner collection insert failed: ${insErr.message}`,
        );
      }
    }
  }

  console.log(`[billing sync] Done: ${byMonth.size} month(s) updated`);
  return { monthsUpdated: byMonth.size };
}

export interface CollectionGapRow {
  partnerName: string;
  finalRevenue: number;
  amountReceived: number;
  gap: number;
}

function rankGapsFromPartnerMap(
  byPartner: Map<string, Map<string, PartnerCollection>>,
  months: string[],
  limit = 5,
): CollectionGapRow[] {
  const monthSet = new Set(months);
  const byName = new Map<string, { finalRevenue: number; amountReceived: number }>();

  for (const [month, partners] of byPartner) {
    if (!monthSet.has(month)) continue;
    for (const [partnerName, amounts] of partners) {
      const prev = byName.get(partnerName) ?? {
        finalRevenue: 0,
        amountReceived: 0,
      };
      prev.finalRevenue += amounts.final_revenue;
      prev.amountReceived += amounts.amount_received;
      byName.set(partnerName, prev);
    }
  }

  return [...byName.entries()]
    .map(([partnerName, amounts]) => ({
      partnerName,
      finalRevenue: amounts.finalRevenue,
      amountReceived: amounts.amountReceived,
      gap: amounts.finalRevenue - amounts.amountReceived,
    }))
    .filter((p) => p.gap > 0)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, limit);
}

/** Live compute top unpaid collection gaps from Demand sheet (fallback / on-demand). */
export async function fetchTopCollectionGapsFromSheet(
  months: string[],
  limit = 5,
): Promise<CollectionGapRow[]> {
  if (months.length === 0) return [];
  const demandRows = await getSheetValues(BILLING_SHEET_ID, RANGE_DEMAND);
  const { byPartner } = processDemandRows(demandRows);
  return rankGapsFromPartnerMap(byPartner, months, limit);
}
