/**
 * Shared implementation for comparing `daily_home_totals` vs XDASH UI totals
 * (`fetchHomeForDate` with `mode: "internal"`). Used by `/api/admin/audit-compare`
 * and `/api/cron/self-heal`.
 */

import { supabaseAdmin } from "@/lib/supabase";
import { fetchHomeForDate } from "@/lib/xdash-client";

const TIMEZONE_ISRAEL = "Asia/Jerusalem";
export const AUDIT_COMPARE_INTER_DATE_DELAY_MS = 500;

function getTodayIsrael(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE_ISRAEL });
}

/**
 * Last `n` Israel-calendar dates, oldest → newest.
 */
export function lastNDatesIsrael(n: number): string[] {
  const today = getTodayIsrael();
  const [y, m, d] = today.split("-").map(Number);
  const base = new Date(Date.UTC(y!, m! - 1, d!));
  const out: string[] = [];
  for (let offset = n - 1; offset >= 0; offset--) {
    const dt = new Date(base);
    dt.setUTCDate(dt.getUTCDate() - offset);
    out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}

type AppRow = {
  date: string;
  revenue: number;
  cost: number;
  profit: number;
};

async function readAppRow(date: string): Promise<AppRow | null> {
  const { data, error } = await supabaseAdmin
    .from("daily_home_totals")
    .select("date, revenue, cost, profit")
    .eq("date", date)
    .maybeSingle();
  if (error) {
    throw new Error(`daily_home_totals read failed for ${date}: ${error.message}`);
  }
  if (!data) return null;
  return {
    date: String(data.date).slice(0, 10),
    revenue: Number(data.revenue ?? 0),
    cost: Number(data.cost ?? 0),
    profit: Number(data.profit ?? 0),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function percentString(diff: number, base: number): string {
  if (!Number.isFinite(diff)) return "n/a";
  if (base === 0) return diff === 0 ? "0.0%" : "n/a";
  const pct = (diff / Math.abs(base)) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function isMatch(app: number, xdash: number): boolean {
  return Math.round(app) === Math.round(xdash);
}

export type AuditComparisonRow = {
  date: string;
  match: boolean;
  app: { rev: number; cost: number; profit: number } | null;
  xdash: { rev: number; cost: number; profit: number } | null;
  diff: {
    rev: number;
    cost: number;
    profit: number;
    percent: string;
  } | null;
  error?: string;
};

export type RunHomeTotalsAuditOptions = {
  /** Delay between each date (default 500ms). */
  interDateDelayMs?: number;
};

/**
 * Run the same comparison as `/api/admin/audit-compare` for an explicit date list
 * (sequential, read-only for XDASH + DB).
 */
export async function runHomeTotalsAuditForDates(
  dates: string[],
  options?: RunHomeTotalsAuditOptions,
): Promise<AuditComparisonRow[]> {
  const delayMs = options?.interDateDelayMs ?? AUDIT_COMPARE_INTER_DATE_DELAY_MS;
  const results: AuditComparisonRow[] = [];

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i]!;
    let row: AuditComparisonRow;
    try {
      const [app, xdash] = await Promise.all([
        readAppRow(date),
        fetchHomeForDate(date, {
          mode: "internal",
          skipPartnerPerformance: true,
        }),
      ]);

      if (!app) {
        row = {
          date,
          match: false,
          app: null,
          xdash: {
            rev: round2(xdash.revenue),
            cost: round2(xdash.cost),
            profit: round2(xdash.profit),
          },
          diff: null,
          error: "no row in daily_home_totals",
        };
      } else {
        const revDiff = round2(app.revenue - xdash.revenue);
        const costDiff = round2(app.cost - xdash.cost);
        const profitDiff = round2(app.profit - xdash.profit);
        const match =
          isMatch(app.revenue, xdash.revenue) &&
          isMatch(app.cost, xdash.cost) &&
          isMatch(app.profit, xdash.profit);
        row = {
          date,
          match,
          app: {
            rev: round2(app.revenue),
            cost: round2(app.cost),
            profit: round2(app.profit),
          },
          xdash: {
            rev: round2(xdash.revenue),
            cost: round2(xdash.cost),
            profit: round2(xdash.profit),
          },
          diff: {
            rev: revDiff,
            cost: costDiff,
            profit: profitDiff,
            percent: percentString(revDiff, xdash.revenue),
          },
        };
      }
    } catch (e) {
      row = {
        date,
        match: false,
        app: null,
        xdash: null,
        diff: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    results.push(row);

    if (i < dates.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return results;
}

/** Convenience: last N Israel-calendar days ending today. */
export async function runHomeTotalsAuditLastNDays(
  days: number,
  options?: RunHomeTotalsAuditOptions,
): Promise<{ dates: string[]; results: AuditComparisonRow[] }> {
  const dates = lastNDatesIsrael(days);
  const results = await runHomeTotalsAuditForDates(dates, options);
  return { dates, results };
}
