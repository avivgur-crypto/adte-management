"use client";

import { useMemo } from "react";
import { useFilter } from "@/app/context/FilterContext";
import type { MonthOverview } from "@/app/actions/financials";

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function RevenueCard({ data }: { data: MonthOverview[] }) {
  const totalRevenue = useMemo(
    () => data.reduce((s, d) => s + d.mediaRevenue + d.saasRevenue, 0),
    [data]
  );
  const mediaTotal = useMemo(() => data.reduce((s, d) => s + d.mediaRevenue, 0), [data]);
  const saasTotal = useMemo(() => data.reduce((s, d) => s + d.saasRevenue, 0), [data]);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        Publisher Revenue
      </h2>
      <p className="mb-4 text-4xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400 sm:text-5xl">
        {formatCurrency(totalRevenue)}
      </p>
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 items-center text-sm">
        <span className="font-medium text-zinc-600 dark:text-zinc-400">Media</span>
        <span className="text-right tabular-nums text-zinc-900 dark:text-zinc-200">
          {formatCurrency(mediaTotal)}
        </span>
        <span className="font-medium text-zinc-600 dark:text-zinc-400">SaaS</span>
        <span className="text-right tabular-nums text-zinc-900 dark:text-zinc-200">
          {formatCurrency(saasTotal)}
        </span>
      </div>
    </div>
  );
}

function CostCard({ data }: { data: MonthOverview[] }) {
  const totalCost = useMemo(
    () =>
      data.reduce(
        (s, d) => s + d.mediaCost + d.techCost + d.bsCost,
        0
      ),
    [data]
  );
  const mediaCost = useMemo(() => data.reduce((s, d) => s + d.mediaCost, 0), [data]);
  const techCost = useMemo(() => data.reduce((s, d) => s + d.techCost, 0), [data]);
  const bsCost = useMemo(() => data.reduce((s, d) => s + d.bsCost, 0), [data]);

  return (
    <div className="rounded-2xl border-2 border-amber-200 bg-white p-6 shadow-sm dark:border-amber-800/60 dark:bg-zinc-950">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        Total Cost
      </h2>
      <p className="mb-4 text-4xl font-bold tabular-nums text-amber-600 dark:text-amber-400 sm:text-5xl">
        {formatCurrency(totalCost)}
      </p>
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 items-center text-sm">
        <span className="font-medium text-zinc-600 dark:text-zinc-400">Media</span>
        <span className="text-right tabular-nums text-zinc-900 dark:text-zinc-200">
          {formatCurrency(mediaCost)}
        </span>
        <span className="font-medium text-zinc-600 dark:text-zinc-400">Tech</span>
        <span className="text-right tabular-nums text-zinc-900 dark:text-zinc-200">
          {formatCurrency(techCost)}
        </span>
        <span className="font-medium text-zinc-600 dark:text-zinc-400">Brand Safety</span>
        <span className="text-right tabular-nums text-zinc-900 dark:text-zinc-200">
          {formatCurrency(bsCost)}
        </span>
      </div>
    </div>
  );
}

export default function TotalOverview({
  dataByMonth,
}: {
  dataByMonth: MonthOverview[];
}) {
  const { selectedMonths } = useFilter();
  const filteredData = useMemo(
    () => dataByMonth.filter((d) => selectedMonths.has(d.month)),
    [dataByMonth, selectedMonths]
  );

  if (filteredData.length === 0) {
    return (
      <section className="mb-8">
        <p className="rounded-xl border border-zinc-200 bg-zinc-50/50 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
          Select at least one month in the filter to see total overview.
        </p>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        Revenue vs. Cost
      </h2>
      <p className="mb-4 text-sm text-zinc-400 dark:text-zinc-500">
        (from Billing)
      </p>
      <div className="grid gap-6 sm:grid-cols-2">
        <RevenueCard data={filteredData} />
        <CostCard data={filteredData} />
      </div>
    </section>
  );
}
