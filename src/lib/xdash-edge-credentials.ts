/**
 * Vercel Edge Config (optional): read XDASH secrets with very low latency.
 *
 * Dashboard: Vercel → your Project → Storage → Edge Config → create/link a store
 * to the project (sets `EDGE_CONFIG` automatically). Add string items:
 *   - `xdash_auth_token` — value for legacy `Cookie: auth-token=…` (same as XDASH_AUTH_TOKEN / login bot)
 *   - `xdash_external_api_key` — `x-api-key` for the external report API
 *   - `xdash_report_url` (optional) — full HTTPS URL; falls back to `XDASH_REPORT_URL` env
 *
 * Resolution order (see `xdash-client.ts`): Edge Config → environment variables → Supabase (`xdash_auth` for token only).
 * Any Edge Config read failure is non-fatal; sync continues with existing fallbacks.
 */

import { get } from "@vercel/edge-config";
import { syncProLog } from "@/lib/sync-pro-log";

const EDGE_KEYS = {
  authToken: "xdash_auth_token",
  externalApiKey: "xdash_external_api_key",
  reportUrl: "xdash_report_url",
} as const;

let authSupabaseFallbackHintLogged = false;

export function logXdashAuthSupabaseFallbackHintOnce(): void {
  if (authSupabaseFallbackHintLogged) return;
  authSupabaseFallbackHintLogged = true;
  syncProLog({
    event: "sync_pro.credentials.auth_fallback_supabase",
    branch_type: "credentials",
    status: "ok",
    message:
      "XDASH auth token not in Edge Config or env — reading `xdash_auth` in Supabase. " +
      "To use Edge Config (faster): Vercel Project → Storage → Edge Config → link store → add key `xdash_auth_token` (cookie auth-token value).",
    detail: {
      edge_config_linked: Boolean(process.env.EDGE_CONFIG?.trim()),
      edge_keys: [EDGE_KEYS.authToken, EDGE_KEYS.externalApiKey, EDGE_KEYS.reportUrl],
    },
  });
}

export async function tryGetXdashAuthTokenFromEdge(): Promise<string | null> {
  if (!process.env.EDGE_CONFIG?.trim()) return null;
  try {
    const v = await get<string>(EDGE_KEYS.authToken);
    if (typeof v === "string" && v.trim()) return v.trim();
    return null;
  } catch (e) {
    syncProLog({
      event: "sync_pro.edge_config.read_error",
      branch_type: "credentials",
      status: "error",
      message: "Edge Config read failed for xdash_auth_token; falling back to env/Supabase.",
      detail: {
        error: e instanceof Error ? e.message : String(e),
      },
    });
    return null;
  }
}

export async function resolveExternalReportCredentials(): Promise<{
  reportUrl: string;
  apiKey: string;
}> {
  const envUrl = (process.env.XDASH_REPORT_URL ?? "").trim();
  const envKey = (process.env.XDASH_EXTERNAL_API_KEY ?? "").trim();

  let reportUrl = "";
  let apiKey = "";

  if (process.env.EDGE_CONFIG?.trim()) {
    try {
      const [eUrl, eKey] = await Promise.all([
        get<string>(EDGE_KEYS.reportUrl),
        get<string>(EDGE_KEYS.externalApiKey),
      ]);
      if (typeof eUrl === "string" && eUrl.trim()) reportUrl = eUrl.trim();
      if (typeof eKey === "string" && eKey.trim()) apiKey = eKey.trim();
    } catch (e) {
      syncProLog({
        event: "sync_pro.edge_config.read_error",
        branch_type: "credentials",
        status: "error",
        message: "Edge Config read failed for report URL/API key; falling back to env.",
        detail: { error: e instanceof Error ? e.message : String(e) },
      });
    }
  }

  if (!reportUrl) reportUrl = envUrl;
  if (!apiKey) apiKey = envKey;

  if (!reportUrl || !apiKey) {
    throw new Error(
      "Missing external report credentials: set Edge Config keys `xdash_report_url` + `xdash_external_api_key`, " +
        "or environment variables `XDASH_REPORT_URL` + `XDASH_EXTERNAL_API_KEY`.",
    );
  }

  return { reportUrl, apiKey };
}
