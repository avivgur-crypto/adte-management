"use server";

import { syncBillingData } from "@/lib/sync/billing";
import { syncMondayData } from "@/lib/sync/monday";
import { syncXDASHData } from "@/lib/sync/xdash";

export type TriggerSyncResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Runs the full sync directly (no fetch). Imports and calls sync functions from lib/sync.
 * Wrapped in try/catch: returns { success: true } or { success: false, error } so the UI can show the actual error.
 */
export async function triggerSyncViaCronApi(): Promise<TriggerSyncResult> {
  try {
    await Promise.all([
      syncMondayData(),
      syncBillingData(),
    ]);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message || "Sync failed" };
  }
}
