import { NextResponse, type NextRequest } from "next/server";
import { runHomeTotalsAuditLastNDays } from "@/lib/sync/audit-compare-run";
import { syncXDASHDataForDates } from "@/lib/sync/xdash";
import { syncProLog } from "@/lib/sync-pro-log";

/**
 * Automated daily reconciliation: same comparison as `/api/admin/audit-compare`
 * for the last 2 Israel-calendar days, then optional repair via
 * `syncXDASHDataForDates` (equivalent to backfill-home with `force: true` for
 * that date) when the app is materially under XDASH.
 *
 * Auth: `CRON_SECRET` via `?secret=` or `Authorization: Bearer …`.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const AUDIT_DAYS = 2;
/** App is under XDASH by more than this ratio → pull missing totals (Case A). */
const REPAIR_THRESHOLD = 1.02;
/** XDASH looks like a partial fetch vs DB → alert only, no overwrite (Case B). */
const SUSPECT_THRESHOLD = 0.85;

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
    return NextResponse.json(
      { error: "Unauthorized", detail: auth.detail },
      { status: 401 },
    );
  }

  const t0 = Date.now();
  syncProLog({
    event: "sync_pro.self_heal.start",
    branch_type: "self_heal",
    status: "started",
    detail: { audit_days: AUDIT_DAYS },
  });

  const { dates, results } = await runHomeTotalsAuditLastNDays(AUDIT_DAYS);

  const repairs: Array<{ date: string; app_rev: number; xdash_rev: number }> = [];
  const suspects: Array<{ date: string; app_rev: number; xdash_rev: number }> = [];
  const skipped: Array<{ date: string; reason: string }> = [];

  for (const row of results) {
    if (row.match) continue;

    const appRev = row.app?.rev ?? 0;
    const xRev = row.xdash?.rev ?? 0;

    if (row.error || row.xdash == null) {
      skipped.push({ date: row.date, reason: row.error ?? "missing xdash row" });
      syncProLog({
        event: "sync_pro.self_heal.audit_row_error",
        branch_type: "self_heal",
        status: "error",
        message: `Audit row unusable for ${row.date}: ${row.error ?? "no xdash"}`,
        detail: { date: row.date, error: row.error },
      });
      continue;
    }

    // Case A: XDASH materially higher than app (missing / stale data in DB).
    if (xRev > appRev * REPAIR_THRESHOLD) {
      try {
        const result = await syncXDASHDataForDates([row.date], {
          force: true,
          mode: "internal",
          skipHourlySnapshots: true,
          skipPartnerPerformance: true,
        });
        repairs.push({ date: row.date, app_rev: appRev, xdash_rev: xRev });
        syncProLog({
          event: "sync_pro.self_heal.repaired",
          branch_type: "self_heal",
          status: "ok",
          message: `Auto-repair: backfilled ${row.date} (app rev ${appRev} → XDASH ${xRev})`,
          detail: {
            date: row.date,
            app_revenue: appRev,
            xdash_revenue: xRev,
            ratio: appRev > 0 ? xRev / appRev : null,
            sync: result,
          },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        syncProLog({
          event: "sync_pro.self_heal.repair_failed",
          branch_type: "self_heal",
          status: "error",
          message: `Auto-repair failed for ${row.date}: ${msg}`,
          detail: { date: row.date, app_revenue: appRev, xdash_revenue: xRev },
        });
        skipped.push({ date: row.date, reason: `repair_failed: ${msg}` });
      }
      continue;
    }

    // Case B: XDASH much lower than app — likely partial XDASH response; never overwrite.
    if (row.app != null && appRev > 0 && xRev < appRev * SUSPECT_THRESHOLD) {
      suspects.push({ date: row.date, app_rev: appRev, xdash_rev: xRev });
      syncProLog({
        event: "sync_pro.self_heal.suspect_partial_xdash",
        branch_type: "self_heal",
        status: "error",
        message: `Possible XDASH partial data detected for ${row.date}`,
        detail: {
          date: row.date,
          app_revenue: appRev,
          xdash_revenue: xRev,
          ratio: xRev / appRev,
          threshold: SUSPECT_THRESHOLD,
          hint: "No overwrite — verify manually with /api/admin/audit-compare",
        },
      });
      continue;
    }

    skipped.push({
      date: row.date,
      reason: "mismatch_outside_auto_rules",
    });
  }

  const durationMs = Date.now() - t0;
  syncProLog({
    event: "sync_pro.self_heal.complete",
    branch_type: "self_heal",
    status: suspects.length > 0 ? "error" : "ok",
    duration_ms: durationMs,
    detail: {
      dates,
      checked: results.length,
      repairs: repairs.length,
      suspects: suspects.length,
      skipped: skipped.length,
      repair_dates: repairs.map((r) => r.date),
      suspect_dates: suspects.map((s) => s.date),
    },
  });

  return NextResponse.json({
    ok: true,
    dates,
    checked: results.length,
    repairs,
    suspects,
    skipped,
    duration_ms: durationMs,
    results,
  });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
