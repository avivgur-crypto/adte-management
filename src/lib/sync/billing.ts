/**
 * Billing sync: Master Billing sheet (Demand) → monthly_goals.saas_actual.
 * Supports "Jan26", "Jan 2026", "January 2026" style dates. Scans full sheet range.
 * Used by the unified cron sync and by npm run fetch:billing.
 */

import { getSheetValues } from "@/lib/google-sheets";
import { supabaseAdmin } from "@/lib/supabase";

const BILLING_SHEET_ID = "1GKzqtjt-5bk4uBd-MIhkbbgSasfcF86eJ9UR-VQYZdQ";
/** Full column range so we don't miss rows (entire 2026 sheet). */
const RANGE = "Demand!A:H1000";
const TABLE = "monthly_goals";

const COL_DATE = 0;   // A
const COL_TYPE = 2;   // C: "SAAS"
const COL_AMOUNT = 7; // H

const MONTH_ABBR: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse date cell to YYYY-MM-01. Supports:
 * - "Jan26", "Feb26"
 * - "Jan 2026", "January 2026"
 * - "1/2026", "01/2026"
 * Returns null if invalid.
 */
function parseMonthKey(cell: string | undefined): string | null {
  const raw = String(cell ?? "").trim();
  if (!raw) return null;

  // "January 2026", "Jan 2026" → full year + month name
  const longMatch = raw.match(/^(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{2,4})$/i);
  if (longMatch) {
    const monthStr = longMatch[1].slice(0, 3).toLowerCase();
    const monthNum = MONTH_ABBR[monthStr];
    if (monthNum == null) return null;
    const y = parseInt(longMatch[2], 10);
    const fullYear = y < 100 ? 2000 + y : y;
    return `${fullYear}-${String(monthNum).padStart(2, "0")}-01`;
  }

  // "Jan26", "Feb26"
  if (raw.length >= 4) {
    const monthStr = raw.slice(0, 3).toLowerCase();
    const monthNum = MONTH_ABBR[monthStr];
    if (monthNum != null) {
      const rest = raw.slice(3).replace(/\D/g, "");
      if (rest.length >= 2) {
        const yearStr = rest.length >= 4 ? rest.slice(0, 4) : rest;
        const year = parseInt(yearStr, 10);
        const fullYear = year < 100 ? 2000 + year : year;
        return `${fullYear}-${String(monthNum).padStart(2, "0")}-01`;
      }
    }
  }

  // "1/2026", "01/2026"
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

function parseAmount(cell: string | undefined): number {
  if (cell == null || String(cell).trim() === "") return 0;
  const s = String(cell).replace(/\$/g, "").replace(/,/g, "").trim();
  if (!s) return 0;
  const n = Number(s);
  return Number.isNaN(n) ? 0 : n;
}

export interface SyncBillingResult {
  monthsUpdated: number;
}

export async function syncBillingData(): Promise<SyncBillingResult> {
  const rows = await getSheetValues(BILLING_SHEET_ID, RANGE);
  const byMonth = new Map<string, number>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const type = String(row[COL_TYPE] ?? "").trim();
    if (type.toUpperCase() !== "SAAS") continue;

    const monthKey = parseMonthKey(row[COL_DATE]);
    if (!monthKey) continue;

    const amount = parseAmount(row[COL_AMOUNT]);
    byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + amount);
  }

  for (const [month, saas_actual] of byMonth) {
    const { error } = await supabaseAdmin
      .from(TABLE)
      .upsert({ month, saas_actual }, { onConflict: "month" });
    if (error) throw new Error(`Supabase billing upsert failed for ${month}: ${error.message}`);
  }

  return { monthsUpdated: byMonth.size };
}
