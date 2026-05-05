"use client";

import { startTransition, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { refreshTodayHome } from "@/app/actions/financials";
import { useSyncStatus } from "@/app/context/SyncStatusContext";
import { invalidatePrefetch } from "@/lib/tab-prefetch";

/**
 * Quiet 5-minute interval. `refreshTodayHome` is now synchronous — it awaits
 * the XDASH fetches and `daily_home_totals` upsert before resolving, then we
 * trigger a router refresh to render the freshly-written rows. Vercel Pro's
 * 60s function ceiling bounds how long the action can take.
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
      // Synchronous flow: action only resolves after `daily_home_totals` is
      // written, so we can re-render the page immediately to pick up the
      // fresh rows.
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
