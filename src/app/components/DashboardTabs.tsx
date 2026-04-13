"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useFilter } from "@/app/context/FilterContext";
import { prefetchPartners, prefetchSales } from "@/lib/tab-prefetch";
import { SkeletonCard, SkeletonDonutGrid } from "./SkeletonCard";

const PartnersTabClient = dynamic(() => import("./PartnersTabClient"), {
  loading: () => (
    <div className="stagger-children flex flex-col gap-8">
      <SkeletonDonutGrid />
      <SkeletonCard lines={6} />
    </div>
  ),
});

const SalesTabClient = dynamic(() => import("./SalesTabClient"), {
  loading: () => (
    <div className="stagger-children flex flex-col gap-8">
      <SkeletonCard lines={5} />
      <SkeletonCard lines={4} />
    </div>
  ),
});

/**
 * Priority-loading tab container.
 *
 * `children` is the server-rendered Financial tab (the only tab resolved on the
 * server). Partners and Sales are loaded client-side on demand, backed by a
 * module-level promise cache that is warmed in the background once the Financial
 * tab is interactive.
 */
export default function DashboardTabs({ children }: { children: React.ReactNode }) {
  const { activeScreen } = useFilter();
  const prefetched = useRef(false);

  useEffect(() => {
    if (prefetched.current) return;
    prefetched.current = true;

    const run = () => {
      prefetchPartners();
      prefetchSales();
    };

    if (typeof requestIdleCallback !== "undefined") {
      const id = requestIdleCallback(run, { timeout: 5000 });
      return () => cancelIdleCallback(id);
    }
    const t = setTimeout(run, 2000);
    return () => clearTimeout(t);
  }, []);

  if (activeScreen === "partners") {
    return (
      <div key="partners" data-tab="partners">
        <PartnersTabClient />
      </div>
    );
  }

  if (activeScreen === "sales-funnel") {
    return (
      <div key="sales-funnel" data-tab="sales-funnel">
        <SalesTabClient />
      </div>
    );
  }

  return (
    <div key="financial" data-tab="financial">
      {children}
    </div>
  );
}
