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

type LastSyncResponse = {
  syncedAt: string | null;
  dataSource: "internal_cookie" | "external_api" | "unknown";
  lastRunOk: boolean | null;
  authExpired: boolean;
  errorSummary?: string;
};

export default function LastSyncLine({ syncedAt: serverSyncedAt }: { syncedAt: string | null }) {
  const syncStatus = useSyncStatus();
  const isSyncing = syncStatus?.isSyncing ?? false;
  const contextSyncedAt = syncStatus?.lastSyncedAt ?? null;

  const [meta, setMeta] = useState<LastSyncResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchSync = () =>
      fetch(`/api/last-sync?t=${Date.now()}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d: LastSyncResponse) => {
          if (!cancelled) setMeta(d);
        })
        .catch(() => {});

    fetchSync();
    const interval = setInterval(fetchSync, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const best = contextSyncedAt ?? meta?.syncedAt ?? serverSyncedAt;
  const dataSource = meta?.dataSource ?? "unknown";
  const authExpired = meta?.authExpired ?? false;

  if (!best && !isSyncing) return null;

  // "UI-Synced Data" badge when the last successful run came through the
  // internal cookie path (1:1 with the XDASH UI). External-API runs get a
  // softer label so Aviv can tell at a glance which source the dashboard
  // numbers came from.
  const sourceBadge =
    dataSource === "internal_cookie" ? (
      <span
        className="ml-2 inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-200/90"
        title="Sync used the XDASH UI feed (cookie path) — numbers match the XDASH dashboard 1:1."
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
        UI-Synced Data
      </span>
    ) : dataSource === "external_api" ? (
      <span
        className="ml-2 inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200/90"
        title="Sync used the External Report API — may lag the XDASH UI for recent dates."
      >
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
        External API
      </span>
    ) : null;

  const authBadge = authExpired ? (
    <span
      className="ml-2 inline-flex items-center gap-1 rounded-full border border-rose-500/50 bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-200"
      title={
        meta?.errorSummary ??
        "XDASH cookie expired — refresh XDASH_AUTH_TOKEN (env / Edge Config / xdash_auth)."
      }
    >
      <span className="h-1.5 w-1.5 rounded-full bg-rose-400" aria-hidden />
      Auth Expired
    </span>
  ) : null;

  return (
    <p className="mb-4 flex flex-wrap items-center justify-center gap-1 text-center text-xs text-white/40">
      {isSyncing ? (
        <>
          <Spinner />
          <span className="ml-1.5 font-medium text-white/55">Syncing…</span>
        </>
      ) : best ? (
        <>
          <span>
            Last sync:{" "}
            <span className="font-medium text-white/55">{formatIsrael(best)}</span>
          </span>
        </>
      ) : null}
      {sourceBadge}
      {authBadge}
    </p>
  );
}
