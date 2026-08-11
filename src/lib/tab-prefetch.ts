/**
 * Module-level promise cache for background-prefetching tab data.
 *
 * Flow:
 *  1. DashboardTabs calls prefetchSales via requestIdleCallback shortly after
 *     the Financial tab becomes interactive.
 *  2. When the user switches to Sales, the tab client returns the already
 *     in-flight (or resolved) promise, avoiding a duplicate round-trip.
 *  3. On error the cached promise is cleared so the next caller retries.
 */

import { getSalesFunnelFromCache, getLastMondaySyncAt } from "@/app/actions/sales-funnel-live";
import type { SalesFunnelMetrics } from "@/app/actions/sales";
import {
  getActivityDataFromFunnel,
  getSignedDealsCompanies,
  type ActivityDailyRow,
  type SignedDealCompany,
} from "@/app/actions/activity";

export interface SalesTabData {
  initialFunnelData: SalesFunnelMetrics | null;
  lastMondaySyncAt: string | null;
  activityData: ActivityDailyRow[];
  signedDealsCompanies: SignedDealCompany[];
}

async function fetchSalesData(): Promise<SalesTabData> {
  const [funnel, lastSync, activity, deals] = await Promise.allSettled([
    getSalesFunnelFromCache(),
    getLastMondaySyncAt(),
    getActivityDataFromFunnel(),
    getSignedDealsCompanies(),
  ]);

  return {
    initialFunnelData: funnel.status === "fulfilled" ? funnel.value : null,
    lastMondaySyncAt: lastSync.status === "fulfilled" ? lastSync.value : null,
    activityData: activity.status === "fulfilled" ? activity.value : [],
    signedDealsCompanies: deals.status === "fulfilled" ? deals.value : [],
  };
}

let salesPromise: Promise<SalesTabData> | null = null;

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
  salesPromise = null;
}
