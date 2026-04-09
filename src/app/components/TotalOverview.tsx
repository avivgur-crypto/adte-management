"use client";

import type { ReactNode } from "react";
import { useMemo, useRef, useEffect, useState } from "react";
import {
  Check,
  CircleDollarSign,
  Coins,
  Percent,
  TrendingUp,
} from "lucide-react";
import { useFilter } from "@/app/context/FilterContext";
import type {
  DailyProfitGoalPace,
  MonthOverview,
  XDASHMonthTotals,
} from "@/app/actions/financials";
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

function MetricRow({
  icon: Icon,
  title,
  value,
  valueClassName,
  subParts,
  subNote,
  leadingBeforeIcon,
  valueSuffix,
}: {
  icon: typeof CircleDollarSign;
  title: ReactNode;
  value: number;
  valueClassName: string;
  subParts: SubPart[];
  subNote?: string;
  /** e.g. daily goal ring — sits left of the dim metric icon, same row height as other cards. */
  leadingBeforeIcon?: ReactNode;
  valueSuffix?: ReactNode;
}) {
  return (
    <div className="border-b border-white/[0.07] bg-white/5 px-3 py-2 last:border-b-0">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-1.5">
          {leadingBeforeIcon}
          <Icon
            className="h-3.5 w-3.5 shrink-0 text-white/35"
            strokeWidth={2}
            aria-hidden
          />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-white/45">
            {title}
          </span>
        </div>
        <div className="flex shrink-0 items-baseline gap-0">
          <AnimatedCurrency
            value={value}
            className={`text-xl font-bold tabular-nums leading-none ${valueClassName}`}
          />
          {valueSuffix}
        </div>
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

function profitToneClass(value: number): string {
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-red-400";
  return "text-white/80";
}

function formatGoalPercentLabel(p: number): string {
  const rounded = Math.round(p * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** 16×16 ring: daily goal fill; solid + check when ≥100%. */
function ProfitGoalRing({
  ringFillPct,
  reached,
}: {
  ringFillPct: number;
  reached: boolean;
}) {
  const r = 5;
  const c = 2 * Math.PI * r;
  const dash = (Math.min(100, Math.max(0, ringFillPct)) / 100) * c;

  if (reached) {
    return (
      <span
        className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center"
        aria-hidden
      >
        <span className="absolute inset-0 rounded-full bg-emerald-500" />
        <Check
          className="relative z-10 h-2.5 w-2.5 text-emerald-950"
          strokeWidth={3}
          aria-hidden
        />
      </span>
    );
  }

  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 16 16" aria-hidden>
      <circle
        cx="8"
        cy="8"
        r={r}
        className="fill-none stroke-white/10"
        strokeWidth="2"
      />
      <circle
        cx="8"
        cy="8"
        r={r}
        className="fill-none stroke-emerald-500"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform="rotate(-90 8 8)"
      />
    </svg>
  );
}

export default function TotalOverview({
  dataByMonth,
  xdashByMonth,
  dailyProfitGoalPace = null,
  todayGrossProfit = null,
}: {
  dataByMonth: MonthOverview[];
  xdashByMonth?: Record<string, XDASHMonthTotals>;
  /** Today’s GP vs daily quota (profit_goal ÷ days in month) — same basis as the former pulse bar. */
  dailyProfitGoalPace?: DailyProfitGoalPace | null;
  todayGrossProfit?: number | null;
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

  const marginPct = useMemo(() => {
    const { profitValue, revenueTotal } = metrics;
    if (revenueTotal === 0) return 0;
    return Math.round((profitValue / revenueTotal) * 1000) / 10;
  }, [metrics]);

  const dailyGoalProgress = useMemo(() => {
    const target = dailyProfitGoalPace?.dailyAverageTarget;
    if (target == null || target <= 0 || todayGrossProfit == null) return null;
    const raw = (todayGrossProfit / target) * 100;
    return {
      displayPercent: Math.round(raw * 10) / 10,
      ringFillPct: Math.min(100, Math.max(0, raw)),
      reached: raw >= 100,
    };
  }, [dailyProfitGoalPace, todayGrossProfit]);

  if (metrics.filteredData.length === 0) {
    return (
      <section className="mb-8">
        <p className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/60">
          Select at least one month in the filter to see total overview.
        </p>
      </section>
    );
  }

  const revenueSubs: SubPart[] = [
    { key: "r1", label: `${labels.revenueFirst}:`, value: metrics.mediaRev },
    { key: "r2", label: `${labels.revenueSecond}:`, value: metrics.saasRev },
  ];

  const costSubs: SubPart[] = [
    { key: "c1", label: `${labels.costFirst}:`, value: metrics.mediaCost },
    { key: "c2", label: `${labels.costSecond}:`, value: metrics.techCost },
    { key: "c3", label: `${labels.bs}:`, value: metrics.bsCost },
  ];

  const profitSubs: SubPart[] = [
    { key: "p1", label: `${labels.profitFirst}:`, value: metrics.mediaPL },
    { key: "p2", label: `${labels.profitSecond}:`, value: metrics.saasPL },
  ];

  const profitNote =
    source === "billing" ? "Revenue − cost (all buckets)." : undefined;

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
          valueClassName="text-white"
          subParts={revenueSubs}
        />
        <MetricRow
          icon={Coins}
          title="Total cost"
          value={metrics.totalCost}
          valueClassName="text-white"
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
          valueClassName={profitToneClass(metrics.profitValue)}
          subParts={profitSubs}
          subNote={profitNote}
          leadingBeforeIcon={
            dailyGoalProgress ? (
              <span
                className="inline-flex shrink-0"
                title="Today vs daily gross-profit target"
                aria-label={`Daily goal progress about ${formatGoalPercentLabel(dailyGoalProgress.displayPercent)} percent`}
              >
                <ProfitGoalRing
                  ringFillPct={dailyGoalProgress.ringFillPct}
                  reached={dailyGoalProgress.reached}
                />
              </span>
            ) : undefined
          }
          valueSuffix={
            dailyGoalProgress ? (
              <span className="ml-1 text-xs tabular-nums text-white/40">
                ({formatGoalPercentLabel(dailyGoalProgress.displayPercent)}%)
              </span>
            ) : undefined
          }
        />
        <div className="border-b border-white/[0.07] bg-white/5 px-3 py-2 last:border-b-0">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
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
            <span
              className={`shrink-0 text-xl font-bold tabular-nums leading-none ${
                marginPct >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {marginPct.toFixed(1)}%
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
