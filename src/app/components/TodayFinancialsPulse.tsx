"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import {
  AnimatedCurrency,
  AnimatedNumberText,
} from "@/app/components/AnimatedCurrency";
import type { ComparisonData, DailyProfitGoalPace, TodayHomeRow } from "@/app/actions/financials";

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

/** Stable formatters for AnimatedNumberText (must not be recreated each render). */
function fmtDeltaPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtMarginPp(n: number): string {
  const r = Math.round(n * 10) / 10;
  if (r === 0) return "0.0%";
  return `${r > 0 ? "+" : ""}${r.toFixed(1)}%`;
}

/** Main figure typography — must match pre-animation pulse layout (weight differs for profit). */
const PULSE_VALUE_BASE =
  "min-h-[1.75rem] truncate font-sans text-xl tabular-nums tracking-tight sm:min-h-[2rem] sm:text-2xl lg:text-[1.65rem]";

function fmtMarginPctMain(n: number): string {
  return `${(Math.round(n * 10) / 10).toFixed(1)}%`;
}

/** One-decimal margin % for comparison line (matches main margin display). */
function formatMarginPctDisplay(p: number): string {
  return `${(Math.round(p * 10) / 10).toFixed(1)}%`;
}

type DeltaKind = "none" | "no_hist" | "na" | "flat" | "pct";

type DeltaResult = {
  kind: DeltaKind;
  pct?: number;
  /** Same-time-of-day cumulative value for the comparison date. */
  previousValue?: number;
  /**
   * `true` iff the past row used the linear-estimate fallback (no fresh-enough
   * hourly snapshot existed). Drives the asterisk in the UI.
   */
  isEstimate?: boolean;
};

type MarginDeltaResult =
  | { kind: "no_hist" }
  | { kind: "na"; pastMarginPct?: number; isEstimate?: boolean }
  | { kind: "pp"; pp: number; pastMarginPct: number; isEstimate?: boolean };

/**
 * Period-over-period change vs the same-time-of-day cumulative value on the
 * comparison date (Israel time). % = ((current − previous) / previous) × 100.
 */
function computeDelta(
  today: number,
  pastRow: TodayHomeRow | null,
  pick: (r: TodayHomeRow) => number,
): DeltaResult {
  if (!pastRow) return { kind: "no_hist" };
  const past = pick(pastRow);
  const isEstimate = pastRow.isEstimate ?? pastRow.source === "linear_estimate";

  if (today === 0) {
    return {
      kind: "flat",
      previousValue: past !== 0 ? past : undefined,
      isEstimate,
    };
  }

  if (past === 0) return { kind: "na", isEstimate };

  const pct = ((today - past) / past) * 100;
  return { kind: "pct", pct, previousValue: past, isEstimate };
}

/**
 * Margin vs the comparison date at the same Israel hour. Both sides use the
 * cumulative day-so-far values, so margins are computed at matched timepoints.
 * Delta = percentage points (today margin − past margin).
 */
function computeMarginDelta(
  todayRev: number,
  todayProfit: number,
  pastRow: TodayHomeRow | null,
): MarginDeltaResult {
  if (!pastRow) return { kind: "no_hist" };
  const isEstimate = pastRow.isEstimate ?? pastRow.source === "linear_estimate";

  if (todayRev === 0) {
    const pastMarginPct =
      pastRow.revenue !== 0
        ? (pastRow.profit / pastRow.revenue) * 100
        : undefined;
    return { kind: "na", pastMarginPct, isEstimate };
  }
  if (pastRow.revenue === 0) {
    return { kind: "na", isEstimate };
  }

  // For linear_estimate rows, profit and revenue are scaled by the same factor,
  // so the margin equals the full-day margin — that's a useful, unbiased baseline.
  const pastMarginPct = (pastRow.profit / pastRow.revenue) * 100;
  const todayMargin = (todayProfit / todayRev) * 100;
  const pp = todayMargin - pastMarginPct;
  return { kind: "pp", pp, pastMarginPct, isEstimate };
}

const COMPARISON_TOOLTIP =
  "Apples-to-apples: today's running cumulative vs the comparison date's cumulative at the same Israel hour (largest hour ≤ now from hourly_snapshots). % change = (current − previous) ÷ previous.";

const ESTIMATE_TOOLTIP =
  "Proportional estimate based on daily total (no exact hourly data available).";

const ESTIMATE_LEGEND =
  "* Proportional estimate based on daily total (no exact hourly data available).";

const MARGIN_DELTA_TOOLTIP =
  "Margin change vs the comparison date's margin at the same Israel hour (not full-day). Shown as percentage points; value in parentheses is the past day's margin at this time of day.";

/** Inline asterisk that explains itself on hover. */
function EstimateAsterisk() {
  return (
    <span
      className="ml-0.5 text-white/55"
      title={ESTIMATE_TOOLTIP}
      aria-label={ESTIMATE_TOOLTIP}
    >
      *
    </span>
  );
}

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

/** 16×16 daily GP vs daily target — only visual goal progress in the dashboard (Pulse). */
function DailyProfitGoalRing({
  profit,
  dailyTarget,
}: {
  profit: number;
  dailyTarget: number;
}) {
  if (dailyTarget <= 0) return null;

  const raw = (profit / dailyTarget) * 100;
  const r = 5;
  const c = 2 * Math.PI * r;
  const ringFillPct = Math.min(100, Math.max(0, raw));
  const dash = (ringFillPct / 100) * c;
  const reached = raw >= 100;

  if (reached) {
    return (
      <span
        className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center"
        aria-hidden
        title="Daily gross-profit target reached"
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
    <svg
      className="h-4 w-4 shrink-0"
      viewBox="0 0 16 16"
      role="img"
      aria-label={`About ${Math.round(raw * 10) / 10} percent of daily gross-profit target`}
    >
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
    const pb = delta.previousValue;
    return (
      <ComparisonPill>
        <span
          className="font-medium tabular-nums text-white/45"
          title={pb != null ? COMPARISON_TOOLTIP : undefined}
        >
          —
          {delta.isEstimate && <EstimateAsterisk />}
          {pb != null && (
            <span className="text-[11px] font-normal text-white/40">
              {" "}
              (vs {formatCurrencyCompact(pb)})
            </span>
          )}
        </span>
      </ComparisonPill>
    );
  }
  if (delta.kind === "na") {
    return (
      <ComparisonPill>
        <span className="font-medium tabular-nums text-white/45">
          N/A{delta.isEstimate && <EstimateAsterisk />}
        </span>
      </ComparisonPill>
    );
  }
  const pct = delta.pct ?? 0;
  const up = pct > 0;
  const down = pct < 0;
  const tone = deltaToneClasses(up, down);
  const pb = delta.previousValue;
  return (
    <ComparisonPill>
      <span
        className={`inline-flex flex-wrap items-baseline gap-x-1 font-semibold tabular-nums ${tone.main}`}
        title={COMPARISON_TOOLTIP}
      >
        <span className="inline-flex items-baseline gap-0.5">
          {down && <span aria-hidden>↓</span>}
          {up && <span aria-hidden>↑</span>}
          <AnimatedNumberText value={pct} format={fmtDeltaPct} className="inline" />
          {delta.isEstimate && <EstimateAsterisk />}
        </span>
        {pb != null && (
          <span className={`text-[11px] font-medium tabular-nums ${tone.muted}`}>
            (vs{" "}
            <AnimatedNumberText
              value={pb}
              format={formatCurrencyCompact}
              className="inline"
            />
            )
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
          {delta.isEstimate && <EstimateAsterisk />}
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
  return (
    <ComparisonPill>
      <span
        className={`inline-flex flex-wrap items-baseline gap-x-1 font-semibold tabular-nums ${tone.main}`}
        title={MARGIN_DELTA_TOOLTIP}
      >
        <span className="inline-flex items-baseline gap-0.5">
          {down && <span aria-hidden>↓</span>}
          {up && <span aria-hidden>↑</span>}
          <AnimatedNumberText value={pp} format={fmtMarginPp} className="inline" />
          {delta.isEstimate && <EstimateAsterisk />}
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
  dailyProfitGoalPace,
}: {
  comparison: ComparisonData | null;
  dailyProfitGoalPace: DailyProfitGoalPace | null;
}) {
  const [period, setPeriod] = useState<PeriodKey>(1);

  const todayRow = comparison?.today ?? null;
  const revenue = todayRow?.revenue ?? 0;
  const cost = todayRow?.cost ?? 0;
  const profit = todayRow?.profit ?? 0;

  const pastRow = useMemo(() => {
    if (!comparison) return null;
    return comparison.past[period] ?? null;
  }, [comparison, period]);

  const dRev = useMemo(
    () => computeDelta(revenue, pastRow, (r) => r.revenue),
    [revenue, pastRow],
  );
  const dCost = useMemo(
    () => computeDelta(cost, pastRow, (r) => r.cost),
    [cost, pastRow],
  );
  const dProfit = useMemo(
    () => computeDelta(profit, pastRow, (r) => r.profit),
    [profit, pastRow],
  );
  const dMargin = useMemo(
    () => computeMarginDelta(revenue, profit, pastRow),
    [revenue, profit, pastRow],
  );

  const dailyTarget = dailyProfitGoalPace?.dailyAverageTarget ?? 0;
  const profitGoalRing =
    dailyTarget > 0 ? (
      <DailyProfitGoalRing profit={profit} dailyTarget={dailyTarget} />
    ) : null;

  const hasEstimate = pastRow?.isEstimate ?? pastRow?.source === "linear_estimate";

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

      <div className="animate-adte-in relative grid grid-cols-2 gap-x-5 gap-y-7 sm:gap-x-6 lg:grid-cols-4 lg:gap-x-7 lg:gap-y-8">
        <MetricBlock
          label="Today's revenue"
          primary={
            <AnimatedCurrency
              value={revenue}
              className={`${PULSE_VALUE_BASE} font-bold text-white`}
              minimumFractionDigits={2}
              maximumFractionDigits={2}
            />
          }
          delta={dRev}
        />
        <MetricBlock
          label="Total cost"
          primary={
            <AnimatedCurrency
              value={cost}
              className={`${PULSE_VALUE_BASE} font-bold text-white`}
              minimumFractionDigits={2}
              maximumFractionDigits={2}
            />
          }
          delta={dCost}
        />
        <MetricBlock
          label="Gross profit"
          labelPrefix={profitGoalRing}
          primary={
            <AnimatedCurrency
              value={profit}
              className={`${PULSE_VALUE_BASE} ${
                profit >= 0
                  ? "font-semibold text-white [text-shadow:0_0_24px_rgba(74,222,128,0.25)]"
                  : "font-semibold text-red-400"
              }`}
              minimumFractionDigits={2}
              maximumFractionDigits={2}
            />
          }
          delta={dProfit}
        />
        <MetricBlock
          label="Profit margin"
          primary={
            <AnimatedNumberText
              value={revenue === 0 ? 0 : (profit / revenue) * 100}
              format={fmtMarginPctMain}
              className={`${PULSE_VALUE_BASE} font-bold ${
                profit >= 0 ? "text-emerald-300/95" : "text-red-400"
              }`}
            />
          }
          marginDelta={dMargin}
        />
      </div>

      {hasEstimate && (
        <p
          className="relative mt-3 text-[11px] font-medium tabular-nums text-white/40"
          aria-label={ESTIMATE_LEGEND}
        >
          {ESTIMATE_LEGEND}
        </p>
      )}
    </section>
  );
}

type MetricBlockProps =
  | {
      label: string;
      /** e.g. daily goal ring — left of label (Pulse gross profit only). */
      labelPrefix?: ReactNode;
      primary: ReactNode;
      delta: DeltaResult;
    }
  | {
      label: string;
      primary: ReactNode;
      marginDelta: MarginDeltaResult;
    };

function MetricBlock(props: MetricBlockProps) {
  const { label, primary } = props;
  const labelPrefix = "delta" in props ? props.labelPrefix : undefined;
  return (
    <div className="flex min-w-0 flex-col">
      <p className="mb-1.5 flex min-h-[1.125rem] items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/45 sm:min-h-[1.25rem] sm:text-[11px]">
        {labelPrefix ? <span className="shrink-0">{labelPrefix}</span> : null}
        <span>{label}</span>
      </p>
      <div className="min-w-0">{primary}</div>
      {"marginDelta" in props ? (
        <MarginDeltaSubline delta={props.marginDelta} />
      ) : (
        <DeltaSubline delta={props.delta} />
      )}
    </div>
  );
}
