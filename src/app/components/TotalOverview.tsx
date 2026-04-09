"use client";

import type { ReactNode } from "react";
import { useMemo, useRef, useEffect, useState } from "react";
import { CircleDollarSign, Coins, Percent, TrendingUp } from "lucide-react";
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

function metricCopy(source: FinancialDataSource) {
  return {
    revenueFirst: source === "billing" ? "Ad Network" : "Media",
    revenueSecond: "SaaS",
    costFirst: "Media",
    costSecond: "Tech",
    profitFirst: source === "billing" ? "Ad Network" : "Media",
    profitSecond: "SaaS",
    bs: "Brand Safety",
  } as const;
}

type SubPart = { key: string; label: string; value: number };

/** Shared shell so Revenue / Cost / Profit / Margin primary lines align pixel-consistent. */
const STAT_ROW =
  "border-b border-white/[0.07] bg-white/5 px-3 py-2 last:border-b-0";
const STAT_PRIMARY =
  "flex min-h-[2.25rem] min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1";

/** Ledger-style: all headline figures neutral white (no sign-based color). */
const PRIMARY_FIGURE =
  "shrink-0 text-xl font-bold tabular-nums leading-none text-white";

function MetricRow({
  icon: Icon,
  title,
  value,
  subParts,
  subNote,
}: {
  icon: typeof CircleDollarSign;
  title: ReactNode;
  value: number;
  subParts: SubPart[];
  subNote?: string;
}) {
  return (
    <div className={STAT_ROW}>
      <div className={STAT_PRIMARY}>
        <div className="flex min-w-0 items-center gap-2">
          <Icon
            className="h-3.5 w-3.5 shrink-0 text-white/35"
            strokeWidth={2}
            aria-hidden
          />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-white/45">
            {title}
          </span>
        </div>
        <AnimatedCurrency value={value} className={PRIMARY_FIGURE} />
      </div>
      {subParts.length > 0 && (
        <div className="mt-1.5 min-w-0 pl-5 sm:pl-6">
          <p className="text-[11px] leading-snug text-white/55 sm:text-xs">
            <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5 [word-break:break-word]">
              {subParts.map((p, i) => (
                <span key={p.key} className="inline min-w-0 max-w-full">
                  {i > 0 && (
                    <span className="mr-2 text-white/25" aria-hidden>
                      |
                    </span>
                  )}
                  <span className="text-white/40">{p.label}</span>
                  <span className="ml-0.5 tabular-nums text-white/75">
                    {formatCurrency(p.value)}
                  </span>
                </span>
              ))}
            </span>
          </p>
        </div>
      )}
      {subNote ? (
        <p className="mt-1 pl-5 text-[10px] text-white/35 sm:pl-6">{subNote}</p>
      ) : null}
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

  const metrics = useMemo(() => {
    const billing = dataByMonth.filter((d) => selectedMonths.has(d.month));

    const filteredData =
      source === "billing" || !xdashByMonth
        ? billing
        : billing.map((d) => {
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

    const revenueTotal = filteredData.reduce(
      (s, d) => s + d.mediaRevenue + d.saasRevenue,
      0,
    );
    const mediaRev = filteredData.reduce((s, d) => s + d.mediaRevenue, 0);
    const saasRev = filteredData.reduce((s, d) => s + d.saasRevenue, 0);
    const mediaCost = filteredData.reduce((s, d) => s + d.mediaCost, 0);
    const techCost = filteredData.reduce((s, d) => s + d.techCost, 0);
    const bsCost = filteredData.reduce((s, d) => s + d.bsCost, 0);
    const mediaPL = filteredData.reduce(
      (s, d) => s + (d.mediaRevenue - d.mediaCost),
      0,
    );
    const saasPL = filteredData.reduce(
      (s, d) => s + (d.saasRevenue - d.techCost - d.bsCost),
      0,
    );
    const profitValue = mediaPL + saasPL;

    return {
      filteredData,
      profitValue,
      revenueTotal,
      totalRevenue: mediaRev + saasRev,
      mediaRev,
      saasRev,
      totalCost: mediaCost + techCost + bsCost,
      mediaCost,
      techCost,
      bsCost,
      mediaPL,
      saasPL,
    };
  }, [dataByMonth, selectedMonths, source, xdashByMonth]);

  const labels = metricCopy(source);
  const showBreakdown = source === "billing";

  const marginPct = useMemo(() => {
    const { profitValue, revenueTotal } = metrics;
    if (revenueTotal === 0) return 0;
    return Math.round((profitValue / revenueTotal) * 1000) / 10;
  }, [metrics]);

  if (metrics.filteredData.length === 0) {
    return (
      <section className="mb-8">
        <p className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/60">
          Select at least one month in the filter to see total overview.
        </p>
      </section>
    );
  }

  const revenueSubs: SubPart[] = showBreakdown
    ? [
        { key: "r1", label: `${labels.revenueFirst}:`, value: metrics.mediaRev },
        { key: "r2", label: `${labels.revenueSecond}:`, value: metrics.saasRev },
      ]
    : [];

  const costSubs: SubPart[] = showBreakdown
    ? [
        { key: "c1", label: `${labels.costFirst}:`, value: metrics.mediaCost },
        { key: "c2", label: `${labels.costSecond}:`, value: metrics.techCost },
        { key: "c3", label: `${labels.bs}:`, value: metrics.bsCost },
      ]
    : [];

  const profitSubs: SubPart[] = showBreakdown
    ? [
        { key: "p1", label: `${labels.profitFirst}:`, value: metrics.mediaPL },
        { key: "p2", label: `${labels.profitSecond}:`, value: metrics.saasPL },
      ]
    : [];

  const profitNote = showBreakdown ? "Revenue − cost (all buckets)." : undefined;

  return (
    <section className="mb-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[25px] font-extrabold text-white">
          Main <span className="highlight-brand">Stats</span>
        </h2>
        <DataSourceToggle value={source} onChange={setSource} />
      </div>

      <div className="overflow-hidden rounded-xl border border-white/[0.08]">
        <MetricRow
          icon={CircleDollarSign}
          title="Publisher revenue"
          value={metrics.totalRevenue}
          subParts={revenueSubs}
        />
        <MetricRow
          icon={Coins}
          title="Total cost"
          value={metrics.totalCost}
          subParts={costSubs}
        />
        <MetricRow
          icon={TrendingUp}
          title={
            <>
              <span className="sm:hidden">G. profit</span>
              <span className="hidden sm:inline">Gross profit</span>
            </>
          }
          value={metrics.profitValue}
          subParts={profitSubs}
          subNote={profitNote}
        />
        <div className={STAT_ROW}>
          <div className={STAT_PRIMARY}>
            <div className="flex min-w-0 items-center gap-2">
              <Percent
                className="h-3.5 w-3.5 shrink-0 text-white/35"
                strokeWidth={2}
                aria-hidden
              />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-white/45">
                <span className="inline sm:hidden">Margin %</span>
                <span className="hidden sm:inline">Profit margin %</span>
              </span>
            </div>
            <span className={PRIMARY_FIGURE}>{marginPct.toFixed(1)}%</span>
          </div>
        </div>
      </div>
    </section>
  );
}
