import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { syncXDASHDataLast3Days } from "@/lib/sync/xdash";
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

/**
 * Authenticate the request. Accepts either:
 *  1. Authorization: Bearer <CRON_SECRET>  (Vercel Cron injects this automatically)
 *  2. ?secret=<CRON_SECRET>                (for external services like cron-job.org)
 *
 * Returns true if authenticated, false otherwise.
 * If CRON_SECRET is not configured, auth is skipped (dev convenience).
 */
function isAuthenticated(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true; // no secret configured → allow (dev mode)

  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${cronSecret}`) return true;

  const querySecret = request.nextUrl.searchParams.get("secret");
  if (querySecret === cronSecret) return true;

  return false;
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

function jsonWithNoCache(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: NO_CACHE_HEADERS });
}

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return jsonWithNoCache({ error: "Unauthorized" }, 401);
  }

  const force = request.nextUrl.searchParams.get("force") === "true";
  const serverNow = new Date();

  console.log(
    "[auto-sync] invoked at",
    serverNow.toISOString(),
    "| Israel:",
    nowIsrael(),
    "| force:",
    force,
  );

  try {
    const [lastSync, latestDataDate] = await Promise.all([
      getLastSyncTime(),
      getLatestDataDate(),
    ]);

    const ageMs = lastSync ? serverNow.getTime() - lastSync.getTime() : Infinity;
    const todayIsrael = getTodayIsrael();
    const dataIsBehind = latestDataDate !== null && latestDataDate < todayIsrael;

    console.log(
      "[auto-sync] Current Time (Server):",
      serverNow.toISOString(),
      "| Last Sync in DB:",
      lastSync?.toISOString() ?? "none",
      "| Difference:",
      Math.round(ageMs / 60000),
      "minutes",
      "| latestDataDate:",
      latestDataDate,
      "| todayIsrael:",
      todayIsrael,
      "| dataIsBehind:",
      dataIsBehind,
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

    console.log("[auto-sync] Starting XDASH sync…");
    const xdashResult = await syncXDASHDataLast3Days();
    console.log("[auto-sync] XDASH done:", xdashResult.datesSynced, "dates,", xdashResult.rowsUpserted, "rows");

    let pairsResult = { datesRequested: 0, datesSynced: 0, rowsUpserted: 0 };
    try {
      pairsResult = await syncPartnerPairsData();
      console.log("[auto-sync] Pairs done:", pairsResult.datesSynced, "dates,", pairsResult.rowsUpserted, "rows");
    } catch (e) {
      console.error("[auto-sync] partner pairs failed:", e);
    }

    try {
      await stampLatestRow();
    } catch (e) {
      console.warn("[auto-sync] stamp failed (non-fatal):", e);
    }

    try {
      revalidatePath("/");
      console.log("[auto-sync] revalidatePath(/) called");
    } catch (e) {
      console.warn("[auto-sync] revalidatePath failed:", e);
    }

    const syncedAt = new Date().toISOString();
    console.log("[auto-sync] Done, syncedAt:", syncedAt);

    return jsonWithNoCache({
      synced: true,
      xdash: xdashResult,
      partnerPairs: pairsResult,
      syncedAt,
    });
  } catch (err) {
    console.error("[auto-sync] failed:", err);
    return jsonWithNoCache({ synced: false, error: "sync failed" }, 500);
  }
}
