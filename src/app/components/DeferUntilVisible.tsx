"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Defers mounting `children` until the wrapper approaches the viewport.
 *
 * Used for below-the-fold charts: on mobile they dictated TTI because their
 * lazy chunk download + recharts mount ran eagerly during page load. With
 * this gate the work happens only when the user scrolls toward them (and
 * ChartsWarmup has usually already fetched the chunk by then).
 *
 * - `rootMargin` 600px: starts mounting well before the content enters view,
 *   so at normal scroll speed the chart is ready when it arrives.
 * - Once visible, stays mounted forever (never unmounts on scroll-away).
 * - The fallback must have a fixed height matching the mounted content so
 *   the swap causes no layout shift.
 */
export default function DeferUntilVisible({
  children,
  fallback,
  rootMargin = "600px 0px",
}: {
  children: ReactNode;
  fallback: ReactNode;
  rootMargin?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, rootMargin]);

  return <div ref={ref}>{visible ? children : fallback}</div>;
}
