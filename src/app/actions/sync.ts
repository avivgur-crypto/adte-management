"use server";

const isSyncAllowed = () =>
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_SHOW_SYNC_BUTTON === "true";

export type TriggerSyncResult =
  | { ok: true; summary: unknown }
  | { ok: false; error: string };

/**
 * Calls /api/cron/sync with Authorization: Bearer CRON_SECRET (server-side only).
 * Used by the "Sync Data" sidebar button.
 */
export async function triggerSyncViaCronApi(): Promise<TriggerSyncResult> {
  if (!isSyncAllowed()) {
    return { ok: false, error: "Sync is not allowed in this environment." };
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return { ok: false, error: "CRON_SECRET is not set." };
  }
  const base =
    process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const url = `${base}/api/cron/sync`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    const data = (await res.json()) as { ok?: boolean; error?: string; summary?: unknown };
    if (!res.ok) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    if (!data.ok) {
      return { ok: false, error: data.error ?? "Sync failed." };
    }
    return { ok: true, summary: data.summary };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
