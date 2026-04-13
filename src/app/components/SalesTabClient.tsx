"use client";

import { useEffect, useState } from "react";
import { prefetchSales, type SalesTabData } from "@/lib/tab-prefetch";
import DashboardErrorBoundary from "./DashboardErrorBoundary";
import SalesFunnelFiltered from "./SalesFunnelFiltered";
import ActivitySummary from "./ActivitySummary";
import { SkeletonCard } from "./SkeletonCard";

export default function SalesTabClient() {
  const [data, setData] = useState<SalesTabData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    prefetchSales()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || !data) {
    return (
      <div className="stagger-children flex flex-col gap-8">
        <SkeletonCard lines={5} />
        <SkeletonCard lines={4} />
      </div>
    );
  }

  return (
    <div className="stagger-children flex flex-col gap-8">
      <DashboardErrorBoundary sectionName="Sales funnel">
        <SalesFunnelFiltered initialData={data.initialFunnelData} />
      </DashboardErrorBoundary>
      <DashboardErrorBoundary sectionName="Activity summary">
        <ActivitySummary
          activityData={data.activityData}
          signedDealsCompanies={data.signedDealsCompanies}
        />
      </DashboardErrorBoundary>
    </div>
  );
}
