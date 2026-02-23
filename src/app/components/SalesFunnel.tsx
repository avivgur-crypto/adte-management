"use client";

import {
  Info,
  X,
  Users,
  Lightbulb,
  FileCheck,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { SalesFunnelMetrics } from "@/app/actions/sales";

const STAGES: {
  key: keyof Pick<
    SalesFunnelMetrics,
    "totalLeads" | "qualifiedLeads" | "opsApprovedLeads" | "wonDeals"
  >;
  label: string;
  tooltip: string;
  bg: string;
  gradient: string;
  icon: LucideIcon;
}[] = [
  {
    key: "totalLeads",
    label: "Leads",
    tooltip: "Leads board + Signed Contracts",
    bg: "bg-[#F8CF71]",
    gradient: "from-[#FCE9B8] via-[#F5D88A] to-[#E5C25A]",
    icon: Users,
  },
  {
    key: "qualifiedLeads",
    label: "Qualified",
    tooltip: "Moved to Qualified",
    bg: "bg-[#566DF7]",
    gradient: "from-[#7A88F8] via-[#5A6CE8] to-[#4A52D0]",
    icon: Lightbulb,
  },
  {
    key: "opsApprovedLeads",
    label: "Ops Approved",
    tooltip: "Proposal/Negotiation",
    bg: "bg-[#F7669F]",
    gradient: "from-[#F89AB8] via-[#F06A98] to-[#DC5085]",
    icon: FileCheck,
  },
  {
    key: "wonDeals",
    label: "Won Deals",
    tooltip: "Closed Won",
    bg: "bg-[#66F7A9]",
    gradient: "from-[#8AFAC4] via-[#6AE8A8] to-[#52D892]",
    icon: Trophy,
  },
];

function StagePopover({
  stageLabel,
  text,
  open,
  onClose,
  cardRefs,
  index,
  children,
}: {
  stageLabel: string;
  text: string;
  open: boolean;
  onClose: () => void;
  cardRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  index: number;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return <>{children}</>;

  const anchor = cardRefs.current[index];
  const rect = anchor?.getBoundingClientRect();
  const style = rect
    ? {
        left: Math.min(rect.left + rect.width / 2 - 140, window.innerWidth - 300),
        top: rect.top + rect.height + 8,
      }
    : { left: "50%", top: "50%", transform: "translate(-50%, -50%)" as const };

  const popover = (
    <>
      <div className="fixed inset-0 z-[99]" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${stageLabel}: ${text}`}
        className="fixed z-[100] w-[280px] rounded-lg border border-white/10 bg-[var(--adte-funnel-bg)] px-3 py-2.5 shadow-xl"
        style={style}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-semibold uppercase tracking-wide text-white">
              {stageLabel}
            </div>
            <div className="mt-0.5 text-xs leading-relaxed text-white/70">
              {text}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-white/50 hover:bg-white/10"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      {children}
      {createPortal(popover, document.body)}
    </>
  );
}

export default function SalesFunnel({
  data,
}: {
  data: SalesFunnelMetrics | null;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [openPopoverIndex, setOpenPopoverIndex] = useState<number | null>(null);
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  if (!data) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
        <h2 className="mb-4 text-center text-lg font-semibold text-white">
          Sales <span className="highlight-brand">Funnel</span>
        </h2>
        <p className="text-center text-sm text-white/60">
          No funnel data. Run <code className="rounded bg-white/10 px-1.5 py-0.5 text-white/80">npm run fetch:monday</code> to sync.
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
  const conversionFromPrevious = [
    null,
    data.leadToQualifiedPercent,
    data.qualifiedLeads > 0
      ? Number(
          ((data.opsApprovedLeads / data.qualifiedLeads) * 100).toFixed(1)
        )
      : null,
    data.qualifiedToWonPercent,
  ];

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-5 md:p-6">
      <h2 className="text-center text-xl font-semibold text-white">
        Sales <span className="highlight-brand">Funnel</span>
      </h2>
      <p className="mb-6 text-center text-xs text-white/50">
        All-time pipeline from Monday
      </p>

      {/* One row per stage: [Card] —— line —— [Segment] */}
      <div className="mx-auto max-w-2xl space-y-0">
        {STAGES.map((stage, i) => (
          <div
            key={stage.key}
            className="flex items-stretch gap-0"
            style={{ minHeight: 72 }}
          >
            {/* Left: stage card with label, value, conversion */}
            <div
              ref={(el) => { cardRefs.current[i] = el; }}
              className="flex min-w-0 flex-1 items-center rounded-l-lg border border-white/[0.08] border-r-0 bg-black/30 py-3 pl-4 pr-2"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div
                  className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${stage.bg} text-white`}
                >
                  <stage.icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold uppercase tracking-wide text-white/90">
                    {stage.label}
                  </div>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="highlight-brand text-lg font-bold tabular-nums">
                      {values[i]!.toLocaleString()}
                    </span>
                    {conversionFromPrevious[i] != null && (
                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-sm font-semibold text-white/90">
                        {conversionFromPrevious[i]}% conversion
                      </span>
                    )}
                  </div>
                </div>
                <StagePopover
                  stageLabel={stage.label}
                  text={stage.tooltip}
                  open={openPopoverIndex === i}
                  onClose={() => setOpenPopoverIndex(null)}
                  cardRefs={cardRefs}
                  index={i}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setOpenPopoverIndex(openPopoverIndex === i ? null : i)
                    }
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-white/40 hover:bg-white/10 hover:text-white/80"
                    aria-label={`Info: ${stage.label}`}
                  >
                    <Info className="h-4 w-4" />
                  </button>
                </StagePopover>
              </div>
            </div>

            {/* Center: visible connector line */}
            <div
              className="flex w-8 flex-shrink-0 items-center bg-[var(--adte-funnel-bg)]"
              aria-hidden
            >
              <div className="h-0.5 w-full bg-white/25" title="" />
            </div>

            {/* Right: funnel segment (interactive) */}
            <div
              ref={(el) => { segmentRefs.current[i] = el; }}
              className="relative flex w-28 flex-shrink-0 items-center justify-center rounded-r-lg border border-white/[0.08] border-l-0"
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <div
                className={`h-full w-full rounded-r-lg bg-gradient-to-b ${stage.gradient} transition-all duration-200 ${
                  hoveredIndex === i ? "opacity-100 ring-2 ring-white/40" : "opacity-90"
                }`}
                style={{ minHeight: 72 }}
              />
              <div className="absolute inset-0 flex items-center justify-center rounded-r-lg border-0 border-transparent">
                <span className="text-center text-xs font-bold uppercase tracking-wide text-white drop-shadow-md">
                  {stage.label}
                </span>
              </div>
              {/* Tooltip on segment hover */}
              {hoveredIndex === i && (
                <div
                  className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 rounded bg-white/95 px-2 py-1 text-xs font-medium text-zinc-900 shadow-lg"
                  role="tooltip"
                >
                  {stage.tooltip}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Win Rate */}
      <div className="mt-6 flex justify-end border-t border-white/5 pt-4">
        <div className="text-right">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-white/50">
            Win Rate
          </div>
          <div className="text-2xl font-bold tabular-nums text-white md:text-3xl">
            <span className="highlight-brand-simplicity">
              {data.overallWinRatePercent ?? "—"}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
