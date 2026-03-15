import { supabaseAdmin } from "@/lib/supabase";
import {
  DEALS_STATUS_COLUMN_ID,
  MONDAY_BOARD_IDS,
  fetchBoardItems,
  getColumnText,
  getItemStatus,
  type MondayItem,
} from "@/lib/monday-client";

const OPS_STAGE_KEYWORDS = ["ops", "legal", "sign"] as const;

export async function syncFunnelToSupabase(): Promise<{
  synced: boolean;
  totalLeads?: number;
  wonDeals?: number;
  error?: string;
}> {
  try {
    const [leadsItems, dealsItems, contractsItems] = await Promise.all([
      fetchBoardItems(MONDAY_BOARD_IDS.leads, { includeColumnValues: false }),
      fetchBoardItems(MONDAY_BOARD_IDS.deals, { includeColumnValues: true }),
      fetchBoardItems(MONDAY_BOARD_IDS.contracts, { includeColumnValues: false }),
    ]);

    const contractsCount = contractsItems.length;

    let opsApprovedCount = 0;
    const getDealStatus = DEALS_STATUS_COLUMN_ID
      ? (item: MondayItem) => getColumnText(item, DEALS_STATUS_COLUMN_ID)
      : getItemStatus;

    for (const item of dealsItems) {
      const status = (getDealStatus(item) ?? "").trim().toLowerCase();
      if (status && OPS_STAGE_KEYWORDS.some((kw) => status.includes(kw))) {
        opsApprovedCount += 1;
      }
    }

    const totalLeads = leadsItems.length + contractsCount;
    const qualifiedLeads = dealsItems.length + contractsCount;
    const opsApprovedLeads = opsApprovedCount + contractsCount;
    const wonDeals = contractsCount;

    const leadToQualifiedPct =
      totalLeads > 0 ? Number(((qualifiedLeads / totalLeads) * 100).toFixed(1)) : null;
    const qualifiedToOpsPct =
      qualifiedLeads > 0
        ? Math.min(100, Number(((opsApprovedLeads / qualifiedLeads) * 100).toFixed(1)))
        : null;
    const opsToWonPct =
      opsApprovedLeads > 0
        ? Math.min(100, Number(((wonDeals / opsApprovedLeads) * 100).toFixed(1)))
        : null;
    const winRatePct =
      totalLeads > 0 ? Number(((wonDeals / totalLeads) * 100).toFixed(1)) : null;

    const { error } = await supabaseAdmin.from("cached_funnel_metrics").upsert({
      id: "latest",
      total_leads: totalLeads,
      qualified_leads: qualifiedLeads,
      ops_approved: opsApprovedLeads,
      won_deals: wonDeals,
      lead_to_qualified_pct: leadToQualifiedPct,
      qualified_to_ops_pct: qualifiedToOpsPct,
      ops_to_won_pct: opsToWonPct,
      win_rate_pct: winRatePct,
      month_label: "All time",
      updated_at: new Date().toISOString(),
    });

    if (error) {
      console.error("[sync-funnel] upsert failed:", error.message);
      return { synced: false, error: error.message };
    }

    console.log(`[sync-funnel] Synced: ${totalLeads} leads, ${wonDeals} won deals`);
    return { synced: true, totalLeads, wonDeals };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sync-funnel] failed:", msg);
    return { synced: false, error: msg };
  }
}
