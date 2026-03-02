"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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

const BAR_COLOR = "#0088FE"; // same as first pie color (demand)
const TOP_BAR_N = 10;

type Side = { total: number; partners: PartnerShare[] };

function aggregateDemandSides(
  dataByMonth: Record<string, PartnerConcentrationResult | null>,
  monthKeys: string[]
): Side {
  const byName = new Map<string, number>();
  let total = 0;
  for (const key of monthKeys) {
    const d = dataByMonth[key];
    if (!d) continue;
    const demand = d.demand;
    total += demand.total;
    for (const p of demand.partners) {
      byName.set(p.name, (byName.get(p.name) ?? 0) + Number(p.revenue));
    }
  }
  const sorted = Array.from(byName.entries())
    .map(([name, revenue]) => ({ name, revenue }))
    .sort((a, b) => b.revenue - a.revenue);
  const top = sorted.slice(0, TOP_BAR_N);
  const othersSum = sorted.slice(TOP_BAR_N).reduce((s, r) => s + r.revenue, 0);
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

export default function TopPublishersRevenueChart({
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

  const { barData, total } = useMemo(() => {
    const side = aggregateDemandSides(dataByMonth, filteredMonthKeys);
    const barData = side.partners.map((p) => ({
      name: p.name,
      revenue: Number(p.revenue),
      percent: p.percent,
    }));
    return { barData, total: side.total };
  }, [dataByMonth, filteredMonthKeys]);

  if (monthKeys.length === 0) {
    return (
      <div className="w-full max-w-5xl rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
        <h2 className="mb-4 text-[25px] font-extrabold text-white">
          Top Publishers Revenue
        </h2>
        <p className="text-sm text-white/50">No concentration data available.</p>
      </div>
    );
  }

  if (filteredMonthKeys.length === 0) {
    return (
      <div className="w-full max-w-5xl rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
        <h2 className="mb-4 text-[25px] font-extrabold text-white">
          Top Publishers Revenue
        </h2>
        <p className="text-sm text-white/50">
          Select at least one month in the filter to view publishers.
        </p>
      </div>
    );
  }

  if (barData.length === 0) {
    return (
      <div className="w-full max-w-5xl rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
        <h2 className="mb-4 text-[25px] font-extrabold text-white">
          Top Publishers Revenue
        </h2>
        <p className="text-sm text-white/50">No demand revenue data for selected months.</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
      <div className="mb-4">
        <h2 className="text-[25px] font-extrabold text-white">
          Top Publishers Revenue
        </h2>
        <p className="mt-1 text-sm text-white/50">
          Demand partners by revenue (selected months) · Total {formatCurrency(total)}
        </p>
      </div>
      <div className="h-[380px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={barData}
            layout="vertical"
            margin={{ top: 4, right: 24, left: 4, bottom: 4 }}
          >
            <XAxis
              type="number"
              tickFormatter={(v) => (v >= 1_000_000 ? `$${v / 1e6}M` : `$${v / 1e3}K`)}
              tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={120}
              tick={{ fill: "rgba(255,255,255,0.8)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => (v.length > 18 ? `${v.slice(0, 16)}…` : v)}
            />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const p = payload[0].payload as { name: string; revenue: number; percent: number };
                return (
                  <div className="rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 shadow-xl">
                    <p className="mb-1 font-medium text-white">{p.name}</p>
                    <p className="text-sm text-white/70">
                      {formatCurrency(p.revenue)} ({p.percent}%)
                    </p>
                  </div>
                );
              }}
              formatter={(value: number) => [formatCurrency(value), "Revenue"]}
            />
            <Bar
              dataKey="revenue"
              fill={BAR_COLOR}
              radius={[0, 4, 4, 0]}
              barSize={24}
              name="Revenue"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
