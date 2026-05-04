/**
 * P&L sync: Master Billing 2026 — tabs "Consolidated PNL", "TMS PNL", "Adte PNL" → pnl_data.
 *
 * Layout (from sheet screenshots):
 *   Row 1: header — month names (January..December) start in column B; column N = "Total".
 *   Column A: line label (Media Revenue, Total OPEX, etc.).
 *
 * Strategy: keyword-based label mapping per row. Tab-specific quirks:
 *   - TMS PNL: column O contains a red note → ignored automatically (only month columns are read).
 *   - Adte PNL: includes optional "Employer Costs (TMS)" section with Monthly OpEX / Real Profit.
 *
 * Empty / "#DIV/0!" cells under a mapped label are stored as 0 so every (label, month) pair
 * is present in the database.
 */

import { getSheetValues } from "@/lib/google-sheets";
import { supabaseAdmin } from "@/lib/supabase";

const BILLING_SHEET_ID = "1GKzqtjt-5bk4uBd-MIhkbbgSasfcF86eJ9UR-VQYZdQ";

/** App-wide year (matches FilterContext). */
const PNL_YEAR = 2026;

const PNL_TABS: { sheetTitle: string; entity: "Consolidated" | "TMS" | "Adte" }[] = [
  { sheetTitle: "Consolidated PNL", entity: "Consolidated" },
  { sheetTitle: "TMS PNL", entity: "TMS" },
  { sheetTitle: "Adte PNL", entity: "Adte" },
];

const MONTH_NAME_TO_INDEX: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/* ===================================================================
 *  Header detection
 * =================================================================== */

interface MonthHeader {
  headerRowIndex: number;
  monthCols: { col: number; month: string }[];
}

function monthFirst(monthIndex: number): string {
  return `${PNL_YEAR}-${String(monthIndex).padStart(2, "0")}-01`;
}

/**
 * Find the row that has month names (full English names) in consecutive columns.
 * Search the first 8 rows, accept any row where ≥6 cells match a month name.
 */
function findMonthHeader(rows: string[][]): MonthHeader | null {
  const maxRows = Math.min(8, rows.length);
  for (let r = 0; r < maxRows; r++) {
    const row = rows[r] ?? [];
    const monthCols: { col: number; month: string }[] = [];
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] ?? "").trim().toLowerCase();
      const idx = MONTH_NAME_TO_INDEX[cell];
      if (idx) monthCols.push({ col: c, month: monthFirst(idx) });
    }
    if (monthCols.length >= 6) {
      return { headerRowIndex: r, monthCols };
    }
  }
  return null;
}

/* ===================================================================
 *  Label mapping (keyword-based)
 * =================================================================== */

interface LabelMatch {
  category: string;
  label: string;
  /** Generic sheet section rows such as "Revenue" are skipped when they have no monthly values. */
  skipWhenAllZero?: boolean;
}

function normalize(s: string): string {
  return s
    .replace(/\uFEFF/g, "")
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function compactLabel(s: string): string {
  return normalize(s).replace(/[^a-z0-9]+/g, "");
}

/**
 * Map a column-A label to a canonical (category, label). Returns null when the row
 * is unrelated (blank rows, decorative section headers like "Employer Costs (TMS)").
 */
function classifyLabel(rawLabel: string): LabelMatch | null {
  const t = normalize(rawLabel);
  const compact = compactLabel(rawLabel);
  if (!t) return null;

  // Revenue
  if (compact.includes("mediarevenue")) return { category: "Revenue", label: "Media Revenue" };
  if (compact.includes("saasrevenue") || compact.includes("sassrevenue")) {
    return { category: "Revenue", label: "SAAS Revenue" };
  }
  if (compact === "revenue") {
    return { category: "Revenue", label: "Total Revenue", skipWhenAllZero: true };
  }
  if (compact.includes("totalrevenue")) return { category: "Revenue", label: "Total Revenue" };

  // COGS
  if (compact.includes("mediacost")) return { category: "COGS", label: "Media Costs" };
  if (compact.includes("adashcost")) return { category: "COGS", label: "Adash Costs" };
  if (compact.includes("saascost") || compact.includes("sasscost")) {
    return { category: "COGS", label: "SaaS Costs" };
  }
  if (compact.includes("totalcogs") || compact.includes("totalcostofgood")) {
    return { category: "COGS", label: "Total COGS" };
  }

  // Gross profitability
  if (compact.includes("grossprofit")) return { category: "Gross Profit", label: "Gross Profit" };
  if (compact === "gmargin" || compact.includes("grossmargin")) {
    return { category: "Gross Profit", label: "G. Margin" };
  }

  // OPEX buckets
  if (compact.includes("marketing")) return { category: "OPEX - Marketing", label: "Marketing & PR" };
  if (compact.includes("legal") || compact.includes("accounting")) {
    return { category: "OPEX - Legal", label: "Legal and Accounting" };
  }
  if (compact === "admin" || compact.includes("adminoperations") || compact === "ga" || compact.includes("generaladmin")) {
    return { category: "OPEX - Admin", label: "Admin" };
  }
  if (compact === "rd" || compact.includes("researchanddevelopment")) {
    return { category: "OPEX - R&D", label: "R&D" };
  }
  if (compact === "hr" || compact.includes("humanresources")) {
    return { category: "OPEX - HR", label: "HR" };
  }
  if (compact.includes("totalopex") || compact.includes("totaloperatingexpenses")) {
    return { category: "OPEX", label: "Total OPEX" };
  }

  // Bottom line
  if (compact.includes("operatingprofit") || compact === "ebitda") {
    return { category: "Operating Profit", label: "Operating Profit (EBITDA)" };
  }
  if (compact === "pmargin" || compact.includes("profitmargin") || compact.includes("netmargin")) {
    return { category: "Operating Profit", label: "P. Margin" };
  }

  // Adte-only "Employer Costs (TMS)" section
  if (compact.includes("monthlyopex")) {
    return { category: "Operating Profit", label: "Monthly OpEX" };
  }
  if (compact.includes("realprofit")) return { category: "Operating Profit", label: "Real Profit" };

  return null;
}

/* ===================================================================
 *  Cell value parsing
 * =================================================================== */

/** Parse a cell as currency / percentage / signed number. Returns 0 for empty or "#DIV/0!". */
function parseCellOrZero(val: unknown): number {
  if (val == null) return 0;
  const raw = String(val).trim();
  if (!raw) return 0;
  if (/^#(?:div\/0|n\/a|ref|value|name|null|num|error)/i.test(raw)) return 0;

  // Parens negative: "(1,234)" → -1234
  const parenNeg = /^\(\s*([^)]+)\s*\)$/.exec(raw);
  const body = parenNeg ? parenNeg[1]! : raw;

  const cleaned = body.replace(/[^0-9.\-]+/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return 0;
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return 0;
  return parenNeg ? -n : n;
}

/* ===================================================================
 *  Per-tab parser
 * =================================================================== */

interface PnlParsedRow {
  month: string;
  category: string;
  label: string;
  amount: number;
}

function parseTabRows(rows: string[][], entity: string): PnlParsedRow[] {
  const header = findMonthHeader(rows);
  if (!header) {
    console.warn(`[pnl sync] ${entity}: month header row not found (looked for "January"..."December")`);
    return [];
  }

  const byKey = new Map<string, PnlParsedRow>();
  for (let r = header.headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const labelRaw = String(row[0] ?? "").trim();
    const mapped = classifyLabel(labelRaw);
    if (!mapped) continue;
    const amounts = header.monthCols.map(({ col }) => parseCellOrZero(row[col]));
    if (mapped.skipWhenAllZero && amounts.every((amount) => amount === 0)) continue;

    for (let i = 0; i < header.monthCols.length; i++) {
      const month = header.monthCols[i]!.month;
      const amount = amounts[i] ?? 0;
      byKey.set(`${mapped.label}|${month}`, {
        month,
        category: mapped.category,
        label: mapped.label,
        amount,
      });
    }
  }

  for (const { month } of header.monthCols) {
    ensureSummedRow(byKey, month, "Revenue", "Total Revenue", ["Media Revenue", "SAAS Revenue"]);
    ensureSummedRow(byKey, month, "COGS", "Total COGS", ["Media Costs", "Adash Costs", "SaaS Costs"]);
  }

  return [...byKey.values()];
}

function ensureSummedRow(
  byKey: Map<string, PnlParsedRow>,
  month: string,
  category: string,
  label: string,
  sourceLabels: string[],
): void {
  const key = `${label}|${month}`;
  const existing = byKey.get(key);
  const sum = sourceLabels.reduce((total, sourceLabel) => {
    return total + (byKey.get(`${sourceLabel}|${month}`)?.amount ?? 0);
  }, 0);

  if (!existing && sum !== 0) {
    byKey.set(key, { month, category, label, amount: sum });
    return;
  }

  if (existing && existing.amount === 0 && sum !== 0) {
    byKey.set(key, { ...existing, amount: sum });
  }
}

/* ===================================================================
 *  Sync entry point
 * =================================================================== */

function escapeSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function rangeForTab(title: string): string {
  return `${escapeSheetTitle(title)}!A1:N60`;
}

export interface SyncPnlResult {
  rowsUpserted: number;
  entities: string[];
}

export async function syncPnlData(): Promise<SyncPnlResult> {
  const allRows: { entity: "Consolidated" | "TMS" | "Adte"; row: PnlParsedRow }[] = [];

  for (const { sheetTitle, entity } of PNL_TABS) {
    console.log(`[pnl sync] Fetching ${sheetTitle}…`);
    const values = await getSheetValues(BILLING_SHEET_ID, rangeForTab(sheetTitle));
    const parsed = parseTabRows(values, entity);
    console.log(
      `[pnl sync] ${entity}: ${parsed.length} cells across ${new Set(parsed.map((p) => p.label)).size} labels`,
    );
    for (const row of parsed) allRows.push({ entity, row });
  }

  if (allRows.length === 0) {
    console.warn("[pnl sync] No rows parsed — check tab names, header row, and label mapping");
    return { rowsUpserted: 0, entities: [] };
  }

  const batch = allRows.map(({ entity, row }) => ({
    entity,
    month: row.month,
    category: row.category,
    label: row.label,
    amount: row.amount,
    updated_at: new Date().toISOString(),
  }));

  for (const { entity } of PNL_TABS) {
    const { error: delErr } = await supabaseAdmin.from("pnl_data").delete().eq("entity", entity);
    if (delErr) throw new Error(`Supabase pnl delete failed (${entity}): ${delErr.message}`);
  }

  const chunk = 400;
  for (let i = 0; i < batch.length; i += chunk) {
    const slice = batch.slice(i, i + chunk);
    const { error } = await supabaseAdmin.from("pnl_data").insert(slice);
    if (error) throw new Error(`Supabase pnl insert failed: ${error.message}`);
  }

  console.log(`[pnl sync] Done: ${batch.length} row(s) across ${PNL_TABS.length} entities`);
  return { rowsUpserted: batch.length, entities: PNL_TABS.map((t) => t.entity) };
}
