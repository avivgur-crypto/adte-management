import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { syncXDASHDataForDates } from "@/lib/sync/xdash";
import { syncProLog } from "@/lib/sync-pro-log";

/**
 * Reconciliation / backfill endpoint for `daily_home_totals`.
 *
 * Two ways to specify the dates (mutually exclusive — `dates` wins):
 *   ?dates=2026-05-01,2026-05-02,...
 *   ?from=2026-05-01&to=2026-05-07
 *
 * Defaults to **2026-05-01 → 2026-05-07** when no parameters are provided
 * (matches the "Ultimate Data Reconciliation" task).
 *
 * Mode (Sync-Pro accuracy guarantees):
 *   - `forceExternal: true` so every fetch hits the External Report API and
 *     returns the FINALIZED revenue/cost/profit (the cookie path can return
 *     stale "live" intraday values for today).
 *   - `skipHourlySnapshots: true` so the original intraday Pulse timeline is
 *     preserved — Pulse's "live vs live" comparisons keep working without
 *     asterisks.
 *   - `force: true` so existing rows are hard-overwritten regardless of
 *     whether they already have profit > 0.
 *   - `skipPartnerPerformance: true` (default) — reconciliation only repaints
 *     the totals table. Pass `partners=true` to repaint demand/supply too.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` (or `?secret=…`).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const FINANCIAL_TAG = "financial-data";
const DEFAULT_FROM = "2026-05-01";
const DEFAULT_TO = "2026-05-07";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
  return { ok: false, detail: `Secret mismatch (${received.length} vs ${expected.length} chars)` };
}

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const start = new Date(Date.UTC(fy!, fm! - 1, fd!));
  const end = new Date(Date.UTC(ty!, tm! - 1, td!));
  if (end < start) return out;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function parseDates(req: NextRequest): { dates: string[]; from?: string; to?: string } {
  const explicit = req.nextUrl.searchParams.get("dates");
  if (explicit) {
    const list = explicit
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean)
      .filter((d) => ISO_DATE.test(d));
    if (list.length > 0) return { dates: list };
  }
  const from = req.nextUrl.searchParams.get("from")?.trim();
  const to = req.nextUrl.searchParams.get("to")?.trim();
  if (from && to && ISO_DATE.test(from) && ISO_DATE.test(to)) {
    return { dates: dateRange(from, to), from, to };
  }
  return { dates: dateRange(DEFAULT_FROM, DEFAULT_TO), from: DEFAULT_FROM, to: DEFAULT_TO };
}

function isTrueish(v: string | null | undefined): boolean {
  if (v == null) return false;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

type RowSnapshot = {
  date: string;
  revenue: number;
  cost: number;
  profit: number;
  impressions: number;
};

async function readRows(dates: string[]): Promise<Map<string, RowSnapshot>> {
  const out = new Map<string, RowSnapshot>();
  if (dates.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from("daily_home_totals")
    .select("date, revenue, cost, profit, impressions")
    .in("date", dates);
  if (error) {
    syncProLog({
      event: "sync_pro.reconcile.read_failed",
      branch_type: "totals",
      status: "error",
      message: error.message,
      detail: { dates },
    });
    return out;
  }
  for (const r of data ?? []) {
    const date = String(r.date).slice(0, 10);
    out.set(date, {
      date,
      revenue: Number(r.revenue ?? 0),
      cost: Number(r.cost ?? 0),
      profit: Number(r.profit ?? 0),
      impressions: Number(r.impressions ?? 0),
    });
  }
  return out;
}

export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized", detail: auth.detail }, { status: 401 });
  }

  const { dates, from, to } = parseDates(request);
  if (dates.length === 0) {
    return NextResponse.json({ error: "No valid dates resolved" }, { status: 400 });
  }
  const includePartners = isTrueish(request.nextUrl.searchParams.get("partners"));
  const t0 = Date.now();

  syncProLog({
    event: "sync_pro.reconcile.start",
    branch_type: "totals",
    status: "started",
    detail: {
      mode: "external_only",
      dates,
      range: from && to ? { from, to } : undefined,
      forceExternal: true,
      skipHourlySnapshots: true,
      force: true,
      includePartners,
    },
  });

  const before = await readRows(dates);

  try {
    const result = await syncXDASHDataForDates(dates, {
      force: true,
      forceExternal: true,
      skipHourlySnapshots: true,
      skipPartnerPerformance: !includePartners,
    });

    const after = await readRows(dates);
    const diffs = dates.map((d) => {
      const b = before.get(d);
      const a = after.get(d);
      return {
        date: d,
        before: b ?? null,
        after: a ?? null,
        revenueDelta: (a?.revenue ?? 0) - (b?.revenue ?? 0),
        profitDelta: (a?.profit ?? 0) - (b?.profit ?? 0),
      };
    });

    try {
      revalidateTag(FINANCIAL_TAG, { expire: 0 });
      revalidatePath("/");
    } catch {
      /* non-fatal */
    }

    const durationMs = Date.now() - t0;
    syncProLog({
      event: "sync_pro.reconcile.complete",
      branch_type: "totals",
      status: "ok",
      duration_ms: durationMs,
      detail: {
        dates,
        datesSynced: result.datesSynced,
        rowsUpserted: result.rowsUpserted,
        diffs,
      },
    });

    return NextResponse.json({
      ok: true,
      mode: "external_only",
      dates,
      range: from && to ? { from, to } : undefined,
      hourly_snapshots_preserved: true,
      ...result,
      diffs,
      duration_ms: durationMs,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const durationMs = Date.now() - t0;
    syncProLog({
      event: "sync_pro.reconcile.failed",
      branch_type: "totals",
      status: "error",
      duration_ms: durationMs,
      message: msg,
      detail: { dates },
    });
    return NextResponse.json(
      { ok: false, dates, error: msg, duration_ms: durationMs },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
