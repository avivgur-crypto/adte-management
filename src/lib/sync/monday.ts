/**
 * Monday.com sync: funnel metrics + Leads/Contracts activity.
 * - Leads board 7832231403 (New Partners): every item, no status filter.
 *   Date from Creation Log column pulse_log_mkzm790s → grouped by YYYY-MM-DD.
 * - Contracts board 8280704003: only status "Complete Storage" (cm_status_template).
 *   Date from Creation Log pulse_log_mkzm1prs.
 * Before upsert: resets 2026 funnel lead/deal counts and replaces activity rows for both boards.
 */

import {
  CREATION_LOG_COLUMN_IDS,
  CONTRACTS_COMPANY_COLUMN_ID,
  CONTRACTS_STATUS_COLUMN_ID,
  CONTRACTS_SIGNED_STATUS,
  fetchBoardItems,
  getCreationLogDate,
  getColumnText,
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
  const [leadsItems, allContractsItems] = await Promise.all([
    fetchBoardItems(LEADS_BOARD_ID, { includeColumnValues: true, includeCreatedAt: true }),
    fetchBoardItems(CONTRACTS_BOARD_ID, { includeColumnValues: true, includeCreatedAt: true }),
  ]);

  // Only items with status "Complete Storage" count as signed deals
  const contractsItems = allContractsItems.filter((item) => {
    const status = getColumnText(item, CONTRACTS_STATUS_COLUMN_ID);
    return status === CONTRACTS_SIGNED_STATUS;
  });

  // Leads: all items on board 7832231403; creation date from pulse_log_mkzm790s only.
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
  // Reset 2026 funnel rows so stale total_leads / won_deals from old logic or misdated rows clear.
  const { error: resetError } = await supabaseAdmin
    .from(TABLE)
    .update({ total_leads: 0, won_deals: 0 })
    .gte("date", "2026-01-01")
    .lt("date", "2027-01-01");
  if (resetError) console.error("[monday-sync] funnel total_leads/won_deals reset:", resetError.message);

  if (funnelRows.length > 0) {
    const { error: funnelError } = await supabaseAdmin
      .from(TABLE)
      .upsert(funnelRows, { onConflict: "date" });
    if (funnelError) throw new Error(`Supabase funnel upsert failed: ${funnelError.message}`);
  }

  function toActivityRows(
    items: Awaited<ReturnType<typeof fetchBoardItems>>,
    boardId: string,
    creationLogColumnId: string,
    companyColumnId?: string
  ) {
    return items.map((item) => {
      const createdAtDate = getCreationLogDate(item, creationLogColumnId);
      const createdAt = createdAtDate ?? new Date(item.created_at ?? Date.now());
      const dateStr = dateToKey(createdAt);
      const company_name =
        companyColumnId != null ? getColumnText(item, companyColumnId) : null;
      return {
        item_id: String(item.id),
        board_id: boardId,
        created_at: createdAt.toISOString(),
        created_date: dateStr,
        ...(company_name != null && company_name !== "" && { company_name }),
      };
    });
  }

  console.log(
    `[monday-sync] leads: ${leadsItems.length} items (all statuses, date from ${CREATION_LOG_COLUMN_IDS.leads})`
  );
  console.log(
    `[monday-sync] contracts: ${allContractsItems.length} total → ${contractsItems.length} with status "${CONTRACTS_SIGNED_STATUS}"`
  );

  // Replace activity for both boards so misdated or duplicate rows from old syncs are removed.
  const { error: deleteError } = await supabaseAdmin
    .from(ACTIVITY_TABLE)
    .delete()
    .in("board_id", [LEADS_BOARD_ID, CONTRACTS_BOARD_ID]);
  if (deleteError) console.error("[monday-sync] activity cleanup (leads+contracts):", deleteError.message);

  const activityRows = [
    ...toActivityRows(leadsItems, LEADS_BOARD_ID, CREATION_LOG_COLUMN_IDS.leads),
    ...toActivityRows(
      contractsItems,
      CONTRACTS_BOARD_ID,
      CREATION_LOG_COLUMN_IDS.contracts,
      CONTRACTS_COMPANY_COLUMN_ID
    ),
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
