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

    refreshTodayHome()
      .then((result) => {
        if (result?.updated === true) router.refresh();
        else scheduleRetry();
      })
      .catch(() => {
        scheduleRetry();
      });

    return () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [router]);

  return null;
}
