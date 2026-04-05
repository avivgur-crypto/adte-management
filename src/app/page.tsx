import { Suspense } from "react";
import {
  getActivityDataFromFunnel,
  getSignedDealsCompanies,
  type ActivityDailyRow,
} from "@/app/actions/activity";
import { getAllDependencyPairs } from "@/app/actions/dependency-mapping";
import type { PairEntry } from "@/lib/dependency-mapping-utils";
import { getLastDataUpdate, getPartnerConcentration } from "@/app/actions/financials";
import { getSalesFunnelFromCache } from "@/app/actions/sales-funnel-live";
import ActivitySummary from "@/app/components/ActivitySummary";
import DashboardErrorBoundary from "@/app/components/DashboardErrorBoundary";
import DashboardTabs from "@/app/components/DashboardTabs";
import FinancialTab from "@/app/components/FinancialTab";
import PartnersFiltered from "@/app/components/PartnersFiltered";
import PartnerDistributionCharts from "@/app/components/PartnerDistributionCharts";
import SalesFunnelFiltered from "@/app/components/SalesFunnelFiltered";
import AutoSync from "@/app/components/AutoSync";
import LastSyncLine from "@/app/components/LastSyncLine";
import WebPushSubscribe from "@/app/components/WebPushSubscribe";
import { SkeletonCard, SkeletonDonutGrid } from "@/app/components/SkeletonCard";

/**
 * force-dynamic: every navigation hits the server so the initial render always
 * shows the latest DB values. The per-query `unstable_cache` (tagged
 * "financial-data") still deduplicates within a single render and provides a
 * short TTL safety net; `refreshTodayHome` invalidates the tag after writes.
 */
export const dynamic = "force-dynamic";

const CONCENTRATION_MONTHS = ["2026-01-01", "2026-02-01"];

/* ── Skeleton fallbacks per tab ── */

function PartnersSkeleton() {
  return (
    <div className="stagger-children flex flex-col gap-8">
      <SkeletonDonutGrid />
      <SkeletonCard lines={6} />
    </div>
  );
}

function SalesSkeleton() {
  return (
    <div className="stagger-children flex flex-col gap-8">
      <SkeletonCard lines={5} />
      <SkeletonCard lines={4} />
    </div>
  );
}

/* ── Async Server Components — each streams independently ── */

async function LastSyncContent() {
  const lastDataUpdate = await getLastDataUpdate();
  return <LastSyncLine syncedAt={lastDataUpdate?.syncedAt ?? null} />;
}

async function PartnersTab() {
  const [concJan, concFeb, depPairsResult] = await Promise.allSettled([
    getPartnerConcentration("2026-01-01"),
    getPartnerConcentration("2026-02-01"),
    getAllDependencyPairs(),
  ]);

  const concentrationJan = concJan.status === "fulfilled" ? concJan.value : null;
  const concentrationFeb = concFeb.status === "fulfilled" ? concFeb.value : null;
  const pairsByMonth: Record<string, PairEntry[]> =
    depPairsResult.status === "fulfilled" ? depPairsResult.value : {};

  const dataByMonth: Record<string, Awaited<ReturnType<typeof getPartnerConcentration>>> = {};
  if (concentrationJan) dataByMonth["2026-01-01"] = concentrationJan;
  if (concentrationFeb) dataByMonth["2026-02-01"] = concentrationFeb;

  const hasError = concJan.status === "rejected" || concFeb.status === "rejected";

  return (
    <div className="stagger-children flex flex-col gap-8">
      {hasError && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-red-200">
          Some partner data could not be loaded.
        </div>
      )}
      <DashboardErrorBoundary sectionName="Client concentration">
        <PartnerDistributionCharts
          dataByMonth={dataByMonth}
          monthKeys={CONCENTRATION_MONTHS}
        />
      </DashboardErrorBoundary>
      <DashboardErrorBoundary sectionName="Partner flow and Dependency mapping">
        <PartnersFiltered pairsByMonth={pairsByMonth} />
      </DashboardErrorBoundary>
    </div>
  );
}

async function SalesTab() {
  const [funnelResult, activityDataResult, signedDealsResult] =
    await Promise.allSettled([
      getSalesFunnelFromCache(),
      getActivityDataFromFunnel(),
      getSignedDealsCompanies(),
    ]);

  const initialFunnelData = funnelResult.status === "fulfilled" ? funnelResult.value : null;
  const activityData: ActivityDailyRow[] =
    activityDataResult.status === "fulfilled" ? activityDataResult.value : [];
  const signedDealsCompanies =
    signedDealsResult.status === "fulfilled" ? signedDealsResult.value : [];

  return (
    <div className="stagger-children flex flex-col gap-8">
      <DashboardErrorBoundary sectionName="Sales funnel">
        <SalesFunnelFiltered initialData={initialFunnelData} />
      </DashboardErrorBoundary>
      <DashboardErrorBoundary sectionName="Activity summary">
        <ActivitySummary
          activityData={activityData}
          signedDealsCompanies={signedDealsCompanies}
        />
      </DashboardErrorBoundary>
    </div>
  );
}

/* ── Page ── */

export default function Home() {
  return (
    <div
      className="bg-adte-page"
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(ellipse 120% 80% at 50% 0%, #1a1a1a 0%, #0a0a0a 50%, #000000 100%)",
      }}
    >
      <AutoSync />
      <main className="mx-auto max-w-5xl px-3 pb-8 pt-6 sm:px-4 sm:pb-10 sm:pt-10">
        <Suspense
          fallback={
            <div
              className="h-5 w-48 animate-pulse rounded bg-white/10"
              style={{
                height: 20,
                width: 192,
                borderRadius: 8,
                backgroundColor: "rgba(255,255,255,0.1)",
              }}
            />
          }
        >
          <LastSyncContent />
        </Suspense>
        <WebPushSubscribe />
        <DashboardTabs>
          <FinancialTab />
          <Suspense fallback={<PartnersSkeleton />}>
            <PartnersTab />
          </Suspense>
          <Suspense fallback={<SalesSkeleton />}>
            <SalesTab />
          </Suspense>
        </DashboardTabs>
      </main>
    </div>
  );
}
