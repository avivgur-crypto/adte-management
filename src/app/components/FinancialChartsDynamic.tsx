"use client";

import dynamic from "next/dynamic";

// Both point at charts-bundle (the single recharts chunk) — see that module's doc.
export const RevenueGoalChart = dynamic(
  () =>
    import("@/app/components/charts-bundle").then((m) => ({
      default: m.RevenueGoalChart,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="h-[340px] w-full animate-pulse rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)]" />
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
      <div className="h-[340px] w-full animate-pulse rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)]" />
    ),
  },
);
