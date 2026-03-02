"use server";

import { unstable_cache } from "next/cache";
import {
  DEALS_STATUS_COLUMN_ID,
  MONDAY_BOARD_IDS,
  fetchBoardItems,
  getColumnText,
  getItemStatus,
} from "@/lib/monday-client";
import { withRetry } from "@/lib/resilience";
import type { SalesFunnelMetrics } from "@/app/actions/sales";

const LEADS_BOARD_ID = MONDAY_BOARD_IDS.leads;
const DEALS_BOARD_ID = MONDAY_BOARD_IDS.deals;
const CONTRACTS_BOARD_ID = MONDAY_BOARD_IDS.contracts;

/** Stage 3 (Ops Approved): only these statuses on Deals board. Case-insensitive. */
const STATUS_OPS_APPROVED = new Set([
  "legal negotiation",
  "waiting for sign",
  "negotiation failed",
  "conrtact archived", // typo as in Monday
  "contract archived", // in case some items use correct spelling
]);

/** Minimal fetch for count-only boards (Leads, Contracts) — no column_values/created_at to reduce payload. */
const COUNT_ONLY_OPTS = { includeColumnValues: false, includeCreatedAt: false };
/** Deals need column_values for status. */
const DEALS_OPTS = { includeColumnValues: true, includeCreatedAt: false };

const FUNNEL_TIMEOUT_MS = 45_000;
const CACHE_REVALIDATE_S = 300; // 5 min

async function fetchFunnelFromMonday(): Promise<SalesFunnelMetrics | null> {
  return withRetry(async () => {
    const [leadsItems, dealsItems, contractsItems] = await Promise.all([
      fetchBoardItems(LEADS_BOARD_ID, COUNT_ONLY_OPTS),
      fetchBoardItems(DEALS_BOARD_ID, DEALS_OPTS),
      fetchBoardItems(CONTRACTS_BOARD_ID, COUNT_ONLY_OPTS),
    ]);

    const contractsCount = contractsItems.length;

    /* Stage 3: Deals with Ops Approved statuses only. Use dedicated column if set (correct Ops count). */
    let opsApprovedCount = 0;
    const getDealStatus = DEALS_STATUS_COLUMN_ID
      ? (item: (typeof dealsItems)[number]) => getColumnText(item, DEALS_STATUS_COLUMN_ID)
      : getItemStatus;
    for (const item of dealsItems) {
      const raw = (getDealStatus(item) ?? "").trim();
      const status = raw.toLowerCase().replace(/\s+/g, " ");
      if (STATUS_OPS_APPROVED.has(status)) opsApprovedCount += 1;
    }

    /* Success Base Rule (always on): Stage 1 = leads + contracts, Stage 2 = deals + contracts, Stage 3 = ops + contracts, Stage 4 = contracts. */
    const totalLeads = leadsItems.length + contractsCount;
    const qualifiedLeads = dealsItems.length + contractsCount;
    const opsApprovedLeads = opsApprovedCount + contractsCount;
    const wonDeals = contractsCount;

    const leadToQualifiedPercent =
      totalLeads > 0 ? Number(((qualifiedLeads / totalLeads) * 100).toFixed(1)) : null;
    const qualifiedToOpsPercent =
      qualifiedLeads > 0
        ? Math.min(100, Number(((opsApprovedLeads / qualifiedLeads) * 100).toFixed(1)))
        : null;
    const opsToWonPercent =
      opsApprovedLeads > 0
        ? Math.min(100, Number(((wonDeals / opsApprovedLeads) * 100).toFixed(1)))
        : null;
    const overallWinRatePercent =
      totalLeads > 0 ? Number(((wonDeals / totalLeads) * 100).toFixed(1)) : null;

    return {
      totalLeads,
      qualifiedLeads,
      opsApprovedLeads,
      wonDeals,
      leadToQualifiedPercent,
      qualifiedToOpsPercent,
      opsToWonPercent,
      overallWinRatePercent,
      month: "All time",
      months: [],
    };
  }, { timeoutMs: FUNNEL_TIMEOUT_MS });
}

const CACHE_KEY = "sales-funnel-from-monday";

/**
 * Live Sales Funnel: always sourced from Monday API (Leads, Deals, Media Contracts).
 * Cache is short-lived (5 min) only to avoid hammering the API; UI refetches every 5 min
 * so data keeps updating directly from Monday.
 * Always all-time data; not affected by dashboard date filters.
 */
export async function getSalesFunnelMetricsFromMonday(): Promise<SalesFunnelMetrics | null> {
  return unstable_cache(fetchFunnelFromMonday, [CACHE_KEY], {
    revalidate: CACHE_REVALIDATE_S,
    tags: [CACHE_KEY],
  })();
}
