"use server";

import { syncBillingData } from "@/lib/sync/billing";
import { syncMondayData } from "@/lib/sync/monday";
import { syncXDASHData } from "@/lib/sync/xdash";

export type TriggerSyncResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Starts the full sync in the background and returns success immediately
 * so the UI does not wait for the entire process. Sync runs: Monday + Billing + XDASH in parallel.
 */
export async function triggerSyncViaCronApi(): Promise<TriggerSyncResult> {
  void runSyncInBackground();
  return { success: true };
}

async function runSyncInBackground(): Promise<void> {
  try {
    await Promise.all([
      syncMondayData(),
      syncBillingData(),
      syncXDASHData(),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync] Background sync error:", message);
  }
}
