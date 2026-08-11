"use server";

import { syncBillingData } from "@/lib/sync/billing";
import { syncMondayData } from "@/lib/sync/monday";
import { syncPnlData } from "@/lib/sync/pnl";
import { syncXDASHData } from "@/lib/sync/xdash";

export type TriggerSyncResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Starts the full sync in the background and returns success immediately.
 * Runs: Monday + Billing + P&L + XDASH home totals (no partner pairs).
 */
export async function triggerSyncViaCronApi(): Promise<TriggerSyncResult> {
  void runSyncInBackground();
  return { success: true };
}

async function runSyncInBackground(): Promise<void> {
  const xdashDisabled = (process.env.XDASH_DISABLED ?? "false").toLowerCase() === "true";
  try {
    await Promise.all([
      syncMondayData(),
      syncBillingData(),
      syncPnlData(),
      ...(xdashDisabled ? [] : [syncXDASHData()]),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync] Background sync error:", message);
  }
}
