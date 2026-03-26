"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ComparisonData, TodayHomeRow } from "@/app/actions/financials";

const PERIODS = [
  { key: 1 as const, label: "1d" },
  { key: 7 as const, label: "7d" },
  { key: 28 as const, label: "28d" },
];

type PeriodKey = (typeof PERIODS)[number]["key"];

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Compact USD for paced baseline: always use K for |n| ≥ 1k (e.g. $36.5k).
 * Below 1k, whole dollars without cents clutter.
 */
function formatCurrencyCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${Math.round(abs)}`;
}

function marginPct(revenue: number, profit: number): string {
  if (revenue === 0) return "0.0%";
  const p = (profit / revenue) * 100;
  return `${(Math.round(p * 10) / 10).toFixed(1)}%`;
}

/** One-decimal margin % for comparison line (matches main margin display). */
function formatMarginPctDisplay(p: number): string {
  return `${(Math.round(p * 10) / 10).toFixed(1)}%`;
}

type DeltaKind = "none" | "no_hist" | "na" | "flat" | "pct";

type DeltaResult = {
  kind: DeltaKind;
  pct?: number;
  /** pastDay × dayProgress — “paced total” for this clock time on the comparison day */
  pacedBaseline?: number;
};

type MarginDeltaResult =
  | { kind: "no_hist" }
  | { kind: "na"; pastMarginPct?: number }
  | { kind: "pp"; pp: number; pastMarginPct: number };

/** Fraction [0.01, 1] of Israel calendar day elapsed (linear pacing baseline). */
function getIsraelDayProgress(): number {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  let frac = (hour + minute / 60) / 24;
  if (frac <= 0) frac = 0.01;
  if (frac > 1) frac = 1;
  return frac;
}

function useIsraelDayProgress(): number {
  const [progress, setProgress] = useState(getIsraelDayProgress);
  useEffect(() => {
    const tick = () => setProgress(getIsraelDayProgress());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);
  return progress;
}

/**
 * Linear pace: compare today so far vs (past full-day × dayProgress).
 * % = ((today / (past × dayProgress)) − 1) × 100
 */
function computeDelta(
  today: number,
  pastRow: TodayHomeRow | null,
  pick: (r: TodayHomeRow) => number,
  dayProgress: number,
): DeltaResult {
  if (!pastRow) return { kind: "no_hist" };
  const past = pick(pastRow);
  const pacedBaseline = past * dayProgress;

  if (today === 0) {
    return {
      kind: "flat",
      pacedBaseline: past !== 0 ? pacedBaseline : undefined,
    };
  }

  if (past === 0) return { kind: "na" };

  if (pacedBaseline <= 0) return { kind: "na" };

  const pct = (today / pacedBaseline - 1) * 100;
  return { kind: "pct", pct, pacedBaseline };
}

/**
 * Margin vs same calendar day in the past: full-day margins (no pacing).
 * Delta = percentage points (today margin − past margin).
 */
function computeMarginDelta(
  todayRev: number,
  todayProfit: number,
  pastRow: TodayHomeRow | null,
): MarginDeltaResult {
  if (!pastRow) return { kind: "no_hist" };

  if (todayRev === 0) {
    const pastMarginPct =
      pastRow.revenue !== 0
        ? (pastRow.profit / pastRow.revenue) * 100
        : undefined;
    return { kind: "na", pastMarginPct };
  }
  if (pastRow.revenue === 0) {
    return { kind: "na" };
  }

  const pastMarginPct = (pastRow.profit / pastRow.revenue) * 100;
  const todayMargin = (todayProfit / todayRev) * 100;
  const pp = todayMargin - pastMarginPct;
  return { kind: "pp", pp, pastMarginPct };
}

const PACED_TOOLTIP =
  "Paced total: full-day value for that historical date × today’s day fraction (Israel time). This is the dollar baseline the % compares against.";

const MARGIN_DELTA_TOOLTIP =
  "Margin change vs that day’s full-day margin (not paced). Shown as percentage points. Value in parentheses is that day’s full-day profit margin.";

function deltaToneClasses(up: boolean, down: boolean) {
  if (up) {
    return {
      main: "text-emerald-300",
      muted: "text-emerald-300/55",
    };
  }
  if (down) {
    return {
      main: "text-red-400",
      muted: "text-red-400/55",
    };
  }
  return { main: "text-white/50", muted: "text-white/40" };
}

function ComparisonPill({ children }: { children: ReactNode }) {
  return (
    <div className="mt-2 min-h-[2.75rem] rounded-xl border border-white/[0.08] bg-black/30 px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[12px] leading-snug sm:text-[13px]">
        {children}
      </div>
    </div>
  );
}

function DeltaSubline({ delta }: { delta: DeltaResult }) {
  if (delta.kind === "none") {
    return (
      <ComparisonPill>
        <span className="font-medium tabular-nums text-white/40">—</span>
      </ComparisonPill>
    );
  }
  if (delta.kind === "no_hist") {
    return (
      <ComparisonPill>
        <span className="font-medium text-white/45">No historical data</span>
      </ComparisonPill>
    );
  }
  if (delta.kind === "flat") {
    const pb = delta.pacedBaseline;
    return (
      <ComparisonPill>
        <span
          className="font-medium tabular-nums text-white/45"
          title={pb != null ? PACED_TOOLTIP : undefined}
        >
          —
          {pb != null && (
            <span className="text-[11px] font-normal text-white/40">
              {" "}
              (paced {formatCurrencyCompact(pb)})
            </span>
          )}
        </span>
      </ComparisonPill>
    );
  }
  if (delta.kind === "na") {
    return (
      <ComparisonPill>
        <span className="font-medium tabular-nums text-white/45">N/A</span>
      </ComparisonPill>
    );
  }
  const pct = delta.pct ?? 0;
  const up = pct > 0;
  const down = pct < 0;
  const tone = deltaToneClasses(up, down);
  const formatted = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  const pb = delta.pacedBaseline;
  return (
    <ComparisonPill>
      <span
        className={`inline-flex flex-wrap items-baseline gap-x-1 font-semibold tabular-nums ${tone.main}`}
        title={PACED_TOOLTIP}
      >
        <span className="inline-flex items-baseline gap-0.5">
          {down && <span aria-hidden>↓</span>}
          {up && <span aria-hidden>↑</span>}
          <span>{formatted}</span>
        </span>
        {pb != null && (
          <span className={`text-[11px] font-medium tabular-nums ${tone.muted}`}>
            (vs {formatCurrencyCompact(pb)})
          </span>
        )}
      </span>
    </ComparisonPill>
  );
}

function MarginDeltaSubline({ delta }: { delta: MarginDeltaResult }) {
  if (delta.kind === "no_hist") {
    return (
      <ComparisonPill>
        <span className="font-medium text-white/45">No historical data</span>
      </ComparisonPill>
    );
  }
  if (delta.kind === "na") {
    const pm = delta.pastMarginPct;
    return (
      <ComparisonPill>
        <span
          className="inline-flex flex-wrap items-baseline gap-x-1 font-medium tabular-nums text-white/45"
          title={MARGIN_DELTA_TOOLTIP}
        >
          —
          {pm != null && (
            <span className="text-[11px] font-medium tabular-nums text-white/40">
              (vs {formatMarginPctDisplay(pm)})
            </span>
          )}
        </span>
      </ComparisonPill>
    );
  }
  const pp = delta.pp;
  const pastMarginPct = delta.pastMarginPct;
  const up = pp > 0;
  const down = pp < 0;
  const tone = deltaToneClasses(up, down);
  const formatted =
    pp === 0 ? "0.0%" : `${pp > 0 ? "+" : ""}${pp.toFixed(1)}%`;
  return (
    <ComparisonPill>
      <span
        className={`inline-flex flex-wrap items-baseline gap-x-1 font-semibold tabular-nums ${tone.main}`}
        title={MARGIN_DELTA_TOOLTIP}
      >
        <span className="inline-flex items-baseline gap-0.5">
          {down && <span aria-hidden>↓</span>}
          {up && <span aria-hidden>↑</span>}
          <span>{formatted}</span>
        </span>
        <span className={`text-[11px] font-medium tabular-nums ${tone.muted}`}>
          (vs {formatMarginPctDisplay(pastMarginPct)})
        </span>
      </span>
    </ComparisonPill>
  );
}

export default function TodayFinancialsPulse({
  comparison,
}: {
  comparison: ComparisonData | null;
}) {
  const [period, setPeriod] = useState<PeriodKey>(1);
  const dayProgress = useIsraelDayProgress();

  const todayRow = comparison?.today ?? null;
  const revenue = todayRow?.revenue ?? 0;
  const cost = todayRow?.cost ?? 0;
  const profit = todayRow?.profit ?? 0;

  const pastRow = useMemo(() => {
    if (!comparison) return null;
    return comparison.past[period] ?? null;
  }, [comparison, period]);

  const dRev = useMemo(
    () => computeDelta(revenue, pastRow, (r) => r.revenue, dayProgress),
    [revenue, pastRow, dayProgress],
  );
  const dCost = useMemo(
    () => computeDelta(cost, pastRow, (r) => r.cost, dayProgress),
    [cost, pastRow, dayProgress],
  );
  const dProfit = useMemo(
    () => computeDelta(profit, pastRow, (r) => r.profit, dayProgress),
    [profit, pastRow, dayProgress],
  );
  const dMargin = useMemo(
    () => computeMarginDelta(revenue, profit, pastRow),
    [revenue, profit, pastRow],
  );

  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/[0.1] bg-[var(--adte-funnel-bg)] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.04)] sm:p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_100%_0%,rgba(34,197,94,0.08),transparent_55%)]" aria-hidden />

      <div className="relative mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
            Today&apos;s financial pulse
          </h2>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
          <div
            className="inline-flex shrink-0 rounded-lg border border-white/[0.08] bg-black/35 p-0.5"
            role="tablist"
            aria-label="Comparison period"
          >
            {PERIODS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={period === key}
                onClick={() => setPeriod(key)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  period === key
                    ? "bg-white/12 text-white shadow-sm"
                    : "text-white/45 hover:text-white/70"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            className="inline-flex h-8 min-w-[5.25rem] shrink-0 items-center justify-center gap-2 rounded-full border border-emerald-500/35 bg-emerald-500/12 px-3"
            aria-live="polite"
          >
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-widest text-emerald-300">
              Live
            </span>
          </div>
        </div>
      </div>

      <div
        key={period}
        className="animate-adte-in relative grid grid-cols-2 gap-x-5 gap-y-7 sm:gap-x-6 lg:grid-cols-4 lg:gap-x-7 lg:gap-y-8"
      >
        <MetricBlock
          label="Today's revenue"
          value={formatCurrency(revenue)}
          valueClassName="text-white"
          delta={dRev}
        />
        <MetricBlock
          label="Total cost"
          value={formatCurrency(cost)}
          valueClassName="text-white"
          delta={dCost}
        />
        <MetricBlock
          label="Gross profit"
          value={formatCurrency(profit)}
          valueClassName={
            profit >= 0
              ? "font-semibold text-white [text-shadow:0_0_24px_rgba(74,222,128,0.25)]"
              : "font-semibold text-red-400"
          }
          delta={dProfit}
        />
        <MetricBlock
          label="Profit margin"
          value={marginPct(revenue, profit)}
          valueClassName={
            profit >= 0 ? "text-emerald-300/95" : "text-red-400"
          }
          marginDelta={dMargin}
        />
      </div>
    </section>
  );
}

type MetricBlockProps =
  | {
      label: string;
      value: string;
      valueClassName: string;
      delta: DeltaResult;
    }
  | {
      label: string;
      value: string;
      valueClassName: string;
      marginDelta: MarginDeltaResult;
    };

function MetricBlock(props: MetricBlockProps) {
  const { label, value, valueClassName } = props;
  return (
    <div className="flex min-w-0 flex-col">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/45 sm:text-[11px]">
        {label}
      </p>
      <p
        className={`min-h-[1.75rem] truncate font-sans text-xl font-bold tabular-nums tracking-tight sm:min-h-[2rem] sm:text-2xl lg:text-[1.65rem] ${valueClassName}`}
      >
        {value}
      </p>
      {"marginDelta" in props ? (
        <MarginDeltaSubline delta={props.marginDelta} />
      ) : (
        <DeltaSubline delta={props.delta} />
      )}
    </div>
  );
}
