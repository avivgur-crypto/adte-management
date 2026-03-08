import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { syncXDASHDataLast7Days, syncXDASHBackfill } from "@/lib/sync/xdash";
import { syncPartnerPairsData } from "@/lib/sync/partner-pairs";

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

  const { raw, trimmed: received } = extractSecret(request);

  console.log(`Auth check: received [${raw}] vs expected [${envRaw}]`);
  console.log(
    `Auth check (trimmed): received [${received}] (${received.length} chars) vs expected [${expected}] (${expected.length} chars)`,
  );

  if (received === expected) return { ok: true };

  return {
    ok: false,
    detail: `Secret mismatch: received ${received.length} chars, expected ${expected.length} chars`,
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
  const serverNow = new Date();

  console.log(
    "[auto-sync] invoked at",
    serverNow.toISOString(),
    "| Israel:",
    nowIsrael(),
    "| force:", force,
    "| full:", full,
    "| backfill:", backfill,
  );

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

    // ── XDASH: always re-fetch last 7 days (covers XDASH retroactive adjustments) ──
    console.log("[auto-sync] Starting XDASH 7-day sync…");
    const xdashResult = await syncXDASHDataLast7Days();
    console.log("[auto-sync] XDASH done:", xdashResult.datesSynced, "dates,", xdashResult.rowsUpserted, "rows");

    // Partner pairs: skipped on force (fast path for cron-job.org)
    let pairsResult = { datesRequested: 0, datesSynced: 0, rowsUpserted: 0 };
    if (!force || full) {
      try {
        pairsResult = await syncPartnerPairsData();
        console.log("[auto-sync] Pairs done:", pairsResult.datesSynced, "dates,", pairsResult.rowsUpserted, "rows");
      } catch (e) {
        console.error("[auto-sync] partner pairs failed:", e);
      }
    } else {
      console.log("[auto-sync] Skipping partner pairs (force=true fast path)");
    }

    try { await stampLatestRow(); } catch (e) { console.warn("[auto-sync] stamp failed:", e); }
    try { revalidatePath("/"); } catch (e) { console.warn("[auto-sync] revalidate failed:", e); }

    const syncedAt = new Date().toISOString();
    console.log("[auto-sync] Done, syncedAt:", syncedAt);

    return jsonWithNoCache({
      synced: true,
      mode: force && !full ? "fast (home + 7 days)" : "full (home + 7 days + partners)",
      xdash: xdashResult,
      partnerPairs: pairsResult,
      syncedAt,
    });
  } catch (err) {
    console.error("[auto-sync] failed:", err);
    return jsonWithNoCache({ synced: false, error: "sync failed" }, 500);
  }
}
