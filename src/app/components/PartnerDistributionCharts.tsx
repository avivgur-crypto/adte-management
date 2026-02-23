"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useMemo } from "react";
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

const TOP_N = 10;
const CONCENTRATION_THRESHOLD = 30;

type Side = { total: number; partners: PartnerShare[] };

function aggregateSides(sides: Side[]): Side {
  const byName = new Map<string, number>();
  let total = 0;
  for (const s of sides) {
    total += s.total;
    for (const p of s.partners) {
      byName.set(p.name, (byName.get(p.name) ?? 0) + Number(p.revenue));
    }
  }
  const sorted = Array.from(byName.entries())
    .map(([name, revenue]) => ({ name, revenue }))
    .sort((a, b) => b.revenue - a.revenue);
  const top = sorted.slice(0, TOP_N);
  const othersSum = sorted.slice(TOP_N).reduce((s, r) => s + r.revenue, 0);
  const partners: PartnerShare[] = top.map((p) => ({
    name: p.name,
    revenue: p.revenue,
    percent: total > 0 ? Math.round((p.revenue / total) * 1000) / 10 : 0,
  }));
  if (othersSum > 0) {
    partners.push({
      name: "Others",
      revenue: othersSum,
      percent: total > 0 ? Math.round((othersSum / total) * 1000) / 10 : 0,
    });
  }
  return { total, partners };
}

function SideDonut({
  title,
  side,
}: {
  title: string;
  side: Side;
}) {
  const chartData = useMemo(() => {
    return side.partners.map((p) => ({
      name: String(p.name),
      value: Number(p.revenue),
    }));
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

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">
        {title}
      </h3>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-8">
        <div className="mx-auto h-64 w-64 shrink-0 sm:h-72 sm:w-72 lg:h-80 lg:w-80">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius="55%"
                outerRadius="75%"
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
          <p className="mb-3 text-sm font-medium text-white/50">
            Top 5 — {formatCurrency(side.total)} total
          </p>
          <ul className="space-y-2.5 text-sm">
            {top5.map((p, i) => (
              <li
                key={`${p.name}-${i}`}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
              >
                <span className="break-words text-white/95">
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

  const aggregated = useMemo(() => {
    const demandSides: Side[] = [];
    const supplySides: Side[] = [];
    for (const key of filteredMonthKeys) {
      const d = dataByMonth[key];
      if (!d) continue;
      demandSides.push(d.demand);
      supplySides.push(d.supply);
    }
    if (demandSides.length === 0 && supplySides.length === 0) return null;
    const demand = aggregateSides(demandSides);
    const supply = aggregateSides(supplySides);
    const allPartners = [
      ...demand.partners.filter((p) => p.name !== "Others"),
      ...supply.partners.filter((p) => p.name !== "Others"),
    ];
    const concentrationRisk = allPartners.some(
      (p) => Number(p.percent) >= CONCENTRATION_THRESHOLD
    );
    return { demand, supply, concentrationRisk };
  }, [filteredMonthKeys, dataByMonth]);

  if (monthKeys.length === 0) {
    return (
      <div className="w-full max-w-5xl rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">
          Partner Distribution
        </h2>
        <p className="text-sm text-white/50">
          No concentration data. Run fetch:client-breakdown for Jan26 and Feb26.
        </p>
      </div>
    );
  }

  if (!aggregated) {
    return (
      <div className="w-full max-w-5xl rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">
          Client Concentration
        </h2>
        <p className="text-sm text-white/50">
          Select at least one month in the filter to view concentration data.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">
          Client Concentration
        </h2>
        <div className="flex items-center gap-2">
          {aggregated.concentrationRisk && (
            <span className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-white/90">
              Concentration risk (partner &gt; 30%)
            </span>
          )}
        </div>
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        <SideDonut title="Demand (Revenue)" side={aggregated.demand} />
        <SideDonut title="Supply (Cost)" side={aggregated.supply} />
      </div>
    </div>
  );
}
