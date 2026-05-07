import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { getIsraelDateDaysAgo } from "@/lib/israel-date";
import { syncXDASHDataForDates } from "@/lib/sync/xdash";
import { recordSyncRun } from "@/lib/sync-logs";
import { syncProLog } from "@/lib/sync-pro-log";

/**
 * “Golden Sync” — runs at 04:00 UTC (06:00 Israel) to lock in YESTERDAY’s final
 * `daily_home_totals` numbers before the 08:00 IL morning summary fires.
 *
 * Distinct from `/api/cron/sync` because:
 *  1. Targets a single date (`getIsraelDateDaysAgo(1)`) — no current-day intraday work.
 *  2. Forces re-fetch (`force=true`) regardless of whether a row already exists.
 *  3. Bumps `revalidateTag(financial-data)` immediately so chart + Pulse pick up the
 *     finalized numbers within seconds.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const FINANCIAL_TAG = "financial-data";

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
    detail: { date: yesterday, mode: "always_upsert", force: true },
  });

  try {
    const result = await syncXDASHDataForDates([yesterday], { force: true });

    try {
      revalidateTag(FINANCIAL_TAG, { expire: 0 });
      revalidatePath("/");
    } catch {
      /* non-fatal */
    }

    const durationMs = Date.now() - t0;
    syncProLog({
      event: "sync_pro.golden_sync.complete",
      branch_type: "totals",
      status: "ok",
      duration_ms: durationMs,
      detail: { date: yesterday, datesSynced: result.datesSynced, rowsUpserted: result.rowsUpserted },
    });
    void recordSyncRun({
      source: "cron_golden_sync",
      durationMs,
      datesSynced: result.datesSynced,
      rowsUpserted: result.rowsUpserted,
      ok: true,
      detail: { date: yesterday },
    });

    return NextResponse.json({ ok: true, date: yesterday, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const durationMs = Date.now() - t0;
    syncProLog({
      event: "sync_pro.golden_sync.failed",
      branch_type: "totals",
      status: "error",
      duration_ms: durationMs,
      message: msg,
      detail: { date: yesterday },
    });
    void recordSyncRun({
      source: "cron_golden_sync",
      durationMs,
      datesSynced: 0,
      rowsUpserted: 0,
      ok: false,
      errorMessage: msg,
      detail: { date: yesterday },
    });
    return NextResponse.json({ ok: false, date: yesterday, error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
