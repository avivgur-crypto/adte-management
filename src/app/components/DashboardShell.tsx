"use client";

import { useEffect, useRef, useState } from "react";
import FilterSidebar, { filterSidebarWidth } from "./FilterSidebar";
import { AdteLogoHeader } from "./AdteLogo";
import RouteActiveScreenSync from "./RouteActiveScreenSync";
import { prefetchActiveMonthForCurrentEntity } from "@/lib/pnl-client-cache";

/** Only on mobile: show header only when truly in top zone; hide when scrolled down. */
const TOP_ZONE_PX = 72;
const SCROLL_DELTA_PX = 24;

export default function DashboardShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const [headerVisible, setHeaderVisible] = useState(true);
  const lastScrollY = useRef(0);
  const rafId = useRef<number | null>(null);

  /**
   * Stage 1 — App-level prefetch.
   *
   * Warm the P&L cache for the current month/entity at app boot, scheduled at
   * idle time so it never competes with first paint or Financials interactivity.
   * By the time the user clicks "PNL", the snapshot is already in localStorage.
   */
  useEffect(() => {
    type IdleCallback = (cb: () => void, opts?: { timeout: number }) => number;
    const win = window as unknown as { requestIdleCallback?: IdleCallback };
    const schedule = win.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    const handle = schedule(() => prefetchActiveMonthForCurrentEntity(), { timeout: 3000 });
    return () => {
      const winCancel = window as unknown as { cancelIdleCallback?: (h: number) => void };
      if (typeof winCancel.cancelIdleCallback === "function") winCancel.cancelIdleCallback(handle as number);
      else clearTimeout(handle as unknown as number);
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    if (mq.matches) return;

    const onScroll = () => {
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        const y = window.scrollY;
        const prev = lastScrollY.current;

        if (y <= TOP_ZONE_PX) {
          setHeaderVisible(true);
        } else if (y > prev + SCROLL_DELTA_PX) {
          setHeaderVisible(false);
        } else if (y < prev - SCROLL_DELTA_PX) {
          setHeaderVisible(y <= TOP_ZONE_PX);
        }
        lastScrollY.current = y;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
    };
  }, []);

  return (
    <>
      <RouteActiveScreenSync />
      <header
        className="sticky top-0 z-30 border-b border-white/5 bg-black/95 backdrop-blur-sm transition-[transform,padding] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] md:translate-y-0 lg:pr-[var(--filter-sidebar-width)]"
        style={{
          transform: headerVisible ? "translateY(0)" : "translateY(-100%)",
          ["--filter-sidebar-width" as string]: `${filterSidebarWidth}px`,
        }}
      >
        <div className="mx-auto flex min-h-[88px] max-w-5xl items-center justify-start py-3 pl-3 pr-14 sm:pl-4 sm:pr-14 md:min-h-[96px] md:py-3.5 md:pr-4">
          <AdteLogoHeader className="min-w-0 shrink-0" />
        </div>
      </header>
      <main
        className="min-h-screen flex-1 pr-0 transition-[padding] lg:pr-[var(--filter-sidebar-width)]"
        style={{ ["--filter-sidebar-width" as string]: `${filterSidebarWidth}px` }}
      >
        {children}
      </main>
      <FilterSidebar />
    </>
  );
}
