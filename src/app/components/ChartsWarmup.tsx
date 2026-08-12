"use client";

import { useEffect } from "react";

/** Module-level so the warmup runs once per page load, not per mount. */
let warmed = false;

/**
 * Pre-fetches + compiles the charts-bundle chunk (~380 kB, recharts + chart
 * components) during the post-hydration idle window, WITHOUT mounting
 * anything. The charts themselves are viewport-gated (DeferUntilVisible), so
 * without this the chunk download would land on the critical scroll path;
 * with it, the module is already in cache when the user scrolls to a chart
 * and the mount is instant.
 */
export default function ChartsWarmup() {
  useEffect(() => {
    if (warmed) return;
    const fire = () => {
      if (warmed) return;
      warmed = true;
      void import("@/app/components/charts-bundle");
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(fire, { timeout: 5000 });
      return () => window.cancelIdleCallback(id);
    }
    // Safari: no requestIdleCallback — fixed delay past hydration.
    const t = setTimeout(fire, 3000);
    return () => clearTimeout(t);
  }, []);

  return null;
}
