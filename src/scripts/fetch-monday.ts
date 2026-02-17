/**
 * Fetches Monday.com funnel data and upserts into daily_funnel_metrics.
 * Also upserts monday_items_activity for Leads (7832231403) and Contracts (8280704003) with created_at.
 *
 * If MONDAY_BOARD_ID is set: fetches one board and maps Status column to metrics.
 * Otherwise uses MONDAY_BOARD_IDS (Leads, Deals, Contracts boards) with legacy logic.
 *
 * Usage: npm run fetch:monday
 */

import {
  CREATION_LOG_COLUMN_IDS,
  MONDAY_BOARD_ID,
  MONDAY_BOARD_IDS,
  fetchBoardItems,
  getCreationLogDate,
  getItemStatus,
} from "../lib/monday-client";
import { supabaseAdmin } from "../lib/supabase";

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
  const conversionRate = safeRate(qualified_leads, total_leads);
  const winRate = safeRate(won_deals, total_leads);

  return {
    total_leads,
    qualified_leads,
    ops_approved_leads,
    won_deals,
    conversion_rate: conversionRate,
    win_rate: winRate,
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

async function main() {
  const today = new Date().toISOString().split("T")[0];

  console.log("Fetching Monday.com funnel...\n");

  let row: {
    total_leads: number;
    qualified_leads: number;
    ops_approved_leads: number;
    won_deals: number;
    conversion_rate: number | null;
    win_rate: number | null;
  };

  if (MONDAY_BOARD_ID) {
    console.log(`Using single board (MONDAY_BOARD_ID): ${MONDAY_BOARD_ID}`);
    row = await runStatusBasedFunnel(MONDAY_BOARD_ID);
  } else {
    console.log("Using Leads / Deals / Contracts boards (legacy)");
    row = await runLegacyFunnel();
  }

  const { error } = await supabaseAdmin
    .from(TABLE)
    .upsert({ date: today, ...row }, { onConflict: "date" });

  if (error) throw new Error(`Supabase upsert failed: ${error.message}`);

  console.log(`Upserted daily_funnel_metrics for date=${today}\n`);

  // --- Activity: Leads + Contracts using creation log columns ---
  // Leads (7832231403): column pulse_log_mkzm790s; Contracts (8280704003): column pulse_log_mkzm1prs.
  // Upsert overwrites created_at/created_date so existing records get correct dates (January backfill).
  console.log("Fetching activity items (Leads + Contracts, creation log columns)...");
  const [leadsItems, contractsItems] = await Promise.all([
    fetchBoardItems(LEADS_BOARD_ID, { includeColumnValues: true }),
    fetchBoardItems(CONTRACTS_BOARD_ID, { includeColumnValues: true }),
  ]);

  function toActivityRows(
    items: Awaited<ReturnType<typeof fetchBoardItems>>,
    boardId: string,
    creationLogColumnId: string
  ): { item_id: string; board_id: string; created_at: string; created_date: string }[] {
    return items.map((item) => {
      const createdAtDate = getCreationLogDate(item, creationLogColumnId);
      const createdAt = createdAtDate ?? new Date();
      const createdDate = createdAt.toISOString().split("T")[0];
      return {
        item_id: String(item.id),
        board_id: boardId,
        created_at: createdAt.toISOString(),
        created_date: createdDate,
      };
    });
  }

  const activityRows = [
    ...toActivityRows(leadsItems, LEADS_BOARD_ID, CREATION_LOG_COLUMN_IDS.leads),
    ...toActivityRows(contractsItems, CONTRACTS_BOARD_ID, CREATION_LOG_COLUMN_IDS.contracts),
  ];

  if (activityRows.length > 0) {
    const { error: activityError } = await supabaseAdmin
      .from(ACTIVITY_TABLE)
      .upsert(activityRows, { onConflict: "item_id,board_id", ignoreDuplicates: false });

    if (activityError) throw new Error(`Activity upsert failed: ${activityError.message}`);
    console.log(`Upserted ${activityRows.length} rows into ${ACTIVITY_TABLE}\n`);
  }

  console.log("=== Funnel Summary ===");
  console.log(`  Total Leads:      ${row.total_leads}`);
  console.log(`  Qualified Leads:  ${row.qualified_leads}`);
  console.log(`  Ops Approved:     ${row.ops_approved_leads}`);
  console.log(`  Won Deals:        ${row.won_deals}`);
  console.log(`  Conversion Rate:  ${row.conversion_rate ?? "—"}%`);
  console.log(`  Win Rate:         ${row.win_rate ?? "—"}%`);
  console.log("\nDone.\n");
}

main().catch((err) => {
  console.error("Failed to fetch Monday funnel data:", err);
  process.exit(1);
});
