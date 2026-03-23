"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFilter } from "@/app/context/FilterContext";
import type { MonthOverview, XDASHMonthTotals } from "@/app/actions/financials";

type DataSource = "billing" | "xdash";

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

function RevenueCard({
  data,
  source,
}: {
  data: MonthOverview[];
  source: DataSource;
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
    <div className="rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/50">
        Publisher Revenue
      </h2>
      <div className="flex min-h-[65px] items-center">
        <AnimatedCurrency
          value={totalRevenue}
          className="w-[230px] text-[43px] font-semibold tabular-nums text-white"
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
  source: DataSource;
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
    <div className="rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/50">
        Total Cost
      </h2>
      <div className="flex min-h-[65px] items-center">
        <AnimatedCurrency
          value={totalCost}
          className="w-[230px] text-[43px] font-semibold tabular-nums text-white"
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
  source: DataSource;
}) {
  const isBilling = source === "billing";
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/50">
        {isBilling ? "Profit" : "Net Profit"}
      </h2>
      <div className="mb-4 flex min-h-[65px] items-center">
        <AnimatedCurrency
          value={profit}
          className={`w-[230px] text-[43px] font-semibold tabular-nums ${
            profit >= 0 ? "text-white" : "text-red-400"
          }`}
        />
      </div>
      <div className="text-sm text-white/50">
        {isBilling ? "Revenue − Cost" : "From XDASH (synced)"}
      </div>
    </div>
  );
}

function SourceToggle({
  value,
  onChange,
}: {
  value: DataSource;
  onChange: (v: DataSource) => void;
}) {
  return (
    <div className="relative inline-flex rounded-full border border-white/10 bg-black/40 p-[3px]">
      {/* sliding indicator */}
      <div
        className="absolute inset-y-[3px] w-[calc(50%-3px)] rounded-full bg-white/15 transition-transform duration-300 ease-in-out"
        style={{
          transform: value === "billing" ? "translateX(3px)" : "translateX(calc(100% + 3px))",
        }}
      />
      {(["billing", "xdash"] as const).map((src) => (
        <button
          key={src}
          onClick={() => onChange(src)}
          className={`relative z-10 rounded-full px-4 py-1 text-xs font-semibold transition-colors duration-200 ${
            value === src ? "text-white" : "text-white/40 hover:text-white/60"
          }`}
        >
          {src === "billing" ? "Billing" : "XDASH"}
        </button>
      ))}
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
  const [source, setSource] = useState<DataSource>("xdash");

  const { filteredData, profitValue } = useMemo(() => {
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

    if (source === "billing" || !xdashByMonth) {
      return { filteredData: billing, profitValue: profit };
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
    return { filteredData: mapped, profitValue: profit };
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
          Revenue vs. <span className="highlight-brand">Cost</span>
        </h2>
        <SourceToggle value={source} onChange={setSource} />
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <RevenueCard data={filteredData} source={source} />
        <CostCard data={filteredData} source={source} />
        <ProfitCard profit={profitValue} source={source} />
      </div>
    </section>
  );
}
