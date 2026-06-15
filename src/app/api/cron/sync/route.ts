import { NextResponse, type NextRequest } from "next/server";
import { syncBillingData } from "@/lib/sync/billing";
import { syncMondayData } from "@/lib/sync/monday";
import { syncPnlData } from "@/lib/sync/pnl";
import { recordSyncRun } from "@/lib/sync-logs";
import { syncProLog } from "@/lib/sync-pro-log";

export const dynamic = "force-dynamic";
/**
 * Light half-hourly sweep: Monday + billing + P&L only. These run in parallel and
 * finish well under Vercel's 300s ceiling.
 *
 * The heavy XDASH work was split out to avoid 300s timeouts: the backup backend
 * answers each query in ~120-210s, so chaining phase-1 here with XDASH totals +
 * partner-pairs in ONE function overran 300s. XDASH totals now come from the
 * interactive `refreshTodayHome` (every page load) + the nightly full auto-sync,
 * and partner-pairs from the dedicated, budget-aware `/api/cron/pairs`.
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
    errors: string[];
  } = { errors: [] };

  const t0 = Date.now();
  syncProLog({
    event: "sync_pro.cron.start",
    branch_type: "full_cron",
    status: "started",
    message: "cron/sync: phase1 monday+billing+pnl only; XDASH totals via refreshTodayHome + nightly, pairs via /api/cron/pairs",
    detail: { max_duration_s: 300 },
  });

  const [mondayResult, billingResult, pnlResult] = await Promise.allSettled([
    syncMondayData(),
    syncBillingData(),
    syncPnlData(),
  ]);

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

  const ok = summary.errors.length === 0;
  const durationMs = Date.now() - t0;

  const rowsUpserted =
    (summary.pnl?.rowsUpserted ?? 0) +
    (summary.monday?.funnelRows ?? 0) +
    (summary.monday?.activityRows ?? 0);

  syncProLog({
    event: "sync_pro.cron.complete",
    branch_type: "full_cron",
    status: ok ? "ok" : "error",
    duration_ms: durationMs,
    detail: { rowsUpserted, error_count: summary.errors.length },
  });

  void recordSyncRun({
    source: "cron_sync",
    durationMs,
    datesSynced: 0,
    rowsUpserted,
    ok,
    errorMessage: summary.errors[0],
    detail: { ...summary, data_source: "internal_cookie" },
  });

  return NextResponse.json({ ok, summary }, { status: ok ? 200 : 500 });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
