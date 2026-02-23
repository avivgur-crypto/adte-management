import {
  getActivityDataFromFunnel,
  getSignedDealsCompanies,
  type ActivityDailyRow,
} from "@/app/actions/activity";
import {
  getFinancialPace,
  getPartnerConcentration,
  getTotalOverviewData,
} from "@/app/actions/financials";
import type { FinancialPaceWithTrend } from "@/app/actions/financials";
import ActivitySummary from "@/app/components/ActivitySummary";
import DashboardErrorBoundary from "@/app/components/DashboardErrorBoundary";
import FinancialPaceFiltered from "@/app/components/FinancialPaceFiltered";
import PartnerDistributionCharts from "@/app/components/PartnerDistributionCharts";
import SalesFunnelFiltered from "@/app/components/SalesFunnelFiltered";
import TotalOverview from "@/app/components/TotalOverview";

const CONCENTRATION_MONTHS = ["2026-01-01", "2026-02-01"];

/** Month keys for 2026 used for pacing pre-fetch (must match FilterContext month keys). */
const PACING_MONTH_KEYS: string[] = Array.from({ length: 12 }, (_, i) =>
  `2026-${String(i + 1).padStart(2, "0")}-01`
);

export default async function Home() {
  let concentrationJan;
  let concentrationFeb;
  let overviewData;
  let paceByMonth: Record<string, FinancialPaceWithTrend> = {};
  let error: string | null = null;

  const [concJan, concFeb, overviewResult, activityDataResult, signedDealsResult, ...paceResults] = await Promise.allSettled([
    getPartnerConcentration("2026-01-01"),
    getPartnerConcentration("2026-02-01"),
    getTotalOverviewData(),
    getActivityDataFromFunnel(),
    getSignedDealsCompanies(),
    ...PACING_MONTH_KEYS.map((m) => getFinancialPace([m])),
  ]);
  concentrationJan = concJan.status === "fulfilled" ? concJan.value : null;
  concentrationFeb = concFeb.status === "fulfilled" ? concFeb.value : null;
  overviewData = overviewResult.status === "fulfilled" ? overviewResult.value : null;
  const activityData: ActivityDailyRow[] = activityDataResult.status === "fulfilled" ? activityDataResult.value : [];
  const signedDealsCompanies = signedDealsResult.status === "fulfilled" ? signedDealsResult.value : [];
  paceResults.forEach((p, i) => {
    if (p.status === "fulfilled" && PACING_MONTH_KEYS[i]) paceByMonth[PACING_MONTH_KEYS[i]!] = p.value;
  });
  if (concJan.status === "rejected" || concFeb.status === "rejected" || overviewResult.status === "rejected") {
    error = "Some data could not be loaded. The rest of the dashboard may still work.";
  }

  const overview = Array.isArray(overviewData) ? overviewData : [];
  const dataByMonth: Record<string, Awaited<ReturnType<typeof getPartnerConcentration>>> = {};
  if (concentrationJan) dataByMonth["2026-01-01"] = concentrationJan;
  if (concentrationFeb) dataByMonth["2026-02-01"] = concentrationFeb;

  return (
    <div className="bg-adte-page">
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="mb-8 text-2xl font-semibold text-white">
          <span className="highlight-brand-alt">Management</span>
        </h1>
        {error && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-red-200">
            {error}
          </div>
        )}
        <div className="stagger-children flex flex-col gap-8">
          <DashboardErrorBoundary sectionName="Total overview">
            {overview.length > 0 && <TotalOverview dataByMonth={overview} />}
          </DashboardErrorBoundary>
          <DashboardErrorBoundary sectionName="Financial pacing">
            <FinancialPaceFiltered paceByMonth={paceByMonth} />
          </DashboardErrorBoundary>
          <div>
            <DashboardErrorBoundary sectionName="Client concentration">
              <PartnerDistributionCharts
                dataByMonth={dataByMonth}
                monthKeys={CONCENTRATION_MONTHS}
              />
            </DashboardErrorBoundary>
          </div>
          <div>
            <DashboardErrorBoundary sectionName="Sales funnel">
              <SalesFunnelFiltered />
            </DashboardErrorBoundary>
          </div>
          <div>
            <DashboardErrorBoundary sectionName="Activity summary">
              <ActivitySummary activityData={activityData} signedDealsCompanies={signedDealsCompanies} />
            </DashboardErrorBoundary>
          </div>
        </div>
      </main>
    </div>
  );
}
