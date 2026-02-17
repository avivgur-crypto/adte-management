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
  /** Soft gradient for rounded 3D look (lighter top → darker bottom) */
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

/** Per-segment trapezoid clip: top wider, bottom narrower. Segment 4 = full trapezoid (not cut off). */
const SEGMENT_CLIPS: [string, string, string, string][] = [
  ["0% 0", "100% 0", "85% 100%", "15% 100%"],
  ["15% 0", "85% 0", "70% 100%", "30% 100%"],
  ["30% 0", "70% 0", "58% 100%", "42% 100%"],
  ["42% 0", "58% 0", "54% 100%", "46% 100%"], // complete trapezoid, ~8% bottom width
];

/** Vertical center of each funnel segment (%), for connector lines. */
const SEGMENT_CENTER_Y = [11.8, 36.9, 62.4, 87.9];

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  const names = "JanFebMarAprMayJunJulAugSepOctNovDec";
  const name = names.slice((parseInt(m, 10) - 1) * 3, parseInt(m, 10) * 3);
  return `${name} ${y}`;
}

function formatMonthsLabel(months: string[]): string {
  if (months.length === 0) return "";
  return months.map(monthLabel).join(", ");
}

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
        className="fixed z-[100] w-[calc(100vw-2rem)] max-w-sm rounded-lg border border-[#2B2B4A]/20 bg-[#F8F6F1] px-4 py-3 shadow-xl"
        style={
          isDesktop
            ? {
                left: Math.min(
                  triggerRect.left + triggerRect.width + 10,
                  typeof window !== "undefined" ? window.innerWidth - 320 : 0
                ),
                top: Math.max(12, triggerRect.top + triggerRect.height / 2 - 40),
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
            <div className="font-semibold uppercase tracking-wide text-[#2B2B4A]">
              {stageLabel}
            </div>
            <div className="mt-1 text-sm leading-relaxed text-[#2B2B4A]/75">
              {text}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[#2B2B4A]/60 hover:bg-[#2B2B4A]/10"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
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
      <div className="rounded-2xl bg-[#F8F6F1] p-6">
        <h2 className="mb-4 text-center text-xl font-bold uppercase tracking-wide text-[#2B2B4A]">
          Sales Funnel
        </h2>
        <p className="text-center text-sm text-[#2B2B4A]/75">
          No funnel data for selected period. Run{" "}
          <code className="rounded bg-white/80 px-1.5 py-0.5">npm run fetch:monday</code> to
          sync.
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

  const funnelHeight = 320;
  const segmentGap = 6;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-[#F8F6F1] p-6 pb-8 md:p-8">
      <h2 className="relative text-center text-2xl font-bold uppercase tracking-wide text-[#2B2B4A] md:text-3xl">
        Sales Funnel
      </h2>
      <p className="relative mb-1 text-center text-sm text-[#2B2B4A]/70">
        Automatically from monday · {monthLabel(data.month)}
      </p>
      <p className="relative mb-8 text-center text-xs text-[#2B2B4A]/60">
        Displaying data for: {formatMonthsLabel(data.months ?? [data.month])}
      </p>

      {/* Desktop (md+): 5-column grid — left cards | connector | funnel | connector | right cards */}
      <div
        className="relative hidden md:grid md:grid-cols-[300px_36px_320px_36px_300px] md:grid-rows-[320px] md:items-center md:gap-0 md:px-2"
      >
        {/* Column 1: left cards */}
        <div className="flex flex-col justify-center gap-4 md:min-w-0">
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

        {/* Column 2: left connector lines (card → funnel), desktop only */}
        <div className="hidden h-full w-full md:block">
          <svg
            viewBox="0 0 36 100"
            preserveAspectRatio="none"
            className="h-full w-full"
          >
            <path
              d={`M0 ${SEGMENT_CENTER_Y[0]} L36 ${SEGMENT_CENTER_Y[0]}`}
              fill="none"
              stroke="#d1d5db"
              strokeWidth="1"
            />
            <path
              d={`M0 ${SEGMENT_CENTER_Y[2]} L36 ${SEGMENT_CENTER_Y[2]}`}
              fill="none"
              stroke="#d1d5db"
              strokeWidth="1"
            />
          </svg>
        </div>

        {/* Column 3: funnel — no text inside segments on desktop */}
        <div className="flex flex-shrink-0 flex-col items-center justify-center md:w-[320px] md:min-w-[320px] md:max-w-[320px]">
          <div
            className="flex w-full flex-col overflow-hidden rounded-xl shadow-lg"
            style={{ height: funnelHeight, gap: segmentGap }}
          >
            {STAGES.map((stage, i) => (
              <div
                key={stage.key}
                className="relative flex-1 min-h-0 overflow-hidden"
                style={{
                  clipPath: `polygon(${SEGMENT_CLIPS[i].join(", ")})`,
                }}
              >
                <div
                  className={`h-full w-full bg-gradient-to-b ${stage.gradient} shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]`}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Column 4: right connector lines (funnel → card), desktop only */}
        <div className="hidden h-full w-full md:block">
          <svg
            viewBox="0 0 36 100"
            preserveAspectRatio="none"
            className="h-full w-full"
          >
            <path
              d={`M36 ${SEGMENT_CENTER_Y[1]} L0 ${SEGMENT_CENTER_Y[1]}`}
              fill="none"
              stroke="#d1d5db"
              strokeWidth="1"
            />
            <path
              d={`M36 ${SEGMENT_CENTER_Y[3]} L0 ${SEGMENT_CENTER_Y[3]}`}
              fill="none"
              stroke="#d1d5db"
              strokeWidth="1"
            />
          </svg>
        </div>

        {/* Column 5: right cards */}
        <div className="flex flex-col justify-center gap-4 md:min-w-0">
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

      {/* Mobile (< 768px): vertical stack — funnel then cards; popover opens on tap */}
      <div className="mt-6 flex flex-col gap-5 md:mt-0 md:hidden">
        <div
          className="relative mx-auto flex w-full max-w-[260px] flex-col overflow-hidden rounded-xl shadow-lg"
          style={{ height: 260, gap: segmentGap }}
        >
          {STAGES.map((stage, i) => (
            <div
              key={stage.key}
              className="relative flex-1 min-h-0 overflow-hidden"
              style={{
                clipPath: `polygon(${SEGMENT_CLIPS[i].join(", ")})`,
              }}
            >
              <div
                className={`h-full w-full bg-gradient-to-b ${stage.gradient} shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]`}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-center text-xs font-bold uppercase tracking-wide text-white drop-shadow-md">
                  {stage.label.toUpperCase()}
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

      {/* Win Rate - bottom right, prominent */}
      <div className="mt-8 flex justify-end">
        <div className="text-right">
          <div className="text-xs font-semibold uppercase tracking-widest text-[#2B2B4A]/80">
            Win Rate
          </div>
          <div className="text-3xl font-bold tabular-nums text-[#2B2B4A] md:text-4xl">
            {data.overallWinRatePercent ?? "—"}%
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
    <div className="rounded-2xl border border-[#2B2B4A]/06 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full ${stage.bg} text-white shadow-sm`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-bold uppercase tracking-wide text-[#2B2B4A]">
            {stage.label}
          </div>
          <p className="mt-0.5 text-xs leading-snug text-[#2B2B4A]/70">
            {stage.tooltip}
          </p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-xl font-bold tabular-nums text-[#2B2B4A] md:text-2xl">
              {value.toLocaleString()}
            </span>
            {conversion != null && (
              <span className="text-sm font-normal text-[#2B2B4A]/60">
                {conversion}% from prior
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
            className="flex h-11 min-h-[44px] w-11 min-w-[44px] flex-shrink-0 items-center justify-center rounded-full border border-[#2B2B4A]/10 bg-white text-[#2B2B4A]/50 shadow-sm hover:bg-[#2B2B4A]/06 hover:text-[#2B2B4A] [touch-action:manipulation]"
            aria-label={`Info: ${stage.label}`}
            aria-expanded={openPopover}
          >
            <Info className="h-5 w-5" />
          </button>
        </StagePopover>
      </div>
    </div>
  );
}
