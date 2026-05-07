import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { syncBillingData } from "@/lib/sync/billing";
import { syncMondayData } from "@/lib/sync/monday";
import { syncPartnerPairsData } from "@/lib/sync/partner-pairs";
import { syncPnlData } from "@/lib/sync/pnl";
import { syncXDASHData } from "@/lib/sync/xdash";
import {
  checkPerformance,
  notifyCriticalSyncTripleFailure,
} from "@/app/actions/notifications";
import { recordSyncRun } from "@/lib/sync-logs";
import { applyXdashTotalsCronHealth } from "@/lib/sync-health";
import { syncProLog } from "@/lib/sync-pro-log";

const FINANCIAL_TAG = "financial-data";
/** Secondary tag (optional); safe no-op if no cache entry uses it — requested for home totals busting. */
const HOME_TOTALS_TAG = "home-totals";

export const dynamic = "force-dynamic";
/**
 * Cron-only daily sweep. Vercel Pro caps cron functions at 300s; we keep that ceiling
 * because this route runs full-month catch-ups for every source, not the snappy
 * 60s interactive path.
 */
export const maxDuration = 300;

function getReceivedSecret(request: NextRequest): string {
  const q = request.nextUrl.searchParams.get("secret");
  if (q != null && String(q).trim() !== "") return String(q).trim();
  const auth = request.headers.get("authorization") ?? "";
  return auth.replace(/^Bearer\s+/i, "").trim();
}

function checkAuth(request: NextRequest): { ok: boolean; detail?: string } {
  const expected = (process.env.CRON_SECRET ?? "").trim();
  if (!expected) {
    console.log("[cron/sync] CRON_SECRET not set — rejecting request");
    return { ok: false, detail: "CRON_SECRET not configured" };
  }
  const received = getReceivedSecret(request);
  if (received === expected) return { ok: true };
  console.log(
    `[cron/sync] auth fail: received ${received.length} chars, expected ${expected.length} chars`,
  );
  return {
    ok: false,
    detail: `Secret mismatch (${received.length} vs ${expected.length} chars)`,
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

  const summary: {
    monday?: { funnelRows: number; activityRows: number };
    billing?: { monthsUpdated: number };
    pnl?: { rowsUpserted: number; entities: string[] };
    xdash?: { datesSynced: number; rowsUpserted: number };
    partnerPairs?: { datesRequested: number; datesSynced: number; rowsUpserted: number };
    errors: string[];
  } = { errors: [] };

  const xdashDisabled = (process.env.XDASH_DISABLED ?? "false").toLowerCase() === "true";

  const t0 = Date.now();
  syncProLog({
    event: "sync_pro.cron.start",
    branch_type: "full_cron",
    status: "started",
    message: "cron/sync: phase1 monday+billing+pnl; phase2 xdash totals || partner-pairs",
    detail: { max_duration_s: 300, xdash_disabled: xdashDisabled },
  });

  const phase1T0 = Date.now();
  const [mondayResult, billingResult, pnlResult] = await Promise.allSettled([
    syncMondayData(),
    syncBillingData(),
    syncPnlData(),
  ]);
  syncProLog({
    event: "sync_pro.cron.phase1_done",
    branch_type: "phase1",
    status:
      mondayResult.status === "fulfilled" &&
      billingResult.status === "fulfilled" &&
      pnlResult.status === "fulfilled"
        ? "ok"
        : "error",
    duration_ms: Date.now() - phase1T0,
    detail: {
      monday: mondayResult.status,
      billing: billingResult.status,
      pnl: pnlResult.status,
    },
  });

  // Phase 2: XDASH home/partner-performance totals vs partner-pairs — same wall-clock window, different tables
  // (`daily_home_totals` / `hourly_snapshots` vs `daily_partner_pairs`). Start both immediately; await totals
  // first so checkPerformance + cache bust run without waiting on the heavy pairs crawl.
  // Start totals first so the critical path is scheduled immediately; partners runs concurrently.
  const totalsFuture = (async () => {
    const b0 = Date.now();
    syncProLog({
      event: "sync_pro.cron.branch.totals",
      branch_type: "totals",
      status: "started",
    });
    try {
      if (xdashDisabled) {
        syncProLog({
          event: "sync_pro.cron.branch.totals",
          branch_type: "totals",
          status: "ok",
          duration_ms: Date.now() - b0,
          detail: { skipped: true, reason: "XDASH_DISABLED" },
        });
        return { datesSynced: 0, rowsUpserted: 0 };
      }
      const value = await syncXDASHData();
      syncProLog({
        event: "sync_pro.cron.branch.totals",
        branch_type: "totals",
        status: "ok",
        duration_ms: Date.now() - b0,
        detail: { datesSynced: value.datesSynced, rowsUpserted: value.rowsUpserted },
      });
      return value;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      syncProLog({
        event: "sync_pro.cron.branch.totals",
        branch_type: "totals",
        status: "error",
        duration_ms: Date.now() - b0,
        message: msg,
      });
      throw e;
    }
  })();

  const partnersFuture = (async () => {
    const b0 = Date.now();
    syncProLog({
      event: "sync_pro.cron.branch.partners",
      branch_type: "partners",
      status: "started",
    });
    try {
      if (xdashDisabled) {
        syncProLog({
          event: "sync_pro.cron.branch.partners",
          branch_type: "partners",
          status: "ok",
          duration_ms: Date.now() - b0,
          detail: { skipped: true, reason: "XDASH_DISABLED" },
        });
        return { datesRequested: 0, datesSynced: 0, rowsUpserted: 0 };
      }
      const value = await syncPartnerPairsData();
      syncProLog({
        event: "sync_pro.cron.branch.partners",
        branch_type: "partners",
        status: "ok",
        duration_ms: Date.now() - b0,
        detail: {
          datesRequested: value.datesRequested,
          datesSynced: value.datesSynced,
          rowsUpserted: value.rowsUpserted,
        },
      });
      return value;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      syncProLog({
        event: "sync_pro.cron.branch.partners",
        branch_type: "partners",
        status: "error",
        duration_ms: Date.now() - b0,
        message: msg,
      });
      throw e;
    }
  })();

  const [totalsSettled] = await Promise.allSettled([totalsFuture]);
  const xdashResult =
    totalsSettled.status === "fulfilled"
      ? ({ status: "fulfilled" as const, value: totalsSettled.value })
      : ({ status: "rejected" as const, reason: totalsSettled.reason });

  function maskReason(label: string, reason: unknown): string {
    const raw = reason instanceof Error ? reason.message : String(reason);
    syncProLog({
      event: "sync_pro.cron.step_error",
      branch_type: "full_cron",
      status: "error",
      message: `${label} failed`,
      detail: { label, raw: process.env.NODE_ENV === "production" ? undefined : raw },
    });
    if (process.env.NODE_ENV === "production") return `${label}: sync failed`;
    return `${label}: ${raw}`;
  }

  if (mondayResult.status === "fulfilled") {
    summary.monday = mondayResult.value;
  } else {
    summary.errors.push(maskReason("Monday", mondayResult.reason));
  }

  if (billingResult.status === "fulfilled") {
    summary.billing = billingResult.value;
  } else {
    summary.errors.push(maskReason("Billing", billingResult.reason));
  }

  if (pnlResult.status === "fulfilled") {
    summary.pnl = pnlResult.value;
  } else {
    summary.errors.push(maskReason("P&L", pnlResult.reason));
  }

  if (xdashResult.status === "fulfilled") {
    summary.xdash = xdashResult.value;
  } else {
    summary.errors.push(maskReason("XDASH", xdashResult.reason));
  }

  if (!xdashDisabled) {
    const health = await applyXdashTotalsCronHealth(xdashResult.status === "fulfilled");
    syncProLog({
      event: "sync_pro.cron.sync_health",
      branch_type: "sync_health",
      status: "ok",
      detail: {
        consecutiveFailures: health.consecutiveFailures,
        triple_failure_alert: health.shouldAlertTripleFailure,
      },
    });
    if (health.shouldAlertTripleFailure) {
      const hint =
        xdashResult.status === "rejected"
          ? xdashResult.reason instanceof Error
            ? xdashResult.reason.message
            : String(xdashResult.reason)
          : "";
      void notifyCriticalSyncTripleFailure(hint).then((r) =>
        syncProLog({
          event: "sync_pro.cron.critical_push",
          branch_type: "sync_health",
          status: r.ok > 0 ? "ok" : "error",
          detail: { deliveries_ok: r.ok, failed: r.failed, log: r.log },
        }),
      );
    }
  }

  // As soon as totals land: goal/margin alerts + bust financial caches so Home reflects revenue/profit
  // even while the partner-pairs branch may still be running.
  if (!xdashDisabled && xdashResult.status === "fulfilled") {
    try {
      const perf = await checkPerformance();
      syncProLog({
        event: "sync_pro.cron.check_performance",
        branch_type: "totals",
        status: "ok",
        detail: { log: perf.log },
      });
    } catch (e) {
      syncProLog({
        event: "sync_pro.cron.check_performance",
        branch_type: "totals",
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
    try {
      revalidateTag(FINANCIAL_TAG, { expire: 0 });
      revalidateTag(HOME_TOTALS_TAG, { expire: 0 });
      revalidatePath("/");
    } catch {
      /* non-fatal */
    }
  }

  const [partnersSettled] = await Promise.allSettled([partnersFuture]);
  const partnerPairsResult =
    partnersSettled.status === "fulfilled"
      ? ({ status: "fulfilled" as const, value: partnersSettled.value })
      : ({ status: "rejected" as const, reason: partnersSettled.reason });

  if (partnerPairsResult.status === "fulfilled") {
    summary.partnerPairs = partnerPairsResult.value;
  } else {
    summary.errors.push(maskReason("Partner pairs", partnerPairsResult.reason));
  }

  const ok = summary.errors.length === 0;
  const durationMs = Date.now() - t0;

  const datesSynced = (summary.xdash?.datesSynced ?? 0) + (summary.partnerPairs?.datesSynced ?? 0);
  const rowsUpserted =
    (summary.xdash?.rowsUpserted ?? 0) +
    (summary.partnerPairs?.rowsUpserted ?? 0) +
    (summary.pnl?.rowsUpserted ?? 0) +
    (summary.monday?.funnelRows ?? 0) +
    (summary.monday?.activityRows ?? 0);

  const phase1Ok =
    mondayResult.status === "fulfilled" &&
    billingResult.status === "fulfilled" &&
    pnlResult.status === "fulfilled";
  const totalsBranchOk = xdashDisabled || xdashResult.status === "fulfilled";
  /** Partners failing must not fail the cron HTTP status once money totals are in (monitoring / Vercel dashboard). */
  const httpOk = phase1Ok && totalsBranchOk;

  syncProLog({
    event: "sync_pro.cron.complete",
    branch_type: "full_cron",
    status: ok ? "ok" : "error",
    duration_ms: durationMs,
    detail: {
      datesSynced,
      rowsUpserted,
      error_count: summary.errors.length,
      http_ok: httpOk,
    },
  });

  void recordSyncRun({
    source: "cron_sync",
    durationMs,
    datesSynced,
    rowsUpserted,
    ok,
    errorMessage: summary.errors[0],
    detail: { ...summary, data_source: "internal_cookie" },
  });

  return NextResponse.json({ ok, summary }, { status: httpOk ? 200 : 500 });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
