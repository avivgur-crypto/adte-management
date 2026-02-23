"use client";

import { useEffect, useState } from "react";
import { getSalesFunnelMetricsAllTime } from "@/app/actions/sales";
import SalesFunnel from "./SalesFunnel";
import type { SalesFunnelMetrics } from "@/app/actions/sales";

export default function SalesFunnelFiltered() {
  const [data, setData] = useState<SalesFunnelMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSalesFunnelMetricsAllTime()
      .then((result) => {
        if (!cancelled) setData(result ?? null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load funnel");
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-8">
        <h2 className="mb-2 text-lg font-semibold text-white">
          Sales <span className="highlight-brand">Funnel</span>
        </h2>
        <p className="text-sm text-white/60">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-[var(--adte-funnel-bg)] p-6">
        <h2 className="mb-2 text-lg font-semibold text-white">
          Sales <span className="highlight-brand">Funnel</span>
        </h2>
        <p className="text-sm text-red-300">{error}</p>
      </div>
    );
  }

  return <SalesFunnel data={data} />;
}
