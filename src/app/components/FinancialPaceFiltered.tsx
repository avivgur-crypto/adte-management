"use client";

import { useEffect, useMemo, useState } from "react";
import { getFinancialPace } from "@/app/actions/financials";
import { useFilter } from "@/app/context/FilterContext";
import FinancialPaceCard from "./FinancialPaceCard";
import type { FinancialPaceWithTrend } from "@/app/actions/financials";

function getCurrentMonthStart(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/** Stable key so we only refetch when the effective month changes. */
function effectiveMonthKey(selectedMonths: Set<string>): string {
  if (selectedMonths.size === 0) return getCurrentMonthStart();
  const sorted = Array.from(selectedMonths).sort();
  return sorted[0] ?? getCurrentMonthStart();
}

export default function FinancialPaceFiltered() {
  const { selectedMonths } = useFilter();
  const [summary, setSummary] = useState<FinancialPaceWithTrend | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const monthStart = useMemo(() => effectiveMonthKey(selectedMonths), [selectedMonths]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getFinancialPace(monthStart)
      .then((result) => {
        if (!cancelled) setSummary(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load pacing");
          setSummary(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [monthStart]);

  if (loading) {
    return (
      <div className="w-full max-w-4xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Pacing achievement
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
        {error}
      </div>
    );
  }

  if (!summary) return null;

  return <FinancialPaceCard summary={summary} />;
}
