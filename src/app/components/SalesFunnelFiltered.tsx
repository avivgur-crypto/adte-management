"use client";

import { useEffect, useMemo, useState } from "react";
import { getSalesFunnelMetrics } from "@/app/actions/sales";
import { useFilter } from "@/app/context/FilterContext";
import SalesFunnel from "./SalesFunnel";
import type { SalesFunnelMetrics } from "@/app/actions/sales";

function getCurrentMonthStart(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/** Stable key so we only refetch when the actual selection changes, not Set reference. */
function monthStartsKey(selectedMonths: Set<string>): string {
  if (selectedMonths.size === 0) return getCurrentMonthStart();
  return JSON.stringify(Array.from(selectedMonths).sort());
}

function keyToMonths(key: string): string[] {
  if (key.startsWith("[")) return JSON.parse(key) as string[];
  return [key];
}

export default function SalesFunnelFiltered() {
  const { selectedMonths } = useFilter();
  const [data, setData] = useState<SalesFunnelMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const key = useMemo(() => monthStartsKey(selectedMonths), [selectedMonths]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const months = keyToMonths(key);
    getSalesFunnelMetrics(months)
      .then((result) => {
        if (!cancelled) setData(result ?? null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load funnel");
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
      <div className="rounded-2xl border border-zinc-200 bg-[#F8F6F1] p-8 dark:border-zinc-800">
        <h2 className="mb-2 text-center text-xl font-bold uppercase tracking-wide text-[#2B2B4A]">
          Sales Funnel
        </h2>
        <p className="text-center text-sm text-[#2B2B4A]/70">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950/50">
        <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Sales Funnel
        </h2>
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
      </div>
    );
  }

  return <SalesFunnel data={data} />;
}
