import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchHomeForDate } from "@/lib/xdash-client";

/**
 * Read-only Manual Data Auditor: compares `daily_home_totals` (App DB) against
 * the live XDASH UI source (`mode: "internal"` cookie path) for the last N days.
 *
 * Unlike `/api/admin/backfill-home`, this route NEVER writes to the database.
 * It is a diagnostic to surface drift between what the dashboard renders and
 * what XDASH's UI currently reports — without touching either side.
 *
 * Query params:
 *   - `days` (default 3): how many recent days to inspect, ending today (Israel TZ).
 *   - `secret`: matches `CRON_SECRET` (or `Authorization: Bearer …`).
 *
 * Safety:
 *   - Sequential per-date fetch (no parallelism).
 *   - 500ms delay between dates so we don't hammer the XDASH backup server.
 *   - Zero `upsert` / `insert` / `update` calls anywhere in this file.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const TIMEZONE_ISRAEL = "Asia/Jerusalem";
const DEFAULT_DAYS = 3;
const MAX_DAYS = 60;
const INTER_DATE_DELAY_MS = 500;

function getReceivedSecret(request: NextRequest): string {
  const q = request.nextUrl.searchParams.get("secret");
  if (q != null && String(q).trim() !== "") return String(q).trim();
  const auth = request.headers.get("authorization") ?? "";
  return auth.replace(/^Bearer\s+/i, "").trim();
}

function checkAuth(request: NextRequest): { ok: boolean; detail?: string } {
  const expected = (process.env.CRON_SECRET ?? "").trim();
  if (!expected) return { ok: false, detail: "CRON_SECRET not configured" };
  const received = getReceivedSecret(request);
  if (received === expected) return { ok: true };
  return {
    ok: false,
    detail: `Secret mismatch (${received.length} vs ${expected.length} chars)`,
  };
}

function parseDays(raw: string | null): number {
  if (!raw) return DEFAULT_DAYS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DAYS;
  return Math.min(n, MAX_DAYS);
}

/** Today (YYYY-MM-DD) in Israel timezone — matches XDASH's calendar. */
function getTodayIsrael(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE_ISRAEL });
}

/**
 * Last `n` Israel-calendar dates, oldest → newest (so the audit reads
 * chronologically and the most recent / most volatile day lands last).
 */
function lastNDatesIsrael(n: number): string[] {
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

/**
 * Match policy: round both sides to whole dollars before comparing so harmless
 * sub-cent drift doesn't flag a mismatch. Adjust here if a tighter threshold
 * is ever needed.
 */
function isMatch(app: number, xdash: number): boolean {
  return Math.round(app) === Math.round(xdash);
}

type ComparisonRow = {
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

export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: "Unauthorized", detail: auth.detail },
      { status: 401 },
    );
  }

  const days = parseDays(request.nextUrl.searchParams.get("days"));
  const dates = lastNDatesIsrael(days);
  const t0 = Date.now();

  const results: ComparisonRow[] = [];

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i]!;
    let row: ComparisonRow;
    try {
      const [app, xdash] = await Promise.all([
        readAppRow(date),
        fetchHomeForDate(date, { mode: "internal" }),
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
      await new Promise((r) => setTimeout(r, INTER_DATE_DELAY_MS));
    }
  }

  const mismatches = results.filter((r) => !r.match).length;

  return NextResponse.json({
    ok: true,
    read_only: true,
    mode: "internal",
    days,
    dates,
    checked: results.length,
    mismatches,
    duration_ms: Date.now() - t0,
    results,
  });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
