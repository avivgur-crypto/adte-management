"use server";

export type TriggerSyncResult =
  | { ok: true }
  | { ok: false; error: string };

function getBaseUrl(): string {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export async function triggerSyncViaCronApi(): Promise<TriggerSyncResult> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/api/sync-now`;
  const response = await fetch(url, { method: "POST", cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: data.error ?? "Sync failed" };
  }
  return { ok: true };
}
