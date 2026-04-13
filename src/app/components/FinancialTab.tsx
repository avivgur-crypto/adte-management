import { Suspense } from "react";
import {
  getAllDailyMovement,
  getComparisonData,
  getDailyProfitGoalPaceIsrael,
  getDualPaceByMonth,
  getMonthlyXDASHTotals,
  getTotalOverviewData,
} from "@/app/actions/financials";
import type { ComparisonData, FinancialPaceWithTrend, XDASHMonthTotals } from "@/app/actions/financials";
import DashboardErrorBoundary from "@/app/components/DashboardErrorBoundary";
import { DailyMovementChart, RevenueGoalChart } from "@/app/components/FinancialChartsDynamic";
import FinancialPaceFiltered from "@/app/components/FinancialPaceFiltered";
import TodayFinancialsPulse from "@/app/components/TodayFinancialsPulse";
import type { PulseComparison } from "@/app/components/TodayFinancialsPulse";
import TotalOverview from "@/app/components/TotalOverview";
import { SkeletonCard, SkeletonPacingGrid } from "@/app/components/SkeletonCard";
import type { GoalChartPace } from "@/app/components/RevenueGoalChart";

const PACING_MONTH_KEYS: string[] = Array.from({ length: 12 }, (_, i) =>
  `2026-${String(i + 1).padStart(2, "0")}-01`,
);

/** Server-side projection: strip impressions before RSC serialization. */
function slimComparison(data: ComparisonData): PulseComparison {
  const strip = (r: { date: string; revenue: number; cost: number; profit: number } | null) =>
    r ? { date: r.date, revenue: r.revenue, cost: r.cost, profit: r.profit } : null;
  return {
    today: strip(data.today),
    past: Object.fromEntries(
      Object.entries(data.past).map(([k, v]) => [Number(k), strip(v)]),
    ) as PulseComparison["past"],
  };
}

/** Server-side projection: keep only actual/goal per section for the chart. */
function slimPaceForChart(
  pace: Record<string, FinancialPaceWithTrend>,
): Record<string, GoalChartPace> {
  const out: Record<string, GoalChartPace> = {};
  for (const [k, v] of Object.entries(pace)) {
    out[k] = {
      total: { actual: v.total.actual, goal: v.total.goal },
      media: { actual: v.media.actual, goal: v.media.goal },
      saas: { actual: v.saas.actual, goal: v.saas.goal },
      profit: { actual: v.profit.actual, goal: v.profit.goal },
    };
  }
  return out;
}

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
  const [overviewResult, xdashTotalsResult, comparisonResult, goalPaceResult] = await Promise.allSettled([
    getTotalOverviewData(),
    getMonthlyXDASHTotals(),
    getComparisonData([1, 7, 28]),
    getDailyProfitGoalPaceIsrael(),
  ]);
  const overviewData = overviewResult.status === "fulfilled" ? overviewResult.value : null;
  const xdashTotals: Record<string, XDASHMonthTotals> =
    xdashTotalsResult.status === "fulfilled" ? xdashTotalsResult.value : {};
  const overview = Array.isArray(overviewData) ? overviewData : [];
  const hasError = overviewResult.status === "rejected";
  const comparison =
    comparisonResult.status === "fulfilled" ? comparisonResult.value : null;
  const dailyProfitGoalPace =
    goalPaceResult.status === "fulfilled" ? goalPaceResult.value : null;

  return (
    <div className="flex flex-col gap-8">
      <TodayFinancialsPulse
        comparison={comparison ? slimComparison(comparison) : null}
        dailyProfitGoalPace={dailyProfitGoalPace}
      />
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
        <RevenueGoalChart paceByMonth={slimPaceForChart(paceDual?.xdash ?? {})} />
      </DashboardErrorBoundary>
      <DashboardErrorBoundary sectionName="Daily progress">
        <DailyMovementChart
          dailyByMonth={dailyByMonth}
          monthKeys={PACING_MONTH_KEYS}
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
