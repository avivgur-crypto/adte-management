"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { refreshTodayHome } from "@/app/actions/financials";
import { useSyncStatus } from "@/app/context/SyncStatusContext";
import { invalidatePrefetch } from "@/lib/tab-prefetch";

const POLL_MS = 5 * 60 * 1000; // 5 minutes — respectful to XDASH API
const INITIAL_DELAY_MS = 3_000; // small delay on page load before first sync

export default function AutoSync() {
  const router = useRouter();
  const syncStatus = useSyncStatus();
  const isMounted = useRef(true);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const forceRefreshUI = useCallback(() => {
    if (!isMounted.current) return;
    syncStatus?.setLastSyncedAt(new Date().toISOString());
    syncStatus?.bumpSyncVersion();
    invalidatePrefetch();
    router.refresh();
  }, [router, syncStatus]);

  const runSync = useCallback(async () => {
    const t0 = Date.now();
    try {
      const result = await refreshTodayHome();
      const ms = Date.now() - t0;
      if (result.error) {
        console.error(`[AutoSync] error (${ms}ms):`, result.error);
      } else if (result.updated) {
        console.log(`[AutoSync] synced (${ms}ms). Revenue: $${result.details?.todayRevenue?.toFixed(2) ?? "?"}`);
      }
    } catch (e) {
      console.error("[AutoSync] threw:", e instanceof Error ? e.message : e);
    }
    forceRefreshUI();
  }, [forceRefreshUI]);

  useEffect(() => {
    isMounted.current = true;

    const initialDelay = setTimeout(() => {
      runSync();
    }, INITIAL_DELAY_MS);

    pollRef.current = setInterval(() => {
      runSync();
    }, POLL_MS);

    return () => {
      isMounted.current = false;
      clearTimeout(initialDelay);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [runSync]);

  return null;
}
