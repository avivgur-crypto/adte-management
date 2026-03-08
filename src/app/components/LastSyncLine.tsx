"use client";

import { useEffect, useState } from "react";
import { useSyncStatus } from "@/app/context/SyncStatusContext";

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

export default function LastSyncLine({ syncedAt: serverSyncedAt }: { syncedAt: string | null }) {
  const syncStatus = useSyncStatus();
  const isSyncing = syncStatus?.isSyncing ?? false;
  const contextSyncedAt = syncStatus?.lastSyncedAt ?? null;

  // Client-side truth: fetch the real timestamp from DB on mount
  const [clientSyncedAt, setClientSyncedAt] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/last-sync?t=${Date.now()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { syncedAt: string | null }) => {
        if (d.syncedAt) setClientSyncedAt(d.syncedAt);
      })
      .catch(() => {});
  }, []);

  // Priority: context (just-synced) > client fetch (on mount) > server prop (ISR)
  const best = contextSyncedAt ?? clientSyncedAt ?? serverSyncedAt;

  if (!best && !isSyncing) return null;

  return (
    <p className="mb-4 text-center text-xs text-white/40">
      {isSyncing ? (
        <>
          <Spinner />
          <span className="ml-1.5 font-medium text-white/55">Syncing…</span>
        </>
      ) : best ? (
        <>
          Last sync:{" "}
          <span className="font-medium text-white/55">{formatIsrael(best)}</span>
        </>
      ) : null}
    </p>
  );
}
