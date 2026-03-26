import { Suspense } from "react";
import {
  getAllDailyMovement,
  getComparisonData,
  getDualPaceByMonth,
  getMonthlyXDASHTotals,
  getTotalOverviewData,
} from "@/app/actions/financials";
import type { FinancialPaceWithTrend, XDASHMonthTotals } from "@/app/actions/financials";
import DashboardErrorBoundary from "@/app/components/DashboardErrorBoundary";
import DailyMovementChart from "@/app/components/DailyMovementChart";
import FinancialPaceFiltered from "@/app/components/FinancialPaceFiltered";
import RevenueGoalChart from "@/app/components/RevenueGoalChart";
import TodayFinancialsPulse from "@/app/components/TodayFinancialsPulse";
import TotalOverview from "@/app/components/TotalOverview";
import { SkeletonCard, SkeletonPacingGrid } from "@/app/components/SkeletonCard";

const PACING_MONTH_KEYS: string[] = Array.from({ length: 12 }, (_, i) =>
  `2026-${String(i + 1).padStart(2, "0")}-01`,
);

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

async function FinancialOverview() {
  const [overviewResult, xdashTotalsResult, comparisonResult] = await Promise.allSettled([
    getTotalOverviewData(),
    getMonthlyXDASHTotals(),
    getComparisonData([1, 7, 28]),
  ]);
  const overviewData = overviewResult.status === "fulfilled" ? overviewResult.value : null;
  const xdashTotals: Record<string, XDASHMonthTotals> =
    xdashTotalsResult.status === "fulfilled" ? xdashTotalsResult.value : {};
  const overview = Array.isArray(overviewData) ? overviewData : [];
  const hasError = overviewResult.status === "rejected";
  const comparison =
    comparisonResult.status === "fulfilled" ? comparisonResult.value : null;

  return (
    <div className="flex flex-col gap-8">
      <TodayFinancialsPulse comparison={comparison} />
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
    </div>
  );
}

async function FinancialCharts() {
  const [paceResult, dailyResult] = await Promise.allSettled([
    getDualPaceByMonth(PACING_MONTH_KEYS),
    getAllDailyMovement(),
  ]);
  const paceDual = paceResult.status === "fulfilled" ? paceResult.value : null;
  const paceByMonth: Record<string, FinancialPaceWithTrend> = paceDual?.xdash ?? {};
  const dailyByMonth = dailyResult.status === "fulfilled" ? dailyResult.value : {};
  const hasError = paceResult.status === "rejected";

  return (
    <div className="stagger-children flex flex-col gap-8">
      {hasError && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-red-200">
          Some pacing data could not be loaded.
        </div>
      )}
      <DashboardErrorBoundary sectionName="Financial pacing">
        <FinancialPaceFiltered
          paceByMonthXdash={paceDual?.xdash ?? {}}
          paceByMonthBilling={paceDual?.billing ?? {}}
        />
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

/** Financial tab: pulse + Main Stats + charts (used on `/` and `/financials`). */
export default function FinancialTab() {
  return (
    <div className="flex flex-col gap-8">
      <Suspense fallback={<SkeletonCard lines={3} />}>
        <FinancialOverview />
      </Suspense>
      <Suspense fallback={<FinancialSkeleton />}>
        <FinancialCharts />
      </Suspense>
    </div>
  );
}
