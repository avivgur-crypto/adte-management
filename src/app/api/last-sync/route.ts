import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

/**
 * Lightweight endpoint — latest `created_at` from DB (no caching).
 * Note: This reflects **XDASH / home totals** (`daily_home_totals`), not Monday-only cron runs.
 * A successful `/api/auto-sync?target=monday` does not move this timestamp unless XDASH also wrote.
 */
export async function GET() {
  try {
    // Prefer daily_home_totals (source of truth for financial data)
    const { data: homeRow } = await supabaseAdmin
      .from("daily_home_totals")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (homeRow?.created_at) {
      return NextResponse.json({ syncedAt: homeRow.created_at }, { headers: NO_CACHE_HEADERS });
    }

    // Fallback to partner table
    const { data } = await supabaseAdmin
      .from("daily_partner_performance")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    return NextResponse.json({ syncedAt: data?.created_at ?? null }, { headers: NO_CACHE_HEADERS });
  } catch {
    return NextResponse.json({ syncedAt: null }, { status: 500, headers: NO_CACHE_HEADERS });
  }
}
