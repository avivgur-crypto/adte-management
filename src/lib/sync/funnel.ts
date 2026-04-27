import { supabaseAdmin } from "@/lib/supabase";
import {
  MONDAY_BOARD_IDS,
  SIGNED_DEALS_WON_DATE_COLUMN_ID,
  FUNNEL_DEALS_STATUS_COL,
  FUNNEL_DEALS_GROUP_IDS,
  FUNNEL_OPS_STATUSES,
  collectClosedWonDealsWithWonDate,
  fetchBoardItems,
  filterActiveItems,
  getColumnText,
} from "@/lib/monday-client";

/**
 * Compute the new funnel stages from Monday.com and upsert to
 * cached_funnel_metrics so the dashboard reads from Supabase.
 *
 * Stage 1 (Leads):        ALL active items on the Leads board.
 * Stage 2 (Qualified):    Active Deals in groups (topics | new_group_mkmgrv50) + ALL active Contracts.
 * Stage 3 (Ops Approved): Same group-filtered Deals whose status_mkmxymkn is
 *                          Legal Negotiation / Waiting for sign / Negotiation Failed + ALL active Contracts.
 * Stage 4 (Won Deals):    CRM Deals board — "Closed Won" group with Won Date (`date_mktkg4zp`), same as `syncMondayData`.
 * Win Rate:               Stage 4 / Stage 1 * 100.
 */
export async function syncFunnelToSupabase(): Promise<{
  synced: boolean;
  totalLeads?: number;
  wonDeals?: number;
  error?: string;
}> {
  try {
    const [leadsRaw, dealsRaw, contractsRaw] = await Promise.all([
      fetchBoardItems(MONDAY_BOARD_IDS.leads, { includeColumnValues: false }),
      fetchBoardItems(MONDAY_BOARD_IDS.deals, { includeColumnValues: true }),
      fetchBoardItems(MONDAY_BOARD_IDS.contracts, { includeColumnValues: false }),
    ]);

    const leads = filterActiveItems(leadsRaw);
    const deals = filterActiveItems(dealsRaw);
    const contracts = filterActiveItems(contractsRaw);

    const { deals: closedWon, skippedMissingWonDate } =
      collectClosedWonDealsWithWonDate(dealsRaw);
    if (skippedMissingWonDate > 0) {
      console.warn(
        `[sync-funnel] ${skippedMissingWonDate} Closed Won deals missing ${SIGNED_DEALS_WON_DATE_COLUMN_ID}; excluded from won count.`,
      );
    }

    const contractsCount = contracts.length;

    const dealsInScope = deals.filter((i) => {
      const gid = i.group?.id;
      return gid != null && FUNNEL_DEALS_GROUP_IDS.has(gid);
    });

    let opsMatchedCount = 0;
    for (const item of dealsInScope) {
      const status = getColumnText(item, FUNNEL_DEALS_STATUS_COL);
      if (status != null && FUNNEL_OPS_STATUSES.has(status)) {
        opsMatchedCount += 1;
      }
    }

    const totalLeads = leads.length;
    const qualifiedLeads = dealsInScope.length + contractsCount;
    const opsApprovedLeads = opsMatchedCount + contractsCount;
    const wonDeals = closedWon.length;

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

    console.log(
      `[sync-funnel] Synced: ${totalLeads} leads, ${qualifiedLeads} qualified, ${opsApprovedLeads} ops, ${wonDeals} won`,
    );
    return { synced: true, totalLeads, wonDeals };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sync-funnel] failed:", msg);
    return { synced: false, error: msg };
  }
}
