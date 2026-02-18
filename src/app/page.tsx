import {
  getPartnerConcentration,
  getTotalOverviewData,
} from "@/app/actions/financials";
import ActivitySummary from "@/app/components/ActivitySummary";
import DashboardErrorBoundary from "@/app/components/DashboardErrorBoundary";
import FinancialPaceFiltered from "@/app/components/FinancialPaceFiltered";
import PartnerDistributionCharts from "@/app/components/PartnerDistributionCharts";
import SalesFunnelFiltered from "@/app/components/SalesFunnelFiltered";
import TotalOverview from "@/app/components/TotalOverview";

const CONCENTRATION_MONTHS = ["2026-01-01", "2026-02-01"];

export default async function Home() {
  let concentrationJan;
  let concentrationFeb;
  let overviewData;
  let error: string | null = null;
  const [concJan, concFeb, overviewResult] = await Promise.allSettled([
    getPartnerConcentration("2026-01-01"),
    getPartnerConcentration("2026-02-01"),
    getTotalOverviewData(),
  ]);
  concentrationJan = concJan.status === "fulfilled" ? concJan.value : null;
  concentrationFeb = concFeb.status === "fulfilled" ? concFeb.value : null;
  overviewData = overviewResult.status === "fulfilled" ? overviewResult.value : null;
  if (concJan.status === "rejected" || concFeb.status === "rejected" || overviewResult.status === "rejected") {
    error = "Some data could not be loaded. The rest of the dashboard may still work.";
  }

  const overview = Array.isArray(overviewData) ? overviewData : [];
  const dataByMonth: Record<string, Awaited<ReturnType<typeof getPartnerConcentration>>> = {};
  if (concentrationJan) dataByMonth["2026-01-01"] = concentrationJan;
  if (concentrationFeb) dataByMonth["2026-02-01"] = concentrationFeb;

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950">
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="mb-8 text-2xl font-semibold text-blue-600 dark:text-blue-400">
          Adte Management
        </h1>
        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
            {error}
          </div>
        )}
        <DashboardErrorBoundary sectionName="Total overview">
          {overview.length > 0 && <TotalOverview dataByMonth={overview} />}
        </DashboardErrorBoundary>
        <DashboardErrorBoundary sectionName="Financial pacing">
          <FinancialPaceFiltered />
        </DashboardErrorBoundary>
        <div className="mt-8">
          <DashboardErrorBoundary sectionName="Client concentration">
            <PartnerDistributionCharts
              dataByMonth={dataByMonth}
              monthKeys={CONCENTRATION_MONTHS}
            />
          </DashboardErrorBoundary>
        </div>
        <div className="mt-8">
          <DashboardErrorBoundary sectionName="Sales funnel">
            <SalesFunnelFiltered />
          </DashboardErrorBoundary>
        </div>
        <div className="mt-8">
          <DashboardErrorBoundary sectionName="Activity summary">
            <ActivitySummary />
          </DashboardErrorBoundary>
        </div>
      </main>
    </div>
  );
}
