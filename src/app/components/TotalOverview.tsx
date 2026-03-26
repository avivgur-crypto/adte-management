"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFilter } from "@/app/context/FilterContext";
import type { MonthOverview, XDASHMonthTotals } from "@/app/actions/financials";
import {
  DataSourceToggle,
  type FinancialDataSource,
} from "@/app/components/DataSourceToggle";

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

/** Smoothly animates a number from its previous value to the new one. */
function AnimatedCurrency({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  const raf = useRef(0);

  useEffect(() => {
    const from = prev.current;
    const to = value;
    prev.current = to;
    if (from === to) return;

    const duration = 400;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const current = from + (to - from) * ease;
      if (ref.current) ref.current.textContent = formatCurrency(current);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);

  return (
    <span ref={ref} className={className}>
      {formatCurrency(value)}
    </span>
  );
}

/** Collapsible wrapper: animates height + opacity via grid‑row trick. */
function Collapsible({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="grid transition-[grid-template-rows,opacity] duration-300 ease-in-out"
      style={{
        gridTemplateRows: open ? "1fr" : "0fr",
        opacity: open ? 1 : 0,
      }}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

function ProfitMarginCard({
  profit,
  revenue,
}: {
  profit: number;
  revenue: number;
}) {
  const pct = revenue === 0 ? 0 : (profit / revenue) * 100;
  const rounded = Math.round(pct * 10) / 10;
  const display = `${rounded.toFixed(1)}%`;

  return (
    <div className="min-w-0 rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/50">
        <span className="inline sm:hidden">Margin %</span>
        <span className="hidden sm:inline">Profit Margin %</span>
      </h2>
      <div className="flex min-h-[65px] min-w-0 items-center">
        <span
          className={`max-w-full text-[clamp(1.25rem,calc(0.45rem+2.4vw),2.125rem)] font-semibold tabular-nums leading-none ${
            rounded >= 0 ? "text-white" : "text-red-400"
          }`}
        >
          {display}
        </span>
      </div>
    </div>
  );
}

function RevenueCard({
  data,
  source,
}: {
  data: MonthOverview[];
  source: FinancialDataSource;
}) {
  const totalRevenue = useMemo(
    () => data.reduce((s, d) => s + d.mediaRevenue + d.saasRevenue, 0),
    [data],
  );
  const mediaTotal = useMemo(
    () => data.reduce((s, d) => s + d.mediaRevenue, 0),
    [data],
  );
  const saasTotal = useMemo(
    () => data.reduce((s, d) => s + d.saasRevenue, 0),
    [data],
  );

  return (
    <div className="min-w-0 rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/50">
        Publisher Revenue
      </h2>
      <div className="flex min-h-[65px] min-w-0 items-center">
        <AnimatedCurrency
          value={totalRevenue}
          className="block w-full min-w-0 max-w-full text-[clamp(1.25rem,calc(0.45rem+2.4vw),2.125rem)] font-semibold tabular-nums leading-none text-white"
        />
      </div>
      <Collapsible open={source === "billing"}>
        <div className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 text-sm">
          <span className="font-medium text-white/50">Media</span>
          <span className="text-right tabular-nums text-white/90">
            {formatCurrency(mediaTotal)}
          </span>
          <span className="font-medium text-white/50">SaaS</span>
          <span className="text-right tabular-nums text-white/90">
            {formatCurrency(saasTotal)}
          </span>
        </div>
      </Collapsible>
    </div>
  );
}

function CostCard({
  data,
  source,
}: {
  data: MonthOverview[];
  source: FinancialDataSource;
}) {
  const totalCost = useMemo(
    () => data.reduce((s, d) => s + d.mediaCost + d.techCost + d.bsCost, 0),
    [data],
  );
  const mediaCost = useMemo(
    () => data.reduce((s, d) => s + d.mediaCost, 0),
    [data],
  );
  const techCost = useMemo(
    () => data.reduce((s, d) => s + d.techCost, 0),
    [data],
  );
  const bsCost = useMemo(
    () => data.reduce((s, d) => s + d.bsCost, 0),
    [data],
  );

  return (
    <div className="min-w-0 rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/50">
        Total Cost
      </h2>
      <div className="flex min-h-[65px] min-w-0 items-center">
        <AnimatedCurrency
          value={totalCost}
          className="block w-full min-w-0 max-w-full text-[clamp(1.25rem,calc(0.45rem+2.4vw),2.125rem)] font-semibold tabular-nums leading-none text-white"
        />
      </div>
      <Collapsible open={source === "billing"}>
        <div className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 text-sm">
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
      </Collapsible>
    </div>
  );
}

function ProfitCard({
  profit,
  source,
}: {
  profit: number;
  source: FinancialDataSource;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/50">
        <span className="sm:hidden">G. Profit</span>
        <span className="hidden sm:inline">Gross Profit</span>
      </h2>
      <div className="mb-4 flex min-h-[65px] min-w-0 items-center">
        <AnimatedCurrency
          value={profit}
          className={`block w-full min-w-0 max-w-full text-[clamp(1.25rem,calc(0.45rem+2.4vw),2.125rem)] font-semibold tabular-nums leading-none ${
            profit >= 0 ? "text-white" : "text-red-400"
          }`}
        />
      </div>
      {source === "billing" && (
        <div className="text-sm text-white/50">Revenue − Cost</div>
      )}
    </div>
  );
}

export default function TotalOverview({
  dataByMonth,
  xdashByMonth,
}: {
  dataByMonth: MonthOverview[];
  xdashByMonth?: Record<string, XDASHMonthTotals>;
}) {
  const { selectedMonths } = useFilter();
  const [source, setSource] = useState<FinancialDataSource>("xdash");

  const { filteredData, profitValue, revenueTotal } = useMemo(() => {
    const billing = dataByMonth.filter((d) => selectedMonths.has(d.month));

    // Billing profit: total revenue − total cost (all buckets)
    const billingProfit = billing.reduce(
      (s, d) => s + d.mediaRevenue + d.saasRevenue - d.mediaCost - d.techCost - d.bsCost,
      0,
    );

    // XDASH profit: sum of synced netRevenue − netCost per month
    const xdashProfit = xdashByMonth
      ? billing.reduce((s, d) => s + (xdashByMonth[d.month]?.mediaProfit ?? 0), 0)
      : billingProfit;

    const profit = source === "billing" ? billingProfit : xdashProfit;

    const revenueFromRows = (rows: MonthOverview[]) =>
      rows.reduce((s, d) => s + d.mediaRevenue + d.saasRevenue, 0);

    if (source === "billing" || !xdashByMonth) {
      return {
        filteredData: billing,
        profitValue: profit,
        revenueTotal: revenueFromRows(billing),
      };
    }

    const mapped = billing.map((d) => {
      const xdash = xdashByMonth[d.month];
      if (!xdash || (xdash.mediaRevenue === 0 && xdash.mediaCost === 0)) {
        return d;
      }
      return {
        ...d,
        mediaRevenue: xdash.mediaRevenue,
        mediaCost: xdash.mediaCost,
      };
    });
    return {
      filteredData: mapped,
      profitValue: profit,
      revenueTotal: revenueFromRows(mapped),
    };
  }, [dataByMonth, selectedMonths, source, xdashByMonth]);

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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[25px] font-extrabold text-white">
          Main <span className="highlight-brand">Stats</span>
        </h2>
        <DataSourceToggle value={source} onChange={setSource} />
      </div>
      <div className="grid min-w-0 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <RevenueCard data={filteredData} source={source} />
        <CostCard data={filteredData} source={source} />
        <ProfitCard profit={profitValue} source={source} />
        <ProfitMarginCard profit={profitValue} revenue={revenueTotal} />
      </div>
    </section>
  );
}
