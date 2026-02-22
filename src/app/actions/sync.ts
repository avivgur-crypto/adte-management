"use server";

import { headers } from "next/headers";

export type TriggerSyncResult =
  | { ok: true }
  | { ok: false; error: string };

/** Build absolute URL (https://) so fetch never gets a relative path. Uses host header or env. */
async function getBaseUrl(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get("host");
    if (host && !host.startsWith("localhost")) {
      return `https://${host}`;
    }
    if (host && host.startsWith("localhost")) {
      return `http://${host}`;
    }
  } catch {
    // headers() can throw in some edge contexts
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) {
    return appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;
  }
  return "http://localhost:3000";
}

export async function triggerSyncViaCronApi(): Promise<TriggerSyncResult> {
  try {
    const baseUrl = await getBaseUrl();
    const url = `${baseUrl.replace(/\/$/, "")}/api/sync-now`;
    const response = await fetch(url, { method: "POST", cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: (data as { error?: string }).error ?? "Sync failed" };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message || "Sync request failed" };
  }
}
