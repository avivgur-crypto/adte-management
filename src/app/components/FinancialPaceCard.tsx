"use client";

import { memo, useCallback, useState, type ReactNode } from "react";
import type { PacingSection } from "@/lib/pacing";
import type { FinancialPaceWithTrend } from "@/app/actions/financials";
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

/** Projected vs goal %: ≥100% green + ↑, &lt;100% red + ↓ (do not mix in MoM trend). */
function PaceBadge({ percent }: { percent: number | null }) {
  if (percent == null) return <span className="text-white/50">—</span>;
  const atOrAboveGoal = percent >= 100;
  const className = atOrAboveGoal
    ? "font-semibold text-emerald-600 dark:text-emerald-400"
    : "font-semibold text-red-600 dark:text-red-400";
  return (
    <span className="inline-flex items-baseline gap-0.5">
      <span className={className}>{percent}%</span>
      <span className={className} aria-hidden>
        {atOrAboveGoal ? "↑" : "↓"}
      </span>
    </span>
  );
}

function SectionBlock({
  title,
  section,
  isMultiMonth,
  showGoalVarianceLine,
}: {
  title: ReactNode;
  section: PacingSection & { projected?: number | null; projectedVsGoalPercent?: number | null };
  isMultiMonth?: boolean;
  /** Only for current calendar month (projected pacing); hide for closed months. */
  showGoalVarianceLine?: boolean;
}) {
  const { actual, targetMtd, goal, delta, requiredDailyRunRate, pacePercent, projected, projectedVsGoalPercent } = section;
  const barScale = goal > 0 ? goal : 1;
  const actualPercent = Math.min(100, (actual / barScale) * 100);
  const targetPercent = Math.min(100, (targetMtd / barScale) * 100);
  const isBehind = delta < 0;
  const isAhead = delta > 0;
  const achievementPercent = goal > 0 ? Math.round((actual / goal) * 100) : null;

  return (
    <div className="rounded-xl border border-white/[0.08] bg-black/30 p-4">
      <h3 className="mb-3 min-h-[1.25rem] text-sm font-semibold leading-tight text-white/50">
        {title}
      </h3>
      <div className="space-y-3">
        {/* Two stacked lines: MTD Actual, then MTD Calculated Target — label above, number on next line */}
        <div className="space-y-1.5">
          <div className="block">
            <div className="text-xs text-white/50">MTD Actual:</div>
            <div className="text-sm font-semibold tabular-nums text-white">
              {formatCurrency(actual)}
            </div>
          </div>
          <div className="block">
            <div className="text-xs text-white/50">MTD Calculated Target:</div>
            <div className="text-sm font-semibold tabular-nums text-white">
              {formatCurrency(targetMtd)}
            </div>
          </div>
        </div>

        {/* Delta: clearly below revenue lines */}
        <div className="text-xs font-medium tabular-nums">
          {isBehind && (
            <span className="text-red-600 dark:text-red-400">
              {formatCurrency(delta)} behind MTD Target
            </span>
          )}
          {isAhead && (
            <span className="text-emerald-600 dark:text-emerald-400">
              +{formatCurrency(delta)} ahead of MTD Target
            </span>
          )}
          {!isBehind && !isAhead && (
            <span className="text-white/60">On target</span>
          )}
        </div>

        {/* Progress bar: dark gray track, lighter gray Actual fill, white dashed line = MTD Calculated Target */}
        <div className="relative h-3 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-white/30 transition-all"
            style={{ width: `${actualPercent}%` }}
          />
          {targetPercent > 0 && targetPercent <= 100 && (
            <div
              className="absolute top-0 bottom-0 w-0 border-l-2 border-dashed border-white"
              style={{ left: `${targetPercent}%`, transform: "translateX(-50%)" }}
              title="MTD Calculated Target"
            />
          )}
        </div>

        {isMultiMonth ? (
          <div className="rounded-md bg-white/5 px-3 py-2">
            <div className="text-[11px] font-medium text-white/50">
              Actual / Goal = {achievementPercent != null ? `${achievementPercent}%` : "—"}
            </div>
            <div className="mt-1 text-xs text-white/80">
              {formatCurrency(actual)} / {formatCurrency(goal)}
            </div>
          </div>
        ) : (
          <div className="rounded-md bg-white/5 px-3 py-2">
            <div className="text-[11px] font-medium text-white/50">
              Projected month-end
            </div>
            <div className="text-base font-semibold tabular-nums text-white">
              {formatCurrency(projected)}
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-2 text-[11px] text-white/50">
              <span>Goal {formatCurrency(goal)}</span>
              <PaceBadge percent={projectedVsGoalPercent ?? null} />
            </div>
            {showGoalVarianceLine && projected != null && (
              <div className="mt-1.5 text-xs font-medium tabular-nums">
                {(() => {
                  const variance = projected - goal;
                  if (variance > 0) {
                    return (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        +{formatCurrency(variance)} ahead of Goal
                      </span>
                    );
                  }
                  if (variance < 0) {
                    return (
                      <span className="text-red-600 dark:text-red-400">
                        {formatCurrency(variance)} behind Goal
                      </span>
                    );
                  }
                  return <span className="text-white/60">On goal</span>;
                })()}
              </div>
            )}
          </div>
        )}

        {/* Required daily run rate footnote */}
        <p className="text-[11px] font-medium tabular-nums text-white/50">
          Required daily: {formatCurrency(requiredDailyRunRate)}/day to hit EOM goal
        </p>
      </div>
    </div>
  );
}

type PaceMetricKey = "total" | "media" | "saas" | "profit";

const PACE_METRIC_DEFAULTS: Record<PaceMetricKey, boolean> = {
  profit: true,
  total: true,
  media: true,
  saas: true,
};

const PACE_METRIC_OPTIONS: { key: PaceMetricKey; label: string; shortLabel?: string }[] = [
  { key: "profit", label: "Gross Profit", shortLabel: "G. Profit" },
  { key: "total", label: "Total Revenue" },
  { key: "media", label: "Media Revenue" },
  { key: "saas", label: "SaaS Revenue" },
];

function FinancialPaceCard({
  summary,
  showGoalVarianceLine = false,
  dataSource = "xdash",
  onDataSourceChange,
}: {
  summary: FinancialPaceWithTrend;
  /** Goal variance row only when viewing the live calendar month (single-month). */
  showGoalVarianceLine?: boolean;
  dataSource?: FinancialDataSource;
  onDataSourceChange?: (v: FinancialDataSource) => void;
}) {
  const [visible, setVisible] = useState<Record<PaceMetricKey, boolean>>(() => ({
    ...PACE_METRIC_DEFAULTS,
  }));

  const toggleMetric = useCallback((key: PaceMetricKey) => {
    setVisible((v) => ({ ...v, [key]: !v[key] }));
  }, []);

  return (
    <div className="w-full max-w-5xl overflow-hidden rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-4 sm:p-6">
      <div className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[25px] font-extrabold text-white">
            Pacing <span className="highlight-brand">achievement</span>
          </h2>
          {onDataSourceChange && (
            <DataSourceToggle value={dataSource} onChange={onDataSourceChange} />
          )}
        </div>
        <p className="mt-1 text-sm text-white/50">
          Actual vs. MTD calculated target
        </p>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-white/50">
        <span><span className="font-semibold text-emerald-600 dark:text-emerald-400">≥100%</span></span>
        <span><span className="font-semibold text-amber-600 dark:text-amber-400">90–99%</span></span>
        <span><span className="font-semibold text-red-600 dark:text-red-400">&lt;90%</span></span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-white/[0.06] pb-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-white/40">Show metrics</span>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {PACE_METRIC_OPTIONS.map(({ key, label, shortLabel }) => (
            <label
              key={key}
              className="inline-flex cursor-pointer select-none items-center gap-2 text-sm text-white/85"
            >
              <input
                type="checkbox"
                checked={visible[key]}
                onChange={() => toggleMetric(key)}
                className="h-4 w-4 shrink-0 rounded border-white/25 bg-black/50 text-violet-400 accent-violet-500 focus:ring-2 focus:ring-violet-500/40"
              />
              <span>
                <span className="sm:hidden">{shortLabel ?? label}</span>
                <span className="hidden sm:inline">{label}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {visible.profit && (
          <SectionBlock
            title={
              <>
                <span className="sm:hidden">G. Profit</span>
                <span className="hidden sm:inline">Gross Profit</span>
              </>
            }
            section={summary.profit}
            isMultiMonth={summary.isMultiMonth}
            showGoalVarianceLine={showGoalVarianceLine}
          />
        )}
        {visible.total && (
          <SectionBlock
            title="Total Revenue"
            section={summary.total}
            isMultiMonth={summary.isMultiMonth}
            showGoalVarianceLine={showGoalVarianceLine}
          />
        )}
        {visible.media && (
          <SectionBlock
            title="Media Revenue (Xdash)"
            section={summary.media}
            isMultiMonth={summary.isMultiMonth}
            showGoalVarianceLine={showGoalVarianceLine}
          />
        )}
        {visible.saas && (
          <SectionBlock
            title="SaaS Revenue (Billing)"
            section={summary.saas}
            isMultiMonth={summary.isMultiMonth}
            showGoalVarianceLine={showGoalVarianceLine}
          />
        )}
      </div>
      <p className="mt-4 text-[15px] text-white/50">
        {dataSource === "xdash"
          ? "Actuals from XDASH vs. the same monthly goals (N-1)."
          : "Actuals from Master Billing vs. the same monthly goals (N-1)."}
      </p>
    </div>
  );
}

export default memo(FinancialPaceCard);
