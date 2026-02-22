/**
 * Monday.com sync: funnel metrics + Leads/Contracts activity.
 * Used by the unified cron sync and by npm run fetch:monday.
 */

import {
  CREATION_LOG_COLUMN_IDS,
  MONDAY_BOARD_ID,
  MONDAY_BOARD_IDS,
  fetchBoardItems,
  getCreationLogDate,
  getItemStatus,
} from "@/lib/monday-client";
import { supabaseAdmin } from "@/lib/supabase";

const TABLE = "daily_funnel_metrics";
const ACTIVITY_TABLE = "monday_items_activity";
const LEADS_BOARD_ID = "7832231403";
const CONTRACTS_BOARD_ID = "8280704003";

const STATUS_TO_METRIC = {
  "new leads": "total_leads",
  "qualified/discovery": "qualified_leads",
  "qualified": "qualified_leads",
  "discovery": "qualified_leads",
  "proposal/negotiation": "ops_approved_leads",
  "proposal": "ops_approved_leads",
  "negotiation": "ops_approved_leads",
  "closed won": "won_deals",
  "closed won ": "won_deals",
} as Record<string, "total_leads" | "qualified_leads" | "ops_approved_leads" | "won_deals">;

function normalizeStatus(s: string | null): string {
  if (!s) return "";
  return s.trim().toLowerCase();
}

function safeRate(num: number, denom: number): number | null {
  if (denom === 0) return null;
  return Number(((num / denom) * 100).toFixed(2));
}

async function runStatusBasedFunnel(boardId: string) {
  const items = await fetchBoardItems(boardId, { includeColumnValues: true });
  const counts = {
    total_leads: 0,
    qualified_leads: 0,
    ops_approved_leads: 0,
    won_deals: 0,
  };
  for (const item of items) {
    const status = normalizeStatus(getItemStatus(item));
    if (!status) continue;
    const key = STATUS_TO_METRIC[status];
    if (key) counts[key]++;
  }
  const { total_leads, qualified_leads, ops_approved_leads, won_deals } = counts;
  return {
    total_leads,
    qualified_leads,
    ops_approved_leads,
    won_deals,
    conversion_rate: safeRate(qualified_leads, total_leads),
    win_rate: safeRate(won_deals, total_leads),
  };
}

async function runLegacyFunnel() {
  const [leadsItems, dealsItems, contractsItems] = await Promise.all([
    fetchBoardItems(MONDAY_BOARD_IDS.leads),
    fetchBoardItems(MONDAY_BOARD_IDS.deals, { includeColumnValues: true }),
    fetchBoardItems(MONDAY_BOARD_IDS.contracts),
  ]);
  const OPS_STATUSES = ["Ops", "Legal", "Sign"];
  const isOps = (s: string | null) =>
    s && OPS_STATUSES.some((o) => o.toLowerCase() === s.trim().toLowerCase());
  const wonDeals = contractsItems.length;
  const totalLeads = leadsItems.length + wonDeals;
  const qualifiedLeads = dealsItems.length + wonDeals;
  const opsApprovedLeads =
    dealsItems.filter((i) => isOps(getItemStatus(i))).length + wonDeals;
  return {
    total_leads: totalLeads,
    qualified_leads: qualifiedLeads,
    ops_approved_leads: opsApprovedLeads,
    won_deals: wonDeals,
    conversion_rate: safeRate(qualifiedLeads, totalLeads),
    win_rate: safeRate(wonDeals, totalLeads),
  };
}

export interface SyncMondayResult {
  funnelRows: number;
  activityRows: number;
}

export async function syncMondayData(): Promise<SyncMondayResult> {
  const today = new Date().toISOString().split("T")[0];
  let row: {
    total_leads: number;
    qualified_leads: number;
    ops_approved_leads: number;
    won_deals: number;
    conversion_rate: number | null;
    win_rate: number | null;
  };

  if (MONDAY_BOARD_ID) {
    row = await runStatusBasedFunnel(MONDAY_BOARD_ID);
  } else {
    row = await runLegacyFunnel();
  }

  const { error } = await supabaseAdmin
    .from(TABLE)
    .upsert({ date: today, ...row }, { onConflict: "date" });
  if (error) throw new Error(`Supabase funnel upsert failed: ${error.message}`);

  const [leadsItems, contractsItems] = await Promise.all([
    fetchBoardItems(LEADS_BOARD_ID, { includeColumnValues: true }),
    fetchBoardItems(CONTRACTS_BOARD_ID, { includeColumnValues: true }),
  ]);

  function toActivityRows(
    items: Awaited<ReturnType<typeof fetchBoardItems>>,
    boardId: string,
    creationLogColumnId: string
  ): { item_id: string; created_at: string }[] {
    return items.map((item) => {
      const createdAtDate = getCreationLogDate(item, creationLogColumnId);
      const createdAt = createdAtDate ?? new Date();
      return {
        item_id: String(item.id),
        created_at: createdAt.toISOString(),
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
      .upsert(activityRows, { onConflict: "item_id", ignoreDuplicates: false });
    if (activityError) throw new Error(`Activity upsert failed: ${activityError.message}`);
    activityRowsUpserted = activityRows.length;
  }

  return { funnelRows: 1, activityRows: activityRowsUpserted };
}
