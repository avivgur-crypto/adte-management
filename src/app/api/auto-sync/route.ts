import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { syncXDASHDataLastNDays, syncXDASHBackfill } from "@/lib/sync/xdash";
import { syncPartnerPairsData } from "@/lib/sync/partner-pairs";
import { syncFunnelToSupabase } from "@/lib/sync/funnel";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const BACKFILL_START = "2026-01-01";

function jsonWithNoCache(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: NO_CACHE_HEADERS });
}

function extractSecret(request: NextRequest): { raw: string; trimmed: string } {
  const fromQuery = request.nextUrl.searchParams.get("secret") ?? "";
  if (fromQuery) return { raw: fromQuery, trimmed: fromQuery.trim() };

  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "");
  return { raw: bearer, trimmed: bearer.trim() };
}

function checkAuth(request: NextRequest): { ok: boolean; detail?: string } {
  const envRaw = process.env.CRON_SECRET ?? "";
  const expected = envRaw.trim();

  if (!expected) return { ok: true, detail: "CRON_SECRET not configured — auth skipped" };

  const { trimmed: received } = extractSecret(request);

  console.log(`[auto-sync] Auth debug — URL: ${request.nextUrl.pathname}${request.nextUrl.search}`);
  console.log(`[auto-sync] Auth debug — searchParams keys: [${[...request.nextUrl.searchParams.keys()].join(", ")}]`);
  console.log(`[auto-sync] Auth debug — Authorization header present: ${!!request.headers.get("authorization")}`);
  console.log(
    `[auto-sync] Auth check: received (${received.length} chars) vs expected (${expected.length} chars)`,
  );

  if (received === expected) return { ok: true };

  return {
    ok: false,
    detail: `Secret mismatch: received ${received.length} chars, expected ${expected.length} chars. URL: ${request.nextUrl.pathname}${request.nextUrl.search}`,
  };
}

function getTodayIsrael(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

function nowIsrael(): string {
  return new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" });
}

async function getLastSyncTime(): Promise<Date | null> {
  const { data: homeRow } = await supabaseAdmin
    .from("daily_home_totals")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (homeRow?.created_at) return new Date(homeRow.created_at);

  const { data } = await supabaseAdmin
    .from("daily_partner_performance")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return data?.created_at ? new Date(data.created_at) : null;
}

async function getLatestDataDate(): Promise<string | null> {
  const { data: homeRow } = await supabaseAdmin
    .from("daily_home_totals")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .single();
  if (homeRow?.date) return String(homeRow.date).slice(0, 10);

  const { data } = await supabaseAdmin
    .from("daily_partner_performance")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .single();
  return data?.date ? String(data.date).slice(0, 10) : null;
}

async function stampLatestRow(): Promise<void> {
  const now = new Date().toISOString();

  const { data: homeRow } = await supabaseAdmin
    .from("daily_home_totals")
    .select("date")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (homeRow) {
    const { error } = await supabaseAdmin
      .from("daily_home_totals")
      .update({ created_at: now })
      .eq("date", homeRow.date);
    if (error) console.warn("[auto-sync] home stamp failed:", error.message);
    else { console.log("[auto-sync] Stamped created_at on daily_home_totals"); return; }
  }

  const { data: row } = await supabaseAdmin
    .from("daily_partner_performance")
    .select("date, partner_name, partner_type")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!row) return;

  const { error } = await supabaseAdmin
    .from("daily_partner_performance")
    .update({ created_at: now })
    .eq("date", row.date)
    .eq("partner_name", row.partner_name)
    .eq("partner_type", row.partner_type);

  if (error) console.warn("[auto-sync] partner stamp failed:", error.message);
  else console.log("[auto-sync] Stamped created_at on partner row");
}

export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth.ok) {
    return jsonWithNoCache({ error: "Secret mismatch", detail: auth.detail }, 401);
  }

  const force = request.nextUrl.searchParams.get("force") === "true";
  const full = request.nextUrl.searchParams.get("full") === "true";
  const backfill = request.nextUrl.searchParams.get("backfill") === "true";
  const source = request.nextUrl.searchParams.get("source") ?? "";
  const isCron = source === "cron";
  const daysParam = parseInt(request.nextUrl.searchParams.get("days") ?? "", 10);
  const days = isCron
    ? Math.min(Number.isFinite(daysParam) && daysParam >= 1 ? daysParam : 2, 2)
    : (Number.isFinite(daysParam) && daysParam >= 1 ? daysParam : 2);
  const serverNow = new Date();

  console.log(
    "[auto-sync] invoked at",
    serverNow.toISOString(),
    "| Israel:",
    nowIsrael(),
    "| force:", force,
    "| full:", full,
    "| backfill:", backfill,
    "| source:", source,
    "| target:", target || "(all)",
    "| isCron:", isCron,
    "| days:", days,
  );

  const target = request.nextUrl.searchParams.get("target") ?? "";

  try {
    // ── BACKFILL MODE: re-fetch a date range (defaults to 2026-01-01 → today) ──
    if (backfill) {
      const startDate = request.nextUrl.searchParams.get("start") ?? BACKFILL_START;
      const endDate = request.nextUrl.searchParams.get("end") ?? getTodayIsrael();
      console.log(`[auto-sync] BACKFILL MODE: ${startDate} → ${endDate}`);
      const xdashResult = await syncXDASHBackfill(startDate, endDate);
      console.log("[auto-sync] Backfill done:", xdashResult.datesSynced, "dates,", xdashResult.rowsUpserted, "rows");

      try { await stampLatestRow(); } catch (e) { console.warn("[auto-sync] stamp failed:", e); }
      try { revalidatePath("/"); } catch (e) { console.warn("[auto-sync] revalidate failed:", e); }

      return jsonWithNoCache({
        synced: true,
        mode: "backfill",
        range: { start: startDate, end: endDate },
        xdash: xdashResult,
        syncedAt: new Date().toISOString(),
      });
    }

    // ── TARGETED MODE: run only the requested subsystem ──
    if (target === "xdash") {
      console.log(`[auto-sync] TARGETED xdash: ${days}-day sync + partner pairs`);
      const xdashResult = await syncXDASHDataLastNDays(days);
      console.log("[auto-sync] XDASH done:", xdashResult.datesSynced, "dates,", xdashResult.rowsUpserted, "rows");

      let pairsResult = { datesRequested: 0, datesSynced: 0, rowsUpserted: 0 };
      try {
        pairsResult = await syncPartnerPairsData();
        console.log("[auto-sync] Pairs done:", pairsResult.datesSynced, "dates,", pairsResult.rowsUpserted, "rows");
      } catch (e) {
        console.error("[auto-sync] partner pairs failed:", e);
      }

      try { await stampLatestRow(); } catch (e) { console.warn("[auto-sync] stamp failed:", e); }
      try { revalidatePath("/"); } catch (e) { console.warn("[auto-sync] revalidate failed:", e); }

      const syncedAt = new Date().toISOString();
      return jsonWithNoCache({
        synced: true,
        mode: `xdash ${days}-day + partners`,
        target: "xdash",
        days,
        xdash: xdashResult,
        partnerPairs: pairsResult,
        syncedAt,
      });
    }

    if (target === "monday") {
      console.log("[auto-sync] TARGETED monday: funnel sync only");
      const funnelResult = await syncFunnelToSupabase();
      console.log("[auto-sync] Funnel done:", funnelResult.synced ? "ok" : `failed: ${funnelResult.error ?? "unknown"}`);

      try { revalidatePath("/"); } catch (e) { console.warn("[auto-sync] revalidate failed:", e); }

      const syncedAt = new Date().toISOString();
      return jsonWithNoCache({
        synced: funnelResult.synced,
        mode: "monday funnel",
        target: "monday",
        funnel: funnelResult,
        syncedAt: funnelResult.synced ? syncedAt : undefined,
        ...(funnelResult.error && { error: funnelResult.error }),
      });
    }

    // ── NORMAL MODE: staleness check ──
    const [lastSync, latestDataDate] = await Promise.all([
      getLastSyncTime(),
      getLatestDataDate(),
    ]);

    const ageMs = lastSync ? serverNow.getTime() - lastSync.getTime() : Infinity;
    const todayIsrael = getTodayIsrael();
    const dataIsBehind = latestDataDate !== null && latestDataDate < todayIsrael;

    console.log(
      "[auto-sync]",
      "lastSync:", lastSync?.toISOString() ?? "none",
      "| age:", Math.round(ageMs / 60000), "min",
      "| latestData:", latestDataDate,
      "| today:", todayIsrael,
      "| behind:", dataIsBehind,
    );

    if (!force && ageMs < STALE_THRESHOLD_MS && !dataIsBehind) {
      console.log("[auto-sync] Skipping — data is fresh");
      return jsonWithNoCache({
        synced: false,
        reason: "fresh",
        ageMinutes: Math.round(ageMs / 60000),
        lastSync: lastSync?.toISOString(),
        syncedAt: lastSync?.toISOString() ?? null,
      });
    }

    // ── XDASH + Funnel sync ──
    let xdashResult;
    let funnelResult: { synced: boolean; error?: string; totalLeads?: number; wonDeals?: number } =
      { synced: false, error: "skipped (cron fast path)" };

    if (isCron) {
      console.log(`[auto-sync] CRON fast path: ${days}-day XDASH only (skipping funnel to stay under 10s)`);
      xdashResult = await syncXDASHDataLastNDays(days);
    } else {
      console.log(`[auto-sync] Starting XDASH ${days}-day sync + funnel sync…`);
      const [xdash, funnel] = await Promise.all([
        syncXDASHDataLastNDays(days),
        syncFunnelToSupabase().catch((e) => {
          console.error("[auto-sync] funnel sync failed:", e);
          return { synced: false, error: String(e) };
        }),
      ]);
      xdashResult = xdash;
      funnelResult = funnel;
    }
    console.log("[auto-sync] XDASH done:", xdashResult.datesSynced, "dates,", xdashResult.rowsUpserted, "rows");
    if (!isCron) {
      console.log("[auto-sync] Funnel done:", funnelResult.synced ? "ok" : `failed: ${funnelResult.error ?? "unknown"}`);
    }

    let pairsResult = { datesRequested: 0, datesSynced: 0, rowsUpserted: 0 };
    if (full && !isCron) {
      try {
        pairsResult = await syncPartnerPairsData();
        console.log("[auto-sync] Pairs done:", pairsResult.datesSynced, "dates,", pairsResult.rowsUpserted, "rows");
      } catch (e) {
        console.error("[auto-sync] partner pairs failed:", e);
      }
    }

    try { await stampLatestRow(); } catch (e) { console.warn("[auto-sync] stamp failed:", e); }
    try { revalidatePath("/"); } catch (e) { console.warn("[auto-sync] revalidate failed:", e); }

    const syncedAt = new Date().toISOString();
    console.log("[auto-sync] Done, syncedAt:", syncedAt);

    return jsonWithNoCache({
      synced: true,
      mode: isCron
        ? `${days}-day home sync (cron fast path)`
        : `${days}-day home sync + funnel${full ? " + partners" : ""}`,
      days,
      xdash: xdashResult,
      funnel: funnelResult,
      partnerPairs: pairsResult,
      syncedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[auto-sync] FATAL:", message, err);
    return jsonWithNoCache(
      { synced: false, error: "sync failed", detail: message },
      500,
    );
  }
}
