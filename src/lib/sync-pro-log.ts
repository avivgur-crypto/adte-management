/**
 * Structured JSON logs for Vercel Log Insights / dashboards.
 * One JSON object per line; filter with `logger: "sync-pro"` or `event` prefixes.
 */

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
}
