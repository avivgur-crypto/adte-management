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
import { getSalesFunnelMetricsFromMonday } from "@/app/actions/sales-funnel-live";
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

export const dynamic = "force-dynamic";

const CONCENTRATION_MONTHS = ["2026-01-01", "2026-02-01"];

const PACING_MONTH_KEYS: string[] = Array.from({ length: 12 }, (_, i) =>
  `2026-${String(i + 1).padStart(2, "0")}-01`
);

export default async function Home() {
  let error: string | null = null;

  const [
    concJan,
    concFeb,
    overviewResult,
    xdashTotalsResult,
    activityDataResult,
    signedDealsResult,
    funnelResult,
    paceResult,
    dailyResult,
    depPairsResult,
    lastUpdateResult,
  ] = await Promise.allSettled([
    getPartnerConcentration("2026-01-01"),
    getPartnerConcentration("2026-02-01"),
    getTotalOverviewData(),
    getMonthlyXDASHTotals(),
    getActivityDataFromFunnel(),
    getSignedDealsCompanies(),
    getSalesFunnelMetricsFromMonday(),
    getAllPaceByMonth(PACING_MONTH_KEYS),
    getAllDailyMovement(),
    getAllDependencyPairs(),
    getLastDataUpdate(),
  ]);

  const initialFunnelData = funnelResult.status === "fulfilled" ? funnelResult.value : null;
  const concentrationJan = concJan.status === "fulfilled" ? concJan.value : null;
  const concentrationFeb = concFeb.status === "fulfilled" ? concFeb.value : null;
  const overviewData = overviewResult.status === "fulfilled" ? overviewResult.value : null;
  const xdashTotals: Record<string, XDASHMonthTotals> =
    xdashTotalsResult.status === "fulfilled" ? xdashTotalsResult.value : {};
  const activityData: ActivityDailyRow[] =
    activityDataResult.status === "fulfilled" ? activityDataResult.value : [];
  const signedDealsCompanies =
    signedDealsResult.status === "fulfilled" ? signedDealsResult.value : [];

  const paceByMonth: Record<string, FinancialPaceWithTrend> =
    paceResult.status === "fulfilled" ? paceResult.value : {};
  const dailyByMonth =
    dailyResult.status === "fulfilled" ? dailyResult.value : {};
  const pairsByMonth: Record<string, PairEntry[]> =
    depPairsResult.status === "fulfilled" ? depPairsResult.value : {};
  const lastDataUpdate =
    lastUpdateResult.status === "fulfilled" ? lastUpdateResult.value : null;

  if (
    concJan.status === "rejected" ||
    concFeb.status === "rejected" ||
    overviewResult.status === "rejected"
  ) {
    error = "Some data could not be loaded. The rest of the dashboard may still work.";
  }

  const overview = Array.isArray(overviewData) ? overviewData : [];
  const dataByMonth: Record<string, Awaited<ReturnType<typeof getPartnerConcentration>>> = {};
  if (concentrationJan) dataByMonth["2026-01-01"] = concentrationJan;
  if (concentrationFeb) dataByMonth["2026-02-01"] = concentrationFeb;

  return (
    <div className="bg-adte-page">
      <main className="mx-auto max-w-5xl px-4 py-10">
        <LastSyncLine syncedAt={lastDataUpdate?.syncedAt ?? null} />
        {error && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-red-200">
            {error}
          </div>
        )}
        <DashboardTabs>
          <div className="stagger-children flex flex-col gap-8">
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
          <div className="stagger-children flex flex-col gap-8">
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
        </DashboardTabs>
      </main>
    </div>
  );
}
