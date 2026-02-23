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

const SEGMENT_CLIPS: [string, string, string, string][] = [
  ["0% 0", "100% 0", "85% 100%", "15% 100%"],
  ["15% 0", "85% 0", "70% 100%", "30% 100%"],
  ["30% 0", "70% 0", "58% 100%", "42% 100%"],
  ["42% 0", "58% 0", "54% 100%", "46% 100%"],
];

const SEGMENT_CENTER_Y = [11.8, 36.9, 62.4, 87.9];

function StagePopover({
  stageLabel,
  text,
  open,
  onClose,
  triggerRect,
  children,
}: {
  stageLabel: string;
  text: string;
  open: boolean;
  onClose: () => void;
  triggerRect: DOMRect | null;
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

  const isDesktop = triggerRect && triggerRect.width > 0;
  const popover = (
    <>
      <div className="fixed inset-0 z-[99]" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${stageLabel}: ${text}`}
        className="fixed z-[100] w-[calc(100vw-2rem)] max-w-xs rounded-lg border border-white/10 bg-[var(--adte-funnel-bg)] px-3 py-2.5 shadow-xl"
        style={
          isDesktop
            ? {
                left: Math.min(
                  triggerRect.left + triggerRect.width + 8,
                  typeof window !== "undefined" ? window.innerWidth - 280 : 0
                ),
                top: Math.max(12, triggerRect.top + triggerRect.height / 2 - 32),
                transform: "translateY(-50%)",
              }
            : {
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
              }
        }
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
  const [openPopoverIndex, setOpenPopoverIndex] = useState<number | null>(null);
  const [triggerRects, setTriggerRects] = useState<(DOMRect | null)[]>([]);
  const triggerRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const updateRect = (i: number) => {
    const el = triggerRefs.current[i];
    if (el) {
      const rect = el.getBoundingClientRect();
      setTriggerRects((prev) => {
        const next = [...prev];
        while (next.length <= i) next.push(null);
        next[i] = rect;
        return next;
      });
    }
  };

  useEffect(() => {
    if (openPopoverIndex !== null) {
      const id = requestAnimationFrame(() => updateRect(openPopoverIndex));
      return () => cancelAnimationFrame(id);
    }
  }, [openPopoverIndex]);

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

  const funnelHeight = 240;
  const segmentGap = 4;

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-5 md:p-6">
      <h2 className="text-center text-xl font-semibold text-white">
        Sales <span className="highlight-brand">Funnel</span>
      </h2>
      <p className="mb-6 text-center text-xs text-white/50">
        All-time pipeline from Monday
      </p>

      {/* Desktop: compact 5-column grid */}
      <div
        className="relative hidden md:grid md:items-center md:gap-0"
        style={{
          gridTemplateColumns: "1fr 24px 200px 24px 1fr",
          gridTemplateRows: `${funnelHeight}px`,
        }}
      >
        {/* Left cards */}
        <div className="flex flex-col justify-center gap-3">
          <StageCard
            stage={STAGES[0]}
            value={values[0]}
            conversion={conversionFromPrevious[0]}
            openPopover={openPopoverIndex === 0}
            onPopoverOpen={() => setOpenPopoverIndex(0)}
            onPopoverClose={() => setOpenPopoverIndex(null)}
            triggerRect={triggerRects[0] ?? null}
            triggerRef={(el) => { triggerRefs.current[0] = el; }}
          />
          <StageCard
            stage={STAGES[2]}
            value={values[2]}
            conversion={conversionFromPrevious[2]}
            openPopover={openPopoverIndex === 2}
            onPopoverOpen={() => setOpenPopoverIndex(2)}
            onPopoverClose={() => setOpenPopoverIndex(null)}
            triggerRect={triggerRects[2] ?? null}
            triggerRef={(el) => { triggerRefs.current[2] = el; }}
          />
        </div>

        {/* Left connectors */}
        <div className="h-full w-full">
          <svg viewBox="0 0 24 100" preserveAspectRatio="none" className="h-full w-full">
            <path d={`M0 ${SEGMENT_CENTER_Y[0]} L24 ${SEGMENT_CENTER_Y[0]}`} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" />
            <path d={`M0 ${SEGMENT_CENTER_Y[2]} L24 ${SEGMENT_CENTER_Y[2]}`} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" />
          </svg>
        </div>

        {/* Funnel graphic */}
        <div className="flex flex-col items-center justify-center">
          <div
            className="flex w-full flex-col overflow-hidden rounded-lg"
            style={{ height: funnelHeight, gap: segmentGap }}
          >
            {STAGES.map((stage, i) => (
              <div
                key={stage.key}
                className="relative min-h-0 flex-1 overflow-hidden"
                style={{ clipPath: `polygon(${SEGMENT_CLIPS[i].join(", ")})` }}
              >
                <div className={`h-full w-full bg-gradient-to-b ${stage.gradient} opacity-90`} />
              </div>
            ))}
          </div>
        </div>

        {/* Right connectors */}
        <div className="h-full w-full">
          <svg viewBox="0 0 24 100" preserveAspectRatio="none" className="h-full w-full">
            <path d={`M24 ${SEGMENT_CENTER_Y[1]} L0 ${SEGMENT_CENTER_Y[1]}`} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" />
            <path d={`M24 ${SEGMENT_CENTER_Y[3]} L0 ${SEGMENT_CENTER_Y[3]}`} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" />
          </svg>
        </div>

        {/* Right cards */}
        <div className="flex flex-col justify-center gap-3">
          <StageCard
            stage={STAGES[1]}
            value={values[1]}
            conversion={conversionFromPrevious[1]}
            openPopover={openPopoverIndex === 1}
            onPopoverOpen={() => setOpenPopoverIndex(1)}
            onPopoverClose={() => setOpenPopoverIndex(null)}
            triggerRect={triggerRects[1] ?? null}
            triggerRef={(el) => { triggerRefs.current[1] = el; }}
          />
          <StageCard
            stage={STAGES[3]}
            value={values[3]}
            conversion={conversionFromPrevious[3]}
            openPopover={openPopoverIndex === 3}
            onPopoverOpen={() => setOpenPopoverIndex(3)}
            onPopoverClose={() => setOpenPopoverIndex(null)}
            triggerRect={triggerRects[3] ?? null}
            triggerRef={(el) => { triggerRefs.current[3] = el; }}
          />
        </div>
      </div>

      {/* Mobile: vertical stack */}
      <div className="mt-4 flex flex-col gap-4 md:mt-0 md:hidden">
        <div
          className="relative mx-auto flex w-full max-w-[200px] flex-col overflow-hidden rounded-lg"
          style={{ height: 200, gap: segmentGap }}
        >
          {STAGES.map((stage, i) => (
            <div
              key={stage.key}
              className="relative min-h-0 flex-1 overflow-hidden"
              style={{ clipPath: `polygon(${SEGMENT_CLIPS[i].join(", ")})` }}
            >
              <div className={`h-full w-full bg-gradient-to-b ${stage.gradient} opacity-90`} />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-center text-[10px] font-bold uppercase tracking-wide text-white drop-shadow-md">
                  {stage.label}
                </span>
              </div>
            </div>
          ))}
        </div>
        {STAGES.map((stage, i) => (
          <StageCard
            key={stage.key}
            stage={stage}
            value={values[i]}
            conversion={conversionFromPrevious[i]}
            openPopover={openPopoverIndex === i}
            onPopoverOpen={() => setOpenPopoverIndex(i)}
            onPopoverClose={() => setOpenPopoverIndex(null)}
            triggerRect={triggerRects[i] ?? null}
            triggerRef={(el) => { triggerRefs.current[i] = el; }}
          />
        ))}
      </div>

      {/* Win Rate */}
      <div className="mt-5 flex justify-end">
        <div className="text-right">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-white/50">
            Win Rate
          </div>
          <div className="text-2xl font-bold tabular-nums text-white md:text-3xl">
            <span className="highlight-brand-simplicity">{data.overallWinRatePercent ?? "—"}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StageCard({
  stage,
  value,
  conversion,
  openPopover,
  onPopoverOpen,
  onPopoverClose,
  triggerRect,
  triggerRef,
}: {
  stage: (typeof STAGES)[number];
  value: number;
  conversion: number | null;
  openPopover: boolean;
  onPopoverOpen: () => void;
  onPopoverClose: () => void;
  triggerRect: DOMRect | null;
  triggerRef: (el: HTMLButtonElement | null) => void;
}) {
  const Icon = stage.icon;
  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/30 px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <div
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${stage.bg} text-white`}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-white/80">
            {stage.label}
          </div>
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="highlight-brand text-base font-bold tabular-nums md:text-lg">
              {value.toLocaleString()}
            </span>
            {conversion != null && (
              <span className="text-[10px] text-white/40">
                {conversion}%
              </span>
            )}
          </div>
        </div>
        <StagePopover
          stageLabel={stage.label}
          text={stage.tooltip}
          open={openPopover}
          onClose={onPopoverClose}
          triggerRect={triggerRect}
        >
          <button
            ref={triggerRef}
            type="button"
            onClick={() => (openPopover ? onPopoverClose() : onPopoverOpen())}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-white/10 text-white/30 hover:bg-white/10 hover:text-white/70 [touch-action:manipulation]"
            aria-label={`Info: ${stage.label}`}
            aria-expanded={openPopover}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </StagePopover>
      </div>
    </div>
  );
}
