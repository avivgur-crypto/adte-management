"use server";

import { unstable_cache } from "next/cache";
import {
  MONDAY_BOARD_IDS,
  CREATION_LOG_COLUMN_IDS,
  FUNNEL_DEALS_STATUS_COL,
  FUNNEL_DEALS_GROUP_IDS,
  FUNNEL_OPS_STATUSES,
  fetchBoardItems,
  filterActiveItems,
  getColumnText,
  getContractWonReportingDate,
  type MondayItem,
} from "@/lib/monday-client";
import { withRetry } from "@/lib/resilience";
import { supabaseAdmin } from "@/lib/supabase";
import type { SalesFunnelMetrics } from "@/app/actions/sales";

const LEADS_BOARD_ID = MONDAY_BOARD_IDS.leads;
const DEALS_BOARD_ID = MONDAY_BOARD_IDS.deals;
const CONTRACTS_BOARD_ID = MONDAY_BOARD_IDS.contracts;

const CACHE_TTL = 300;
const FUNNEL_TIMEOUT_MS = 45_000;
const CACHE_REVALIDATE_S = 300;

export interface MonthFilter {
  year: number;
  month: number; // 1-12
}

const DATE_TZ = "Asia/Jerusalem";

/** Calendar YYYY-MM-DD in Israel (same as Monday sync / activity). */
function dateKeyIsrael(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: DATE_TZ });
}

/**
 * Leads / Deals: bucket by item **creation** month in Israel (not UTC), so late-day UTC
 * does not shift March ↔ April.
 */
function leadOrDealCreatedInFilterMonth(item: MondayItem, filter: MonthFilter): boolean {
  const raw = item.created_at;
  if (!raw) return false;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return false;
  const key = dateKeyIsrael(d);
  const [y, m] = key.split("-").map(Number);
  return y === filter.year && m === filter.month;
}

/**
 * Contracts (Won): bucket by **signed reporting date** (Signed Date column → file → status
 * changed_at → updated_at → …), not `created_at`, so Anzu-type rows land in April when signed in April.
 */
function contractSignedInFilterMonth(item: MondayItem, filter: MonthFilter): boolean {
  const d = getContractWonReportingDate(item, CREATION_LOG_COLUMN_IDS.contracts);
  const key = dateKeyIsrael(d);
  const [y, m] = key.split("-").map(Number);
  return y === filter.year && m === filter.month;
}

/**
 * Core funnel computation using NEW verified logic.
 *
 * Stage 1: ALL active Leads.
 * Stage 2: Active Deals in (topics | new_group_mkmgrv50) + ALL active Contracts.
 * Stage 3: Same group-filtered Deals with status in [Legal Negotiation, Waiting for sign, Negotiation Failed] + ALL active Contracts.
 * Stage 4: ALL active Contracts.
 * Win Rate: Stage 4 / Stage 1.
 */
async function fetchFunnelCore(monthFilter?: MonthFilter): Promise<SalesFunnelMetrics | null> {
  const needCreatedAt = !!monthFilter;
  const contractsNeedSignedMeta = !!monthFilter;

  const [leadsRaw, dealsRaw, contractsRaw] = await Promise.all([
    fetchBoardItems(LEADS_BOARD_ID, { includeColumnValues: false, includeCreatedAt: needCreatedAt }),
    fetchBoardItems(DEALS_BOARD_ID, { includeColumnValues: true, includeCreatedAt: needCreatedAt }),
    fetchBoardItems(CONTRACTS_BOARD_ID, {
      includeColumnValues: contractsNeedSignedMeta,
      includeCreatedAt: contractsNeedSignedMeta,
      includeUpdatedAt: contractsNeedSignedMeta,
    }),
  ]);

  let leads = filterActiveItems(leadsRaw);
  let deals = filterActiveItems(dealsRaw);
  let contracts = filterActiveItems(contractsRaw);

  if (monthFilter) {
    leads = leads.filter((i) => leadOrDealCreatedInFilterMonth(i, monthFilter));
    deals = deals.filter((i) => leadOrDealCreatedInFilterMonth(i, monthFilter));
    contracts = contracts.filter((i) => contractSignedInFilterMonth(i, monthFilter));
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

export async function getMonthlyFunnelMetrics(
  year: number,
  month: number,
): Promise<SalesFunnelMetrics | null> {
  return withRetry(async () => fetchFunnelCore({ year, month }), {
    timeoutMs: FUNNEL_TIMEOUT_MS,
  });
}

/* ── Fast cached read from Supabase (written by cron via syncFunnelToSupabase) ── */

async function _getSalesFunnelFromCache(): Promise<SalesFunnelMetrics | null> {
  const { data, error } = await supabaseAdmin
    .from("cached_funnel_metrics")
    .select("*")
    .eq("id", "latest")
    .maybeSingle();

  if (error || !data) return null;

  return {
    totalLeads: data.total_leads,
    qualifiedLeads: data.qualified_leads,
    opsApprovedLeads: data.ops_approved,
    wonDeals: data.won_deals,
    leadToQualifiedPercent: data.lead_to_qualified_pct != null ? Number(data.lead_to_qualified_pct) : null,
    qualifiedToOpsPercent: data.qualified_to_ops_pct != null ? Number(data.qualified_to_ops_pct) : null,
    opsToWonPercent: data.ops_to_won_pct != null ? Number(data.ops_to_won_pct) : null,
    overallWinRatePercent: data.win_rate_pct != null ? Number(data.win_rate_pct) : null,
    month: data.month_label ?? "All time",
    months: [],
  };
}

export const getSalesFunnelFromCache = unstable_cache(
  _getSalesFunnelFromCache,
  ["funnel-from-cache"],
  { revalidate: CACHE_TTL },
);
