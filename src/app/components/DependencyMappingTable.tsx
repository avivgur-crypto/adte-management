"use client";

import { useMemo, useState } from "react";
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
  const displayRows = useMemo(
    () => (Array.isArray(data?.rows) ? data.rows : []),
    [data]
  );
  const riskSet = useMemo(
    () => new Set(Array.isArray(data?.riskDemandPartners) ? data.riskDemandPartners : []),
    [data]
  );
  const fromXdash = data?.fromXdash ?? false;

  if (!data || displayRows.length === 0) {
    const reason = data?.errorMessage
      ? data.errorMessage
      : "No pair-level data in database. Run the sync (cron) to backfill daily_partner_pairs from XDASH.";
    return (
      <div className="w-full max-w-5xl rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
        <h2 className="mb-1 text-[25px] font-extrabold text-white">
          Dependency <span className="highlight-brand">Mapping</span>
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
            Dependency <span className="highlight-brand">Mapping</span>
          </h2>
          <p className="mt-1 text-sm text-white/50">
            Demand × Supply pairs (from database, synced from XDASH). Top 20 by profit.
          </p>
        </div>
        {riskSet.size > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-300">
            <RiskAlertIcon className="h-4 w-4" />
            Risk: demand partner &gt;60% from single supply
          </span>
        )}
      </div>

      {/* Desktop: full table */}
      <div className="hidden md:block overflow-x-auto">
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
                      <span title=">60% revenue from single supply">
                        <RiskAlertIcon className="h-4 w-4 shrink-0 text-amber-400" />
                      </span>
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

      {/* Mobile: expandable card list */}
      <MobileCardList rows={displayRows} riskSet={riskSet} />
    </div>
  );
}

function MobileCardList({
  rows,
  riskSet,
}: {
  rows: DependencyMappingResult["rows"];
  riskSet: Set<string>;
}) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const handleToggle = (i: number) => {
    setExpandedIdx((prev) => (prev === i ? null : i));
  };

  return (
    <div className="flex flex-col gap-2 md:hidden">
      {rows.map((row, i) => {
        const isOpen = expandedIdx === i;
        return (
          <div
            key={`${row.demandPartner}-${row.supplyPartner}-${i}`}
            className={`w-full rounded-xl border text-left transition-colors duration-200 ${
              isOpen
                ? "border-white/15 bg-white/[0.06]"
                : "border-white/[0.06] bg-white/[0.02]"
            }`}
          >
            <button
              type="button"
              onClick={() => handleToggle(i)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left active:bg-white/[0.04]"
            >
              {riskSet.has(row.demandPartner) && (
                <RiskAlertIcon className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 text-xs">
                  <span className="truncate font-medium text-white/90">
                    {row.demandPartner}
                  </span>
                  <span className="shrink-0 text-white/30">→</span>
                  <span className="truncate text-white/60">
                    {row.supplyPartner}
                  </span>
                </div>
              </div>
              <span
                className={`shrink-0 text-xs font-medium tabular-nums ${
                  row.profitMarginPercent >= 0 ? "text-emerald-300/80" : "text-red-300/80"
                }`}
              >
                {formatPercent(row.profitMarginPercent)}
              </span>
              <svg
                className={`h-3.5 w-3.5 shrink-0 text-white/30 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {isOpen && (
              <div className="border-t border-white/[0.06] px-3 pb-3 pt-2 text-xs">
                <div className="mb-2 space-y-0.5">
                  <div className="text-white/90 break-words leading-relaxed">
                    <span className="text-white/40">Demand: </span>{row.demandPartner}
                  </div>
                  <div className="text-white/70 break-words leading-relaxed">
                    <span className="text-white/40">Supply: </span>{row.supplyPartner}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-y-1.5 gap-x-2">
                  <div>
                    <div className="text-white/40">Revenue</div>
                    <div className="font-medium tabular-nums text-white/90">{formatCurrency(row.revenue)}</div>
                  </div>
                  <div>
                    <div className="text-white/40">Cost</div>
                    <div className="font-medium tabular-nums text-white/90">{formatCurrency(row.cost)}</div>
                  </div>
                  <div>
                    <div className="text-white/40">Profit</div>
                    <div className={`font-medium tabular-nums ${row.profit >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                      {formatCurrency(row.profit)}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
