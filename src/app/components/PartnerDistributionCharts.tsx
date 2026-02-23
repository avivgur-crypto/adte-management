"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useEffect, useMemo, useState } from "react";
import type {
  PartnerConcentrationResult,
  PartnerShare,
} from "@/app/actions/financials";
import { useFilter } from "@/app/context/FilterContext";

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function monthToLabel(month: string): string {
  const [y, m] = month.split("-");
  const months = "JanFebMarAprMayJunJulAugSepOctNovDec";
  const mm = months.slice((parseInt(m, 10) - 1) * 3, parseInt(m, 10) * 3);
  const yy = y?.slice(-2) ?? "";
  return `${mm}${yy}`;
}

const COLORS = [
  "#0088FE",
  "#00C49F",
  "#FFBB28",
  "#FF8042",
  "#8884d8",
  "#82ca9d",
  "#ffc658",
  "#ff7c7c",
  "#a4de6c",
  "#d0ed57",
];

function SideDonut({
  title,
  side,
}: {
  title: string;
  side: { total: number; partners: PartnerShare[] };
}) {
  const chartData = useMemo(() => {
    const data = side.partners.map((p) => ({
      name: String(p.name),
      value: Number(p.revenue),
    }));
    return data;
  }, [side.partners]);

  const top5 = useMemo(() => side.partners.slice(0, 5), [side.partners]);
  const total = Number(side.total);

  if (side.partners.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-4">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-white/50">
          {title}
        </h3>
        <p className="text-sm text-white/50">No data</p>
      </div>
    );
  }

  if (typeof window !== "undefined") {
    console.log(`[PartnerDistributionCharts] ${title} data:`, chartData);
  }

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-4">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-white/50">
        {title}
      </h3>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="h-52 w-full min-w-0 sm:h-56 sm:w-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                stroke="none"
                paddingAngle={1}
              >
                {chartData.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={COLORS[index % COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number | undefined) => formatCurrency(value ?? 0)}
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null;
                  const p = payload[0].payload as { name: string; value: number };
                  const percent =
                    total > 0 ? ((Number(p.value) / total) * 100).toFixed(1) : "0";
                  return (
                    <div className="rounded-lg border border-white/10 bg-[var(--adte-funnel-bg)] px-3 py-2">
                      <p className="font-medium text-white">
                        {p.name}
                      </p>
                      <p className="text-sm text-white/60">
                        {formatCurrency(Number(p.value))} ({percent}%)
                      </p>
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="min-w-0 flex-1">
          <p className="mb-2 text-xs font-medium text-white/50">
            Top 5 — {formatCurrency(side.total)} total
          </p>
          <ul className="space-y-1.5 text-sm">
            {top5.map((p, i) => (
              <li
                key={`${p.name}-${i}`}
                className="flex min-w-0 items-center justify-between gap-2"
              >
                <span
                  className="min-w-0 truncate text-white/90"
                  title={p.name}
                >
                  {p.name}
                </span>
                <span className="shrink-0 whitespace-nowrap text-white/60">
                  {formatCurrency(Number(p.revenue))} ({Number(p.percent)}%)
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default function PartnerDistributionCharts({
  dataByMonth,
  monthKeys,
}: {
  dataByMonth: Record<string, PartnerConcentrationResult | null>;
  monthKeys: string[];
}) {
  const { selectedMonths } = useFilter();
  const filteredMonthKeys = useMemo(
    () => monthKeys.filter((k) => selectedMonths.has(k)),
    [monthKeys, selectedMonths]
  );
  const [selectedMonth, setSelectedMonth] = useState(filteredMonthKeys[0] ?? "");
  useEffect(() => {
    if (filteredMonthKeys.length > 0 && !filteredMonthKeys.includes(selectedMonth)) {
      setSelectedMonth(filteredMonthKeys[0]);
    }
  }, [filteredMonthKeys, selectedMonth]);

  if (monthKeys.length === 0) {
    return (
      <div className="w-full max-w-4xl rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">
          Partner Distribution
        </h2>
        <p className="text-sm text-white/50">
          No concentration data. Run fetch:client-breakdown for Jan26 and Feb26.
        </p>
      </div>
    );
  }

  if (filteredMonthKeys.length === 0) {
    return (
      <div className="w-full max-w-4xl rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">
          Client Concentration
        </h2>
        <p className="text-sm text-white/50">
          Select at least one month in the filter to view concentration data.
        </p>
      </div>
    );
  }

  const effectiveMonthKeys = filteredMonthKeys;
  const effectiveSelectedMonth = effectiveMonthKeys.includes(selectedMonth)
    ? selectedMonth
    : effectiveMonthKeys[0] ?? "";
  const effectiveData = effectiveSelectedMonth ? dataByMonth[effectiveSelectedMonth] : null;

  return (
    <div className="w-full max-w-4xl rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">
          Client Concentration
        </h2>
        <div className="flex items-center gap-2">
          {effectiveData?.concentrationRisk && (
            <span className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-white/90">
              Concentration risk (partner &gt; 30%)
            </span>
          )}
          <div className="flex rounded-lg border border-white/10 p-0.5">
            {effectiveMonthKeys.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedMonth(key)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  effectiveSelectedMonth === key
                    ? "bg-white/15 text-white"
                    : "text-white/60 hover:bg-white/10"
                }`}
              >
                {monthToLabel(key)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!effectiveData ? (
        <p className="text-sm text-white/50">
          No data for this month.
        </p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          <SideDonut title="Demand (Revenue)" side={effectiveData.demand} />
          <SideDonut title="Supply (Cost)" side={effectiveData.supply} />
        </div>
      )}
    </div>
  );
}
