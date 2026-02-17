"use server";

import { syncBillingData } from "@/lib/sync/billing";
import { syncMondayData } from "@/lib/sync/monday";
import { syncXDASHData } from "@/lib/sync/xdash";

const isSyncAllowed = () =>
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_SHOW_SYNC_BUTTON === "true";

export type ManualSyncResult =
  | { ok: true; summary: { monday?: unknown; billing?: unknown; xdash?: unknown } }
  | { ok: false; error: string };

export async function runManualSync(): Promise<ManualSyncResult> {
  if (!isSyncAllowed()) {
    return { ok: false, error: "Manual sync is not allowed in this environment." };
  }

  const summary: {
    monday?: { funnelRows: number; activityRows: number };
    billing?: { monthsUpdated: number };
    xdash?: { datesSynced: number; rowsUpserted: number };
  } = {};

  try {
    summary.monday = await syncMondayData();
  } catch (err) {
    return {
      ok: false,
      error: `Monday: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    summary.billing = await syncBillingData();
  } catch (err) {
    return {
      ok: false,
      error: `Billing: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    summary.xdash = await syncXDASHData();
  } catch (err) {
    return {
      ok: false,
      error: `XDASH: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { ok: true, summary };
}
