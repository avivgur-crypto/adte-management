/**
 * Monday.com sync: funnel metrics + Leads / New Signed Deals activity.
 *
 * - Leads board 7832231403 (New Partners): every item, no status filter.
 *   Date from Creation Log pulse_log_mkzm1prs → grouped by calendar day (Asia/Jerusalem).
 *
 * - **New Signed Deals** are sourced from the CRM Deals board 7832231409,
 *   restricted to the "Closed Won" group (group id `closed`).
 *     • Won/reporting date: `date_mktkg4zp` (Won Date), parsed as a calendar
 *       day in Asia/Jerusalem (so the row lands on the Israeli business day,
 *       not whatever UTC instant midnight happens to fall on).
 *     • Company name: `board_relation_mkwsdcg0` (Accounts) display text.
 *   The previous Media Contracts board (8280704003) is **no longer used** for
 *   signed-deal counts. Stale rows for that board are removed below so the
 *   2026 "ghost deals" disappear after one sync.
 *
 * Before upsert, the 2026 row in `daily_funnel_metrics` is reset
 * (total_leads = 0, won_deals = 0) so any prior misdated counts disappear.
 */

import {
  CREATION_LOG_COLUMN_IDS,
  SIGNED_DEALS_BOARD_ID,
  SIGNED_DEALS_CLOSED_WON_GROUP_ID,
  SIGNED_DEALS_ACCOUNT_RELATION_COLUMN_ID,
  SIGNED_DEALS_WON_DATE_COLUMN_ID,
  collectClosedWonDealsWithWonDate,
  fetchBoardItems,
  getCreationLogDate,
  getColumnText,
  type MondayItem,
} from "@/lib/monday-client";
import { supabaseAdmin } from "@/lib/supabase";

const TABLE = "daily_funnel_metrics";
const ACTIVITY_TABLE = "monday_items_activity";
const LEADS_BOARD_ID = "7832231403";
/** Legacy Media Contracts board — kept only so we can purge its stale 2026 rows. */
const LEGACY_CONTRACTS_BOARD_ID = "8280704003";
/** Match Monday UI / business day — avoids UTC vs local shifting March rows into Feb/April. */
const DATE_TZ = "Asia/Jerusalem";

/**
 * Calendar YYYY-MM-DD in Israel (same as XDASH / rest of app).
 * Used for daily_funnel_metrics keys and monday_items_activity.created_date.
 */
function dateKeyFromDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: DATE_TZ });
}

/** Count items per creation date (YYYY-MM-DD) for a board. */
function countByCreationDate(
  items: MondayItem[],
  creationLogColumnId: string,
): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const item of items) {
    const createdAt = getCreationLogDate(item, creationLogColumnId);
    const d = createdAt ?? new Date();
    const key = dateKeyFromDate(d);
    byDate.set(key, (byDate.get(key) ?? 0) + 1);
  }
  return byDate;
}

function countSignedDealsByWonDate(
  closedWon: Array<{ wonDate: Date }>,
): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const { wonDate } of closedWon) {
    const key = dateKeyFromDate(wonDate);
    byDate.set(key, (byDate.get(key) ?? 0) + 1);
  }
  return byDate;
}

export interface SyncMondayResult {
  funnelRows: number;
  activityRows: number;
}

export async function syncMondayData(): Promise<SyncMondayResult> {
  const [leadsItems, dealsItems] = await Promise.all([
    fetchBoardItems(LEADS_BOARD_ID, {
      includeColumnValues: true,
      includeCreatedAt: true,
    }),
    fetchBoardItems(SIGNED_DEALS_BOARD_ID, {
      includeColumnValues: true,
      includeCreatedAt: true,
    }),
  ]);

  const { deals: closedWon, skippedMissingWonDate } =
    collectClosedWonDealsWithWonDate(dealsItems);
  if (skippedMissingWonDate > 0) {
    console.warn(
      `[monday-sync] ${skippedMissingWonDate} Closed Won deals on board ${SIGNED_DEALS_BOARD_ID} are missing ${SIGNED_DEALS_WON_DATE_COLUMN_ID}; skipped from funnel/activity.`,
    );
  }

  // Leads: all items on board 7832231403; creation date from Creation log (pulse_log_mkzm1prs).
  const totalLeadsByDate = countByCreationDate(
    leadsItems,
    CREATION_LOG_COLUMN_IDS.leads,
  );
  const wonDealsByDate = countSignedDealsByWonDate(closedWon);
  const allDates = new Set<string>([
    ...totalLeadsByDate.keys(),
    ...wonDealsByDate.keys(),
  ]);

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

  // Reset 2026 funnel rows so stale total_leads / won_deals from the previous
  // Media Contracts source (the 498 ghost-deal rows) clear before the upsert.
  const { error: resetError } = await supabaseAdmin
    .from(TABLE)
    .update({ total_leads: 0, won_deals: 0 })
    .gte("date", "2026-01-01")
    .lt("date", "2027-01-01");
  if (resetError) {
    console.error(
      "[monday-sync] funnel total_leads/won_deals reset:",
      resetError.message,
    );
  }

  if (funnelRows.length > 0) {
    const { error: funnelError } = await supabaseAdmin
      .from(TABLE)
      .upsert(funnelRows, { onConflict: "date" });
    if (funnelError) {
      throw new Error(`Supabase funnel upsert failed: ${funnelError.message}`);
    }
  }

  function toLeadsActivityRows(items: MondayItem[]) {
    return items.map((item) => {
      const createdAtDate = getCreationLogDate(item, CREATION_LOG_COLUMN_IDS.leads);
      const createdAt = createdAtDate ?? new Date(item.created_at ?? Date.now());
      const dateStr = dateKeyFromDate(createdAt);
      const company_name = item.name?.trim() || null;
      return {
        item_id: String(item.id),
        board_id: LEADS_BOARD_ID,
        created_at: createdAt.toISOString(),
        created_date: dateStr,
        ...(company_name != null && company_name !== "" && { company_name }),
      };
    });
  }

  function toSignedDealActivityRows(
    closed: Array<{ item: MondayItem; wonDate: Date }>,
  ) {
    return closed.map(({ item, wonDate }) => {
      const dateStr = dateKeyFromDate(wonDate);
      // Accounts (board_relation_mkwsdcg0): Monday returns linked-item names as `text`.
      const fromColumn = getColumnText(item, SIGNED_DEALS_ACCOUNT_RELATION_COLUMN_ID);
      const company_name =
        fromColumn && fromColumn.trim() !== ""
          ? fromColumn.trim()
          : item.name?.trim() || null;
      return {
        item_id: String(item.id),
        board_id: SIGNED_DEALS_BOARD_ID,
        created_at: wonDate.toISOString(),
        created_date: dateStr,
        ...(company_name != null && company_name !== "" && { company_name }),
      };
    });
  }

  console.log(
    `[monday-sync] leads: ${leadsItems.length} items (all statuses, date from ${CREATION_LOG_COLUMN_IDS.leads})`,
  );
  console.log(
    `[monday-sync] signed deals: ${dealsItems.length} total deals on board ${SIGNED_DEALS_BOARD_ID} → ${closedWon.length} in group "${SIGNED_DEALS_CLOSED_WON_GROUP_ID}" with ${SIGNED_DEALS_WON_DATE_COLUMN_ID}; company from ${SIGNED_DEALS_ACCOUNT_RELATION_COLUMN_ID}`,
  );

  // Replace activity for every board we manage so misdated or duplicate rows
  // from previous syncs (incl. the legacy Media Contracts board 8280704003)
  // are removed before re-inserting.
  const { error: deleteError } = await supabaseAdmin
    .from(ACTIVITY_TABLE)
    .delete()
    .in("board_id", [
      LEADS_BOARD_ID,
      SIGNED_DEALS_BOARD_ID,
      LEGACY_CONTRACTS_BOARD_ID,
    ]);
  if (deleteError) {
    console.error(
      "[monday-sync] activity cleanup (leads + signed deals + legacy contracts):",
      deleteError.message,
    );
  }

  const activityRows = [
    ...toLeadsActivityRows(leadsItems),
    ...toSignedDealActivityRows(closedWon),
  ];

  let activityRowsUpserted = 0;
  if (activityRows.length > 0) {
    const { error: activityError } = await supabaseAdmin
      .from(ACTIVITY_TABLE)
      .upsert(activityRows, { onConflict: "item_id,board_id", ignoreDuplicates: false });
    if (activityError) {
      throw new Error(`Activity upsert failed: ${activityError.message}`);
    }
    activityRowsUpserted = activityRows.length;
  }

  return { funnelRows: funnelRows.length, activityRows: activityRowsUpserted };
}
