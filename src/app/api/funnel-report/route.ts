import { NextRequest, NextResponse } from "next/server";
import { getMonthlyFunnelMetrics } from "@/app/actions/sales-funnel-live";

/**
 * GET /api/funnel-report?year=2026&month=2
 *
 * Generates the PDFMonkey-ready JSON payload for a given reporting month.
 * Fetches live data from Monday.com (Leads, Deals, Media Contracts boards)
 * and applies the additive funnel formulas.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const yearStr = searchParams.get("year");
  const monthStr = searchParams.get("month");

  const year = yearStr ? parseInt(yearStr, 10) : NaN;
  const month = monthStr ? parseInt(monthStr, 10) : NaN;

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return NextResponse.json(
      { error: "Provide valid ?year=YYYY&month=M (1-12)" },
      { status: 400 },
    );
  }

  const data = await getMonthlyFunnelMetrics(year, month);

  if (!data) {
    return NextResponse.json(
      { error: "Failed to fetch funnel data from Monday.com" },
      { status: 502 },
    );
  }

  const period = new Date(year, month - 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  const winRate =
    data.overallWinRatePercent != null ? `${data.overallWinRatePercent}%` : "0.0%";

  const payload = {
    period,
    total_pipeline: String(data.totalLeads),
    leads_count: String(data.totalLeads),
    qualified_count: String(data.qualifiedLeads),
    ops_count: String(data.opsApprovedLeads),
    won_count: String(data.wonDeals),
    contracts: String(data.wonDeals),
    win_rate: winRate,
    velocity: "113",
    executive_summary: `Current funnel performance shows a ${winRate} overall win rate from ${data.totalLeads} leads to ${data.wonDeals} signed contracts.`,
  };

  return NextResponse.json(payload);
}
