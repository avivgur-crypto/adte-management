"use server";

import { withRetry } from "@/lib/resilience";
import { supabaseAdmin } from "@/lib/supabase";

const LEADS_BOARD_ID = "7832231403";
const CONTRACTS_BOARD_ID = "8280704003";
const TABLE = "monday_items_activity";

export interface ActivityMetrics {
  newLeads: number;
  newSignedDeals: number;
}

/**
 * Build date range filter for a list of month starts (YYYY-MM-01).
 * Each month is [monthStart, nextMonthStart).
 */
function monthRanges(monthStarts: string[]): { start: string; end: string }[] {
  return monthStarts.map((monthStart) => {
    const [y, m] = monthStart.split("-").map(Number);
    const endMonth = m === 12 ? 1 : m + 1;
    const endYear = m === 12 ? y + 1 : y;
    const end = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
    return { start: monthStart, end };
  });
}

/**
 * Count items in monday_items_activity for a board where created_date falls within any of the selected months.
 */
export async function getActivityMetrics(
  monthStarts: string[]
): Promise<ActivityMetrics> {
  if (monthStarts.length === 0) {
    return { newLeads: 0, newSignedDeals: 0 };
  }

  return withRetry(async () => {
    const ranges = monthRanges(monthStarts);

    async function countForBoard(boardId: string): Promise<number> {
      const queries = ranges.map(({ start, end }) =>
        supabaseAdmin
          .from(TABLE)
          .select("id", { count: "exact", head: true })
          .eq("board_id", boardId)
          .gte("created_date", start)
          .lt("created_date", end)
      );

      const results = await Promise.all(queries);
      return results.reduce((sum, r) => sum + (r.count ?? 0), 0);
    }

    const [newLeads, newSignedDeals] = await Promise.all([
      countForBoard(LEADS_BOARD_ID),
      countForBoard(CONTRACTS_BOARD_ID),
    ]);

    return { newLeads, newSignedDeals };
  });
}
