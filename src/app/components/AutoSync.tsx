"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { refreshTodayHome } from "@/app/actions/financials";

/**
 * Silent refresh: user sees cached/stale Supabase data immediately.
 * After mount, may upsert today's row from XDASH; router.refresh() only if
 * { updated: true } — never blocks first paint.
 */
export default function AutoSync() {
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    refreshTodayHome().then((result) => {
      if (result?.updated === true) router.refresh();
    });
  }, [router]);

  return null;
}
