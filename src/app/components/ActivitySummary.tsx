"use client";

import { useMemo } from "react";
import { useFilter } from "@/app/context/FilterContext";
import type {
  ActivityDailyRow,
  SignedDealCompany,
} from "@/app/actions/activity";

function getCurrentMonthStart(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/** Format month key (YYYY-MM-01) to "Jan 2026". */
function formatMonthLabel(key: string): string {
  const [y, m] = key.split("-");
  const names = "JanFebMarAprMayJunJulAugSepOctNovDec";
  const name = names.slice((parseInt(m ?? "1", 10) - 1) * 3, parseInt(m ?? "1", 10) * 3);
  return `${name} ${y}`;
}

/** Return a short period label for the selected months. */
function getPeriodLabel(monthStarts: string[]): string {
  if (monthStarts.length === 0) return "";
  if (monthStarts.length === 1) return formatMonthLabel(monthStarts[0]!);
  const first = formatMonthLabel(monthStarts[0]!);
  const last = formatMonthLabel(monthStarts[monthStarts.length - 1]!);
  return `${first} – ${last}`;
}

/** True if date (YYYY-MM-DD) falls in one of the given month starts (YYYY-MM-01). */
function dateInMonths(date: string, monthStarts: string[]): boolean {
  if (monthStarts.length === 0) return false;
  const dateMonth = date.slice(0, 7);
  return monthStarts.some((m) => m.slice(0, 7) === dateMonth);
}

export default function ActivitySummary({
  activityData,
  signedDealsCompanies = [],
}: {
  activityData: ActivityDailyRow[];
  signedDealsCompanies?: SignedDealCompany[];
}) {
  const { selectedMonths } = useFilter();

  const { metrics, monthStarts, periodLabel, hasSelection, signedContractsInPeriod } =
    useMemo(() => {
      const monthStarts =
        selectedMonths.size > 0 ? Array.from(selectedMonths).sort() : [];
      let newLeads = 0;
      for (const row of activityData) {
        if (monthStarts.length === 0 || !dateInMonths(row.date, monthStarts))
          continue;
        newLeads += row.total_leads;
      }

      /** One entry per contract row from monday_items_activity (getSignedDealsCompanies); counter and list use this array only. */
      const signedContractsInPeriod =
        monthStarts.length === 0
          ? []
          : signedDealsCompanies.filter((c) =>
              dateInMonths(c.created_date, monthStarts),
            );

      const periodLabel =
        monthStarts.length === 0
          ? "Select months in the filter to see data"
          : getPeriodLabel(monthStarts);

      const newSignedDeals = signedContractsInPeriod.length;

      return {
        metrics: { newLeads, newSignedDeals },
        monthStarts,
        periodLabel,
        hasSelection: monthStarts.length > 0,
        signedContractsInPeriod,
      };
    }, [activityData, selectedMonths, signedDealsCompanies]);

  return (
    <section className="mb-8">
      <p className="mb-3 text-sm text-white/50">
        Period: <span className="font-medium text-white/70">{periodLabel}</span>
      </p>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
          <h2 className="mb-1 text-xl font-semibold uppercase tracking-wider text-white/50">
            New Leads
          </h2>
          <p className="mb-1 text-4xl font-semibold tabular-nums text-white sm:text-5xl">
            {hasSelection ? metrics.newLeads.toLocaleString() : "—"}
          </p>
          <p className="text-xs text-white/50">
            New leads created in selected period (Monday&apos;s &apos;Leads&apos; board creation date)
          </p>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
          <h2 className="mb-1 text-xl font-semibold uppercase tracking-wider text-white/50">
            New Signed Deals
          </h2>
          <p className="mb-1 text-4xl font-semibold tabular-nums text-white sm:text-5xl">
            {hasSelection ? metrics.newSignedDeals.toLocaleString() : "—"}
          </p>
          <p className="mb-3 text-xs text-white/50">
            New deals signed in selected period (Monday&apos;s &apos;Media Contracts&apos; board creation date)
          </p>
          {hasSelection && metrics.newSignedDeals > 0 && (
            <div className="border-t border-white/10 pt-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                Signed contracts this period
              </p>
              {signedContractsInPeriod.length > 0 ? (
                <ul className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-white/80">
                  {signedContractsInPeriod.map((entry, index) => (
                    <li
                      key={`${entry.created_date}-${index}`}
                      className="rounded bg-white/5 px-2 py-0.5"
                    >
                      {entry.company_name}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-white/45">
                  Run Monday sync after updating env — company names come from the board or item title.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
