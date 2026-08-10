"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  prefetchPartners,
  CONCENTRATION_MONTHS,
  type PartnersTabData,
} from "@/lib/tab-prefetch";
import DashboardErrorBoundary from "./DashboardErrorBoundary";
import PartnersFiltered from "./PartnersFiltered";
import { SkeletonCard, SkeletonDonutGrid } from "./SkeletonCard";

// Loaded from charts-bundle (the single recharts chunk) instead of statically,
// so this tab's chunk doesn't carry its own copy of recharts.
const PartnerDistributionCharts = dynamic(
  () =>
    import("@/app/components/charts-bundle").then((m) => ({
      default: m.PartnerDistributionCharts,
    })),
  {
    ssr: false,
    loading: () => <SkeletonDonutGrid />,
  },
);

export default function PartnersTabClient() {
  const [data, setData] = useState<PartnersTabData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    prefetchPartners()
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
        <SkeletonDonutGrid />
        <SkeletonCard lines={6} />
      </div>
    );
  }

  return (
    <div className="stagger-children flex flex-col gap-8">
      {data.hasError && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-red-200">
          Some partner data could not be loaded.
        </div>
      )}
      <DashboardErrorBoundary sectionName="Client concentration">
        <PartnerDistributionCharts
          dataByMonth={data.dataByMonth}
          monthKeys={CONCENTRATION_MONTHS}
        />
      </DashboardErrorBoundary>
      <DashboardErrorBoundary sectionName="Partner flow and Dependency mapping">
        <PartnersFiltered pairsByMonth={data.pairsByMonth} />
      </DashboardErrorBoundary>
    </div>
  );
}
