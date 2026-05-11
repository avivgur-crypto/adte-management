import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { getIsraelDateDaysAgo } from "@/lib/israel-date";
import { syncXDASHDataForDates } from "@/lib/sync/xdash";
import { recordSyncRun } from "@/lib/sync-logs";
import { syncProLog } from "@/lib/sync-pro-log";

/**
 * “Golden Sync” — runs at 04:00 UTC (06:00 Israel) to lock in YESTERDAY’s final
 * `daily_home_totals` numbers before the 08:00 IL morning summary fires.
 *
 * Sync-Pro contract:
 *   1. Single date: `getIsraelDateDaysAgo(1)`.
 *   2. `mode: "internal"` → cookie path = exact match with the XDASH UI.
 *   3. `skipHourlySnapshots: true` → preserves the genuine intraday timeline
 *      so Pulse keeps doing "live vs live" without asterisks.
 *   4. `force: false` → opt INTO the regression guard in `syncHomeTotalsForDates`.
 *      A partial XDASH response that would shrink yesterday by >15% is blocked
 *      and surfaces as `sync_pro.xdash_sync.regression_blocked` (the May-8 fix).
 *      Yesterday is still always re-fetched (the read-side filter exempts it),
 *      so the only thing `force: false` changes is the *write* gate.
 *      Operator escape hatch: `/api/admin/backfill-home?dates=YYYY-MM-DD&force=true`.
 *   5. Reads the pre-sync row, runs the sync, reads the post-sync row, and
 *      emits `sync_pro.golden_sync.finalized_row_locked` with the delta.
 *   6. `revalidateTag("financial-data")` + `revalidatePath("/")` immediately.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const FINANCIAL_TAG = "financial-data";

type RowSnapshot = {
  revenue: number;
  cost: number;
  profit: number;
  impressions: number;
} | null;

function getReceivedSecret(request: NextRequest): string {
  const q = request.nextUrl.searchParams.get("secret");
  if (q != null && String(q).trim() !== "") return String(q).trim();
  const auth = request.headers.get("authorization") ?? "";
  return auth.replace(/^Bearer\s+/i, "").trim();
}

function checkAuth(request: NextRequest): { ok: boolean; detail?: string } {
  const expected = (process.env.CRON_SECRET ?? "").trim();
  if (!expected) {
    return { ok: false, detail: "CRON_SECRET not configured" };
  }
  const received = getReceivedSecret(request);
  if (received === expected) return { ok: true };
  return { ok: false, detail: `Secret mismatch (${received.length} vs ${expected.length} chars)` };
}

async function readDailyHomeTotalsRow(date: string): Promise<RowSnapshot> {
  const { data, error } = await supabaseAdmin
    .from("daily_home_totals")
    .select("revenue, cost, profit, impressions")
    .eq("date", date)
    .maybeSingle();
  if (error) {
    syncProLog({
      event: "sync_pro.golden_sync.read_failed",
      branch_type: "totals",
      status: "error",
      message: error.message,
      detail: { date },
    });
    return null;
  }
  if (!data) return null;
  return {
    revenue: Number(data.revenue ?? 0),
    cost: Number(data.cost ?? 0),
    profit: Number(data.profit ?? 0),
    impressions: Number(data.impressions ?? 0),
  };
}

export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized", detail: auth.detail }, { status: 401 });
  }

  const yesterday = getIsraelDateDaysAgo(1);
  const t0 = Date.now();

  syncProLog({
    event: "sync_pro.golden_sync.start",
    branch_type: "totals",
    status: "started",
    detail: {
      date: yesterday,
      mode: "internal",
      data_source: "internal_cookie",
      skipHourlySnapshots: true,
      // Golden sync deliberately runs without `force` so the regression guard
      // in `syncHomeTotalsForDates` can block a partial XDASH response from
      // overwriting the (correct) intraday-final row. If you need to legitimately
      // overwrite with a much lower number, use `/api/admin/backfill-home?dates=…&force=true`.
      force: false,
    },
  });

  const before = await readDailyHomeTotalsRow(yesterday);

  try {
    const result = await syncXDASHDataForDates([yesterday], {
      // `force: false` lets the regression guard protect the row. Yesterday is
      // always re-fetched regardless (the read-side filter explicitly includes
      // today + yesterday), so this only changes the *write*-side behaviour:
      // a >15% revenue drop vs the existing row will be blocked + logged as
      // `sync_pro.xdash_sync.regression_blocked` instead of silently overwriting.
      force: false,
      mode: "internal",
      skipHourlySnapshots: true,
      skipPartnerPerformance: true,
    });

    try {
      revalidateTag(FINANCIAL_TAG, { expire: 0 });
      revalidatePath("/");
    } catch {
      /* non-fatal */
    }

    const after = await readDailyHomeTotalsRow(yesterday);
    const previousRevenue = before?.revenue ?? 0;
    const finalizedRevenue = after?.revenue ?? 0;
    const revenueDelta = finalizedRevenue - previousRevenue;
    const previousProfit = before?.profit ?? 0;
    const finalizedProfit = after?.profit ?? 0;
    const profitDelta = finalizedProfit - previousProfit;

    syncProLog({
      event: "sync_pro.golden_sync.finalized_row_locked",
      branch_type: "totals",
      status: "ok",
      detail: {
        date: yesterday,
        previous: { revenue: previousRevenue, profit: previousProfit, raw: before },
        finalized: { revenue: finalizedRevenue, profit: finalizedProfit, raw: after },
        revenueDelta,
        profitDelta,
      },
    });

    const durationMs = Date.now() - t0;
    syncProLog({
      event: "sync_pro.golden_sync.complete",
      branch_type: "totals",
      status: "ok",
      duration_ms: durationMs,
      detail: {
        date: yesterday,
        datesSynced: result.datesSynced,
        rowsUpserted: result.rowsUpserted,
        hourlySnapshotsPreserved: true,
      },
    });
    void recordSyncRun({
      source: "cron_golden_sync",
      durationMs,
      datesSynced: result.datesSynced,
      rowsUpserted: result.rowsUpserted,
      ok: true,
      detail: {
        date: yesterday,
        data_source: "internal_cookie",
        previousRevenue,
        finalizedRevenue,
        revenueDelta,
      },
    });

    return NextResponse.json({
      ok: true,
      date: yesterday,
      previous: before,
      finalized: after,
      revenueDelta,
      profitDelta,
      hourly_snapshots_preserved: true,
      ...result,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const durationMs = Date.now() - t0;
    syncProLog({
      event: "sync_pro.golden_sync.failed",
      branch_type: "totals",
      status: "error",
      duration_ms: durationMs,
      message: msg,
      detail: { date: yesterday, previous: before },
    });
    void recordSyncRun({
      source: "cron_golden_sync",
      durationMs,
      datesSynced: 0,
      rowsUpserted: 0,
      ok: false,
      errorMessage: msg,
      detail: { date: yesterday, data_source: "internal_cookie" },
    });
    return NextResponse.json({ ok: false, date: yesterday, error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
