"use client";

import { useEffect, useState, useCallback } from "react";
import { BarChart3, CalendarSync } from "lucide-react";
import { useAuth } from "@/app/context/AuthContext";
import { useSyncStatus } from "@/app/context/SyncStatusContext";

const XDASH_SYNC_URL = "/api/auto-sync?force=true&days=7&secret=Adte2026&target=xdash";
const MONDAY_SYNC_URL = "/api/auto-sync?force=true&secret=Adte2026&target=monday";
const SYNC_TIMEOUT_MS = 30_000;
const FEEDBACK_DURATION_MS = 4_000;
const ADMIN_EMAIL = "aviv.gur@adte.com";

type FeedbackState = { type: "success" | "error"; message: string } | null;

function Spinner() {
  return (
    <span
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white/80"
      aria-hidden
    />
  );
}

function formatIsrael(iso: string): string {
  return new Date(iso).toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jerusalem",
  });
}

function useSyncAction(
  url: string,
  label: string,
  onSyncedAt: (iso: string) => void,
) {
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), FEEDBACK_DURATION_MS);
    return () => clearTimeout(t);
  }, [feedback]);

  const trigger = useCallback(async () => {
    setSyncing(true);
    setFeedback(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);

    try {
      const res = await fetch(`${url}&t=${Date.now()}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const detail = data?.detail ?? data?.error ?? `HTTP ${res.status}`;
        setFeedback({ type: "error", message: `${label} failed: ${detail}` });
        return;
      }

      if (data?.syncedAt) onSyncedAt(data.syncedAt);
      setFeedback({ type: "success", message: `${label} synced!` });
    } catch (err) {
      const message =
        err instanceof Error && err.name === "AbortError"
          ? `${label} timed out`
          : `${label} failed: ${err instanceof Error ? err.message : String(err)}`;
      setFeedback({ type: "error", message });
    } finally {
      clearTimeout(timeoutId);
      setSyncing(false);
    }
  }, [url, label, onSyncedAt]);

  return { syncing, feedback, trigger } as const;
}

export default function LastSyncLine({ syncedAt: serverSyncedAt }: { syncedAt: string | null }) {
  const { user } = useAuth();
  const syncStatus = useSyncStatus();
  const autoSyncing = syncStatus?.isSyncing ?? false;
  const contextSyncedAt = syncStatus?.lastSyncedAt ?? null;

  const [clientSyncedAt, setClientSyncedAt] = useState<string | null>(null);

  const updateSyncedAt = useCallback(
    (iso: string) => syncStatus?.setLastSyncedAt(iso),
    [syncStatus],
  );

  const xdash = useSyncAction(XDASH_SYNC_URL, "XDASH", updateSyncedAt);
  const monday = useSyncAction(MONDAY_SYNC_URL, "Monday", updateSyncedAt);

  useEffect(() => {
    const fetchSync = () =>
      fetch(`/api/last-sync?t=${Date.now()}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { syncedAt: string | null }) => {
          if (d.syncedAt) setClientSyncedAt(d.syncedAt);
        })
        .catch(() => {});

    fetchSync();
    const interval = setInterval(fetchSync, 60_000);
    return () => clearInterval(interval);
  }, []);

  const best = contextSyncedAt ?? clientSyncedAt ?? serverSyncedAt;
  const canSync =
    user?.isAdmin === true || user?.email === ADMIN_EMAIL;
  const activeFeedback = xdash.feedback ?? monday.feedback;
  const anyBusy = autoSyncing || xdash.syncing || monday.syncing;

  if (!best && !anyBusy && !activeFeedback) return null;

  return (
    <div className="mb-4 flex items-center justify-center gap-2 text-xs text-white/40">
      {autoSyncing ? (
        <>
          <Spinner />
          <span className="font-medium text-white/55">Auto-syncing…</span>
        </>
      ) : best ? (
        <span>
          Last sync:{" "}
          <span className="font-medium text-white/55">{formatIsrael(best)}</span>
        </span>
      ) : null}

      {canSync && (
        <>
          <button
            type="button"
            onClick={xdash.trigger}
            disabled={xdash.syncing}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white/70 disabled:pointer-events-none disabled:opacity-40"
            title="Sync XDASH (7 days + partners)"
          >
            <BarChart3 className={`h-3.5 w-3.5 ${xdash.syncing ? "animate-pulse" : ""}`} />
            {xdash.syncing && <span className="text-[10px] font-medium text-white/55">syncing…</span>}
          </button>

          <span className="text-white/15">|</span>

          <button
            type="button"
            onClick={monday.trigger}
            disabled={monday.syncing}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white/70 disabled:pointer-events-none disabled:opacity-40"
            title="Sync Monday.com funnel"
          >
            <CalendarSync className={`h-3.5 w-3.5 ${monday.syncing ? "animate-pulse" : ""}`} />
            {monday.syncing && <span className="text-[10px] font-medium text-white/55">syncing…</span>}
          </button>
        </>
      )}

      {activeFeedback && (
        <span
          className={`font-medium ${
            activeFeedback.type === "success" ? "text-green-400" : "text-red-400"
          }`}
        >
          {activeFeedback.message}
        </span>
      )}
    </div>
  );
}
