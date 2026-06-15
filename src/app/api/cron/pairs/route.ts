import { NextResponse, type NextRequest } from "next/server";
import { syncPartnerPairsData } from "@/lib/sync/partner-pairs";
import { recordSyncRun } from "@/lib/sync-logs";
import { syncProLog } from "@/lib/sync-pro-log";

export const dynamic = "force-dynamic";
/**
 * Dedicated partner-pairs sweep, split out of /api/cron/sync so the slow backup
 * backend (each /reports/query is ~120-210s) never has to share a 300s function
 * with the phase-1 work. `syncPartnerPairsData` is budget-aware: it stops starting
 * new dates once less than its headroom remains, so a date in flight always
 * finishes. On a warm backend it drains several missing days per run; on a cold
 * one, one per run. Skips today (always 0 via the finalized-only report endpoint).
 */
export const maxDuration = 300;

/** Deadline handed to the budget-aware sync; sits below the 300s ceiling for cleanup margin. */
const PAIRS_DEADLINE_OFFSET_MS = 290_000;

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

export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized", detail: auth.detail }, { status: 401 });
  }

  const xdashDisabled = (process.env.XDASH_DISABLED ?? "false").toLowerCase() === "true";
  const t0 = Date.now();

  syncProLog({
    event: "sync_pro.cron.pairs.start",
    branch_type: "partner_pairs_sync",
    status: "started",
    detail: { max_duration_s: 300, xdash_disabled: xdashDisabled },
  });

  if (xdashDisabled) {
    return NextResponse.json({ ok: true, skipped: "XDASH_DISABLED" });
  }

  let result: { datesRequested: number; datesSynced: number; rowsUpserted: number };
  try {
    result = await syncPartnerPairsData({ deadlineMs: t0 + PAIRS_DEADLINE_OFFSET_MS });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const durationMs = Date.now() - t0;
    syncProLog({
      event: "sync_pro.cron.pairs.complete",
      branch_type: "partner_pairs_sync",
      status: "error",
      duration_ms: durationMs,
      message: msg,
    });
    void recordSyncRun({
      source: "cron_pairs",
      durationMs,
      datesSynced: 0,
      rowsUpserted: 0,
      ok: false,
      errorMessage: msg,
      detail: { data_source: "internal_cookie" },
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  const durationMs = Date.now() - t0;
  syncProLog({
    event: "sync_pro.cron.pairs.complete",
    branch_type: "partner_pairs_sync",
    status: "ok",
    duration_ms: durationMs,
    detail: result,
  });
  void recordSyncRun({
    source: "cron_pairs",
    durationMs,
    datesSynced: result.datesSynced,
    rowsUpserted: result.rowsUpserted,
    ok: true,
    detail: { ...result, data_source: "internal_cookie" },
  });

  return NextResponse.json({ ok: true, ...result });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
