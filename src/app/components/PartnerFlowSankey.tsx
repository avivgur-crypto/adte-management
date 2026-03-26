"use client";

import { useMemo, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import type { DependencyMappingResult } from "@/app/actions/dependency-mapping";

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    setMobile(mq.matches);
    const fn = () => setMobile(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return mobile;
}

const ResponsiveSankey = dynamic(
  () => import("@nivo/sankey").then((m) => m.ResponsiveSankey),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[400px] w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] md:h-[500px]">
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

  const maxRevenue = Math.max(...top.map((r) => r.revenue), 1);
  /** Min display value so thin links (small revenue) still render visibly as lines. */
  const minDisplayValue = maxRevenue * 0.04;

  const links: SankeyLink[] = top.map((r) => ({
    source: `demand:${r.demandPartner}`,
    target: `supply:${r.supplyPartner}`,
    value: Math.max(r.revenue, minDisplayValue),
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

/** Truncate long names with "..." so they don't overlap; full name in tooltip. */
function formatNodeLabel(name: string, isMobile: boolean): string {
  const maxLen = isMobile ? 14 : 22;
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 3) + "...";
}

interface SelectedLink {
  source: string;
  target: string;
  revenue: number;
  profit: number;
}

export default function PartnerFlowSankey({
  data,
}: {
  data: DependencyMappingResult | null;
}) {
  const [mounted, setMounted] = useState(false);
  const isMobile = useIsMobile();
  const [selectedLink, setSelectedLink] = useState<SelectedLink | null>(null);
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
        <h2 className="mb-1 text-[25px] font-extrabold text-white">Tags <span className="highlight-brand">Flow</span></h2>
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
          Tags <span className="highlight-brand">Flow</span>
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
        <h2 className="text-[25px] font-extrabold text-white">Tags <span className="highlight-brand">Flow</span></h2>
        <p className="mt-1 text-sm text-white/50">
          {isMobile
            ? "Tap a flow line for details"
            : `Top ${sankeyData.links.length} Demand → Supply connections by revenue`}
        </p>
      </div>

      <div className="min-h-[320px] h-[min(420px,60vh)] w-full md:h-[500px]">
        <ResponsiveSankey
          data={sankeyData}
          margin={
            isMobile
              ? { top: 6, right: 12, bottom: 6, left: 12 }
              : { top: 16, right: 180, bottom: 16, left: 180 }
          }
          align="justify"
          sort="descending"
          colors={(node: SankeyNode) => node.nodeColor ?? "#00f2ff"}
          nodeOpacity={1}
          nodeHoverOpacity={1}
          nodeHoverOthersOpacity={0.25}
          nodeThickness={isMobile ? 10 : 20}
          nodeSpacing={isMobile ? 10 : 24}
          nodeInnerPadding={isMobile ? 1 : 3}
          nodeBorderWidth={isMobile ? 0 : 1}
          nodeBorderColor={{ from: "color", modifiers: [["darker", 0.5]] }}
          nodeBorderRadius={isMobile ? 2 : 3}
          linkOpacity={isMobile ? 0.9 : 0.85}
          linkHoverOpacity={1}
          linkHoverOthersOpacity={isMobile ? 0.15 : 0.2}
          linkContract={0}
          linkBlendMode="normal"
          enableLinkGradient={!isMobile}
          enableLabels={!isMobile}
          label={(node) => formatNodeLabel(stripPrefix(node.id as string), false)}
          labelPosition="outside"
          labelPadding={12}
          labelOrientation="horizontal"
          labelTextColor="#ffffff"
          onClick={(nodeOrLink) => {
            if (!isMobile) return;
            const item = nodeOrLink as unknown as Record<string, unknown>;
            if (item.source && item.target) {
              const src = item.source as { id?: string };
              const tgt = item.target as { id?: string };
              setSelectedLink({
                source: stripPrefix(src.id ?? ""),
                target: stripPrefix(tgt.id ?? ""),
                revenue: Number(item.revenue ?? item.value ?? 0),
                profit: Number(item.profitMarginPercent ?? 0),
              });
            } else if (item.id) {
              setSelectedLink({
                source: stripPrefix(String(item.id)),
                target: "",
                revenue: Number(item.value ?? 0),
                profit: 0,
              });
            }
          }}
          linkTooltip={({ link }) => {
            if (isMobile) return <span />;
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
          nodeTooltip={({ node }) => {
            if (isMobile) return <span />;
            const fullName = stripPrefix(node.id as string);
            return (
              <div className="rounded-lg border border-white/20 bg-[#1a1a2e] px-3 py-2.5 text-xs text-white shadow-xl max-w-[280px]">
                <div className="font-semibold text-white break-words" title={fullName}>
                  {fullName}
                </div>
                <div className="mt-1 text-white/90">
                  Total: {formatCurrency(node.value)}
                </div>
              </div>
            );
          }}
          theme={{
            text: { fill: "#cccccc", fontSize: 11 },
            labels: {
              text: {
                fontSize: 12,
                fontWeight: 600,
                fill: "#ffffff",
              },
            },
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

      {/* Mobile: selected link details panel — same format as dependency mapping expanded card */}
      {isMobile && (
        <div className="mt-3 min-h-[44px] md:hidden">
          {selectedLink ? (
            <div className="rounded-xl border border-white/15 bg-white/[0.06] text-xs">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Selected Connection</span>
                <button
                  type="button"
                  onClick={() => setSelectedLink(null)}
                  className="rounded px-1.5 py-0.5 text-white/30 active:text-white/60"
                >
                  ✕
                </button>
              </div>
              <div className="border-t border-white/[0.06] px-3 pb-3 pt-2">
                {selectedLink.target ? (
                  <div className="mb-2 space-y-0.5">
                    <div className="text-white/90 break-words leading-relaxed">
                      <span className="text-white/40">Demand: </span>{selectedLink.source}
                    </div>
                    <div className="text-white/70 break-words leading-relaxed">
                      <span className="text-white/40">Supply: </span>{selectedLink.target}
                    </div>
                  </div>
                ) : (
                  <div className="mb-2 text-white/90 break-words leading-relaxed">
                    {selectedLink.source}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
                  <div>
                    <div className="text-white/40">Revenue</div>
                    <div className="font-medium tabular-nums text-white/90">{formatCurrency(selectedLink.revenue)}</div>
                  </div>
                  {selectedLink.target && (
                    <div>
                      <div className="text-white/40">Profit</div>
                      <div className={`font-medium tabular-nums ${selectedLink.profit >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                        {selectedLink.profit.toFixed(1)}%
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-center text-xs text-white/30">Tap a line above to see details</p>
          )}
        </div>
      )}
    </div>
  );
}
