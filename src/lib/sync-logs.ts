/**
 * Sync-Pro: persistence helper for sync run summaries.
 *
 * Writes one row per sync invocation to `public.daily_sync_logs` so we can audit
 * duration / row counts / error rate over time without relying on Vercel logs.
 *
 * Fire-and-forget by design: never throws, never blocks the caller. If the DB
 * is unreachable or the table is missing we just log a warning — the sync run
 * itself remains the source of truth.
 *
 * Invariant: one operation → at most one error event in sync_pro_events, and
 * only after withOneRetry has exhausted its attempts.
 */

import { withOneRetry } from "@/lib/db-telemetry-retry";
import { supabaseAdmin } from "@/lib/supabase";
import { syncProLog } from "@/lib/sync-pro-log";

export type SyncRunRecord = {
  /** Stable identifier for the entry point (e.g. `cron_sync`, `auto_sync:manual-recovery`, `refresh_today_home`). */
  source: string;
  /** Wall-clock duration of the sync run, in ms. */
  durationMs: number;
  /** Number of distinct dates touched. 0 if N/A. */
  datesSynced: number;
  /** Total rows upserted across all tables for this run. 0 if N/A. */
  rowsUpserted: number;
  /** True only if the run completed without any failed step. */
  ok: boolean;
  /** Optional first error message (kept short). */
  errorMessage?: string;
  /** Optional structured detail (e.g. full step results). Stored as JSONB. */
  detail?: Record<string, unknown>;
};

/**
 * Insert a sync run summary into `daily_sync_logs`.
 * Returns void; failures are logged but never propagated.
 * One retry covers the stale keep-alive socket on lambda thaw.
 */
export async function recordSyncRun(record: SyncRunRecord): Promise<void> {
  const result = await withOneRetry(async () => {
    const res = await supabaseAdmin.from("daily_sync_logs").insert({
      source: record.source,
      duration_ms: Math.max(0, Math.round(record.durationMs)),
      dates_synced: Math.max(0, Math.round(record.datesSynced)),
      rows_upserted: Math.max(0, Math.round(record.rowsUpserted)),
      ok: record.ok,
      error_message: record.errorMessage?.slice(0, 1000) ?? null,
      detail: record.detail ?? null,
    });
    // Soft PostgREST errors must throw so withOneRetry actually retries them.
    // Returning `{ error }` would look like success to the retry helper.
    if (res.error) {
      throw new Error(res.error.message);
    }
    return res;
  }, "daily_sync_logs.insert");

  // Only emit after both attempts failed — never on a recovered first attempt.
  if (result == null) {
    syncProLog({
      event: "sync_pro.daily_sync_logs.insert_failed",
      branch_type: "full_cron",
      status: "error",
      message: "failed after retry (see prior console.warn)",
      detail: { source: record.source },
    });
  }
}

/** Latest successful `monday_sync` timestamp from daily_sync_logs, or null. */
export async function getLastSuccessfulMondaySyncAt(): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("daily_sync_logs")
    .select("created_at")
    .eq("source", "monday_sync")
    .eq("ok", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.created_at) return null;
  return String(data.created_at);
}
