"use client";

import { startTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { refreshTodayHome } from "@/app/actions/financials";
import { invalidatePrefetch } from "@/lib/tab-prefetch";

const RETRY_MS = 60_000;

/**
 * Silent refresh: user sees cached/stale Supabase data immediately.
 * After mount, may upsert today's row from XDASH; router.refresh() only if
 * { updated: true } — never blocks first paint.
 *
 * `startTransition` wraps the refresh so React keeps the current UI visible
 * while the new RSC payload streams in, eliminating the "page jump" that a
 * bare `router.refresh()` causes.
 */
export default function AutoSync() {
  const router = useRouter();
  const ran = useRef(false);
  const retryAttempted = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let idleHandle: number | undefined;

    const applyRefresh = () => {
      invalidatePrefetch();
      startTransition(() => {
        router.refresh();
      });
    };

    const scheduleRetry = () => {
      if (retryAttempted.current) return;
      retryAttempted.current = true;
      timeoutId = setTimeout(() => {
        refreshTodayHome()
          .then((result) => {
            if (result?.updated === true) applyRefresh();
          })
          .catch(() => {});
      }, RETRY_MS);
    };

    const run = () => {
      refreshTodayHome()
        .then((result) => {
          if (result?.updated === true) applyRefresh();
          else scheduleRetry();
        })
        .catch(() => {
          scheduleRetry();
        });
    };

    if (typeof requestIdleCallback !== "undefined") {
      idleHandle = requestIdleCallback(run, { timeout: 3000 });
    } else {
      timeoutId = setTimeout(run, 300);
    }

    return () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (idleHandle !== undefined && typeof cancelIdleCallback !== "undefined") {
        cancelIdleCallback(idleHandle);
      }
    };
  }, [router]);

  return null;
}
