/**
 * Tracks consecutive XDASH totals (cron) failures for proactive alerting.
 * Backed by `public.sync_health_counters` (see migrations 031 + 032).
 *
 * Schema-resilient: production rolled out with `consecutive_failures` while
 * the migrations canonicalise to `consecutive_xdash_totals_failures`. We try
 * the canonical column first and silently fall back so cron health never
 * blocks the sync pipeline on a schema drift.
 */

import { supabaseAdmin } from "@/lib/supabase";
import { syncProLog } from "@/lib/sync-pro-log";

const CRON_XDASH_TOTALS_ROW_ID = "cron_xdash_totals";
const CANONICAL_COL = "consecutive_xdash_totals_failures";
const LEGACY_COL = "consecutive_failures";

export type XdashTotalsHealthOutcome = {
  consecutiveFailures: number;
  /** True when the counter just reached 3 (alert once per streak until success resets). */
  shouldAlertTripleFailure: boolean;
};

type SchemaShape = "canonical" | "legacy";

let cachedShape: SchemaShape | null = null;

function isMissingColumnError(message: string | undefined | null, col: string): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes(col.toLowerCase()) &&
    (lower.includes("could not find") ||
      lower.includes("does not exist") ||
      lower.includes("undefined column"))
  );
}

async function detectSchema(): Promise<SchemaShape> {
  if (cachedShape) return cachedShape;

  const canonicalProbe = await supabaseAdmin
    .from("sync_health_counters")
    .select(CANONICAL_COL)
    .limit(1);

  if (!canonicalProbe.error) {
    cachedShape = "canonical";
    return cachedShape;
  }

  if (isMissingColumnError(canonicalProbe.error.message, CANONICAL_COL)) {
    const legacyProbe = await supabaseAdmin
      .from("sync_health_counters")
      .select(LEGACY_COL)
      .limit(1);
    if (!legacyProbe.error) {
      cachedShape = "legacy";
      syncProLog({
        event: "sync_pro.sync_health.schema_fallback",
        branch_type: "sync_health",
        status: "ok",
        message: `Falling back to legacy column '${LEGACY_COL}' on sync_health_counters`,
      });
      return cachedShape;
    }
  }

  // Last resort: assume canonical so the migration path is the source of truth.
  syncProLog({
    event: "sync_pro.sync_health.schema_probe_failed",
    branch_type: "sync_health",
    status: "error",
    message: canonicalProbe.error.message,
  });
  cachedShape = "canonical";
  return cachedShape;
}

function counterColumn(shape: SchemaShape): string {
  return shape === "legacy" ? LEGACY_COL : CANONICAL_COL;
}

export async function applyXdashTotalsCronHealth(success: boolean): Promise<XdashTotalsHealthOutcome> {
  const now = new Date().toISOString();
  const shape = await detectSchema();
  const col = counterColumn(shape);

  if (success) {
    const payload: Record<string, unknown> = {
      id: CRON_XDASH_TOTALS_ROW_ID,
      [col]: 0,
      updated_at: now,
    };
    const { error } = await supabaseAdmin
      .from("sync_health_counters")
      .upsert(payload, { onConflict: "id" });
    if (error) {
      syncProLog({
        event: "sync_pro.sync_health.reset_failed",
        branch_type: "sync_health",
        status: "error",
        message: error.message,
        detail: { column: col },
      });
    }
    return { consecutiveFailures: 0, shouldAlertTripleFailure: false };
  }

  const { data: row, error: readErr } = await supabaseAdmin
    .from("sync_health_counters")
    .select(col)
    .eq("id", CRON_XDASH_TOTALS_ROW_ID)
    .maybeSingle();

  if (readErr) {
    syncProLog({
      event: "sync_pro.sync_health.read_failed",
      branch_type: "sync_health",
      status: "error",
      message: readErr.message,
      detail: { column: col },
    });
  }

  const prev = Number((row as Record<string, unknown> | null)?.[col] ?? 0);
  const next = prev + 1;

  const payload: Record<string, unknown> = {
    id: CRON_XDASH_TOTALS_ROW_ID,
    [col]: next,
    updated_at: now,
  };
  const { error: writeErr } = await supabaseAdmin
    .from("sync_health_counters")
    .upsert(payload, { onConflict: "id" });
  if (writeErr) {
    syncProLog({
      event: "sync_pro.sync_health.increment_failed",
      branch_type: "sync_health",
      status: "error",
      message: writeErr.message,
      detail: { column: col, next },
    });
  }

  return {
    consecutiveFailures: next,
    shouldAlertTripleFailure: next === 3,
  };
}
