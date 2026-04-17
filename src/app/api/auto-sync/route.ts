import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import {
  syncXDASHDataLastNDays,
  syncXDASHDataForDates,
  syncXDASHBackfill,
} from "@/lib/sync/xdash";
import {
  syncPartnerPairsData,
  syncPartnerPairsForDate,
} from "@/lib/sync/partner-pairs";
import { syncFunnelToSupabase } from "@/lib/sync/funnel";
import { syncBillingData } from "@/lib/sync/billing";
import { checkPerformance } from "@/app/actions/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

/* ===================================================================
 *  Helpers
 * =================================================================== */

const NO_CACHE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
} as const;

const FINANCIAL_TAG = "financial-data";

function bustCaches() {
  try { revalidateTag(FINANCIAL_TAG, { expire: 0 }); } catch { /* non-fatal */ }
  try { revalidatePath("/"); } catch { /* non-fatal */ }
}

function respond(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: NO_CACHE });
}

function todayIL(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

function yesterdayIL(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validDate(s: string): boolean {
  return DATE_RE.test(s) && !Number.isNaN(new Date(s + "T12:00:00Z").getTime());
}

/**
 * Same CRON_SECRET everywhere. Prefer ?secret= (cron-job.org); fall back to
 * Authorization: Bearer (Vercel Cron sends this automatically when CRON_SECRET is set).
 */
function getReceivedSecret(request: NextRequest): string {
  const q = request.nextUrl.searchParams.get("secret");
  if (q != null && String(q).trim() !== "") return String(q).trim();
  const auth = request.headers.get("authorization") ?? "";
  return auth.replace(/^Bearer\s+/i, "").trim();
}

function checkAuth(request: NextRequest): { ok: boolean; detail?: string } {
  const expected = (process.env.CRON_SECRET ?? "").trim();
  if (!expected) return { ok: true };
  const received = getReceivedSecret(request);
  if (received === expected) return { ok: true };
  console.log(
    `[auto-sync] auth fail: received ${received.length} chars, expected ${expected.length}`,
  );
  return {
    ok: false,
    detail: `Secret mismatch (${received.length} vs ${expected.length} chars)`,
  };
}

/* ===================================================================
 *  Per-step result type
 * =================================================================== */

type Status = "success" | "failed" | "skipped";
interface StepResult {
  status: Status;
  error?: string;
  [k: string]: unknown;
}
const SKIP: StepResult = Object.freeze({ status: "skipped" });

async function runXdash(days: number, startTime?: number, force?: boolean): Promise<StepResult> {
  try {
    const r = await syncXDASHDataLastNDays(days, {
      startTime: startTime ?? Date.now(),
      timeBudgetMs: 45_000,
      force,
    });
    return { status: "success", datesSynced: r.datesSynced, rowsUpserted: r.rowsUpserted };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sync] xdash failed:", msg);
    return { status: "failed", error: msg };
  }
}

async function runPairs(dates?: string[]): Promise<StepResult> {
  try {
    const targets = dates ?? [yesterdayIL(), todayIL()];
    console.log(`[sync] runPairs: fetching ${targets.length} date(s): ${targets.join(", ")}`);
    let total = 0;
    for (const d of targets) {
      const r = await syncPartnerPairsForDate(d);
      console.log(`[sync] pairs ${d}: ${r.rowsUpserted} rows upserted`);
      total += r.rowsUpserted;
    }
    return { status: "success", dates: targets, rowsUpserted: total };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sync] pairs failed:", msg);
    return { status: "failed", error: msg };
  }
}

async function runFullPairs(): Promise<StepResult> {
  try {
    const r = await syncPartnerPairsData();
    return { status: "success", datesSynced: r.datesSynced, rowsUpserted: r.rowsUpserted };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sync] full-pairs failed:", msg);
    return { status: "failed", error: msg };
  }
}

async function runBilling(): Promise<StepResult> {
  try {
    const r = await syncBillingData();
    return { status: "success", monthsUpdated: r.monthsUpdated };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sync] billing failed:", msg);
    return { status: "failed", error: msg };
  }
}

async function runMonday(): Promise<StepResult> {
  try {
    const r = await syncFunnelToSupabase();
    if (!r.synced) return { status: "failed", error: r.error ?? "unknown" };
    return { status: "success", totalLeads: r.totalLeads, wonDeals: r.wonDeals };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sync] monday failed:", msg);
    return { status: "failed", error: msg };
  }
}

type Results = Record<string, StepResult>;

function logResult(mode: string, results: Results, t0: number, extra?: Record<string, unknown>) {
  console.log("[auto-sync] completed", JSON.stringify({
    mode,
    results,
    ...extra,
    duration: `${((Date.now() - t0) / 1000).toFixed(1)}s`,
    syncedAt: new Date().toISOString(),
  }));
}

/** Parsed query — runs inside after() so cron-job.org closes before work starts. */
type SyncParams = {
  source: string;
  target: string;
  force: boolean;
  backfill: boolean;
  daysRaw: number;
  singleDate: string;
  backfillStart: string;
  backfillEnd: string | null;
};

/**
 * Full sync logic (runs after HTTP response is sent).
 */
async function executeSync(params: SyncParams): Promise<void> {
  const t0 = Date.now();
  const {
    source, target, force, backfill, daysRaw, singleDate, backfillStart, backfillEnd,
  } = params;

  /** True when XDASH home sync wrote to `daily_home_totals` successfully. */
  let shouldCheckPerformance = false;

  try {
    if (backfill) {
      const end = backfillEnd ?? todayIL();
      console.log(`[auto-sync] BACKFILL ${backfillStart} → ${end}`);
      let xdash: StepResult;
      try {
        const r = await syncXDASHBackfill(backfillStart, end);
        xdash = { status: "success", datesSynced: r.datesSynced, rowsUpserted: r.rowsUpserted };
      } catch (e) {
        xdash = { status: "failed", error: e instanceof Error ? e.message : String(e) };
      }
      shouldCheckPerformance = xdash.status === "success";
      bustCaches();
      logResult("backfill", { xdash, pairs: SKIP, billing: SKIP, monday: SKIP }, t0, { range: { start: backfillStart, end } });
      return;
    }

    if (target === "xdash-totals") {
      const days = Number.isFinite(daysRaw) && daysRaw >= 1 ? daysRaw : 2;
      console.log(`[auto-sync] Running targeted sync: ${target} for ${days} days (force=${force}).`);
      let xdash: StepResult;
      if (singleDate && validDate(singleDate)) {
        try {
          const r = await syncXDASHDataForDates([singleDate], { force });
          xdash = { status: "success", ...r };
        } catch (e) {
          xdash = { status: "failed", error: e instanceof Error ? e.message : String(e) };
        }
      } else {
        xdash = await runXdash(days, t0, force);
      }
      shouldCheckPerformance = xdash.status === "success";
      bustCaches();
      logResult("targeted:xdash-totals", { xdash, pairs: SKIP, billing: SKIP, monday: SKIP }, t0, { days });
      return;
    }

    if (target === "partner-pairs") {
      console.log(`[auto-sync] Running targeted sync: ${target}.`);
      let pairs: StepResult;
      if (singleDate && validDate(singleDate)) {
        pairs = await runPairs([singleDate]);
      } else {
        pairs = await runFullPairs();
      }
      bustCaches();
      logResult("targeted:partner-pairs", { xdash: SKIP, pairs, billing: SKIP, monday: SKIP }, t0);
      return;
    }

    if (target === "cron-daily-pairs") {
      console.log(`[auto-sync] Running targeted sync: cron-daily-pairs for 2 days.`);
      const pairs = await runPairs();
      bustCaches();
      logResult("targeted:cron-daily-pairs", { xdash: SKIP, pairs, billing: SKIP, monday: SKIP }, t0);
      return;
    }

    if (target === "daily" || target === "billing" || target === "monday") {
      console.log(`[auto-sync] Running targeted sync: ${target}.`);
      const [billing, monday] = await Promise.all([
        target === "daily" || target === "billing" ? runBilling() : SKIP,
        target === "daily" || target === "monday" ? runMonday() : SKIP,
      ]);
      bustCaches();
      logResult(
        target === "daily" ? "daily-heavy" : `targeted:${target}`,
        { xdash: SKIP, pairs: SKIP, billing, monday },
        t0,
      );
      return;
    }

    if (source === "manual" || force) {
      const days = Number.isFinite(daysRaw) && daysRaw >= 1 ? daysRaw : 7;
      console.log(`[auto-sync] manual-recovery: ${days} days (force=${force})`);
      const xdash = await runXdash(days, t0, force);
      shouldCheckPerformance = xdash.status === "success";
      const pairs = await runPairs();
      const elapsedMs = Date.now() - t0;
      const TIME_BUDGET_MS = 45_000;
      let billing: StepResult = SKIP;
      let monday: StepResult = SKIP;
      if (elapsedMs < TIME_BUDGET_MS) {
        [billing, monday] = await Promise.all([runBilling(), runMonday()]);
      }
      bustCaches();
      logResult("manual-recovery", { xdash, pairs, billing, monday }, t0, { days });
      return;
    }

    console.warn("[auto-sync] executeSync called with no matching mode (should not happen)");
  } catch (err) {
    console.error("[auto-sync] background sync error:", err instanceof Error ? err.message : err);
  } finally {
    if (shouldCheckPerformance) {
      console.log(
        "[auto-sync] daily_home_totals sync finished successfully — running checkPerformance()",
      );
      try {
        const r = await checkPerformance();
        console.log("[auto-sync] checkPerformance completed:", r.log);
      } catch (e) {
        console.error(
          "[auto-sync] checkPerformance failed:",
          e instanceof Error ? e.message : e,
        );
      }
    }
  }
}

function hasValidSyncIntent(sp: URLSearchParams): boolean {
  if (sp.get("backfill") === "true") return true;
  const t = sp.get("target") ?? "";
  if (["xdash-totals", "partner-pairs", "cron-daily-pairs", "daily", "billing", "monday"].includes(t)) {
    return true;
  }
  if (sp.get("force") === "true") return true;
  if (sp.get("source") === "manual") return true;
  return false;
}

/* ===================================================================
 *  GET — auth, then after() for work; response returns immediately.
 * =================================================================== */

export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth.ok) {
    return respond({ error: "Secret mismatch", detail: auth.detail }, 401);
  }

  const sp = request.nextUrl.searchParams;

  if (!hasValidSyncIntent(sp)) {
    return respond(
      {
        accepted: false,
        error: "Missing target. Use ?target=xdash-totals, ?target=cron-daily-pairs, ?target=partner-pairs, ?target=daily|billing|monday, or ?backfill=true",
      },
      400,
    );
  }

  const params: SyncParams = {
    source: sp.get("source") ?? "",
    target: sp.get("target") ?? "",
    force: sp.get("force") === "true",
    backfill: sp.get("backfill") === "true",
    daysRaw: parseInt(sp.get("days") ?? "", 10),
    singleDate: sp.get("singleDate") ?? "",
    backfillStart: sp.get("start") ?? "2026-01-01",
    backfillEnd: sp.get("end"),
  };

  console.log(
    `[auto-sync] accepted (background): source=${params.source} target=${params.target} backfill=${params.backfill}`,
  );

  after(async () => {
    await executeSync(params);
  });

  return respond({
    accepted: true,
    message: "Sync started in background",
    mode: params.backfill
      ? "backfill"
      : params.target || (params.force || params.source === "manual" ? "manual-recovery" : "unknown"),
  });
}
