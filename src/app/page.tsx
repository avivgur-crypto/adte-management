import { Suspense } from "react";
import { unstable_noStore as noStore } from "next/cache";
import {
  getActivityDataFromFunnel,
  getSignedDealsCompanies,
  type ActivityDailyRow,
} from "@/app/actions/activity";
import { getAllDependencyPairs } from "@/app/actions/dependency-mapping";
import type { PairEntry } from "@/lib/dependency-mapping-utils";
import {
  getAllDailyMovement,
  getAllPaceByMonth,
  getLastDataUpdate,
  getMonthlyXDASHTotals,
  getPartnerConcentration,
  getTotalOverviewData,
} from "@/app/actions/financials";
import type { FinancialPaceWithTrend, XDASHMonthTotals } from "@/app/actions/financials";
import { getSalesFunnelFromCache } from "@/app/actions/sales-funnel-live";
import ActivitySummary from "@/app/components/ActivitySummary";
import DashboardErrorBoundary from "@/app/components/DashboardErrorBoundary";
import DashboardTabs from "@/app/components/DashboardTabs";
import DailyMovementChart from "@/app/components/DailyMovementChart";
import PartnersFiltered from "@/app/components/PartnersFiltered";
import FinancialPaceFiltered from "@/app/components/FinancialPaceFiltered";
import RevenueGoalChart from "@/app/components/RevenueGoalChart";
import PartnerDistributionCharts from "@/app/components/PartnerDistributionCharts";
import SalesFunnelFiltered from "@/app/components/SalesFunnelFiltered";
import LastSyncLine from "@/app/components/LastSyncLine";
import TotalOverview from "@/app/components/TotalOverview";
import {
  SkeletonCard,
  SkeletonPacingGrid,
  SkeletonDonutGrid,
} from "@/app/components/SkeletonCard";

export const dynamic = "force-dynamic";

const CONCENTRATION_MONTHS = ["2026-01-01", "2026-02-01"];
const PACING_MONTH_KEYS: string[] = Array.from({ length: 12 }, (_, i) =>
  `2026-${String(i + 1).padStart(2, "0")}-01`
);

/* ── Skeleton fallbacks per tab ── */

function FinancialSkeleton() {
  return (
    <div className="stagger-children flex flex-col gap-8">
      <SkeletonCard lines={3} />
      <SkeletonPacingGrid />
      <SkeletonCard lines={2} />
      <SkeletonCard lines={4} />
    </div>
  );
}

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
  noStore();
  const lastDataUpdate = await getLastDataUpdate();
  return <LastSyncLine syncedAt={lastDataUpdate?.syncedAt ?? null} />;
}

async function FinancialTab() {
  const [overviewResult, xdashTotalsResult, paceResult, dailyResult] =
    await Promise.allSettled([
      getTotalOverviewData(),
      getMonthlyXDASHTotals(),
      getAllPaceByMonth(PACING_MONTH_KEYS),
      getAllDailyMovement(),
    ]);

  const overviewData = overviewResult.status === "fulfilled" ? overviewResult.value : null;
  const xdashTotals: Record<string, XDASHMonthTotals> =
    xdashTotalsResult.status === "fulfilled" ? xdashTotalsResult.value : {};
  const paceByMonth: Record<string, FinancialPaceWithTrend> =
    paceResult.status === "fulfilled" ? paceResult.value : {};
  const dailyByMonth =
    dailyResult.status === "fulfilled" ? dailyResult.value : {};

  const overview = Array.isArray(overviewData) ? overviewData : [];
  const hasError = overviewResult.status === "rejected";

  return (
    <div className="stagger-children flex flex-col gap-8">
      {hasError && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-red-200">
          Some financial data could not be loaded.
        </div>
      )}
      <DashboardErrorBoundary sectionName="Total overview">
        {overview.length > 0 && (
          <TotalOverview dataByMonth={overview} xdashByMonth={xdashTotals} />
        )}
      </DashboardErrorBoundary>
      <DashboardErrorBoundary sectionName="Financial pacing">
        <FinancialPaceFiltered paceByMonth={paceByMonth} />
      </DashboardErrorBoundary>
      <DashboardErrorBoundary sectionName="Revenue vs Goal chart">
        <RevenueGoalChart paceByMonth={paceByMonth} />
      </DashboardErrorBoundary>
      <DashboardErrorBoundary sectionName="Daily progress">
        <DailyMovementChart
          dailyByMonth={dailyByMonth}
          monthKeys={PACING_MONTH_KEYS}
          paceByMonth={paceByMonth}
        />
      </DashboardErrorBoundary>
    </div>
  );
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
    <div className="bg-adte-page">
      <main className="mx-auto max-w-5xl px-4 py-10">
        <Suspense fallback={<div className="h-5 w-48 animate-pulse rounded bg-white/10" />}>
          <LastSyncContent />
        </Suspense>
        <DashboardTabs>
          <Suspense fallback={<FinancialSkeleton />}>
            <FinancialTab />
          </Suspense>
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
