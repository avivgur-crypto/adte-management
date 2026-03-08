"use server";

import { unstable_cache } from "next/cache";
import {
  DEALS_STATUS_COLUMN_ID,
  MONDAY_BOARD_IDS,
  fetchBoardItems,
  getColumnText,
  getItemStatus,
  type MondayItem,
} from "@/lib/monday-client";
import { withRetry } from "@/lib/resilience";
import type { SalesFunnelMetrics } from "@/app/actions/sales";

const LEADS_BOARD_ID = MONDAY_BOARD_IDS.leads;
const DEALS_BOARD_ID = MONDAY_BOARD_IDS.deals;
const CONTRACTS_BOARD_ID = MONDAY_BOARD_IDS.contracts;

/**
 * Stage 3 (Ops Approved): a deal matches if its status text contains any of
 * these keywords (case-insensitive). Covers values like "Ops review",
 * "Legal Negotiation", "Waiting for sign", etc.
 */
const OPS_STAGE_KEYWORDS = ["ops", "legal", "sign"] as const;

const FUNNEL_TIMEOUT_MS = 45_000;
const CACHE_REVALIDATE_S = 300; // 5 min

export interface MonthFilter {
  year: number;
  month: number; // 1-12
}

function isInMonth(item: MondayItem, filter: MonthFilter): boolean {
  const raw = item.created_at;
  if (!raw) return false;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return false;
  return d.getUTCFullYear() === filter.year && d.getUTCMonth() + 1 === filter.month;
}

/**
 * Core funnel computation. When monthFilter is provided, only items
 * whose created_at falls within that month are counted.
 */
async function fetchFunnelCore(monthFilter?: MonthFilter): Promise<SalesFunnelMetrics | null> {
  const needCreatedAt = !!monthFilter;

  const [leadsItems, dealsItems, contractsItems] = await Promise.all([
    fetchBoardItems(LEADS_BOARD_ID, { includeColumnValues: false, includeCreatedAt: needCreatedAt }),
    fetchBoardItems(DEALS_BOARD_ID, { includeColumnValues: true, includeCreatedAt: needCreatedAt }),
    fetchBoardItems(CONTRACTS_BOARD_ID, { includeColumnValues: false, includeCreatedAt: needCreatedAt }),
  ]);

  const leads = monthFilter ? leadsItems.filter((i) => isInMonth(i, monthFilter)) : leadsItems;
  const deals = monthFilter ? dealsItems.filter((i) => isInMonth(i, monthFilter)) : dealsItems;
  const contracts = monthFilter ? contractsItems.filter((i) => isInMonth(i, monthFilter)) : contractsItems;

  const contractsCount = contracts.length;

  /* Stage 3: Deals whose status contains "ops", "legal", or "sign". */
  let opsApprovedCount = 0;
  const getDealStatus = DEALS_STATUS_COLUMN_ID
    ? (item: MondayItem) => getColumnText(item, DEALS_STATUS_COLUMN_ID)
    : getItemStatus;
  for (const item of deals) {
    const status = (getDealStatus(item) ?? "").trim().toLowerCase();
    if (status && OPS_STAGE_KEYWORDS.some((kw) => status.includes(kw))) {
      opsApprovedCount += 1;
    }
  }

  const totalLeads = leads.length + contractsCount;
  const qualifiedLeads = deals.length + contractsCount;
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

  const monthLabel = monthFilter
    ? new Date(monthFilter.year, monthFilter.month - 1).toLocaleString("en-US", {
        month: "long",
        year: "numeric",
      })
    : "All time";

  return {
    totalLeads,
    qualifiedLeads,
    opsApprovedLeads,
    wonDeals,
    leadToQualifiedPercent,
    qualifiedToOpsPercent,
    opsToWonPercent,
    overallWinRatePercent,
    month: monthLabel,
    months: [],
  };
}

/* ── Live (all-time) funnel for the dashboard ── */

async function fetchFunnelFromMonday(): Promise<SalesFunnelMetrics | null> {
  return withRetry(async () => fetchFunnelCore(), { timeoutMs: FUNNEL_TIMEOUT_MS });
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

/* ── Monthly funnel for PDF / report generation ── */

/**
 * Fetch funnel data for a specific month (for monthly reports / PDFMonkey).
 * Not cached — intended for one-off report generation.
 */
export async function getMonthlyFunnelMetrics(
  year: number,
  month: number,
): Promise<SalesFunnelMetrics | null> {
  return withRetry(async () => fetchFunnelCore({ year, month }), {
    timeoutMs: FUNNEL_TIMEOUT_MS,
  });
}
