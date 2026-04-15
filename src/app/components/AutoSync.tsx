"use client";

import { startTransition, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { refreshTodayHome } from "@/app/actions/financials";
import { useSyncStatus } from "@/app/context/SyncStatusContext";
import { invalidatePrefetch } from "@/lib/tab-prefetch";

/** If the first idle refresh is skipped (rows still inside stale window), retry once after 1 minute. */
const RETRY_MS = 60_000;
/** Poll XDASH Home → Supabase so intraday totals stay near real time while the tab is open. */
const POLL_MS = 5 * 60 * 1000;

/**
 * Silent refresh: user sees cached/stale Supabase data immediately.
 * After mount, may upsert today's row from XDASH; router.refresh() only if
 * { updated: true } — never blocks first paint.
 *
 * `startTransition` wraps the refresh so React keeps the current UI visible
 * while the new RSC payload streams in, eliminating the "page jump" that a
 * bare `router.refresh()` causes.
 *
 * While mounted, repeats refreshTodayHome every POLL_MS so daily_home_totals
 * does not fall hours behind XDASH during the workday.
 */
export default function AutoSync() {
  const router = useRouter();
  const syncStatus = useSyncStatus();
  const retryAttempted = useRef(false);

  const applyAfterSuccessfulWrite = useCallback(() => {
    syncStatus?.setLastSyncedAt(new Date().toISOString());
    invalidatePrefetch();
    startTransition(() => {
      router.refresh();
    });
  }, [router, syncStatus]);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let idleHandle: number | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    const scheduleRetry = () => {
      if (retryAttempted.current) return;
      retryAttempted.current = true;
      timeoutId = setTimeout(() => {
        refreshTodayHome()
          .then((result) => {
            if (result?.updated === true) applyAfterSuccessfulWrite();
          })
          .catch(() => {});
      }, RETRY_MS);
    };

    const runPoll = () => {
      refreshTodayHome()
        .then((result) => {
          if (result?.updated === true) applyAfterSuccessfulWrite();
        })
        .catch(() => {});
    };

    const runInitial = () => {
      refreshTodayHome()
        .then((result) => {
          if (result?.updated === true) applyAfterSuccessfulWrite();
          else scheduleRetry();
        })
        .catch(() => {
          scheduleRetry();
        });
    };

    if (typeof requestIdleCallback !== "undefined") {
      idleHandle = requestIdleCallback(runInitial, { timeout: 3000 });
    } else {
      timeoutId = setTimeout(runInitial, 300);
    }

    pollTimer = setInterval(runPoll, POLL_MS);

    return () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (idleHandle !== undefined && typeof cancelIdleCallback !== "undefined") {
        cancelIdleCallback(idleHandle);
      }
      if (pollTimer !== undefined) clearInterval(pollTimer);
    };
  }, [router, applyAfterSuccessfulWrite]);

  return null;
}
