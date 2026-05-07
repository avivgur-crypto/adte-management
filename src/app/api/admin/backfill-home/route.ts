import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { syncXDASHDataForDates } from "@/lib/sync/xdash";
import { syncProLog } from "@/lib/sync-pro-log";

/**
 * One-shot backfill endpoint for `daily_home_totals`.
 *
 * Usage (production):
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://<app>/api/admin/backfill-home?dates=2026-05-05,2026-05-06,2026-05-07"
 *
 * Defaults to May 5/6/7 if `dates` is omitted (matching the recovery task).
 * Forces re-fetch from XDASH; safe to re-run.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const FINANCIAL_TAG = "financial-data";
const DEFAULT_DATES = ["2026-05-05", "2026-05-06", "2026-05-07"];
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

function parseDates(raw: string | null): string[] {
  if (!raw) return DEFAULT_DATES;
  const list = raw
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((d) => ISO_DATE.test(d));
  return list.length > 0 ? list : DEFAULT_DATES;
}

export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized", detail: auth.detail }, { status: 401 });
  }

  const dates = parseDates(request.nextUrl.searchParams.get("dates"));
  const t0 = Date.now();

  syncProLog({
    event: "sync_pro.admin_backfill.start",
    branch_type: "totals",
    status: "started",
    detail: { dates, force: true },
  });

  try {
    const result = await syncXDASHDataForDates(dates, { force: true });

    try {
      revalidateTag(FINANCIAL_TAG, { expire: 0 });
      revalidatePath("/");
    } catch {
      /* non-fatal */
    }

    const durationMs = Date.now() - t0;
    syncProLog({
      event: "sync_pro.admin_backfill.complete",
      branch_type: "totals",
      status: "ok",
      duration_ms: durationMs,
      detail: { dates, datesSynced: result.datesSynced, rowsUpserted: result.rowsUpserted },
    });
    return NextResponse.json({ ok: true, dates, ...result, duration_ms: durationMs });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const durationMs = Date.now() - t0;
    syncProLog({
      event: "sync_pro.admin_backfill.failed",
      branch_type: "totals",
      status: "error",
      duration_ms: durationMs,
      message: msg,
      detail: { dates },
    });
    return NextResponse.json({ ok: false, dates, error: msg, duration_ms: durationMs }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
