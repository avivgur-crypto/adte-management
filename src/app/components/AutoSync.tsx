"use client";

import { startTransition, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { refreshTodayHome } from "@/app/actions/financials";
import { useSyncStatus } from "@/app/context/SyncStatusContext";
import { invalidatePrefetch } from "@/lib/tab-prefetch";

/**
 * Quiet 5-minute interval: respects XDASH while still keeping the dashboard
 * fresh. refreshTodayHome itself bails early when the DB rows are <5 min old,
 * so concurrent tabs won't multiply the load.
 */
const POLL_MS = 5 * 60 * 1000;
/** Small delay on page load so first paint isn't blocked by the sync. */
const INITIAL_DELAY_MS = 3_000;

export default function AutoSync() {
  const router = useRouter();
  const syncStatus = useSyncStatus();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyRefresh = useCallback(() => {
    syncStatus?.setLastSyncedAt(new Date().toISOString());
    invalidatePrefetch();
    startTransition(() => {
      router.refresh();
    });
  }, [router, syncStatus]);

  const runSync = useCallback(async () => {
    try {
      const result = await refreshTodayHome();
      if (result?.updated === true) applyRefresh();
    } catch (e) {
      console.error("[AutoSync] refreshTodayHome threw:", e instanceof Error ? e.message : e);
    }
  }, [applyRefresh]);

  useEffect(() => {
    const initialDelay = setTimeout(runSync, INITIAL_DELAY_MS);
    pollRef.current = setInterval(runSync, POLL_MS);

    return () => {
      clearTimeout(initialDelay);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [runSync]);

  return null;
}
