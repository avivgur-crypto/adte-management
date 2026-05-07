import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

/**
 * Lightweight endpoint — latest `created_at` from DB plus the data source the
 * most recent sync run used (`internal_cookie` for UI parity, `external_api`
 * for legacy/historical paths).
 *
 * Response shape (back-compat: `syncedAt` is still the primary field):
 *   {
 *     syncedAt: string | null,
 *     dataSource: "internal_cookie" | "external_api" | "unknown",
 *     lastRunOk: boolean | null,
 *     authExpired: boolean,           // true if last_sync run hit sync_pro.internal_sync.auth_expired
 *     errorSummary?: string,
 *   }
 *
 * Data source is read from the most recent `daily_sync_logs.detail.data_source`.
 */

type LastSyncResponse = {
  syncedAt: string | null;
  dataSource: "internal_cookie" | "external_api" | "unknown";
  lastRunOk: boolean | null;
  authExpired: boolean;
  errorSummary?: string;
};

const AUTH_FAIL_PATTERNS = [
  /\b401\b/,
  /\b403\b/,
  /unauthorized/i,
  /auth.expired/i,
  /cookie/i,
];

function looksLikeAuthError(message: string | null | undefined): boolean {
  if (!message) return false;
  return AUTH_FAIL_PATTERNS.some((re) => re.test(message));
}

async function readLatestSyncedAt(): Promise<string | null> {
  const { data: homeRow } = await supabaseAdmin
    .from("daily_home_totals")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (homeRow?.created_at) return homeRow.created_at;

  const { data } = await supabaseAdmin
    .from("daily_partner_performance")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return data?.created_at ?? null;
}

async function readLatestSyncMeta(): Promise<{
  dataSource: LastSyncResponse["dataSource"];
  lastRunOk: boolean | null;
  authExpired: boolean;
  errorSummary?: string;
}> {
  const fallback = {
    dataSource: "unknown" as const,
    lastRunOk: null as boolean | null,
    authExpired: false,
  };
  try {
    const { data, error } = await supabaseAdmin
      .from("daily_sync_logs")
      .select("ok, error_message, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return fallback;

    const detail = (data.detail ?? {}) as Record<string, unknown>;
    const rawSource = String(detail.data_source ?? "").toLowerCase();
    const dataSource: LastSyncResponse["dataSource"] =
      rawSource === "internal_cookie"
        ? "internal_cookie"
        : rawSource === "external_api"
        ? "external_api"
        : "unknown";

    const errMsg = (data.error_message ?? null) as string | null;
    const authExpired = looksLikeAuthError(errMsg);

    return {
      dataSource,
      lastRunOk: data.ok ?? null,
      authExpired,
      errorSummary: errMsg ?? undefined,
    };
  } catch {
    return fallback;
  }
}

export async function GET() {
  try {
    const [syncedAt, meta] = await Promise.all([
      readLatestSyncedAt(),
      readLatestSyncMeta(),
    ]);
    const body: LastSyncResponse = { syncedAt, ...meta };
    return NextResponse.json(body, { headers: NO_CACHE_HEADERS });
  } catch {
    const body: LastSyncResponse = {
      syncedAt: null,
      dataSource: "unknown",
      lastRunOk: null,
      authExpired: false,
    };
    return NextResponse.json(body, { status: 500, headers: NO_CACHE_HEADERS });
  }
}
