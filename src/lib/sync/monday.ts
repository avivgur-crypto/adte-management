/**
 * Monday.com sync: funnel metrics + Leads/Contracts activity.
 * - Leads board 7832231403 (New Partners): every item, no status filter.
 *   Date from Creation Log pulse_log_mkzm1prs → grouped by calendar day (Asia/Jerusalem).
 * - Contracts board 8280704003: status in MONDAY_CONTRACTS_SIGNED_STATUSES (default includes
 *   Complete Storage, Signed, Done, Complete). **Won / activity day** is resolved in
 *   `getContractWonReportingDate` (see `monday-client.ts`), in order:
 *   (1) Last Updated pulse column (default `pulse_updated_mm24tjj9`, overridable via env),
 *   (2) optional Signed Date column, file column, status `changed_at`, item `updated_at`,
 *   (3) Creation Log, then item `created_at`.
 *   Calendar keys use Asia/Jerusalem (`dateKeyFromDate`).
 * - Company list: Account Name column (CONTRACTS_ACCOUNT_NAME_COLUMN_ID), else Monday item name.
 * Before upsert: resets 2026 funnel lead/deal counts and replaces activity rows for both boards.
 */

import {
  CREATION_LOG_COLUMN_IDS,
  CONTRACTS_ACCOUNT_NAME_COLUMN_ID,
  CONTRACTS_LAST_UPDATED_COLUMN_ID,
  CONTRACTS_SIGNED_DATE_COLUMN_ID,
  CONTRACTS_SIGNED_FILE_COLUMN_ID,
  CONTRACTS_STATUS_COLUMN_ID,
  MONDAY_BOARD_IDS,
  fetchBoardItems,
  getContractWonReportingDate,
  getCreationLogDate,
  getColumnText,
} from "@/lib/monday-client";
import { supabaseAdmin } from "@/lib/supabase";

const TABLE = "daily_funnel_metrics";
const ACTIVITY_TABLE = "monday_items_activity";
const LEADS_BOARD_ID = "7832231403";
const CONTRACTS_BOARD_ID = "8280704003";
/** Match Monday UI / business day — avoids UTC vs local shifting March rows into Feb/April. */
const DATE_TZ = "Asia/Jerusalem";

/**
 * Calendar YYYY-MM-DD in Israel (same as XDASH / rest of app).
 * Used for daily_funnel_metrics keys and monday_items_activity.created_date.
 */
function dateKeyFromDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: DATE_TZ });
}

/**
 * Status labels on Media Contracts that count as "signed" for funnel activity.
 * Override with env MONDAY_CONTRACTS_SIGNED_STATUSES="Complete Storage,Signed,Done" (comma-separated).
 */
function signedContractStatuses(): Set<string> {
  const raw =
    process.env.MONDAY_CONTRACTS_SIGNED_STATUSES?.trim() ||
    "Complete Storage,Signed,Done,Complete";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function isSignedContractStatus(status: string | null, allowed: Set<string>): boolean {
  if (status == null) return false;
  const t = status.trim();
  if (t === "") return false;
  return allowed.has(t);
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
    const key = dateKeyFromDate(d);
    byDate.set(key, (byDate.get(key) ?? 0) + 1);
  }
  return byDate;
}

/** Count signed contracts per won reporting day (see getContractWonReportingDate). */
function countByContractWonReportingDate(
  items: Awaited<ReturnType<typeof fetchBoardItems>>,
  creationLogColumnId: string
): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const item of items) {
    const d = getContractWonReportingDate(item, creationLogColumnId);
    const key = dateKeyFromDate(d);
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
    fetchBoardItems(CONTRACTS_BOARD_ID, {
      includeColumnValues: true,
      includeCreatedAt: true,
      includeUpdatedAt: true,
    }),
  ]);

  const signedStatuses = signedContractStatuses();
  const contractsItems = allContractsItems.filter((item) => {
    const status = getColumnText(item, CONTRACTS_STATUS_COLUMN_ID);
    return isSignedContractStatus(status, signedStatuses);
  });

  // Leads: all items on board 7832231403; creation date from Creation log (pulse_log_mkzm1prs).
  const totalLeadsByDate = countByCreationDate(leadsItems, CREATION_LOG_COLUMN_IDS.leads);
  const wonDealsByDate = countByContractWonReportingDate(
    contractsItems,
    CREATION_LOG_COLUMN_IDS.contracts,
  );
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
      const dateStr = dateKeyFromDate(createdAt);
      const fromColumn =
        companyColumnId != null ? getColumnText(item, companyColumnId) : null;
      const company_name =
        fromColumn && fromColumn.trim() !== ""
          ? fromColumn.trim()
          : (item.name?.trim() || null);
      return {
        item_id: String(item.id),
        board_id: boardId,
        created_at: createdAt.toISOString(),
        created_date: dateStr,
        ...(company_name != null && company_name !== "" && { company_name }),
      };
    });
  }

  function toContractActivityRows(
    items: Awaited<ReturnType<typeof fetchBoardItems>>,
    creationLogColumnId: string,
    companyColumnId: string
  ) {
    return items.map((item) => {
      const reporting = getContractWonReportingDate(item, creationLogColumnId);
      const dateStr = dateKeyFromDate(reporting);
      const fromColumn = getColumnText(item, companyColumnId);
      const company_name =
        fromColumn && fromColumn.trim() !== ""
          ? fromColumn.trim()
          : (item.name?.trim() || null);
      return {
        item_id: String(item.id),
        board_id: CONTRACTS_BOARD_ID,
        created_at: reporting.toISOString(),
        created_date: dateStr,
        ...(company_name != null && company_name !== "" && { company_name }),
      };
    });
  }

  console.log(
    `[monday-sync] leads: ${leadsItems.length} items (all statuses, date from ${CREATION_LOG_COLUMN_IDS.leads})`
  );
  console.log(
    `[monday-sync] contracts: ${allContractsItems.length} total → ${contractsItems.length} with signed status in [${[...signedStatuses].join(", ")}]; won-day = lastUpdated(${CONTRACTS_LAST_UPDATED_COLUMN_ID}) → signedDate(${CONTRACTS_SIGNED_DATE_COLUMN_ID || "—"}) → file(${CONTRACTS_SIGNED_FILE_COLUMN_ID || "—"}) → …`,
  );

  // Replace activity for both boards; also drop CRM Deals rows if any remain from a prior source switch.
  const { error: deleteError } = await supabaseAdmin
    .from(ACTIVITY_TABLE)
    .delete()
    .in("board_id", [LEADS_BOARD_ID, CONTRACTS_BOARD_ID, MONDAY_BOARD_IDS.deals]);
  if (deleteError) console.error("[monday-sync] activity cleanup (leads+contracts+crm-orphans):", deleteError.message);

  const activityRows = [
    ...toActivityRows(leadsItems, LEADS_BOARD_ID, CREATION_LOG_COLUMN_IDS.leads),
    ...toContractActivityRows(
      contractsItems,
      CREATION_LOG_COLUMN_IDS.contracts,
      CONTRACTS_ACCOUNT_NAME_COLUMN_ID,
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
