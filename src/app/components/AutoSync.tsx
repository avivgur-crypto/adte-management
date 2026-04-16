"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { refreshTodayHome } from "@/app/actions/financials";
import { useSyncStatus } from "@/app/context/SyncStatusContext";
import { invalidatePrefetch } from "@/lib/tab-prefetch";

const POLL_MS = 60_000;

/**
 * Bulletproof auto-sync: calls refreshTodayHome every 60 seconds and
 * ALWAYS triggers a full router.refresh() afterward — whether the server
 * action wrote new data, returned cached, or threw an error.
 *
 * This guarantees the RSC tree re-renders with the latest DB state on
 * every cycle, eliminating stale-UI scenarios entirely.
 */
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
    console.log("[AutoSync] router.refresh() fired");
  }, [router, syncStatus]);

  const runSync = useCallback(async () => {
    const t0 = Date.now();
    console.log("[AutoSync] Starting sync cycle…");
    try {
      const result = await refreshTodayHome();
      const ms = Date.now() - t0;
      if (result.error) {
        console.error(`[AutoSync] Sync completed with error (${ms}ms):`, result.error);
      } else if (result.updated) {
        console.log(`[AutoSync] Sync wrote new data (${ms}ms). Revenue: $${result.details?.todayRevenue?.toFixed(2) ?? "?"}`);
      } else {
        console.log(`[AutoSync] Sync skipped — rows fresh (${ms}ms)`);
      }
    } catch (e) {
      console.error("[AutoSync] refreshTodayHome threw:", e instanceof Error ? e.message : e);
    }
    forceRefreshUI();
  }, [forceRefreshUI]);

  useEffect(() => {
    isMounted.current = true;

    const initialDelay = setTimeout(() => {
      runSync();
    }, 500);

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
