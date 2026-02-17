"use client";

import { useEffect, useMemo, useState } from "react";
import { getActivityMetrics } from "@/app/actions/activity";
import { useFilter } from "@/app/context/FilterContext";
import type { ActivityMetrics } from "@/app/actions/activity";

function getCurrentMonthStart(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/** Stable key so we only refetch when the actual selection changes. */
function monthStartsKey(selectedMonths: Set<string>): string {
  if (selectedMonths.size === 0) return getCurrentMonthStart();
  return JSON.stringify(Array.from(selectedMonths).sort());
}

function keyToMonths(key: string): string[] {
  if (key.startsWith("[")) return JSON.parse(key) as string[];
  return [key];
}

export default function ActivitySummary() {
  const { selectedMonths } = useFilter();
  const [data, setData] = useState<ActivityMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const key = useMemo(() => monthStartsKey(selectedMonths), [selectedMonths]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const months = keyToMonths(key);
    getActivityMetrics(months)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load activity");
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (loading) {
    return (
      <section className="mb-8">
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              New Leads
            </h2>
            <p className="text-zinc-400 dark:text-zinc-500">Loading…</p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              New Signed Deals
            </h2>
            <p className="text-zinc-400 dark:text-zinc-500">Loading…</p>
          </div>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="mb-8">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
          {error}
        </div>
      </section>
    );
  }

  const metrics = data ?? { newLeads: 0, newSignedDeals: 0 };

  return (
    <section className="mb-8">
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            New Leads
          </h2>
          <p className="mb-1 text-4xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100 sm:text-5xl">
            {metrics.newLeads}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Based on creation date
          </p>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            New Signed Deals
          </h2>
          <p className="mb-1 text-4xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100 sm:text-5xl">
            {metrics.newSignedDeals}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Based on creation date
          </p>
        </div>
      </div>
    </section>
  );
}
