/**
 * Monday.com sync: funnel metrics + Leads/Contracts activity.
 * - Leads board 7832231403 → total_leads per day (by creation date).
 * - Signed Deals board 8280704003 → won_deals per day (by creation date).
 * Uses created_at / creation log from Monday to determine date for each item.
 */

import {
  CREATION_LOG_COLUMN_IDS,
  fetchBoardItems,
  getCreationLogDate,
} from "@/lib/monday-client";
import { supabaseAdmin } from "@/lib/supabase";

const TABLE = "daily_funnel_metrics";
const ACTIVITY_TABLE = "monday_items_activity";
const LEADS_BOARD_ID = "7832231403";
const CONTRACTS_BOARD_ID = "8280704003";

function dateToKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Count items per creation date (YYYY-MM-DD) for a board. */
function countByCreationDate(
  items: Awaited<ReturnType<typeof fetchBoardItems>>,
  creationLogColumnId: string
): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const item of items) {
    const createdAt = getCreationLogDate(item, creationLogColumnId);
    const d = createdAt ?? new Date();
    const key = dateToKey(d);
    byDate.set(key, (byDate.get(key) ?? 0) + 1);
  }
  return byDate;
}

export interface SyncMondayResult {
  funnelRows: number;
  activityRows: number;
}

export async function syncMondayData(): Promise<SyncMondayResult> {
  const [leadsItems, contractsItems] = await Promise.all([
    fetchBoardItems(LEADS_BOARD_ID, { includeColumnValues: true, includeCreatedAt: true }),
    fetchBoardItems(CONTRACTS_BOARD_ID, { includeColumnValues: true, includeCreatedAt: true }),
  ]);

  const totalLeadsByDate = countByCreationDate(leadsItems, CREATION_LOG_COLUMN_IDS.leads);
  const wonDealsByDate = countByCreationDate(contractsItems, CREATION_LOG_COLUMN_IDS.contracts);
  const allDates = new Set<string>([...totalLeadsByDate.keys(), ...wonDealsByDate.keys()]);

  const funnelRows: Array<{
    date: string;
    total_leads: number;
    qualified_leads: number;
    ops_approved_leads: number;
    won_deals: number;
    conversion_rate: number | null;
    win_rate: number | null;
  }> = [];
  for (const date of allDates) {
    funnelRows.push({
      date,
      total_leads: totalLeadsByDate.get(date) ?? 0,
      qualified_leads: 0,
      ops_approved_leads: 0,
      won_deals: wonDealsByDate.get(date) ?? 0,
      conversion_rate: null,
      win_rate: null,
    });
  }
  if (funnelRows.length > 0) {
    const { error: funnelError } = await supabaseAdmin
      .from(TABLE)
      .upsert(funnelRows, { onConflict: "date" });
    if (funnelError) throw new Error(`Supabase funnel upsert failed: ${funnelError.message}`);
  }

  function toActivityRows(
    items: Awaited<ReturnType<typeof fetchBoardItems>>,
    boardId: string,
    creationLogColumnId: string
  ) {
    return items.map((item) => {
      const createdAtDate = getCreationLogDate(item, creationLogColumnId);
      const createdAt = createdAtDate ?? new Date(item.created_at ?? Date.now());
      const dateStr = dateToKey(createdAt);
      return {
        item_id: String(item.id),
        board_id: boardId,
        created_at: createdAt.toISOString(),
        created_date: dateStr,
      };
    });
  }

  const activityRows = [
    ...toActivityRows(leadsItems, LEADS_BOARD_ID, CREATION_LOG_COLUMN_IDS.leads),
    ...toActivityRows(contractsItems, CONTRACTS_BOARD_ID, CREATION_LOG_COLUMN_IDS.contracts),
  ];

  let activityRowsUpserted = 0;
  if (activityRows.length > 0) {
    const { error: activityError } = await supabaseAdmin
      .from(ACTIVITY_TABLE)
      .upsert(activityRows, { onConflict: "item_id,board_id", ignoreDuplicates: false });
    if (activityError) throw new Error(`Activity upsert failed: ${activityError.message}`);
    activityRowsUpserted = activityRows.length;
  }

  return { funnelRows: funnelRows.length, activityRows: activityRowsUpserted };
}
