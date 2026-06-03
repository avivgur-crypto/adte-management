import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getIsraelDateDaysAgo } from "@/lib/israel-date";
import { syncXDASHDataForDates } from "@/lib/sync/xdash";
import { notifyCriticalSyncTripleFailure } from "@/app/actions/notifications";
import { syncProLog } from "@/lib/sync-pro-log";

/**
 * QA / data-drift watchdog for the previous Israel calendar day.
 *
 * Runs once a day, AFTER `/api/cron/golden-sync` (0 4 * * *) has finished and
 * BEFORE `/api/cron/morning-summary` (0 5 * * *) — i.e. inside the small
 * window where any drift between the overnight half-hourly syncs and XDASH
 * is still observable. The morning summary itself force-fetches yesterday at
 * 05:00 UTC, so by then the DB always matches XDASH and a watchdog after
 * that point would be useless.
 *
 * Flow:
 *   1. Read `daily_home_totals` for yesterday  → `dbBefore` (= what the
 *      half-hourly cron left in the DB after the night).
 *   2. Force-sync yesterday from XDASH (cookie/internal path, hard overwrite,
 *      no partner-performance fan-out, leave hourly snapshots intact).
 *   3. Re-read `daily_home_totals` for yesterday → `dbAfter` (= what XDASH
 *      reports right now, post-overnight reconciliation).
 *   4. If |dbBefore.profit − dbAfter.profit| > DRIFT_THRESHOLD_USD, fire a
 *      Web Push to admins via `notifyCriticalSyncTripleFailure` (which is
 *      already deduped per Israel calendar day, so at most one alert/day).
 *
 * Auth: shared `CRON_SECRET` via `?secret=` or `Authorization: Bearer …`.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Profit drift (USD) above which the row is considered out of sync. */
const DRIFT_THRESHOLD_USD = 1.0;

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

type DailyRow = { profit: number; revenue: number } | null;

async function readDailyRow(date: string): Promise<DailyRow> {
  const { data, error } = await supabaseAdmin
    .from("daily_home_totals")
    .select("profit, revenue")
    .eq("date", date)
    .maybeSingle();
  if (error) {
    throw new Error(`daily_home_totals read failed for ${date}: ${error.message}`);
  }
  if (!data) return null;
  return {
    profit: Number(data.profit ?? 0),
    revenue: Number(data.revenue ?? 0),
  };
}

export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: "Unauthorized", detail: auth.detail },
      { status: 401 },
    );
  }

  const t0 = Date.now();
  const yesterday = getIsraelDateDaysAgo(1);

  syncProLog({
    event: "sync_pro.verify_health.start",
    branch_type: "verify_health",
    status: "started",
    detail: { yesterday, threshold_usd: DRIFT_THRESHOLD_USD },
  });

  try {
    const dbBefore = await readDailyRow(yesterday);

    const sync = await syncXDASHDataForDates([yesterday], {
      force: true,
      mode: "internal",
      skipHourlySnapshots: true,
      skipPartnerPerformance: true,
    });

    const dbAfter = await readDailyRow(yesterday);

    if (!dbAfter) {
      const msg = `[verify-health] no daily_home_totals row for ${yesterday} after force-sync — XDASH likely returned an empty/partial response`;
      syncProLog({
        event: "sync_pro.verify_health.no_row_after_sync",
        branch_type: "verify_health",
        status: "error",
        message: msg,
        detail: { yesterday, sync },
      });
      const push = await notifyCriticalSyncTripleFailure(msg);
      return NextResponse.json(
        {
          ok: false,
          reason: "no_row_after_sync",
          yesterday,
          dbBefore,
          dbAfter,
          push,
          duration_ms: Date.now() - t0,
        },
        { status: 500 },
      );
    }

    const beforeProfit = dbBefore?.profit ?? 0;
    const beforeRevenue = dbBefore?.revenue ?? 0;
    const profitDiff = Math.abs(beforeProfit - dbAfter.profit);
    const revenueDiff = Math.abs(beforeRevenue - dbAfter.revenue);
    const inSync = profitDiff <= DRIFT_THRESHOLD_USD;

    const detail = {
      yesterday,
      db_before: dbBefore,
      db_after: dbAfter,
      profit_diff_usd: Number(profitDiff.toFixed(2)),
      revenue_diff_usd: Number(revenueDiff.toFixed(2)),
      threshold_usd: DRIFT_THRESHOLD_USD,
      sync_result: sync,
      duration_ms: Date.now() - t0,
    };

    if (!inSync) {
      const alertMsg =
        `Data drift on ${yesterday}: DB profit was $${beforeProfit.toFixed(2)} ` +
        `but XDASH live is $${dbAfter.profit.toFixed(2)} ` +
        `(Δ $${profitDiff.toFixed(2)}, threshold $${DRIFT_THRESHOLD_USD.toFixed(2)}). ` +
        `Half-hourly cron likely missed an XDASH reattribution overnight.`;

      syncProLog({
        event: "sync_pro.verify_health.drift_detected",
        branch_type: "verify_health",
        status: "error",
        message: alertMsg,
        detail,
      });

      const push = await notifyCriticalSyncTripleFailure(alertMsg);

      return NextResponse.json({
        ok: false,
        reason: "drift_detected",
        message: alertMsg,
        ...detail,
        push,
      });
    }

    syncProLog({
      event: "sync_pro.verify_health.in_sync",
      branch_type: "verify_health",
      status: "ok",
      duration_ms: Date.now() - t0,
      detail,
    });

    return NextResponse.json({
      ok: true,
      message: "Data is in sync with XDASH",
      ...detail,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    syncProLog({
      event: "sync_pro.verify_health.failed",
      branch_type: "verify_health",
      status: "error",
      duration_ms: Date.now() - t0,
      message: msg,
      detail: { yesterday },
    });
    const push = await notifyCriticalSyncTripleFailure(
      `Verify-health watchdog crashed on ${yesterday}: ${msg}`,
    ).catch((pushErr) => ({
      ok: 0,
      failed: 0,
      log: `notify_failed: ${pushErr instanceof Error ? pushErr.message : String(pushErr)}`,
    }));

    return NextResponse.json(
      {
        ok: false,
        reason: "exception",
        error: msg,
        yesterday,
        push,
        duration_ms: Date.now() - t0,
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
