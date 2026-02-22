"use server";

import { syncBillingData } from "@/lib/sync/billing";
import { syncMondayData } from "@/lib/sync/monday";
import { syncXDASHData } from "@/lib/sync/xdash";

export type TriggerSyncResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Runs the full sync directly (no fetch). Calls Monday, Billing, then XDASH.
 * Wrapped in try/catch so errors return a readable message to the UI instead of 500.
 */
export async function triggerSyncViaCronApi(): Promise<TriggerSyncResult> {
  try {
    await syncMondayData();
    await syncBillingData();
    await syncXDASHData();
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message || "Sync failed" };
  }
}
