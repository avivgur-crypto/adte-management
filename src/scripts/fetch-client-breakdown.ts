/**
 * Fetches client revenue breakdown from Master Billing (Demand + Supply tabs)
 * and upserts into client_revenue_breakdown.
 *
 * Demand: A=Month, B=Business Entity, C=Income Type, D=Advertiser Name, H=Final Revenue.
 * Supply: A=Month, B=Business Entity, C=Publisher Type, D=Publisher Name, H=Confirmed Costs (No VAT).
 *
 * Before inserting for a month/type, deletes existing rows for that month+type to avoid duplicates.
 *
 * Usage: npm run fetch:client-breakdown
 */

import { getSheetValues } from "../lib/google-sheets";
import { supabaseAdmin } from "../lib/supabase";

const BILLING_SHEET_ID = "1GKzqtjt-5bk4uBd-MIhkbbgSasfcF86eJ9UR-VQYZdQ";
const TABLE = "client_revenue_breakdown";

const COL_MONTH = 0;
const COL_BUSINESS_ENTITY = 1;
const COL_CATEGORY = 2; // Income Type (Demand) or Publisher Type (Supply)
const COL_NAME = 3;     // Advertiser Name (Demand) or Publisher Name (Supply)
const COL_AMOUNT = 7;    // H: Final Revenue (Demand) or Confirmed Costs (Supply)

/** "Jan26" -> "2026-01-01" */
function monthShortToKey(short: string): string {
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const normalized = normalizeMonthCell(short) || short.toLowerCase();
  const m = normalized.slice(0, 3);
  const yy = normalized.slice(3).replace(/\D/g, "");
  const year = yy.length >= 2 ? (parseInt(yy, 10) < 100 ? 2000 + parseInt(yy, 10) : parseInt(yy, 10)) : new Date().getFullYear();
  const mm = months[m] ?? "01";
  return `${year}-${mm}-01`;
}

/** Robust amount: "$2,349.92" or "2000.00" -> number. */
function parseAmount(cell: string | number | undefined): number {
  const val = cell == null ? "" : String(cell).trim();
  if (val === "") return 0;
  const n = parseFloat(String(val).replace(/[$,]/g, "")) || 0;
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Normalize month cell for matching: trim, lowercase 3-letter month + digits.
 * Handles "Jan26", "Jan 26", "January 26", "jan26".
 */
function normalizeMonthCell(cell: string | number | undefined): string {
  const raw = (cell == null ? "" : String(cell)).trim();
  if (!raw) return "";
  const rest = raw.replace(/\s+/g, "");
  const m = rest.slice(0, 3).toLowerCase();
  const yy = rest.slice(3).replace(/\D/g, "");
  return m + yy;
}

/** Returns true if normalized month cell matches target (e.g. "jan26" matches "Jan26"). */
function monthMatches(cell: string | number | undefined, targetShort: string): boolean {
  const cellNorm = normalizeMonthCell(cell);
  const targetNorm = normalizeMonthCell(targetShort);
  if (!cellNorm || !targetNorm) return false;
  return cellNorm === targetNorm;
}

interface AggRow {
  partner_name: string;
  revenue: number;
  business_entity: string;
  category: string;
}

async function processTab(
  tab: "Demand" | "Supply",
  targetMonthShort: string,
  monthKey: string
): Promise<{ count: number; records: Array<{ month: string; partner_name: string; partner_type: "demand" | "supply"; revenue: number; type: "demand" | "supply"; business_entity: string | null; category: string | null }> }> {
  const range = `${tab}!A:H`;
  const rows = await getSheetValues(BILLING_SHEET_ID, range);
  const type = tab.toLowerCase() as "demand" | "supply";

  if (rows.length < 2) {
    console.warn(`  No data found for ${targetMonthShort} in ${tab}.`);
    return { count: 0, records: [] };
  }

  // Log first 5 values of Column A so we see what the script sees
  const firstFiveColA = rows.slice(1, 6).map((r, i) => {
    const raw = r[COL_MONTH];
    const str = String(raw ?? "").trim();
    return `  Row ${i + 2}: "${str}" (normalized: "${normalizeMonthCell(raw)}")`;
  });
  console.log(`  [${tab}] First 5 values of Column A (Month):`);
  firstFiveColA.forEach((line) => console.log(line));

  const byPartner = new Map<string, AggRow>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const monthRaw = row[COL_MONTH];
    if (!monthMatches(monthRaw, targetMonthShort)) continue;

    const name = String(row[COL_NAME] ?? "").trim();
    if (!name) continue;

    const amount = parseAmount(row[COL_AMOUNT]);
    const business_entity = String(row[COL_BUSINESS_ENTITY] ?? "").trim() || null;
    const category = String(row[COL_CATEGORY] ?? "").trim() || null;

    console.log(`  [${tab}] Found: Partner: ${name}, Month: ${monthRaw}, Amount: ${amount}`);

    const existing = byPartner.get(name);
    if (existing) {
      existing.revenue += amount;
    } else {
      byPartner.set(name, {
        partner_name: name,
        revenue: amount,
        business_entity: business_entity ?? "",
        category: category ?? "",
      });
    }
  }

  if (byPartner.size === 0) {
    console.warn(`  No data found for ${targetMonthShort} in ${tab}.`);
    return { count: 0, records: [] };
  }

  const records = Array.from(byPartner.values()).map((r) => ({
    month: monthKey,
    partner_name: r.partner_name,
    partner_type: type,
    revenue: r.revenue,
    type,
    business_entity: r.business_entity || null,
    category: r.category || null,
  }));

  // Delete existing rows for this month + type to prevent duplicates
  const { error: deleteError } = await supabaseAdmin
    .from(TABLE)
    .delete()
    .eq("month", monthKey)
    .eq("partner_type", type);

  if (deleteError) {
    console.warn(`  Warning: delete before insert failed (${deleteError.message}); continuing with upsert.`);
  }

  const { error } = await supabaseAdmin.from(TABLE).insert(records);

  if (error) throw new Error(`${tab} insert failed: ${error.message}`);
  return { count: records.length, records };
}

async function main() {
  const monthsToSync = ["Jan26", "Feb26"];

  console.log("\n=== Client Revenue Breakdown (Demand + Supply) ===\n");

  let totalDemand = 0;
  let totalSupply = 0;

  for (const monthShort of monthsToSync) {
    const monthKey = monthShortToKey(monthShort);
    console.log(`--- ${monthShort} (${monthKey}) ---`);

    const demandResult = await processTab("Demand", monthShort, monthKey);
    const supplyResult = await processTab("Supply", monthShort, monthKey);

    totalDemand += demandResult.count;
    totalSupply += supplyResult.count;

    const demandRev = demandResult.records.reduce((s, r) => s + r.revenue, 0);
    const supplyRev = supplyResult.records.reduce((s, r) => s + r.revenue, 0);
    console.log(`  Demand: ${demandResult.count} partner(s), $${demandRev.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    console.log(`  Supply: ${supplyResult.count} partner(s), $${supplyRev.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    console.log("");
  }

  console.log("=== Summary ===");
  console.log(`  Total Demand partners synced: ${totalDemand}`);
  console.log(`  Total Supply partners synced: ${totalSupply}`);
  console.log("\nDone.\n");
}

main().catch((err) => {
  console.error("Failed to fetch client breakdown:", err);
  process.exit(1);
});
