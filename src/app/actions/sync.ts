"use server";

export type TriggerSyncResult =
  | { ok: true }
  | { ok: false; error: string };

export async function triggerSyncViaCronApi(): Promise<TriggerSyncResult> {
  const response = await fetch("/api/sync-now", { method: "POST" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: data.error ?? "Sync failed" };
  }
  return { ok: true };
}
