/**
 * Module-level promise cache for background-prefetching tab data.
 *
 * Flow:
 *  1. DashboardTabs calls prefetchPartners/prefetchSales via requestIdleCallback
 *     shortly after the Financial tab becomes interactive.
 *  2. When the user switches to Partners or Sales, the corresponding tab client
 *     component calls the same prefetch function — which returns the already
 *     in-flight (or resolved) promise, avoiding a duplicate round-trip.
 *  3. On error the cached promise is cleared so the next caller retries.
 */

import { getPartnerConcentration } from "@/app/actions/financials";
import type { PartnerConcentrationResult } from "@/app/actions/financials";
import { getAllDependencyPairs } from "@/app/actions/dependency-mapping";
import type { PairEntry } from "@/lib/dependency-mapping-utils";
import { getSalesFunnelFromCache } from "@/app/actions/sales-funnel-live";
import type { SalesFunnelMetrics } from "@/app/actions/sales";
import {
  getActivityDataFromFunnel,
  getSignedDealsCompanies,
  type ActivityDailyRow,
  type SignedDealCompany,
} from "@/app/actions/activity";

// ── Public data shapes ──────────────────────────────────────────────────────

export const CONCENTRATION_MONTHS = ["2026-01-01", "2026-02-01"];

export interface PartnersTabData {
  dataByMonth: Record<string, PartnerConcentrationResult | null>;
  pairsByMonth: Record<string, PairEntry[]>;
  hasError: boolean;
}

export interface SalesTabData {
  initialFunnelData: SalesFunnelMetrics | null;
  activityData: ActivityDailyRow[];
  signedDealsCompanies: SignedDealCompany[];
}

// ── Internal fetchers ───────────────────────────────────────────────────────

async function fetchPartnersData(): Promise<PartnersTabData> {
  const [concJan, concFeb, depPairs] = await Promise.allSettled([
    getPartnerConcentration(CONCENTRATION_MONTHS[0]!),
    getPartnerConcentration(CONCENTRATION_MONTHS[1]!),
    getAllDependencyPairs(),
  ]);

  const dataByMonth: Record<string, PartnerConcentrationResult | null> = {};
  if (concJan.status === "fulfilled" && concJan.value)
    dataByMonth[CONCENTRATION_MONTHS[0]!] = concJan.value;
  if (concFeb.status === "fulfilled" && concFeb.value)
    dataByMonth[CONCENTRATION_MONTHS[1]!] = concFeb.value;

  return {
    dataByMonth,
    pairsByMonth: depPairs.status === "fulfilled" ? depPairs.value : {},
    hasError: concJan.status === "rejected" || concFeb.status === "rejected",
  };
}

async function fetchSalesData(): Promise<SalesTabData> {
  const [funnel, activity, deals] = await Promise.allSettled([
    getSalesFunnelFromCache(),
    getActivityDataFromFunnel(),
    getSignedDealsCompanies(),
  ]);

  return {
    initialFunnelData: funnel.status === "fulfilled" ? funnel.value : null,
    activityData: activity.status === "fulfilled" ? activity.value : [],
    signedDealsCompanies: deals.status === "fulfilled" ? deals.value : [],
  };
}

// ── Module-level promise cache ──────────────────────────────────────────────

let partnersPromise: Promise<PartnersTabData> | null = null;
let salesPromise: Promise<SalesTabData> | null = null;

export function prefetchPartners(): Promise<PartnersTabData> {
  if (!partnersPromise) {
    partnersPromise = fetchPartnersData();
    partnersPromise.catch(() => {
      partnersPromise = null;
    });
  }
  return partnersPromise;
}

export function prefetchSales(): Promise<SalesTabData> {
  if (!salesPromise) {
    salesPromise = fetchSalesData();
    salesPromise.catch(() => {
      salesPromise = null;
    });
  }
  return salesPromise;
}

export function invalidatePrefetch() {
  partnersPromise = null;
  salesPromise = null;
}
