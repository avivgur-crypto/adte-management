"use client";

import { useCallback, useEffect, useState } from "react";
import { getSalesFunnelMetricsFromMonday } from "@/app/actions/sales-funnel-live";
import type { SalesFunnelMetrics } from "@/app/actions/sales";
import SalesFunnel from "./SalesFunnel";

/** Refresh funnel from Monday every 5 min so it keeps updating live. */
const FUNNEL_REFRESH_MS = 300_000;

type Props = { initialData?: SalesFunnelMetrics | null };

export default function SalesFunnelFiltered({ initialData = null }: Props) {
  const [data, setData] = useState<SalesFunnelMetrics | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);

  const fetchFunnel = useCallback(() => {
    setError(null);
    return getSalesFunnelMetricsFromMonday()
      .then((result) => setData(result ?? null))
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load funnel");
        setData(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!initialData) {
      setLoading(true);
      fetchFunnel();
    }
    const interval = setInterval(() => {
      if (!cancelled) fetchFunnel();
    }, FUNNEL_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [fetchFunnel, initialData]);

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
