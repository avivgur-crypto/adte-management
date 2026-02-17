"use client";

import { DonutChart } from "@tremor/react";
import type { ClientBreakdownResult } from "@/app/actions/client-breakdown";

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

export default function ConcentrationPieChart({
  data,
}: {
  data: ClientBreakdownResult | null;
}) {
  if (!data || data.partners.length === 0) {
    return (
      <div className="w-full max-w-4xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Client Concentration
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No client breakdown data for this month. Run{" "}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">
            npm run fetch:client-breakdown
          </code>{" "}
          to populate.
        </p>
      </div>
    );
  }

  const top5 = data.partners.slice(0, 5);
  const chartData = top5.map((p) => ({
    name: p.partner_name,
    value: p.revenue,
  }));

  return (
    <div className="w-full max-w-4xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        Client Concentration — {data.month}
      </h2>
      <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
        Top partners by revenue (concentration risk)
      </p>
      <div className="grid gap-6 sm:grid-cols-[1fr,auto]">
        <div className="h-64 sm:h-72">
          <DonutChart
            data={chartData}
            index="name"
            category="value"
            valueFormatter={formatCurrency}
            showLabel
            colors={["blue", "cyan", "indigo", "violet", "fuchsia"]}
            className="h-full w-full"
          />
        </div>
        <div className="min-w-0 sm:w-64">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Top 5 clients
          </h3>
          <ul className="space-y-2">
            {top5.map((p, i) => (
              <li
                key={`${p.partner_name}-${p.partner_type}`}
                className="flex min-w-0 items-center justify-between gap-2 text-sm"
              >
                <span
                  className="min-w-0 truncate font-medium text-zinc-800 dark:text-zinc-200"
                  title={p.partner_name}
                >
                  {i + 1}. {p.partner_name}
                </span>
                <span className="shrink-0 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                  {formatCurrency(p.revenue)} ({p.percent}%)
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            Total: {formatCurrency(data.totalRevenue)}
          </p>
        </div>
      </div>
    </div>
  );
}
