"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useSyncStatus } from "@/app/context/SyncStatusContext";

const INITIAL_DELAY_MS = 1500;
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 25000;

function runSync(
  setSyncing: (v: boolean) => void,
  setLastSyncedAt: (v: string | null) => void,
  router: ReturnType<typeof useRouter>,
  force = false,
) {
  setSyncing(true);
  const url = `/api/auto-sync?t=${Date.now()}${force ? "&force=true" : ""}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
    setSyncing(false);
    console.warn("[AutoSync] fetch timed out after 25s");
  }, FETCH_TIMEOUT_MS);

  fetch(url, { cache: "no-store", credentials: "same-origin", signal: controller.signal })
    .then((res) => {
      if (!res.ok) {
        setSyncing(false);
        if (res.status === 504 || res.status === 408) {
          console.warn("[AutoSync] server timeout (", res.status, ")");
        }
        return null;
      }
      return res.json();
    })
    .then((data: { synced?: boolean; syncedAt?: string } | null) => {
      if (data?.syncedAt) {
        setLastSyncedAt(data.syncedAt);
      }
      if (data?.synced) router.refresh();
    })
    .catch((err) => {
      if (err?.name !== "AbortError") {
        console.warn("[AutoSync] fetch failed:", err);
      }
    })
    .finally(() => {
      clearTimeout(timeoutId);
      setSyncing(false);
    });
}

export default function AutoSync() {
  const router = useRouter();
  const syncStatus = useSyncStatus();
  const setSyncing = syncStatus?.setSyncing ?? (() => {});
  const setLastSyncedAt = syncStatus?.setLastSyncedAt ?? (() => {});
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const initialTimer = setTimeout(() => {
      runSync(setSyncing, setLastSyncedAt, router);
      intervalRef.current = setInterval(() => {
        runSync(setSyncing, setLastSyncedAt, router);
      }, POLL_INTERVAL_MS);
    }, INITIAL_DELAY_MS);

    return () => {
      clearTimeout(initialTimer);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [router, setSyncing, setLastSyncedAt]);

  return null;
}
