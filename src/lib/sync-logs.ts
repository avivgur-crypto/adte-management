/**
 * Sync-Pro: persistence helper for sync run summaries.
 *
 * Writes one row per sync invocation to `public.daily_sync_logs` so we can audit
 * duration / row counts / error rate over time without relying on Vercel logs.
 *
 * Fire-and-forget by design: never throws, never blocks the caller. If the DB
 * is unreachable or the table is missing we just log a warning — the sync run
 * itself remains the source of truth.
 */

import { supabaseAdmin } from "@/lib/supabase";

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
 */
export async function recordSyncRun(record: SyncRunRecord): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("daily_sync_logs").insert({
      source: record.source,
      duration_ms: Math.max(0, Math.round(record.durationMs)),
      dates_synced: Math.max(0, Math.round(record.datesSynced)),
      rows_upserted: Math.max(0, Math.round(record.rowsUpserted)),
      ok: record.ok,
      error_message: record.errorMessage?.slice(0, 1000) ?? null,
      detail: record.detail ?? null,
    });
    if (error) {
      console.warn(`[Sync-Pro] daily_sync_logs insert failed (non-fatal): ${error.message}`);
    }
  } catch (e) {
    console.warn(
      `[Sync-Pro] daily_sync_logs insert threw (non-fatal): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
