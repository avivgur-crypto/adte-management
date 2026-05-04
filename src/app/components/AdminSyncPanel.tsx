"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, CalendarSync } from "lucide-react";
import { refreshTodayHome } from "@/app/actions/financials";
import { useSyncStatus } from "@/app/context/SyncStatusContext";
import { invalidatePrefetch } from "@/lib/tab-prefetch";

const API_BASE = "/api/auto-sync";
const SECRET = "Adte2026";
const SYNC_TIMEOUT_MS = 15_000;
const FEEDBACK_DURATION_MS = 4_000;
const XDASH_DAYS = 7;
const TOTAL_STEPS = XDASH_DAYS * 2 + 1;

type FeedbackState = { type: "success" | "error"; message: string } | null;

function last7DaysIsrael(): string[] {
  const out: string[] = [];
  for (let i = 0; i < XDASH_DAYS; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(d.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" }));
  }
  return out;
}

async function fetchOneDay(
  target: string,
  date: string,
  signal: AbortSignal,
): Promise<{ ok: boolean; syncedAt?: string; error?: string }> {
  const url =
    `${API_BASE}?force=true&secret=${SECRET}&target=${target}` +
    `&singleDate=${encodeURIComponent(date)}&t=${Date.now()}`;

  const res = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    return { ok: false, error: data?.detail ?? data?.error ?? `HTTP ${res.status}` };
  }
  return { ok: true, syncedAt: data?.syncedAt };
}

export default function AdminSyncPanel() {
  const router = useRouter();
  const syncStatus = useSyncStatus();

  const [xdashLabel, setXdashLabel] = useState<string | null>(null);
  const [xdashFeedback, setXdashFeedback] = useState<FeedbackState>(null);

  const [mondaySyncing, setMondaySyncing] = useState(false);
  const [mondayFeedback, setMondayFeedback] = useState<FeedbackState>(null);

  useEffect(() => {
    if (!xdashFeedback) return;
    const t = setTimeout(() => setXdashFeedback(null), FEEDBACK_DURATION_MS);
    return () => clearTimeout(t);
  }, [xdashFeedback]);

  useEffect(() => {
    if (!mondayFeedback) return;
    const t = setTimeout(() => setMondayFeedback(null), FEEDBACK_DURATION_MS);
    return () => clearTimeout(t);
  }, [mondayFeedback]);

  const handleXdashSync = useCallback(async () => {
    const dates = last7DaysIsrael();
    setXdashFeedback(null);

    let lastSyncedAt: string | null = null;
    let failures = 0;

    for (let i = 0; i < dates.length; i++) {
      setXdashLabel(`Totals: ${i + 1}/${XDASH_DAYS}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
      try {
        const result = await fetchOneDay("xdash-totals", dates[i]!, controller.signal);
        clearTimeout(timeoutId);
        if (!result.ok) {
          console.error(`[XDASH] Totals failed for ${dates[i]}: ${result.error}`);
          failures++;
          continue;
        }
        lastSyncedAt = result.syncedAt ?? lastSyncedAt;
      } catch (err) {
        clearTimeout(timeoutId);
        const msg = err instanceof Error && err.name === "AbortError"
          ? "timed out" : (err instanceof Error ? err.message : String(err));
        console.error(`[XDASH] Totals failed for ${dates[i]}: ${msg}`);
        failures++;
      }
    }

    for (let i = 0; i < dates.length; i++) {
      setXdashLabel(`Pairs: ${i + 1}/${XDASH_DAYS}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
      try {
        const result = await fetchOneDay("partner-pairs", dates[i]!, controller.signal);
        clearTimeout(timeoutId);
        if (!result.ok) {
          console.error(`[XDASH] Pairs failed for ${dates[i]}: ${result.error}`);
          failures++;
          continue;
        }
        lastSyncedAt = result.syncedAt ?? lastSyncedAt;
      } catch (err) {
        clearTimeout(timeoutId);
        const msg = err instanceof Error && err.name === "AbortError"
          ? "timed out" : (err instanceof Error ? err.message : String(err));
        console.error(`[XDASH] Pairs failed for ${dates[i]}: ${msg}`);
        failures++;
      }
    }

    setXdashLabel("Billing…");
    {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
      try {
        const url = `${API_BASE}?force=true&secret=${SECRET}&target=billing&t=${Date.now()}`;
        const res = await fetch(url, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const detail = data?.detail ?? data?.error ?? `HTTP ${res.status}`;
          console.error(`[XDASH] Billing failed: ${detail}`);
          failures++;
        } else {
          lastSyncedAt = data?.syncedAt ?? lastSyncedAt;
        }
      } catch (err) {
        clearTimeout(timeoutId);
        const msg = err instanceof Error && err.name === "AbortError"
          ? "timed out" : (err instanceof Error ? err.message : String(err));
        console.error(`[XDASH] Billing failed: ${msg}`);
        failures++;
      }
    }

    setXdashLabel(null);
    if (failures > 0) {
      setXdashFeedback({
        type: failures === TOTAL_STEPS ? "error" : "success",
        message: failures === TOTAL_STEPS
          ? "All failed"
          : `Done (${failures} failed)`,
      });
    } else {
      setXdashFeedback({ type: "success", message: "Synced!" });
    }
    if (lastSyncedAt) syncStatus?.setLastSyncedAt(lastSyncedAt);

    // Drop the module-level prefetch cache so the Partners tab re-fetches the
    // freshly-synced daily_partner_pairs the next time it mounts. Otherwise the
    // tab keeps showing the stale snapshot from before this sync.
    invalidatePrefetch();

    try {
      const home = await refreshTodayHome();
      if (home.updated) router.refresh();
      else router.refresh();
    } catch (e) {
      console.error("[AdminSyncPanel] refreshTodayHome:", e);
    }
  }, [syncStatus, router]);

  const handleMondaySync = useCallback(async () => {
    setMondaySyncing(true);
    setMondayFeedback(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);

    try {
      const res = await fetch(
        `${API_BASE}?force=true&secret=${SECRET}&target=monday&t=${Date.now()}`,
        { cache: "no-store", credentials: "same-origin", signal: controller.signal },
      );
      clearTimeout(timeoutId);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = data?.detail ?? data?.error ?? `HTTP ${res.status}`;
        setMondayFeedback({ type: "error", message: `Failed: ${detail}` });
        return;
      }
      if (data?.syncedAt) syncStatus?.setLastSyncedAt(data.syncedAt);
      setMondayFeedback({ type: "success", message: "Synced!" });
    } catch (err) {
      clearTimeout(timeoutId);
      const msg = err instanceof Error && err.name === "AbortError"
        ? "Timed out"
        : `Failed: ${err instanceof Error ? err.message : String(err)}`;
      setMondayFeedback({ type: "error", message: msg });
    } finally {
      setMondaySyncing(false);
    }
  }, [syncStatus]);

  const xdashBusy = xdashLabel !== null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        Manual sync
      </p>

      {/* XDASH button */}
      <button
        type="button"
        onClick={handleXdashSync}
        disabled={xdashBusy}
        className="flex w-full items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-zinc-200 shadow-sm transition-colors hover:bg-white/10 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <BarChart3 className={`h-4 w-4 shrink-0 text-zinc-400 ${xdashBusy ? "animate-pulse" : ""}`} />
        <span className="flex-1 text-left">
          {xdashLabel ? `XDASH — ${xdashLabel}` : "Sync XDASH"}
        </span>
      </button>
      {xdashFeedback && (
        <p className={`text-center text-xs font-medium ${
          xdashFeedback.type === "success" ? "text-emerald-400" : "text-red-400"
        }`}>
          {xdashFeedback.message}
        </p>
      )}

      {/* Monday button */}
      <button
        type="button"
        onClick={handleMondaySync}
        disabled={mondaySyncing}
        className="flex w-full items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-zinc-200 shadow-sm transition-colors hover:bg-white/10 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <CalendarSync className={`h-4 w-4 shrink-0 text-zinc-400 ${mondaySyncing ? "animate-pulse" : ""}`} />
        <span className="flex-1 text-left">
          {mondaySyncing ? "Syncing Monday…" : "Sync Monday"}
        </span>
      </button>
      {mondayFeedback && (
        <p className={`text-center text-xs font-medium ${
          mondayFeedback.type === "success" ? "text-emerald-400" : "text-red-400"
        }`}>
          {mondayFeedback.message}
        </p>
      )}
    </div>
  );
}
