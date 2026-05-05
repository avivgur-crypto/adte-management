"use client";

import { startTransition, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { refreshTodayHome } from "@/app/actions/financials";
import { useSyncStatus } from "@/app/context/SyncStatusContext";
import { invalidatePrefetch } from "@/lib/tab-prefetch";

/**
 * Quiet 5-minute interval: respects XDASH while still keeping the dashboard
 * fresh. The Server Action returns immediately and runs the actual XDASH
 * fetches in `after()`, so concurrent tabs don't multiply the user-perceived
 * latency (each tab just schedules a background job in <50ms).
 */
const POLL_MS = 5 * 60 * 1000;
/** Small delay on page load so first paint isn't blocked by the sync. */
const INITIAL_DELAY_MS = 3_000;
/**
 * Delay between scheduling the background sync and asking the router to refresh.
 * Long enough for the background `runRefreshTodayHomeBackground` to fetch +
 * upsert in the common case, short enough that the next page render shows
 * fresh data within the user's visit. If the BG job is slower than this, the
 * next 5-minute poll (or a manual refresh) will pick up the new rows.
 */
const REFRESH_AFTER_BG_DELAY_MS = 12_000;

export default function AutoSync() {
  const router = useRouter();
  const syncStatus = useSyncStatus();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      // The server action now schedules the actual sync in `after()`; it returns
      // in <1s. Wait for the background job to most likely finish before asking
      // the router to re-render with fresh DB rows.
      if (result?.scheduled === true || result?.updated === true) {
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = setTimeout(applyRefresh, REFRESH_AFTER_BG_DELAY_MS);
      }
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
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [runSync]);

  return null;
}
