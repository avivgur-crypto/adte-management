"use client";

import { useMemo, useState } from "react";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useFilter } from "@/app/context/FilterContext";
import type { FinancialPaceWithTrend } from "@/app/actions/financials";

export type RevenueChartFilter = "total" | "media" | "saas" | "profit";

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const BAR_COLOR = "#2dd4bf"; // teal-400
const LINE_COLOR = "#a78bfa"; // violet-400

const FILTER_OPTIONS: { value: RevenueChartFilter; label: string }[] = [
  { value: "total", label: "Total Revenue" },
  { value: "media", label: "Media Revenue" },
  { value: "saas", label: "SaaS Revenue" },
  { value: "profit", label: "Net Profit" },
];

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

/** Y-axis ticks for net profit — full currency, compact enough for chart width. */
function formatProfitAxis(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return formatCurrency(value);
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function CustomTooltip({
  active,
  payload,
  label,
  filterLabel,
}: {
  active?: boolean;
  payload?: unknown;
  label?: string | number;
  filterLabel: string;
}) {
  const list = Array.isArray(payload) ? (payload as { dataKey: string; value: number; color: string }[]) : [];
  if (!active || list.length === 0) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 shadow-xl">
      <p className="mb-1 text-xs font-semibold text-white">{label}</p>
      {list.map((entry) => (
        <p key={entry.dataKey} className="text-xs" style={{ color: entry.color }}>
          {entry.dataKey === "actual" ? `${filterLabel} Actual` : `${filterLabel} Goal`}:{" "}
          <span className="font-semibold">{formatCurrency(entry.value)}</span>
        </p>
      ))}
    </div>
  );
}

export default function RevenueGoalChart({
  paceByMonth,
}: {
  paceByMonth: Record<string, FinancialPaceWithTrend>;
}) {
  const { selectedMonths } = useFilter();
  const [revenueFilter, setRevenueFilter] = useState<RevenueChartFilter>("total");

  const chartData = useMemo(() => {
    const allKeys = Array.from({ length: 12 }, (_, i) =>
      `2026-${String(i + 1).padStart(2, "0")}-01`
    );
    const section = revenueFilter; // "total" | "media" | "saas" | "profit"

    return allKeys.map((key, i) => {
      const pace = paceByMonth[key];
      const sec = pace?.[section];
      const isSelected = selectedMonths.size === 0 || selectedMonths.has(key);
      return {
        month: MONTH_LABELS[i]!,
        monthKey: key,
        actual: isSelected ? (sec?.actual ?? 0) : 0,
        goal: sec?.goal ?? 0,
        _selected: isSelected,
      };
    });
  }, [paceByMonth, selectedMonths, revenueFilter]);

  const maxValue = useMemo(() => {
    let max = 0;
    for (const d of chartData) {
      if (d.actual > max) max = d.actual;
      if (d.goal > max) max = d.goal;
    }
    return max;
  }, [chartData]);

  const isProfit = revenueFilter === "profit";
  const yDomain: [number, number] = useMemo(() => {
    const step = isProfit ? 50_000 : 500_000;
    const top = Math.ceil(Math.max(maxValue, 1) / step) * step;
    return [0, top || (isProfit ? 100_000 : 1_000_000)];
  }, [maxValue, isProfit]);

  const filterLabel = FILTER_OPTIONS.find((f) => f.value === revenueFilter)?.label ?? "Revenue";

  return (
    <div className="w-full max-w-5xl rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-[25px] font-extrabold text-white">
            Month-to-Date Performance vs.{" "}
            <span className="highlight-brand">Goal Pace</span>
          </h2>
          <p className="mt-1 text-sm text-white/50">
            {isProfit
              ? "Net profit (daily_home_totals) vs. profit goal from billing"
              : "Monthly actual vs. finance goal by type"}
          </p>
          {isProfit && (
            <p className="mt-0.5 text-xs text-white/35">(XDASH net profit synced)</p>
          )}
        </div>
        <div className="flex rounded-lg border border-white/[0.08] bg-black/30 p-0.5">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setRevenueFilter(opt.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                revenueFilter === opt.value
                  ? "bg-white/15 text-white"
                  : "text-white/60 hover:text-white/80"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 h-[340px] min-h-[280px] min-w-0 w-full">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart
            data={chartData}
            margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.06)"
              vertical={false}
            />
            <XAxis
              dataKey="month"
              tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 12 }}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              tickLine={false}
            />
            <YAxis
              domain={yDomain}
              tickFormatter={isProfit ? formatProfitAxis : formatCompact}
              tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={isProfit ? 72 : 60}
            />
            <Tooltip
              content={(props) => <CustomTooltip {...props} filterLabel={filterLabel} />}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <Legend
              verticalAlign="top"
              align="center"
              iconType="line"
              wrapperStyle={{ paddingBottom: 12 }}
              formatter={(value: string) => (
                <span className="text-xs text-white/70">
                  {value === "actual" ? `${filterLabel} Actual` : `${filterLabel} Goal`}
                </span>
              )}
            />
            <Line
              dataKey="actual"
              type="monotone"
              stroke={BAR_COLOR}
              strokeWidth={2.5}
              dot={{ r: 4, fill: BAR_COLOR, stroke: BAR_COLOR }}
              activeDot={{ r: 6, fill: BAR_COLOR, stroke: "#fff", strokeWidth: 2 }}
              name="actual"
            />
            <Line
              dataKey="goal"
              type="monotone"
              stroke={LINE_COLOR}
              strokeWidth={2.5}
              dot={{ r: 4, fill: LINE_COLOR, stroke: LINE_COLOR }}
              activeDot={{ r: 6, fill: LINE_COLOR, stroke: "#fff", strokeWidth: 2 }}
              name="goal"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
