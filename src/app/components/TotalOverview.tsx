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
    <div className="rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/50">
        Publisher Revenue
      </h2>
      <p className="mb-4 text-4xl font-semibold tabular-nums text-white sm:text-5xl">
        {formatCurrency(totalRevenue)}
      </p>
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 items-center text-sm">
        <span className="font-medium text-white/50">Media</span>
        <span className="text-right tabular-nums text-white/90">
          {formatCurrency(mediaTotal)}
        </span>
        <span className="font-medium text-white/50">SaaS</span>
        <span className="text-right tabular-nums text-white/90">
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
    <div className="rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/50">
        Total Cost
      </h2>
      <p className="mb-4 text-4xl font-semibold tabular-nums text-white sm:text-5xl">
        {formatCurrency(totalCost)}
      </p>
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 items-center text-sm">
        <span className="font-medium text-white/50">Media</span>
        <span className="text-right tabular-nums text-white/90">
          {formatCurrency(mediaCost)}
        </span>
        <span className="font-medium text-white/50">Tech</span>
        <span className="text-right tabular-nums text-white/90">
          {formatCurrency(techCost)}
        </span>
        <span className="font-medium text-white/50">Brand Safety</span>
        <span className="text-right tabular-nums text-white/90">
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
        <p className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/60">
          Select at least one month in the filter to see total overview.
        </p>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <h2 className="mb-2 text-[25px] font-extrabold text-white">
        Revenue vs. Cost
      </h2>
      <p className="mb-4 text-sm text-white/50">
        (from Billing)
      </p>
      <div className="grid gap-6 sm:grid-cols-2">
        <RevenueCard data={filteredData} />
        <CostCard data={filteredData} />
      </div>
    </section>
  );
}
