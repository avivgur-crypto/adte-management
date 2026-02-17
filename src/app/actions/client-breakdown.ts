"use server";

import { supabaseAdmin } from "@/lib/supabase";

export interface ClientBreakdownPartner {
  partner_name: string;
  partner_type: string;
  revenue: number;
  percent: number;
}

export interface ClientBreakdownResult {
  month: string;
  totalRevenue: number;
  partners: ClientBreakdownPartner[];
}

/** Top 10 partners by revenue for current month with % of total (concentration). */
export async function getClientBreakdown(): Promise<ClientBreakdownResult | null> {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const { data: rows, error } = await supabaseAdmin
    .from("client_revenue_breakdown")
    .select("partner_name, partner_type, revenue")
    .eq("month", monthKey)
    .order("revenue", { ascending: false })
    .limit(10);

  if (error || !rows?.length) return null;

  const totalRevenue = rows.reduce((s, r) => s + Number(r.revenue ?? 0), 0);
  const partners: ClientBreakdownPartner[] = rows.map((r) => {
    const revenue = Number(r.revenue ?? 0);
    const percent = totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0;
    return {
      partner_name: String(r.partner_name ?? ""),
      partner_type: String(r.partner_type ?? ""),
      revenue,
      percent: Math.round(percent * 10) / 10,
    };
  });

  return { month: monthKey, totalRevenue, partners };
}
