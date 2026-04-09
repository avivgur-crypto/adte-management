"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { refreshTodayHome } from "@/app/actions/financials";

const RETRY_MS = 60_000;

/**
 * Silent refresh: user sees cached/stale Supabase data immediately.
 * After mount, may upsert today's row from XDASH; router.refresh() only if
 * { updated: true } — never blocks first paint.
 * One retry after 60s if the first attempt returns { updated: false } or throws.
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

    const scheduleRetry = () => {
      if (retryAttempted.current) return;
      retryAttempted.current = true;
      timeoutId = setTimeout(() => {
        refreshTodayHome()
          .then((result) => {
            if (result?.updated === true) router.refresh();
          })
          .catch(() => {});
      }, RETRY_MS);
    };

    const run = () => {
      refreshTodayHome()
        .then((result) => {
          if (result?.updated === true) router.refresh();
          else scheduleRetry();
        })
        .catch(() => {
          scheduleRetry();
        });
    };

    // De-prioritize vs input/paint: run after the browser is idle (fallback ~300ms).
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
