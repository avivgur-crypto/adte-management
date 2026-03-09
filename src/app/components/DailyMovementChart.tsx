"use client";

import { useMemo, useState } from "react";
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
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

function formatAxisDate(iso: string): string {
  const [, m, d] = iso.split("-");
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
      {payload.map((entry) => {
        const label =
          entry.dataKey === "revenue" ? "Revenue" : entry.dataKey === "cost" ? "Cost" : "Profit";
        return (
          <p key={entry.dataKey} className="text-xs" style={{ color: entry.color }}>
            {label}: <span className="font-semibold">{formatCurrency(entry.value)}</span>
          </p>
        );
      })}
    </div>
  );
}

const SERIES = [
  { key: "revenue", label: "Revenue", color: "#2dd4bf" },
  { key: "cost", label: "Cost", color: "#f472b6" },
  { key: "profit", label: "Profit", color: "#a78bfa" },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];

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
  const [visible, setVisible] = useState<Set<SeriesKey>>(
    new Set(["revenue", "cost", "profit"]),
  );

  const toggle = (key: SeriesKey) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const chartData = useMemo(() => {
    const keys =
      selectedMonths.size > 0
        ? monthKeys.filter((k) => selectedMonths.has(k))
        : monthKeys;
    const all: { date: string; revenue: number; cost: number; profit: number }[] = [];
    for (const key of keys) {
      const days = dailyByMonth[key] ?? [];
      for (const d of days) {
        all.push({ date: d.date, revenue: d.revenue, cost: d.cost, profit: d.revenue - d.cost });
      }
    }
    all.sort((a, b) => a.date.localeCompare(b.date));
    return all.map((d) => ({
      ...d,
      label: formatShortDate(d.date),
      axisLabel: formatAxisDate(d.date),
    }));
  }, [dailyByMonth, monthKeys, selectedMonths]);

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
      if (visible.has("revenue") && d.revenue > max) max = d.revenue;
      if (visible.has("cost") && d.cost > max) max = d.cost;
      if (visible.has("profit") && d.profit > max) max = d.profit;
    }
    return max;
  }, [chartData, visible]);

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
          xdash data
        </p>
        {/* Toggle buttons — own row, wrap on narrow screens */}
        <div className="mt-3 flex flex-wrap gap-2">
          {SERIES.map((s) => {
            const isOn = visible.has(s.key);
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => toggle(s.key)}
                className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all"
                style={{
                  borderColor: isOn ? s.color : "rgba(255,255,255,0.12)",
                  background: isOn ? `${s.color}18` : "transparent",
                  color: isOn ? s.color : "rgba(255,255,255,0.35)",
                }}
              >
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm transition-opacity"
                  style={{
                    backgroundColor: s.color,
                    opacity: isOn ? 1 : 0.25,
                  }}
                />
                {s.label}
              </button>
            );
          })}
        </div>
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
            {SERIES.map((s) =>
              visible.has(s.key) ? (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  fill={s.color}
                  radius={[4, 4, 0, 0]}
                  barSize={24}
                  name={s.key}
                />
              ) : null,
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
