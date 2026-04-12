"use client";

import dynamic from "next/dynamic";

export const RevenueGoalChart = dynamic(
  () => import("@/app/components/RevenueGoalChart"),
  {
    ssr: false,
    loading: () => (
      <div className="h-[340px] w-full animate-pulse rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)]" />
    ),
  },
);

export const DailyMovementChart = dynamic(
  () => import("@/app/components/DailyMovementChart"),
  {
    ssr: false,
    loading: () => (
      <div className="h-[340px] w-full animate-pulse rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)]" />
    ),
  },
);
