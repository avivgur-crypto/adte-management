"use client";

import { useMemo } from "react";
import { useFilter } from "@/app/context/FilterContext";
import FinancialPaceCard from "./FinancialPaceCard";
import type { FinancialPaceWithTrend } from "@/app/actions/financials";

function getCurrentMonthStart(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/** Aggregate multiple single-month pacing results into one multi-month summary (client-side). */
function aggregateMultiMonth(
  singles: FinancialPaceWithTrend[]
): FinancialPaceWithTrend {
  if (singles.length === 0) throw new Error("aggregateMultiMonth requires at least one summary");
  if (singles.length === 1) return singles[0]!;

  function aggSection(
    key: "total" | "media" | "saas"
  ): FinancialPaceWithTrend["total"] {
    let actual = 0;
    let goal = 0;
    let targetMtd = 0;
    let requiredDailyRunRate = 0;
    for (const s of singles) {
      const sec = s[key];
      actual += sec.actual;
      goal += sec.goal;
      targetMtd += sec.targetMtd;
      requiredDailyRunRate += sec.requiredDailyRunRate;
    }
    const delta = actual - targetMtd;
    const pacePercent =
      targetMtd > 0 ? Math.round((actual / targetMtd) * 100) : null;
    return {
      actual,
      targetMtd,
      projected: null,
      goal,
      pacePercent,
      projectedVsGoalPercent: null,
      delta,
      requiredDailyRunRate,
    } as unknown as FinancialPaceWithTrend["total"];
  }

  const totalEffective = singles.reduce((s, x) => s + x.effectiveDaysPassed, 0);
  const totalDays = singles.reduce((s, x) => s + x.daysInMonth, 0);
  const totalRemaining = singles.reduce((s, x) => s + x.daysRemaining, 0);
  const lastSummary = singles[singles.length - 1]!;
  const monthLabels = singles.map((s) => (s.month.length === 7 ? s.month : s.month.slice(0, 7)));

  return {
    month: monthLabels.join(", "),
    daysInMonth: totalDays,
    effectiveDaysPassed: totalEffective,
    daysRemaining: totalRemaining,
    paceTargetRatio: totalDays > 0 ? totalEffective / totalDays : 0,
    dataThroughDate: lastSummary.dataThroughDate,
    total: aggSection("total"),
    media: aggSection("media"),
    saas: aggSection("saas"),
    trend: { total: "stable", media: "stable", saas: "stable" },
    isMultiMonth: true,
  };
}

function PacingSkeleton() {
  return (
    <div className="w-full max-w-4xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="mb-2 text-lg font-semibold text-white">
        Pacing achievement
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-48 animate-pulse rounded-xl border border-white/10 bg-white/5"
          />
        ))}
      </div>
    </div>
  );
}

export default function FinancialPaceFiltered({
  paceByMonth,
}: {
  paceByMonth: Record<string, FinancialPaceWithTrend>;
}) {
  const { selectedMonths } = useFilter();

  const summary = useMemo(() => {
    const monthStarts =
      selectedMonths.size > 0
        ? Array.from(selectedMonths).sort()
        : [getCurrentMonthStart()];
    const singles = monthStarts
      .map((m) => paceByMonth[m])
      .filter((s): s is FinancialPaceWithTrend => s != null);
    if (singles.length === 0) return null;
    if (singles.length === 1) return singles[0]!;
    return aggregateMultiMonth(singles);
  }, [paceByMonth, selectedMonths]);

  if (summary == null) {
    return <PacingSkeleton />;
  }

  return <FinancialPaceCard summary={summary} />;
}
