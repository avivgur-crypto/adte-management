/**
 * Tracks consecutive XDASH totals (cron) failures for proactive alerting.
 * Backed by `public.sync_health_counters` (see migration).
 */

import { supabaseAdmin } from "@/lib/supabase";

const CRON_XDASH_TOTALS_ROW_ID = "cron_xdash_totals";

export type XdashTotalsHealthOutcome = {
  consecutiveFailures: number;
  /** True when the counter just reached 3 (alert once per streak until success resets). */
  shouldAlertTripleFailure: boolean;
};

/**
 * Call once per `/api/cron/sync` run after the XDASH totals branch settles.
 * When `success` is true, resets the streak. When false, increments and sets
 * `shouldAlertTripleFailure` when the new count is exactly 3.
 */
export async function applyXdashTotalsCronHealth(success: boolean): Promise<XdashTotalsHealthOutcome> {
  const now = new Date().toISOString();

  if (success) {
    const { error } = await supabaseAdmin.from("sync_health_counters").upsert(
      {
        id: CRON_XDASH_TOTALS_ROW_ID,
        consecutive_xdash_totals_failures: 0,
        updated_at: now,
      },
      { onConflict: "id" },
    );
    if (error) {
      console.error("[sync-health] reset counters failed:", error.message);
    }
    return { consecutiveFailures: 0, shouldAlertTripleFailure: false };
  }

  const { data: row, error: readErr } = await supabaseAdmin
    .from("sync_health_counters")
    .select("consecutive_xdash_totals_failures")
    .eq("id", CRON_XDASH_TOTALS_ROW_ID)
    .maybeSingle();

  if (readErr) {
    console.error("[sync-health] read counters failed:", readErr.message);
  }

  const prev = Number(row?.consecutive_xdash_totals_failures ?? 0);
  const next = prev + 1;

  const { error: writeErr } = await supabaseAdmin.from("sync_health_counters").upsert(
    {
      id: CRON_XDASH_TOTALS_ROW_ID,
      consecutive_xdash_totals_failures: next,
      updated_at: now,
    },
    { onConflict: "id" },
  );
  if (writeErr) {
    console.error("[sync-health] increment counters failed:", writeErr.message);
  }

  return {
    consecutiveFailures: next,
    shouldAlertTripleFailure: next === 3,
  };
}
