"use client";

import { useMemo } from "react";
import { useFilter } from "@/app/context/FilterContext";
import type { ActivityDailyRow } from "@/app/actions/activity";

function getCurrentMonthStart(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/** True if date (YYYY-MM-DD) falls in one of the given month starts (YYYY-MM-01). */
function dateInMonths(date: string, monthStarts: string[]): boolean {
  if (monthStarts.length === 0) return false;
  const dateMonth = date.slice(0, 7);
  return monthStarts.some((m) => m.slice(0, 7) === dateMonth);
}

export default function ActivitySummary({
  activityData,
}: {
  activityData: ActivityDailyRow[];
}) {
  const { selectedMonths } = useFilter();

  const metrics = useMemo(() => {
    const monthStarts =
      selectedMonths.size > 0
        ? Array.from(selectedMonths).sort()
        : [getCurrentMonthStart()];
    let newLeads = 0;
    let newSignedDeals = 0;
    for (const row of activityData) {
      if (!dateInMonths(row.date, monthStarts)) continue;
      newLeads += row.total_leads;
      newSignedDeals += row.won_deals;
    }
    return { newLeads, newSignedDeals };
  }, [activityData, selectedMonths]);

  return (
    <section className="mb-8">
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/50">
            New Leads
          </h2>
          <p className="mb-1 text-4xl font-semibold tabular-nums text-white sm:text-5xl">
            {metrics.newLeads}
          </p>
          <p className="text-xs text-white/50">
            SUM(total_leads) from daily_funnel_metrics · based on creation date
          </p>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/50">
            New Signed Deals
          </h2>
          <p className="mb-1 text-4xl font-semibold tabular-nums text-white sm:text-5xl">
            {metrics.newSignedDeals}
          </p>
          <p className="text-xs text-white/50">
            SUM(won_deals) from daily_funnel_metrics · based on creation date
          </p>
        </div>
      </div>
    </section>
  );
}
