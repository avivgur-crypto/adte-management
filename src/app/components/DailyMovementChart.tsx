"use client";

import { useMemo } from "react";
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useFilter } from "@/app/context/FilterContext";
import type { DailyMovementDay } from "@/app/actions/financials";
import type { FinancialPaceWithTrend } from "@/app/actions/financials";

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function formatShortDate(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Compact axis label to avoid overlap (e.g. "Jan 15" → "15/1"). */
function formatAxisDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}`;
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number; color: string; payload?: { label: string } }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as { label?: string; axisLabel?: string } | undefined;
  const dateLabel = point?.label ?? point?.axisLabel ?? "";
  return (
    <div className="rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 shadow-xl">
      <p className="mb-1 text-xs font-semibold text-white">{dateLabel}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="text-xs" style={{ color: entry.color }}>
          {entry.dataKey === "revenue" ? "Revenue" : "Cost"}:{" "}
          <span className="font-semibold">{formatCurrency(entry.value)}</span>
        </p>
      ))}
    </div>
  );
}

const REVENUE_COLOR = "#2dd4bf";
const COST_COLOR = "#f472b6";

export default function DailyMovementChart({
  dailyByMonth,
  monthKeys,
  paceByMonth,
}: {
  dailyByMonth: Record<string, DailyMovementDay[]>;
  monthKeys: string[];
  paceByMonth: Record<string, FinancialPaceWithTrend>;
}) {
  const { selectedMonths } = useFilter();

  const chartData = useMemo(() => {
    const keys =
      selectedMonths.size > 0
        ? monthKeys.filter((k) => selectedMonths.has(k))
        : monthKeys;
    const all: { date: string; revenue: number; cost: number }[] = [];
    for (const key of keys) {
      const days = dailyByMonth[key] ?? [];
      for (const d of days) {
        all.push({ date: d.date, revenue: d.revenue, cost: d.cost });
      }
    }
    all.sort((a, b) => a.date.localeCompare(b.date));
    return all.map((d) => ({
      ...d,
      label: formatShortDate(d.date),
      axisLabel: formatAxisDate(d.date),
    }));
  }, [dailyByMonth, monthKeys, selectedMonths]);

  /** X-axis: few ticks (5–6 when many points) + compact labels to avoid overlap. */
  const xAxisTicks = useMemo(() => {
    const n = chartData.length;
    if (n <= 0) return [];
    const wantTicks = n > 30 ? 5 : n > 18 ? 6 : Math.min(8, Math.max(4, Math.ceil(n / 6)));
    const step = Math.max(1, Math.floor(n / wantTicks));
    const out: string[] = [];
    for (let i = 0; i < n; i += step) {
      out.push(chartData[i]!.axisLabel);
    }
    if (n > 1 && chartData[n - 1]!.axisLabel !== out[out.length - 1]) {
      out.push(chartData[n - 1]!.axisLabel);
    }
    return out;
  }, [chartData]);

  const maxValue = useMemo(() => {
    let max = 0;
    for (const d of chartData) {
      if (d.revenue > max) max = d.revenue;
      if (d.cost > max) max = d.cost;
    }
    return max;
  }, [chartData]);

  const yDomain: [number, number] = [
    0,
    Math.ceil(maxValue / 50_000) * 50_000 || 100_000,
  ];

  if (chartData.length === 0) {
    return (
      <div className="w-full max-w-5xl rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
        <h2 className="mb-2 text-[25px] font-extrabold text-white">
          Daily <span className="highlight-brand">progress</span>
        </h2>
        <p className="text-sm text-white/50">
          Select at least one month in the filter to view daily revenue and cost.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
      <div className="mb-4">
        <h2 className="text-[25px] font-extrabold text-white">
          Daily <span className="highlight-brand">progress</span>
        </h2>
        <p className="mt-1 text-sm text-white/50">
          Daily revenue and cost from partner performance
        </p>
      </div>

      <div className="h-[340px] min-h-[280px] min-w-0 w-full">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart
            data={chartData}
            margin={{ top: 8, right: 12, left: 0, bottom: 32 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.06)"
              vertical={false}
            />
            <XAxis
              dataKey="axisLabel"
              ticks={xAxisTicks.length > 0 ? xAxisTicks : undefined}
              tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 10 }}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              tickLine={false}
              interval={0}
              angle={-40}
              textAnchor="end"
            />
            <YAxis
              domain={yDomain}
              tickFormatter={(v) =>
                v >= 1_000_000
                  ? `$${(v / 1_000_000).toFixed(1)}M`
                  : v >= 1_000
                    ? `$${(v / 1_000).toFixed(0)}K`
                    : `$${v}`
              }
              tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={56}
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <Legend
              verticalAlign="top"
              align="center"
              iconType="square"
              wrapperStyle={{ paddingBottom: 12 }}
              formatter={(value: string) => (
                <span className="text-xs text-white/70">
                  {value === "revenue" ? "Revenue" : "Cost"}
                </span>
              )}
            />
            <Bar
              dataKey="revenue"
              fill={REVENUE_COLOR}
              radius={[4, 4, 0, 0]}
              barSize={24}
              name="revenue"
            />
            <Bar
              dataKey="cost"
              fill={COST_COLOR}
              radius={[4, 4, 0, 0]}
              barSize={24}
              name="cost"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
