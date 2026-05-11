import { NextResponse, type NextRequest } from "next/server";
import {
  AUDIT_COMPARE_INTER_DATE_DELAY_MS,
  lastNDatesIsrael,
  runHomeTotalsAuditForDates,
} from "@/lib/sync/audit-compare-run";

/**
 * Read-only Manual Data Auditor: compares `daily_home_totals` (App DB) against
 * the live XDASH UI source (`mode: "internal"` cookie path) for the last N days.
 *
 * Unlike `/api/admin/backfill-home`, this route NEVER writes to the database.
 * It is a diagnostic to surface drift between what the dashboard renders and
 * what XDASH's UI currently reports — without touching either side.
 *
 * Query params:
 *   - `from` + `to` (YYYY-MM-DD, both required): audit only that inclusive range.
 *     When used, the span is capped at **3 calendar days** (returns 400 if wider)
 *     to stay under Vercel timeouts.
 *   - `days` (default 3): used when `from`/`to` are not both set — last N days
 *     ending today (Israel TZ).
 *   - `secret`: matches `CRON_SECRET` (or `Authorization: Bearer …`).
 *
 * Safety:
 *   - Sequential per-date fetch (no parallelism).
 *   - 500ms delay between dates so we don't hammer the XDASH backup server.
 *   - XDASH reads use `skipPartnerPerformance: true` semantics on `fetchHomeForDate`
 *     (home overview only; no partner API fan-out).
 *   - Zero `upsert` / `insert` / `update` calls anywhere in this file.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_RANGE_DAYS_FROM_TO = 3;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_DAYS = 3;
const MAX_DAYS = 60;

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

/** Inclusive UTC calendar range from `from` through `to` (YYYY-MM-DD). */
function dateRangeInclusive(from: string, to: string): string[] {
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

type ResolveDatesResult =
  | { ok: true; dates: string[]; mode: "range"; from: string; to: string }
  | { ok: true; dates: string[]; mode: "days"; days: number }
  | { ok: false; status: number; error: string; detail?: string };

function resolveAuditDates(request: NextRequest): ResolveDatesResult {
  const from = request.nextUrl.searchParams.get("from")?.trim();
  const to = request.nextUrl.searchParams.get("to")?.trim();

  if (from && to) {
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
      return {
        ok: false,
        status: 400,
        error: "Invalid from/to",
        detail: "from and to must be YYYY-MM-DD",
      };
    }
    const dates = dateRangeInclusive(from, to);
    if (dates.length === 0) {
      return {
        ok: false,
        status: 400,
        error: "Invalid range",
        detail: "from must be on or before to",
      };
    }
    if (dates.length > MAX_RANGE_DAYS_FROM_TO) {
      return {
        ok: false,
        status: 400,
        error: "Range too large",
        detail: `from/to may span at most ${MAX_RANGE_DAYS_FROM_TO} day(s) inclusive (got ${dates.length})`,
      };
    }
    return { ok: true, dates, mode: "range", from, to };
  }

  const days = parseDays(request.nextUrl.searchParams.get("days"));
  return { ok: true, dates: lastNDatesIsrael(days), mode: "days", days };
}

export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: "Unauthorized", detail: auth.detail },
      { status: 401 },
    );
  }

  const resolved = resolveAuditDates(request);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: resolved.error, detail: resolved.detail },
      { status: resolved.status },
    );
  }
  const { dates } = resolved;
  const t0 = Date.now();

  const results = await runHomeTotalsAuditForDates(dates, {
    interDateDelayMs: AUDIT_COMPARE_INTER_DATE_DELAY_MS,
  });

  const mismatches = results.filter((r) => !r.match).length;

  const meta =
    resolved.mode === "range"
      ? { date_mode: "range" as const, from: resolved.from, to: resolved.to }
      : { date_mode: "days" as const, days: resolved.days };

  return NextResponse.json({
    ok: true,
    read_only: true,
    mode: "internal",
    skipPartnerPerformance: true,
    ...meta,
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
