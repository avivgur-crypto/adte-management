"use client";

import { useMemo, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import type { DependencyMappingResult } from "@/app/actions/dependency-mapping";

const ResponsiveSankey = dynamic(
  () => import("@nivo/sankey").then((m) => m.ResponsiveSankey),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[500px] w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.03]">
        <p className="text-sm text-white/40">Loading chart…</p>
      </div>
    ),
  }
);

const TOP_N = 15;

/** Vibrant high-contrast palette for dark mode. */
const VIBRANT_PALETTE = [
  "#00f2ff", // cyan
  "#70ff00", // lime
  "#ff007a", // magenta
  "#ff9e00", // orange
  "#9d00ff", // purple
  "#24ff8a", // mint
  "#00f2ff",
  "#70ff00",
  "#ff007a",
  "#ff9e00",
  "#9d00ff",
  "#24ff8a",
  "#00f2ff",
  "#70ff00",
  "#ff007a",
];

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

interface SankeyNode {
  id: string;
  nodeColor?: string;
}

interface SankeyLink {
  source: string;
  target: string;
  value: number;
  revenue: number;
  profitMarginPercent: number;
}

function buildSankeyData(rows: DependencyMappingResult["rows"]) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const top = rows
    .filter((r) => r && typeof r.revenue === "number" && r.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, TOP_N);

  if (top.length === 0) return null;

  const demandSet = new Set<string>();
  const supplySet = new Set<string>();
  for (const r of top) {
    demandSet.add(r.demandPartner);
    supplySet.add(r.supplyPartner);
  }

  const nodes: SankeyNode[] = [];
  let idx = 0;
  for (const d of demandSet) {
    nodes.push({ id: `demand:${d}`, nodeColor: VIBRANT_PALETTE[idx % VIBRANT_PALETTE.length] });
    idx++;
  }
  for (const s of supplySet) {
    nodes.push({ id: `supply:${s}`, nodeColor: VIBRANT_PALETTE[idx % VIBRANT_PALETTE.length] });
    idx++;
  }

  const links: SankeyLink[] = top.map((r) => ({
    source: `demand:${r.demandPartner}`,
    target: `supply:${r.supplyPartner}`,
    value: Math.max(r.revenue, 1),
    revenue: r.revenue,
    profitMarginPercent: r.profitMarginPercent,
  }));

  return { nodes, links };
}

function stripPrefix(id: string): string {
  if (id.startsWith("demand:")) return id.slice(7);
  if (id.startsWith("supply:")) return id.slice(7);
  return id;
}

export default function PartnerFlowSankey({
  data,
}: {
  data: DependencyMappingResult | null;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const sankeyData = useMemo(() => {
    if (!data || !Array.isArray(data.rows) || data.rows.length === 0) return null;
    const built = buildSankeyData(data.rows);
    if (!built || built.nodes.length < 2 || built.links.length < 1) return null;
    return built;
  }, [data]);

  if (!mounted) {
    return (
      <div className="w-full max-w-5xl rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
        <h2 className="mb-1 text-[25px] font-extrabold text-white">Partner Flow</h2>
        <p className="mt-1 text-sm text-white/50">Demand → Supply revenue flow</p>
        <div className="mt-6 flex h-[500px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.03]">
          <p className="text-sm text-white/40">Loading chart…</p>
        </div>
      </div>
    );
  }

  if (!sankeyData) {
    return (
      <div className="w-full max-w-5xl rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
        <h2 className="mb-1 text-[25px] font-extrabold text-white">
          Partner Flow
        </h2>
        <p className="mt-1 text-sm text-white/50">
          Demand → Supply revenue flow
        </p>
        <div className="mt-6 flex h-[200px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.03]">
          <p className="text-sm text-white/40">No flow data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
      <div className="mb-4">
        <h2 className="text-[25px] font-extrabold text-white">Partner Flow</h2>
        <p className="mt-1 text-sm text-white/50">
          Top {Math.min(TOP_N, sankeyData.links.length)} Demand → Supply
          connections by revenue
        </p>
      </div>

      <div className="h-[500px] w-full">
        <ResponsiveSankey
          data={sankeyData}
          margin={{ top: 16, right: 160, bottom: 16, left: 160 }}
          align="justify"
          sort="descending"
          colors={(node: SankeyNode) => node.nodeColor ?? "#00f2ff"}
          nodeOpacity={1}
          nodeHoverOpacity={1}
          nodeHoverOthersOpacity={0.25}
          nodeThickness={20}
          nodeSpacing={24}
          nodeInnerPadding={3}
          nodeBorderWidth={1}
          nodeBorderColor={{ from: "color", modifiers: [["darker", 0.5]] }}
          nodeBorderRadius={3}
          linkOpacity={0.6}
          linkHoverOpacity={0.9}
          linkHoverOthersOpacity={0.12}
          linkContract={3}
          linkBlendMode="screen"
          enableLinkGradient
          enableLabels
          label={(node) => stripPrefix(node.id as string)}
          labelPosition="outside"
          labelPadding={12}
          labelOrientation="horizontal"
          labelTextColor="#ffffff"
          linkTooltip={({ link }) => {
            const l = link as unknown as {
              source: { id: string };
              target: { id: string };
              revenue?: number;
              profitMarginPercent?: number;
              value: number;
            };
            const rev = l.revenue ?? l.value;
            const margin = l.profitMarginPercent ?? 0;
            return (
              <div className="rounded-lg border border-white/20 bg-[#1a1a2e] px-3 py-2.5 text-xs text-white shadow-xl">
                <span className="font-semibold text-white">
                  {stripPrefix(l.source.id)}
                </span>
                <span className="mx-1.5 text-white/60">→</span>
                <span className="font-semibold text-white">
                  {stripPrefix(l.target.id)}
                </span>
                <div className="mt-1.5 flex gap-3">
                  <span className="text-white/90">
                    Revenue:{" "}
                    <span className="font-medium text-emerald-300">
                      {formatCurrency(rev)}
                    </span>
                  </span>
                  <span className="text-white/90">
                    Profit:{" "}
                    <span
                      className={`font-medium ${margin >= 0 ? "text-emerald-300" : "text-red-300"}`}
                    >
                      {margin.toFixed(1)}%
                    </span>
                  </span>
                </div>
              </div>
            );
          }}
          nodeTooltip={({ node }) => (
            <div className="rounded-lg border border-white/20 bg-[#1a1a2e] px-3 py-2.5 text-xs text-white shadow-xl">
              <span className="font-semibold text-white">{stripPrefix(node.id as string)}</span>
              <span className="ml-2 text-white/90">
                {formatCurrency(node.value)}
              </span>
            </div>
          )}
          theme={{
            text: { fill: "#cccccc", fontSize: 11 },
            labels: { text: { fontSize: 12, fontWeight: 600, fill: "#ffffff" } },
            tooltip: {
              container: {
                background: "transparent",
                padding: 0,
                boxShadow: "none",
              },
            },
          }}
        />
      </div>
    </div>
  );
}
