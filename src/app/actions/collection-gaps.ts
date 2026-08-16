"use server";

import { supabaseAdmin } from "@/lib/supabase";
import { fetchTopCollectionGapsFromSheet } from "@/lib/sync/billing";

export interface CollectionGapPartner {
  partnerName: string;
  finalRevenue: number;
  amountReceived: number;
  /** Final Revenue − Amount Received (largest unpaid first). */
  gap: number;
}

function rankFromDbRows(
  rows: Array<{
    partner_name: string | null;
    final_revenue: number | null;
    amount_received: number | null;
  }>,
): CollectionGapPartner[] {
  const byPartner = new Map<
    string,
    { finalRevenue: number; amountReceived: number }
  >();

  for (const r of rows) {
    const name = String(r.partner_name ?? "").trim() || "(Unnamed)";
    const prev = byPartner.get(name) ?? { finalRevenue: 0, amountReceived: 0 };
    prev.finalRevenue += Number(r.final_revenue ?? 0);
    prev.amountReceived += Number(r.amount_received ?? 0);
    byPartner.set(name, prev);
  }

  return [...byPartner.entries()]
    .map(([partnerName, amounts]) => ({
      partnerName,
      finalRevenue: amounts.finalRevenue,
      amountReceived: amounts.amountReceived,
      gap: amounts.finalRevenue - amounts.amountReceived,
    }))
    .filter((p) => p.gap > 0)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 5);
}

/**
 * Top 5 advertisers with the largest unpaid collection gap for the given months.
 * Gap = Σ Final Revenue − Σ Amount Received (Master Billing Demand).
 * Prefers DB cache; falls back to live Demand sheet if table is empty/missing.
 */
export async function getTopCollectionGaps(
  months: string[],
): Promise<CollectionGapPartner[]> {
  if (months.length === 0) return [];

  const { data: rows, error } = await supabaseAdmin
    .from("billing_collection_partners")
    .select("partner_name, final_revenue, amount_received")
    .in("month", months);

  if (!error && rows?.length) {
    return rankFromDbRows(rows);
  }

  return fetchTopCollectionGapsFromSheet(months);
}
