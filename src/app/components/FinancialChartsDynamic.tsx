"use client";

import dynamic from "next/dynamic";

// Both point at charts-bundle (the single recharts chunk) — see that module's doc.
// Loading placeholders use the MEASURED heights of the mounted cards (see
// ChartCardSkeleton in FinancialTab) so chunk-load → chart swap has ~zero CLS.
export const RevenueGoalChart = dynamic(
  () =>
    import("@/app/components/charts-bundle").then((m) => ({
      default: m.RevenueGoalChart,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="h-[443px] w-full animate-pulse rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] lg:h-[454px]" />
    ),
  },
);

export const DailyMovementChart = dynamic(
  () =>
    import("@/app/components/charts-bundle").then((m) => ({
      default: m.DailyMovementChart,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="h-[486px] w-full animate-pulse rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)]" />
    ),
  },
);
