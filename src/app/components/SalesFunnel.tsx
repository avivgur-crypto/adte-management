"use client";

import { useState, useRef, useEffect } from "react";
import type { SalesFunnelMetrics } from "@/app/actions/sales";

const STAGES = [
  {
    key: "totalLeads" as const,
    label: "Total Leads",
    description: "All active leads from the Leads board",
    light: "#B3E8FF",
    mid: "#38BDF8",
    dark: "#0C4A6E",
  },
  {
    key: "qualifiedLeads" as const,
    label: "Qualified",
    description: "Active & Lost deals + Signed contracts",
    light: "#99F6E4",
    mid: "#2DD4BF",
    dark: "#134E4A",
  },
  {
    key: "opsApprovedLeads" as const,
    label: "Ops Approved",
    description: "Deals in legal/signing stages + Signed contracts",
    light: "#D9F99D",
    mid: "#A3E635",
    dark: "#3F6212",
  },
  {
    key: "wonDeals" as const,
    label: "Won Deals",
    description: "Total items from the Signed Contracts board",
    light: "#FED7AA",
    mid: "#FB923C",
    dark: "#7C2D12",
  },
];

/* ── Ring geometry (SVG coord-space) ── */
const CX = 48;
const RINGS = [
  { cy: 55, rx: 80, ry: 40, sw: 18 },
  { cy: 125, rx: 67, ry: 35, sw: 16 },
  { cy: 190, rx: 54, ry: 30, sw: 14 },
  { cy: 252, rx: 41, ry: 25, sw: 12 },
];
const VB = "15 0 230 290";
const VB_H = 290;
const DOT_CX = 210;
const DOT_R = 14;

/* Top half: clockwise arc through the top (the "front" facing us) */
function topArc(cx: number, cy: number, rx: number, ry: number) {
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx + rx} ${cy}`;
}
/* Bottom half: counter-clockwise arc through the bottom (the "back") */
function bottomArc(cx: number, cy: number, rx: number, ry: number) {
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 0 ${cx + rx} ${cy}`;
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

export default function SalesFunnel({
  data,
}: {
  data: SalesFunnelMetrics | null;
}) {
  const [activeTooltip, setActiveTooltip] = useState<number | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeTooltip === null) return;
    const handler = (e: MouseEvent) => {
      if (
        tooltipRef.current &&
        !tooltipRef.current.contains(e.target as Node)
      ) {
        setActiveTooltip(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [activeTooltip]);

  if (!data) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
        <h2 className="mb-4 text-center text-lg font-semibold text-white">
          Sales <span className="highlight-brand">Funnel</span>
        </h2>
        <p className="text-center text-sm text-white/60">
          No funnel data. Run{" "}
          <code className="rounded bg-white/10 px-1.5 py-0.5 text-white/80">
            npm run fetch:monday
          </code>{" "}
          to sync.
        </p>
      </div>
    );
  }

  const values = [
    data.totalLeads,
    data.qualifiedLeads,
    data.opsApprovedLeads,
    data.wonDeals,
  ];

  /* Conversion rate between consecutive stages (Qualified→Ops, Ops→Won); each ≤ 100%. */
  const conversionRates: (number | null)[] = [
    data.leadToQualifiedPercent,
    data.qualifiedToOpsPercent,
    data.opsToWonPercent,
  ];

  /*
   * Interlocking paint order (spring/coil effect):
   *  1. Ring 0 back  (behind ring 1 front)
   *  2. Ring 1 front (overlaps ring 0 back)
   *  3. Ring 1 back  (behind ring 2 front)
   *  4. Ring 2 front …
   *  …
   *  last: Ring 0 front (topmost, always in front)
   */
  const arcs: { idx: number; half: "top" | "bottom" }[] = [];
  arcs.push({ idx: 0, half: "bottom" });
  for (let i = 1; i < RINGS.length; i++) {
    arcs.push({ idx: i, half: "top" });
    arcs.push({ idx: i, half: "bottom" });
  }
  arcs.push({ idx: 0, half: "top" });

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-5 md:p-6">
      {/* Title — right-aligned */}
      <div className="mb-4 flex justify-end">
        <div className="text-right">
          <h2 className="text-xl font-semibold text-white md:text-2xl">
            Sales <span className="highlight-brand">Funnel</span>
          </h2>
          <p className="mt-0.5 text-sm text-white/60">
            Analyzing pipeline effectiveness
          </p>
        </div>
      </div>

      {/* Two-column: SVG funnel (left) + text rows (right) */}
      <div className="flex items-stretch gap-3 md:gap-5">
        {/* ── SVG: 3D rings + connector lines + numbered dots ── */}
        <svg
          className="w-[38%] flex-shrink-0 md:w-[34%]"
          viewBox={VB}
          preserveAspectRatio="xMinYMid meet"
        >
          <defs>
            {STAGES.map((s, i) => {
              const r = RINGS[i];
              return (
                <linearGradient
                  key={i}
                  id={`rg${i}`}
                  x1="0"
                  y1={r.cy - r.ry - r.sw / 2}
                  x2="0"
                  y2={r.cy + r.ry + r.sw / 2}
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0%" stopColor={s.light} />
                  <stop offset="40%" stopColor={s.mid} />
                  <stop offset="100%" stopColor={s.dark} />
                </linearGradient>
              );
            })}
          </defs>

          {/* Connector lines (3 parallel thin lines per stage) */}
          {RINGS.map((r, i) => {
            const x1 = CX + r.rx + r.sw / 2 + 2;
            const x2 = DOT_CX - DOT_R - 2;
            return [-1.5, 0, 1.5].map((dy) => (
              <line
                key={`ln${i}${dy}`}
                x1={x1}
                y1={r.cy + dy}
                x2={x2}
                y2={r.cy + dy}
                stroke="rgba(255,255,255,0.3)"
                strokeWidth="0.5"
              />
            ));
          })}

          {/* Interlocking ring arcs */}
          {arcs.map(({ idx, half }, ai) => {
            const r = RINGS[idx];
            const d =
              half === "top"
                ? topArc(CX, r.cy, r.rx, r.ry)
                : bottomArc(CX, r.cy, r.rx, r.ry);
            return (
              <g key={ai}>
                {/* Main tube stroke */}
                <path
                  d={d}
                  fill="none"
                  stroke={`url(#rg${idx})`}
                  strokeWidth={r.sw}
                />
                {/* Glossy highlight on front arcs */}
                {half === "top" && (
                  <path
                    d={d}
                    fill="none"
                    stroke="rgba(255,255,255,0.22)"
                    strokeWidth={r.sw * 0.18}
                    transform={`translate(0,${-r.sw * 0.3})`}
                  />
                )}
              </g>
            );
          })}

          {/* Numbered circles */}
          {RINGS.map((r, i) => (
            <g key={`d${i}`}>
              <circle
                cx={DOT_CX}
                cy={r.cy}
                r={DOT_R}
                fill={`url(#rg${i})`}
              />
              <text
                x={DOT_CX}
                y={r.cy + 1}
                textAnchor="middle"
                dominantBaseline="central"
                fill="white"
                fontSize="10"
                fontWeight="bold"
              >
                {String(i + 1).padStart(2, "0")}
              </text>
            </g>
          ))}
        </svg>

        {/* ── Text rows + conversion rate between stages ── */}
        <div className="relative min-h-0 flex-1">
          {STAGES.map((stage, i) => {
            const yPct = (RINGS[i].cy / VB_H) * 100;
            const isActive = activeTooltip === i;
            return (
              <div
                key={stage.key}
                ref={isActive ? tooltipRef : undefined}
                className={`absolute left-0 right-0 flex items-center justify-between gap-1 md:items-start md:gap-2 ${isActive ? "z-50" : ""}`}
                style={{ top: `${yPct}%`, transform: "translateY(-50%)" }}
              >
                {/* Left: stage name + (i) icon */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="whitespace-nowrap text-[13px] font-medium leading-tight text-white/95 md:text-xl">
                      {String(i + 1).padStart(2, "0")}. {stage.label}
                    </span>
                    {/* (i) icon — mobile: tap only */}
                    <button
                      type="button"
                      onClick={() =>
                        setActiveTooltip(isActive ? null : i)
                      }
                      className="flex shrink-0 rounded-full p-0.5 text-zinc-500 hover:text-zinc-300 focus:outline-none md:hidden"
                      aria-label={`Info: ${stage.label}`}
                    >
                      <InfoIcon className="h-3.5 w-3.5" />
                    </button>
                    {/* (i) icon — desktop: hover+click */}
                    <button
                      type="button"
                      onMouseEnter={() => setActiveTooltip(i)}
                      onMouseLeave={() => setActiveTooltip(null)}
                      onClick={() =>
                        setActiveTooltip(isActive ? null : i)
                      }
                      className="hidden shrink-0 rounded-full p-0.5 text-zinc-500 hover:bg-white/10 hover:text-zinc-300 focus:outline-none md:flex"
                      aria-label={`Info: ${stage.label}`}
                    >
                      <InfoIcon className="h-4 w-4" />
                    </button>
                  </div>
                  {/* Description — hidden on mobile */}
                  <p className="hidden text-xs text-zinc-400 md:block">
                    {stage.description}
                  </p>
                  {/* Tooltip popup */}
                  {isActive && (
                    <div
                      className="absolute left-0 top-full z-[200] mt-1.5 w-[210px] rounded-xl border border-white/20 bg-[#1a1a2e] px-3.5 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.7)]"
                      role="tooltip"
                    >
                      {/* Conversion % — shown above description */}
                      {i > 0 && conversionRates[i - 1] != null && (
                        <div className="mb-1.5 flex items-center gap-1.5">
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            className="text-white/60"
                          >
                            <path d="M12 5v14M19 12l-7 7-7-7" />
                          </svg>
                          <span className="text-sm font-semibold tabular-nums text-white">
                            {conversionRates[i - 1]}%
                          </span>
                          <span className="text-[11px] text-zinc-400">
                            from {STAGES[i - 1].label}
                          </span>
                        </div>
                      )}
                      <p className="text-xs leading-relaxed text-zinc-300">
                        {stage.description}
                      </p>
                    </div>
                  )}
                </div>
                {/* Right: value */}
                <div className="flex shrink-0 flex-col items-end gap-0 text-right">
                  <span className="whitespace-nowrap text-[13px] font-semibold tabular-nums leading-tight text-white/95 md:text-base md:font-medium">
                    {values[i]!.toLocaleString()}
                  </span>
                  <span className="hidden text-xs text-zinc-400 md:block">
                    {stage.label.toLowerCase()}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Conversion rate pills between stages — desktop only */}
          {conversionRates.map((pct, i) => {
            const midY = (RINGS[i].cy + RINGS[i + 1].cy) / 2;
            const yPct = (midY / VB_H) * 100;
            return (
              <div
                key={`conv-${i}`}
                className="absolute left-0 right-0 hidden items-center justify-end md:flex"
                style={{ top: `${yPct}%`, transform: "translateY(-50%)" }}
              >
                <div className="flex items-center gap-1 rounded-md border border-white/12 bg-white/[0.06] px-1.5 py-0.5 md:gap-1.5 md:px-2.5 md:py-1">
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-white/50 md:h-3.5 md:w-3.5"
                  >
                    <path d="M12 5v14M19 12l-7 7-7-7" />
                  </svg>
                  <span className="text-[10px] font-medium tabular-nums text-white/70 md:text-xs">
                    {pct != null ? `${pct}%` : "—"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Win Rate */}
      <div className="mt-6 flex justify-end border-t border-white/5 pt-4">
        <div className="text-right">
          <div className="text-sm font-medium uppercase tracking-wider text-white/45 md:text-base">
            Win Rate
          </div>
          <div className="mt-0.5 text-xl font-medium tabular-nums text-white/95 md:text-2xl">
            <span className="highlight-brand-simplicity">
              {data.overallWinRatePercent ?? "—"}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
