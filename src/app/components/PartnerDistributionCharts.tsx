"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useMemo, useState } from "react";
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
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

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
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">
        {title}
      </h3>
      <div className="flex min-w-0 flex-col gap-4">
        <p className="text-center text-base font-extrabold text-[var(--adte-blue)]">
          Top 5 — {formatCurrency(side.total)} total
        </p>
        <div className="partner-donut-chart mx-auto h-52 w-52 shrink-0 overflow-hidden rounded-lg bg-transparent sm:h-60 sm:w-60 lg:h-72 lg:w-72">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius="48%"
                outerRadius="62%"
                stroke="rgba(0,0,0,0.25)"
                strokeWidth={1.5}
                paddingAngle={2}
                onMouseEnter={(_: unknown, index: number) => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                {chartData.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={COLORS[index % COLORS.length]}
                    opacity={hoveredIndex != null && hoveredIndex !== index ? 0.35 : 1}
                    style={{ cursor: "pointer", transition: "opacity 0.15s ease" }}
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
        <ul className="space-y-2 text-sm">
          {top5.map((p, i) => {
            const segmentColor = COLORS[i % COLORS.length];
            const isHighlighted = hoveredIndex === i;
            return (
              <li
                key={`${p.name}-${i}`}
                className={`flex flex-col gap-0.5 rounded-md border-l-4 py-1.5 pl-3 transition-all duration-150 ${
                  isHighlighted ? "ring-2 ring-[var(--adte-blue)] ring-opacity-80" : ""
                }`}
                style={{
                  borderLeftColor: segmentColor,
                  backgroundColor: isHighlighted ? `${segmentColor}30` : `${segmentColor}18`,
                }}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                <span className={`break-words ${isHighlighted ? "font-bold text-white" : "text-white/95"}`}>
                  {p.name}
                </span>
                <span className="tabular-nums text-white/60">
                  {formatCurrency(Number(p.revenue))} ({Number(p.percent)}%)
                </span>
              </li>
            );
          })}
        </ul>
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
        <h2 className="text-[25px] font-extrabold text-white">
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
