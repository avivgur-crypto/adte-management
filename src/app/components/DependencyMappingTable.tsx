"use client";

import { useMemo } from "react";
import type { DependencyMappingResult } from "@/app/actions/dependency-mapping";

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function formatPercent(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n / 100);
}

function RiskAlertIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function DependencyMappingTable({
  data,
}: {
  data: DependencyMappingResult | null;
}) {
  const displayRows = useMemo(() => data?.rows ?? [], [data]);
  const riskSet = useMemo(
    () => new Set(data?.riskDemandPartners ?? []),
    [data?.riskDemandPartners]
  );
  const fromXdash = data?.fromXdash ?? false;

  if (!data || displayRows.length === 0) {
    const reason = data?.errorMessage
      ? data.errorMessage
      : "No pair-level data in database. Run the sync (cron) to backfill daily_partner_pairs from XDASH.";
    return (
      <div className="w-full max-w-5xl rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
        <h2 className="mb-1 text-[25px] font-extrabold text-white">
          Dependency Mapping
        </h2>
        <p className="mt-1 text-sm text-white/50">
          Demand × Supply pairs (from database, synced from XDASH)
        </p>
        <p className="mt-4 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/50">
          {reason}
        </p>
        <p className="mt-2 text-xs text-white/40">
          Data is stored in daily_partner_pairs. The cron job syncs only dates that are missing, to reduce load on XDASH.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[25px] font-extrabold text-white">
            Dependency Mapping
          </h2>
          <p className="mt-1 text-sm text-white/50">
            Demand × Supply pairs (from database, synced from XDASH)
          </p>
        </div>
        {riskSet.size > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-300">
            <RiskAlertIcon className="h-4 w-4" />
            Risk: demand partner &gt;60% from single supply
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="pb-3 pr-4 font-semibold uppercase tracking-wider text-white/60">
                Demand Partner
              </th>
              <th className="pb-3 pr-4 font-semibold uppercase tracking-wider text-white/60">
                Supply Partner
              </th>
              <th className="pb-3 pr-4 text-right font-semibold uppercase tracking-wider text-white/60">
                Revenue
              </th>
              <th className="pb-3 pr-4 text-right font-semibold uppercase tracking-wider text-white/60">
                Cost
              </th>
              <th className="pb-3 pr-4 text-right font-semibold uppercase tracking-wider text-white/60">
                Profit
              </th>
              <th className="pb-3 text-right font-semibold uppercase tracking-wider text-white/60">
                Profit %
              </th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, i) => (
              <tr
                key={`${row.demandPartner}-${row.supplyPartner}-${i}`}
                className="border-b border-white/[0.06] transition-colors hover:bg-white/[0.04]"
              >
                <td className="py-3 pr-4">
                  <span className="inline-flex items-center gap-1.5 font-medium text-white/90">
                    {riskSet.has(row.demandPartner) && (
                      <RiskAlertIcon
                        className="h-4 w-4 shrink-0 text-amber-400"
                        title=">60% revenue from single supply"
                      />
                    )}
                    <span className="truncate max-w-[200px]" title={row.demandPartner}>
                      {row.demandPartner}
                    </span>
                  </span>
                </td>
                <td className="py-3 pr-4 text-white/70">
                  <span className="truncate max-w-[200px] block" title={row.supplyPartner}>
                    {row.supplyPartner}
                  </span>
                </td>
                <td className="py-3 pr-4 text-right tabular-nums text-white/90">
                  {formatCurrency(row.revenue)}
                </td>
                <td className="py-3 pr-4 text-right tabular-nums text-white/90">
                  {formatCurrency(row.cost)}
                </td>
                <td
                  className={`py-3 pr-4 text-right tabular-nums ${
                    row.profit >= 0 ? "text-emerald-300/90" : "text-red-300/90"
                  }`}
                >
                  {formatCurrency(row.profit)}
                </td>
                <td
                  className={`py-3 text-right tabular-nums ${
                    row.profitMarginPercent >= 0
                      ? "text-white/70"
                      : "text-red-300/70"
                  }`}
                >
                  {formatPercent(row.profitMarginPercent)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
