"use client";

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { Urbanist } from "next/font/google";
import type { PnlEntity, PnlRow, PnlSnapshot } from "@/app/actions/pnl";
import type { PnlLayoutMetrics } from "@/lib/pnl-layout-metrics";
import { writePnlLayoutMetrics } from "@/lib/pnl-layout-metrics";

const urbanist = Urbanist({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const PNL_DEBUG = process.env.NEXT_PUBLIC_PNL_DEBUG === "1";

const ENTITIES: PnlEntity[] = ["Consolidated", "TMS", "Adte"];

const LINE_ORDER = new Map<string, number>([
  ["Media Revenue", 10],
  ["SAAS Revenue", 20],
  ["Revenue", 25],
  ["Total Revenue", 30],
  ["Media Costs", 40],
  ["Adash Costs", 45],
  ["SaaS Costs", 50],
  ["Total COGS", 60],
  ["Gross Profit", 70],
  ["G. Margin", 80],
  ["Marketing & PR", 90],
  ["Legal and Accounting", 100],
  ["Admin", 110],
  ["R&D", 120],
  ["HR", 130],
  ["Total OPEX", 140],
  ["Operating Profit (EBITDA)", 150],
  ["P. Margin", 160],
  ["Monthly OpEX", 170],
  ["Real Profit", 180],
]);

function formatCurrency(n: number): string {
  if (Math.abs(n) >= 1_000_000) {
    const sign = n < 0 ? "-" : "";
    return `${sign}$${(Math.abs(n) / 1_000_000).toFixed(3)}M`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function isMargin(row: Pick<PnlRow, "label">): boolean {
  const lab = row.label.toLowerCase();
  return lab.includes("margin") || lab.includes("%");
}

function formatDisplayAmount(row: PnlRow): string {
  if (row.label === "P. Margin") {
    const safe = Number.isFinite(row.amount) ? row.amount : 0;
    return `${safe.toFixed(2)}%`;
  }
  return formatCurrency(row.amount);
}

function blankRow(category: string, label: string): PnlRow {
  return { category, label, amount: 0, prevAmount: null, momPercent: null };
}

function sortRows(rows: PnlRow[]): PnlRow[] {
  return [...rows].sort((a, b) => {
    const ao = lineOrder(a.label);
    const bo = lineOrder(b.label);
    return ao - bo || a.label.localeCompare(b.label);
  });
}

function lineOrder(label: string): number {
  return LINE_ORDER.get(label) ?? 999;
}

function isGrossRow(r: PnlRow): boolean {
  return r.category === "Revenue" || r.category === "COGS" || r.category === "Gross Profit";
}

function isOpexRow(r: PnlRow): boolean {
  return r.category === "OPEX" || r.category.startsWith("OPEX -");
}

function isBottomRow(r: PnlRow): boolean {
  return !isGrossRow(r) && !isOpexRow(r);
}

const SummaryCard = memo(function SummaryCard({
  row,
  accent,
  emphasized = false,
}: {
  row: PnlRow;
  accent: "blue" | "rose" | "emerald" | "amber" | "purple";
  emphasized?: boolean;
}) {
  const positive = row.amount >= 0;
  const accentClass = {
    blue: "border-t-cyan-400/80 bg-cyan-500/[0.08] ring-cyan-300/15",
    rose: "border-t-rose-500 bg-rose-500/[0.08] ring-rose-400/15",
    emerald: "border-t-emerald-400/80 bg-emerald-500/[0.08] ring-emerald-300/15",
    amber: "border-t-amber-400/80 bg-amber-500/[0.08] ring-amber-300/15",
    purple: "border-t-indigo-400/80 bg-indigo-500/[0.08] ring-indigo-300/15",
  }[accent];
  const mobileAccentClass = {
    blue: "border-b-cyan-400/70",
    rose: "border-b-rose-500/80",
    emerald: "border-b-emerald-400/70",
    amber: "border-b-amber-400/70",
    purple: "border-b-indigo-400/70",
  }[accent];
  const valueGlowClass = {
    blue: "md:before:bg-cyan-400/30 md:after:bg-cyan-200/10 text-cyan-50",
    rose: "md:before:bg-rose-500/28 md:after:bg-rose-200/10 text-rose-50",
    emerald: "md:before:bg-emerald-400/28 md:after:bg-emerald-200/10 text-emerald-50",
    amber: "",
    purple: "",
  }[accent];

  return (
    <div
      className={`grid min-h-[104px] grid-rows-[36px_1fr] rounded-2xl border border-b-2 border-t-2 border-white/10 bg-white/10 p-3 shadow-none ring-1 md:border-b md:shadow-[0_18px_45px_-28px_rgba(0,0,0,0.9)] md:backdrop-blur-sm ${accentClass} ${mobileAccentClass}`}
    >
      <p className="flex items-start text-[10px] font-bold uppercase leading-[1.15] tracking-[0.16em] text-white/45">
        {row.label}
      </p>
      <div className="flex items-start">
        <p
          className={`relative z-0 inline-flex h-9 items-center text-xl font-extrabold tabular-nums tracking-[-0.045em] sm:text-2xl ${
            positive ? (emphasized ? valueGlowClass : "text-white") : "text-red-200"
          } ${
            emphasized && positive
              ? "md:before:absolute md:before:left-1/2 md:before:top-1/2 md:before:-z-10 md:before:h-8 md:before:w-[118%] md:before:-translate-x-1/2 md:before:-translate-y-1/2 md:before:rounded-full md:before:blur-xl md:after:absolute md:after:left-1/2 md:after:top-1/2 md:after:-z-10 md:after:h-5 md:after:w-[86%] md:after:-translate-x-1/2 md:after:-translate-y-1/2 md:after:rounded-full md:after:blur-md md:[text-shadow:0_1px_0_rgba(255,255,255,0.16),0_10px_26px_rgba(0,0,0,0.38)]"
              : ""
          }`}
        >
          {formatDisplayAmount(row)}
        </p>
      </div>
    </div>
  );
});

const AccordionSection = memo(function AccordionSection({
  title,
  total,
  children,
  lazyMountBody = false,
  closedBodyMinHeight = 0,
}: {
  title: string;
  total: number;
  children: React.ReactNode;
  /** When true, children mount only after the user opens the section once (Tier 3 — keeps OPEX off the critical path). */
  lazyMountBody?: boolean;
  /** Placeholder height (px) for the collapsed body before first open when lazyMountBody is set. */
  closedBodyMinHeight?: number;
}) {
  const [bodyMounted, setBodyMounted] = useState(!lazyMountBody);
  return (
    <details
      className="group overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] shadow-[0_18px_45px_-30px_rgba(0,0,0,0.95)]"
      onToggle={(event) => {
        if (!lazyMountBody) return;
        if ((event.currentTarget as HTMLDetailsElement).open) setBodyMounted(true);
      }}
    >
      <summary className="grid min-h-11 cursor-pointer list-none grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-white/10 bg-white/[0.045] px-3 py-2.5 outline-none transition-colors hover:bg-white/[0.07] marker:content-none [&::-webkit-details-marker]:hidden">
        <h2 className="min-w-0 truncate text-sm font-bold tracking-[-0.02em] text-white">{title}</h2>
        <span className={`text-sm font-bold tabular-nums tracking-[-0.02em] ${total < 0 ? "text-red-200" : "text-white"}`}>
          {formatCurrency(total)}
        </span>
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 text-xs text-white/50 transition-transform duration-300 group-open:rotate-180">
          v
        </span>
      </summary>
      <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-300 ease-out group-open:grid-rows-[1fr]">
        <div className="min-h-0 overflow-hidden">
          {bodyMounted ? (
            children
          ) : (
            <div
              className="bg-white/[0.02]"
              style={{ minHeight: Math.max(closedBodyMinHeight, 44) }}
              aria-hidden
            />
          )}
        </div>
      </div>
    </details>
  );
}, (prev, next) =>
  prev.title === next.title &&
  prev.total === next.total &&
  prev.children === next.children &&
  prev.lazyMountBody === next.lazyMountBody &&
  prev.closedBodyMinHeight === next.closedBodyMinHeight);

const PnlTableRow = memo(function PnlTableRow({
  row,
  idx,
}: {
  row: PnlRow;
  idx: number;
}) {
  const isTotal = row.label.startsWith("Total") || row.label.includes("Profit") || row.label === "P. Margin";
  const isZero = row.amount === 0;
  return (
    <div
      className={`grid min-h-11 grid-cols-[1fr_auto] items-center gap-3 px-3 py-2.5 ${
        idx % 2 === 0 ? "bg-white/[0.025]" : "bg-transparent"
      } ${isTotal ? "font-bold" : ""} ${isZero ? "opacity-40" : ""}`}
    >
      <div className="min-w-0">
        <p className={`${isTotal ? "text-white" : "text-white/70"} truncate text-sm tracking-[-0.01em]`}>
          {row.label}
        </p>
        <p className="mt-0.5 text-[11px] font-medium text-white/25">{row.category}</p>
      </div>
      <p className={`${row.amount < 0 ? "text-red-200" : "text-white"} text-sm font-bold tabular-nums tracking-[-0.01em]`}>
        {formatDisplayAmount(row)}
      </p>
    </div>
  );
});

function sameRows(a: PnlRow[], b: PnlRow[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const ar = a[i]!;
    const br = b[i]!;
    if (
      ar.category !== br.category ||
      ar.label !== br.label ||
      ar.amount !== br.amount ||
      ar.prevAmount !== br.prevAmount ||
      ar.momPercent !== br.momPercent
    ) {
      return false;
    }
  }
  return true;
}

function RowsTableBase({
  rows,
  emptyLabel = "No rows for this section.",
  includeProfitMargin = false,
}: {
  rows: PnlRow[];
  emptyLabel?: string;
  includeProfitMargin?: boolean;
}) {
  const visibleRows = sortRows(
    rows.filter((row) => !isMargin(row) || (includeProfitMargin && row.label === "P. Margin")),
  );
  if (visibleRows.length === 0) {
    return <p className="px-3 py-4 text-sm text-white/45">{emptyLabel}</p>;
  }

  return <VirtualRows rows={visibleRows} />;
}

const RowsTable = memo(
  RowsTableBase,
  (prev, next) =>
    prev.emptyLabel === next.emptyLabel &&
    prev.includeProfitMargin === next.includeProfitMargin &&
    sameRows(prev.rows, next.rows),
);

const VirtualRows = memo(function VirtualRows({ rows }: { rows: PnlRow[] }) {
  const rowHeight = 44;
  const viewportHeight = Math.min(440, rows.length * rowHeight);
  const overscan = 3;
  const [scrollTop, setScrollTop] = useState(0);
  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const end = Math.min(rows.length, start + visibleCount);
  const visibleRows = rows.slice(start, end);

  return (
    <div className="overflow-y-auto" style={{ maxHeight: viewportHeight }} onScroll={onScroll}>
      <div className="relative" style={{ height: rows.length * rowHeight }}>
        {visibleRows.map((row, offset) => {
          const idx = start + offset;
          return (
            <div
              key={`${row.category}-${row.label}`}
              className="absolute left-0 right-0"
              style={{ top: idx * rowHeight, height: rowHeight }}
            >
              <PnlTableRow row={row} idx={idx} />
            </div>
          );
        })}
      </div>
    </div>
  );
}, (prev, next) => sameRows(prev.rows, next.rows));

function PnlSmartSkeleton({ layout }: { layout?: PnlLayoutMetrics | null }) {
  const grossRows = layout?.grossRows ?? 3;
  const opexRows = layout?.opexRows ?? 4;
  const bottomRows = layout?.bottomRows ?? 3;
  const sections = [
    { key: "gross", rows: grossRows },
    { key: "opex", rows: opexRows },
    { key: "bottom", rows: bottomRows },
  ] as const;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[88px] animate-pulse rounded-2xl border border-white/10 bg-white/[0.06]" />
        ))}
      </div>
      {sections.map((s) => (
        <div key={s.key} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
          <div className="h-12 animate-pulse border-b border-white/10 bg-white/[0.06]" />
          <div className="space-y-px p-0">
            {Array.from({ length: s.rows }).map((__, row) => (
              <div
                key={row}
                className={row % 2 === 0 ? "h-11 animate-pulse bg-white/[0.035]" : "h-11 animate-pulse bg-white/[0.015]"}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatSyncedAt(value: string | null | undefined): string {
  if (!value) return "Not synced yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function PnlView({
  snapshot,
  entity,
  layoutSkeletonHint,
  onEntityChange,
  onEntityIntent,
  monthLabel,
  multiMonthNote,
  isLoading,
}: {
  snapshot: PnlSnapshot | null;
  entity: PnlEntity;
  /** Last persisted section row counts for this entity — stabilizes skeleton height on cold switches. */
  layoutSkeletonHint?: PnlLayoutMetrics | null;
  onEntityChange: (e: PnlEntity) => void;
  onEntityIntent?: (e: PnlEntity) => void;
  monthLabel: string;
  multiMonthNote?: string;
  isLoading?: boolean;
}) {
  const renderCountRef = useRef(0);
  useEffect(() => {
    if (!PNL_DEBUG) return;
    renderCountRef.current += 1;
    console.log(
      `[pnl-view] commit #${renderCountRef.current} entity=${entity} loading=${!!isLoading} rows=${snapshot?.rows.length ?? 0}`,
    );
  });
  const tableSnapshot = useDeferredValue(snapshot);
  const rows = useMemo(() => tableSnapshot?.rows ?? [], [tableSnapshot]);
  const nonMarginRows = useMemo(() => rows.filter((row) => !isMargin(row)), [rows]);
  const hasRenderableSnapshot = Boolean(
    snapshot && snapshot.rows.length > 0 && snapshot.entity === entity,
  );
  const [detailTablesReady, setDetailTablesReady] = useState(false);
  useEffect(() => {
    let inner = 0;
    let outer = 0;
    const t = window.setTimeout(() => {
      if (!hasRenderableSnapshot) {
        setDetailTablesReady(false);
        return;
      }
      setDetailTablesReady(false);
      outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setDetailTablesReady(true));
      });
    }, 0);
    return () => {
      window.clearTimeout(t);
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [hasRenderableSnapshot, snapshot]);
  const cards = useMemo(() => {
    if (!snapshot) {
      return [
        blankRow("Revenue", "Total Revenue"),
        blankRow("COGS", "Total COGS"),
        blankRow("Gross Profit", "Gross Profit"),
        blankRow("OPEX", "Total OPEX"),
        blankRow("Operating Profit", "Operating Profit (EBITDA)"),
      ];
    }
    return [
      snapshot.summary.totalRevenue,
      snapshot.summary.totalCogs,
      snapshot.summary.grossProfit,
      snapshot.summary.totalOpex,
      snapshot.summary.ebitda,
    ];
  }, [snapshot]);
  const gross = useMemo(() => nonMarginRows.filter(isGrossRow), [nonMarginRows]);
  const opex = useMemo(() => nonMarginRows.filter(isOpexRow), [nonMarginRows]);
  const bottom = useMemo(() => sortRows(rows.filter(isBottomRow)), [rows]);

  useEffect(() => {
    if (!snapshot || snapshot.entity !== entity) return;
    writePnlLayoutMetrics(entity, {
      grossRows: gross.length,
      opexRows: Math.max(opex.length, 1),
      bottomRows: Math.max(bottom.length, 1),
    });
  }, [snapshot, entity, gross.length, opex.length, bottom.length]);
  const revenueAmount = cards[0]?.amount ?? 0;
  const costsAmount = Math.abs(cards[1]?.amount ?? 0) + Math.abs(cards[3]?.amount ?? 0);
  const showZeroRevenueNotice = revenueAmount === 0 && costsAmount > 0;
  const hasSnapshot = !!snapshot && snapshot.rows.length > 0;
  const tableIsDeferred = tableSnapshot !== snapshot;
  const showSmartSkeleton = Boolean(isLoading && !hasRenderableSnapshot);
  const opexPlaceholderH =
    (layoutSkeletonHint?.opexRows ?? Math.max(opex.length, 1)) * 44;

  return (
    <div className={`${urbanist.className} relative flex flex-col gap-4 tracking-tight`}>
      <div className="sticky top-[88px] z-20 -mx-3 border-b border-white/10 bg-black/95 px-3 py-2.5 md:top-[96px] md:-mx-4 md:px-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-[-0.03em] text-white">P&amp;L</h1>
            <p className="truncate text-xs text-zinc-500">
              {monthLabel}
              {multiMonthNote ? ` · ${multiMonthNote}` : ""}
            </p>
            <p className="mt-0.5 flex h-[14px] items-center text-[11px] text-zinc-600">
              <span className="truncate">
                Last synced: {snapshot?.lastSyncedAt ? formatSyncedAt(snapshot.lastSyncedAt) : "—"}
              </span>
            </p>
          </div>
          <span
            aria-hidden={!isLoading}
            className={`min-w-[78px] rounded-full border px-2 py-1 text-center text-[11px] font-medium transition-opacity ${
              isLoading
                ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200 opacity-100"
                : "border-transparent bg-transparent text-transparent opacity-0"
            }`}
          >
            {hasSnapshot ? "Updating..." : "Loading..."}
          </span>
        </div>
        <div
          className="flex rounded-xl border border-white/10 bg-black/40 p-1"
          role="tablist"
          aria-label="Entity"
        >
          {ENTITIES.map((e) => {
            const active = entity === e;
            const handleIntent = active ? undefined : () => onEntityIntent?.(e);
            return (
              <button
                key={e}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onEntityChange(e)}
                onMouseEnter={handleIntent}
                onFocus={handleIntent}
                onPointerDown={handleIntent}
                onTouchStart={handleIntent}
                className={`min-h-11 flex-1 rounded-lg px-2 py-2 text-center text-xs font-bold tracking-[-0.01em] transition-colors sm:text-sm ${
                  active
                    ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {e}
              </button>
            );
          })}
        </div>
      </div>

      {showSmartSkeleton ? (
        <PnlSmartSkeleton layout={layoutSkeletonHint ?? undefined} />
      ) : !hasRenderableSnapshot && !isLoading ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-8 text-center text-sm text-zinc-400">
          No P&amp;L rows for this month yet. Run a sync after the sheet is connected.
        </div>
      ) : (
        <div
          aria-busy={!!isLoading}
          className={`relative flex flex-col gap-4 transition-opacity duration-150 ${isLoading ? "opacity-50" : "opacity-100"}`}
        >
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
            <SummaryCard row={cards[0]!} accent="blue" emphasized />
            <SummaryCard row={cards[1]!} accent="rose" emphasized />
            <SummaryCard row={cards[2]!} accent="emerald" emphasized />
            <SummaryCard row={cards[3]!} accent="amber" />
            <SummaryCard row={cards[4]!} accent="purple" />
          </div>

          {showZeroRevenueNotice ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/90">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-amber-300/30 text-[10px] font-bold">
                i
              </span>
              <p>
                Revenue is 0 while costs exist for this selection. This reflects the synced Google Sheet values for the selected entity/months.
              </p>
            </div>
          ) : null}

          <AccordionSection title="Gross Profitability" total={cards[2]?.amount ?? 0}>
            <div className={tableIsDeferred ? "opacity-60" : "opacity-100"}>
              {detailTablesReady ? (
                <RowsTable rows={gross} />
              ) : (
                <div
                  className="space-y-px"
                  style={{ minHeight: (layoutSkeletonHint?.grossRows ?? Math.max(gross.length, 1)) * 44 }}
                  aria-hidden
                >
                  {Array.from({
                    length: layoutSkeletonHint?.grossRows ?? Math.max(gross.length, 1),
                  }).map((_, row) => (
                    <div
                      key={row}
                      className={
                        row % 2 === 0 ? "h-11 animate-pulse bg-white/[0.035]" : "h-11 animate-pulse bg-white/[0.015]"
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </AccordionSection>

          <AccordionSection
            title="Operational Expenses (OPEX)"
            total={cards[3]?.amount ?? 0}
            lazyMountBody={opex.length > 0}
            closedBodyMinHeight={opexPlaceholderH}
          >
            {opex.length === 0 ? (
              <p className="px-3 py-4 text-sm text-white/45">No OPEX rows for this section.</p>
            ) : (
              <div className={tableIsDeferred ? "opacity-60" : "opacity-100"}>
                <RowsTable rows={opex} />
              </div>
            )}
          </AccordionSection>

          <AccordionSection title="Bottom Line (EBITDA)" total={cards[4]?.amount ?? 0}>
            <div className={tableIsDeferred ? "opacity-60" : "opacity-100"}>
              {detailTablesReady ? (
                <RowsTable rows={bottom} includeProfitMargin />
              ) : (
                <div
                  className="space-y-px"
                  style={{ minHeight: (layoutSkeletonHint?.bottomRows ?? Math.max(bottom.length, 1)) * 44 }}
                  aria-hidden
                >
                  {Array.from({
                    length: layoutSkeletonHint?.bottomRows ?? Math.max(bottom.length, 1),
                  }).map((_, row) => (
                    <div
                      key={row}
                      className={
                        row % 2 === 0 ? "h-11 animate-pulse bg-white/[0.035]" : "h-11 animate-pulse bg-white/[0.015]"
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </AccordionSection>
        </div>
      )}
    </div>
  );
}

export default memo(PnlView);
