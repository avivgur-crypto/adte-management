/**
 * Structured JSON logs for Vercel Log Insights / dashboards.
 * One JSON object per line; filter with `logger: "sync-pro"` or `event` prefixes.
 *
 * Also persists a truncated copy to `public.sync_pro_events` (fire-and-forget).
 * A DB write failure must NEVER break a sync — console output remains the
 * primary path; the table is observability only.
 */

import { withOneRetry } from "@/lib/db-telemetry-retry";
import { getIsraelHour } from "@/lib/israel-date";
import { supabaseAdmin } from "@/lib/supabase";

export type SyncProBranchType =
  | "totals"
  | "partners"
  | "phase1"
  | "full_cron"
  | "credentials"
  | "sync_health"
  | "auto_sync"
  | "refresh_today_home"
  | "xdash_sync"
  | "partner_pairs_sync"
  | "self_heal"
  | "verify_health";

export type SyncProLogInput = {
  event: string;
  duration_ms?: number;
  branch_type?: SyncProBranchType;
  status?: "started" | "ok" | "error";
  status_code?: number;
  message?: string;
  detail?: Record<string, unknown>;
};

const MESSAGE_MAX = 1000;
/** Soft cap for JSONB detail (~8KB of serialized JSON). */
const DETAIL_MAX_BYTES = 8 * 1024;

function truncateMessage(message: string | undefined): string | null {
  if (message == null) return null;
  if (message.length <= MESSAGE_MAX) return message;
  return `${message.slice(0, MESSAGE_MAX)}…`;
}

function capDetail(
  detail: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (detail == null) return null;
  try {
    const raw = JSON.stringify(detail);
    if (raw.length <= DETAIL_MAX_BYTES) return detail;
    return {
      _truncated: true,
      _original_bytes: raw.length,
      _note: `detail exceeded ${DETAIL_MAX_BYTES} bytes and was dropped`,
    };
  } catch {
    return { _truncated: true, _note: "detail was not JSON-serializable" };
  }
}

function persistSyncProEvent(input: SyncProLogInput): void {
  // Fire-and-forget: never await at the call site, never throw into the sync.
  // One retry covers the stale keep-alive socket on lambda thaw.
  // Soft `{ error }` must throw so withOneRetry retries; final failure is
  // console-only (never emit an error event about failing to persist an event).
  void withOneRetry(async () => {
    const { error } = await supabaseAdmin.from("sync_pro_events").insert({
      event: input.event,
      branch_type: input.branch_type ?? null,
      status: input.status ?? null,
      message: truncateMessage(input.message),
      detail: capDetail(input.detail),
    });
    if (error) {
      throw new Error(error.message);
    }
  }, "sync_pro_events.insert");
}

export function syncProLog(input: SyncProLogInput): void {
  const line = {
    logger: "sync-pro",
    ts: new Date().toISOString(),
    ...input,
  };
  if (input.status === "error") {
    console.error(JSON.stringify(line));
  } else {
    console.log(JSON.stringify(line));
  }
  persistSyncProEvent(input);
}

/** Retention window for sync_pro_events (days). */
export const SYNC_PRO_EVENTS_RETENTION_DAYS = 30;

/** Israel hour (0–23) at which the daily purge is allowed to run. */
const PURGE_ISRAEL_HOUR = 3;

/** In-process gate so a warm instance doesn't purge twice in the same hour. */
let lastPurgeAtMs = 0;

/**
 * Delete sync_pro_events older than the retention window.
 * Gated to Israel hour === 3 (at most ~once/day across cold starts; module
 * timestamp skips a second run on the same warm instance). Never throws.
 */
export async function purgeOldSyncProEvents(): Promise<number> {
  if (getIsraelHour() !== PURGE_ISRAEL_HOUR) return 0;
  if (Date.now() - lastPurgeAtMs < 60 * 60 * 1000) return 0;

  const cutoff = new Date(
    Date.now() - SYNC_PRO_EVENTS_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const count = await withOneRetry(async () => {
    const { error, count: deleted } = await supabaseAdmin
      .from("sync_pro_events")
      .delete({ count: "exact" })
      .lt("created_at", cutoff);

    if (error) {
      throw new Error(error.message);
    }
    return deleted ?? 0;
  }, "sync_pro_events.purge");

  // Error event only after both attempts failed — not on a recovered thaw miss.
  if (count == null) {
    syncProLog({
      event: "sync_pro.sync_pro_events.purge_failed",
      branch_type: "full_cron",
      status: "error",
      message: "purge failed after retry (see prior console.warn)",
      detail: { cutoff },
    });
    return 0;
  }

  lastPurgeAtMs = Date.now();
  console.log(
    `[sync-pro-log] sync_pro_events purge: removed ${count} rows older than ${cutoff} (retention=${SYNC_PRO_EVENTS_RETENTION_DAYS}d)`,
  );
  return count;
}
