"use client";

import { useEffect, useRef, useState } from "react";
import FilterSidebar, { filterSidebarWidth } from "./FilterSidebar";
import { AdteLogoHeader } from "./AdteLogo";

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
      <header
        className="sticky top-0 z-30 border-b border-white/5 bg-black/95 backdrop-blur-sm transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] md:translate-y-0"
        style={{ transform: headerVisible ? "translateY(0)" : "translateY(-100%)" }}
      >
        <div className="mx-auto flex h-[150px] max-w-5xl items-center px-4 py-3 md:py-4">
          <AdteLogoHeader />
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
