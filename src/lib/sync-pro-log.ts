/**
 * Structured JSON logs for Vercel Log Insights / dashboards.
 * One JSON object per line; filter with `logger: "sync-pro"` or `event` prefixes.
 *
 * Also persists a truncated copy to `public.sync_pro_events` (fire-and-forget).
 * A DB write failure must NEVER break a sync — console output remains the
 * primary path; the table is observability only.
 */

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
  void Promise.resolve(
    supabaseAdmin.from("sync_pro_events").insert({
      event: input.event,
      branch_type: input.branch_type ?? null,
      status: input.status ?? null,
      message: truncateMessage(input.message),
      detail: capDetail(input.detail),
    }),
  )
    .then(({ error }) => {
      if (error) {
        console.warn(
          `[sync-pro-log] sync_pro_events insert failed (non-fatal): ${error.message}`,
        );
      }
    })
    .catch((e: unknown) => {
      console.warn(
        `[sync-pro-log] sync_pro_events insert threw (non-fatal):`,
        e instanceof Error ? e.message : e,
      );
    });
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

/**
 * Delete sync_pro_events older than the retention window.
 * Safe to call repeatedly; never throws (logs and returns 0 on failure).
 */
export async function purgeOldSyncProEvents(): Promise<number> {
  const cutoff = new Date(
    Date.now() - SYNC_PRO_EVENTS_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  try {
    const { error, count } = await supabaseAdmin
      .from("sync_pro_events")
      .delete({ count: "exact" })
      .lt("created_at", cutoff);

    if (error) {
      console.warn(
        `[sync-pro-log] sync_pro_events purge failed (non-fatal): ${error.message}`,
      );
      return 0;
    }
    console.log(
      `[sync-pro-log] sync_pro_events purge: removed ${count ?? 0} rows older than ${cutoff} (retention=${SYNC_PRO_EVENTS_RETENTION_DAYS}d)`,
    );
    return count ?? 0;
  } catch (e) {
    console.warn(
      `[sync-pro-log] sync_pro_events purge threw (non-fatal):`,
      e instanceof Error ? e.message : e,
    );
    return 0;
  }
}
