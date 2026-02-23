"use client";

import { memo } from "react";
import type { PacingSection } from "@/lib/pacing";
import type { FinancialPaceWithTrend, PacingTrend } from "@/app/actions/financials";

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDataThroughDate(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

function TrendIcon({ trend }: { trend: PacingTrend }) {
  if (trend === "up") return <span className="ml-0.5 text-emerald-600 dark:text-emerald-400" aria-hidden>↑</span>;
  if (trend === "down") return <span className="ml-0.5 text-red-600 dark:text-red-400" aria-hidden>↓</span>;
  return null;
}

function PaceBadge({
  percent,
  trend,
}: {
  percent: number | null;
  trend?: PacingTrend;
}) {
  if (percent == null) return <span className="text-white/50">—</span>;
  // When trend is present, color percentage by trend (e.g. 77% ⬇️ in red)
  const byTrend =
    trend === "up"
      ? "font-semibold text-emerald-600 dark:text-emerald-400"
      : trend === "down"
        ? "font-semibold text-red-600 dark:text-red-400"
        : null;
  const byPace =
    percent >= 100
      ? "font-semibold text-emerald-600 dark:text-emerald-400"
      : percent >= 90
        ? "font-semibold text-amber-600 dark:text-amber-400"
        : "font-semibold text-red-600 dark:text-red-400";
  const className = byTrend ?? byPace;
  return (
    <span className="inline-flex items-baseline">
      <span className={className}>{percent}%</span>
      {trend != null && trend !== "stable" && <TrendIcon trend={trend} />}
    </span>
  );
}

function SectionBlock({
  title,
  section,
  trend,
  isMultiMonth,
}: {
  title: string;
  section: PacingSection & { projected?: number | null; projectedVsGoalPercent?: number | null };
  trend?: PacingTrend;
  isMultiMonth?: boolean;
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
      <h3 className="mb-3 text-sm font-semibold text-white/50">
        {title}
      </h3>
      <div className="space-y-3">
        {/* Two stacked lines: MTD Actual, then MTD Calculated Target */}
        <div className="space-y-1.5">
          <div>
            <span className="text-xs text-white/50">MTD Actual: </span>
            <span className="text-sm font-semibold tabular-nums text-white">
              {formatCurrency(actual)}
            </span>
          </div>
          <div>
            <span className="text-xs text-white/50">MTD Calculated Target: </span>
            <span className="text-sm font-semibold tabular-nums text-white">
              {formatCurrency(targetMtd)}
            </span>
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
              <PaceBadge percent={projectedVsGoalPercent ?? null} trend={trend} />
            </div>
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

function FinancialPaceCard({
  summary,
}: {
  summary: FinancialPaceWithTrend;
}) {
  return (
    <div className="w-full max-w-4xl rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
      <div className="mb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">
            Pacing achievement — {summary.month}
          </h2>
          <p className="text-xs text-white/50">
            Effective days: {summary.effectiveDaysPassed} of {summary.daysInMonth} (N-1)
          </p>
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
      <div className="grid gap-4 sm:grid-cols-3">
        <SectionBlock title="Total revenue" section={summary.total} trend={summary.trend.total} isMultiMonth={summary.isMultiMonth} />
        <SectionBlock title="Media (from Xdash)" section={summary.media} trend={summary.trend.media} isMultiMonth={summary.isMultiMonth} />
        <SectionBlock title="SaaS (from Billing)" section={summary.saas} trend={summary.trend.saas} isMultiMonth={summary.isMultiMonth} />
      </div>
      <p className="mt-4 text-[11px] text-white/50">
        Based on data up to {formatDataThroughDate(summary.dataThroughDate)}.
      </p>
    </div>
  );
}

export default memo(FinancialPaceCard);
