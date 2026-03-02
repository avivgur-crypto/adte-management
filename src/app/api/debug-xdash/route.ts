import { NextResponse } from "next/server";
import {
  fetchAdServerOverview,
  extractRevenueFromHomeResponse,
} from "@/lib/xdash-client";

/**
 * Debug route: GET /api/debug-xdash
 * Fetches XDASH **backup** home overview for Jan 2026, returns extracted revenue + raw for inspection.
 */
export async function GET() {
  const startDate = "2026-01-01";
  const endDate = "2026-01-31";

  try {
    const raw = await fetchAdServerOverview({
      startDate,
      endDate,
      specificComparisonDate: null,
    });

    const extractedRevenue = extractRevenueFromHomeResponse(raw);

    const ot = (raw as Record<string, unknown>)?.overviewTotals as
      | Record<string, unknown>
      | undefined;
    const sd = ot?.selectedDates as Record<string, unknown> | undefined;
    const totals = sd?.totals as Record<string, unknown> | undefined;

    return NextResponse.json({
      startDate,
      endDate,
      extractedRevenue,
      totalsPreview: totals
        ? {
            revenue: totals.revenue,
            netRevenue: totals.netRevenue,
          }
        : null,
      raw,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("XDASH debug error:", err);
    return NextResponse.json(
      { error: message, startDate: "2026-01-01", endDate: "2026-01-31" },
      { status: 500 }
    );
  }
}
