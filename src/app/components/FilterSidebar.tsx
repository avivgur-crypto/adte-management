"use client";

import { Filter, Funnel, LayoutDashboard, Loader2, RefreshCw, Users, X } from "lucide-react";
import { triggerSyncViaCronApi } from "@/app/actions/sync";
import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  useFilter,
  monthKeyToMonthIndex,
  type FilterState,
  type AppScreen,
} from "@/app/context/FilterContext";

const SCREENS: { key: AppScreen; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "financial", label: "Financial", icon: LayoutDashboard },
  { key: "partners", label: "Partners", icon: Users },
  { key: "sales-funnel", label: "Sales Funnel", icon: Funnel },
];

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const SIDEBAR_WIDTH = 280;
const FAB_SIZE = 56;

const QUARTER_KEYS: Record<number, string[]> = {
  1: ["2026-01-01", "2026-02-01", "2026-03-01"],
  2: ["2026-04-01", "2026-05-01", "2026-06-01"],
  3: ["2026-07-01", "2026-08-01", "2026-09-01"],
  4: ["2026-10-01", "2026-11-01", "2026-12-01"],
};

function ScreenNav({ onNavigate }: { onNavigate?: () => void }) {
  const { activeScreen, setActiveScreen } = useFilter();
  return (
    <nav className="mb-3 flex flex-col gap-0.5 border-b border-white/10 pb-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        App screens
      </p>
      {SCREENS.map(({ key, label, icon: Icon }) => {
        const isActive = activeScreen === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => {
              setActiveScreen(key);
              onNavigate?.();
            }}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm font-medium transition-all duration-200 ${
              isActive
                ? "border-l-2 border-emerald-400 bg-emerald-500/15 text-emerald-200"
                : "border-l-2 border-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
            }`}
          >
            <span
              className={`flex h-1.5 w-1.5 shrink-0 rounded-full ${
                isActive ? "bg-emerald-400" : "bg-zinc-500"
              }`}
              aria-hidden
            />
            <Icon className="h-4 w-4 shrink-0 opacity-80" />
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function FilterFormContent({
  state,
  onApply,
  isMobile,
}: {
  state: FilterState;
  onApply?: () => void;
  isMobile: boolean;
}) {
  const {
    monthKeys,
    isMonthSelected,
    toggleMonth,
    isQuarterSelected,
    toggleQuarter,
    selectAll,
    selectNone,
    reset,
  } = state;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="mb-1.5 text-sm font-medium text-zinc-300/90">
          By quarter
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {([1, 2, 3, 4] as const).map((q) => {
            const active = isQuarterSelected(q);
            return (
              <button
                key={q}
                type="button"
                onClick={() => toggleQuarter(q)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-all duration-200 ${
                  active
                    ? "border-emerald-400/50 bg-emerald-500/25 text-emerald-300 shadow-[0_0_20px_-2px_rgba(52,211,153,0.35)]"
                    : "border-white/10 bg-white/5 text-zinc-400 hover:border-white/20 hover:bg-white/10 hover:text-zinc-300"
                }`}
              >
                Q{q}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <h3 className="mb-1.5 text-sm font-medium text-zinc-300/90">
          Month filter
        </h3>
        <div className="grid grid-cols-3 gap-1">
          {monthKeys.map((key) => {
            const idx = monthKeyToMonthIndex(key);
            const label = MONTH_LABELS[idx - 1];
            const checked = isMonthSelected(key);
            return (
              <label
                key={key}
                className="flex cursor-pointer items-center gap-1 rounded-lg py-1 pr-1 transition-colors hover:bg-white/5"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleMonth(key)}
                  className="h-3.5 w-3.5 shrink-0 rounded border-white/20 bg-white/5 text-emerald-500 focus:ring-emerald-500/50"
                />
                <span className="truncate text-xs text-zinc-300">{label}</span>
              </label>
            );
          })}
        </div>
      </div>
      <div className="mt-auto flex flex-wrap gap-1.5 border-t border-white/10 pt-3">
        <button
          type="button"
          onClick={selectAll}
          className="rounded-lg bg-white/10 px-2.5 py-1 text-sm font-medium text-zinc-200 hover:bg-white/15"
        >
          All
        </button>
        <button
          type="button"
          onClick={selectNone}
          className="rounded-lg bg-white/10 px-2.5 py-1 text-sm font-medium text-zinc-200 hover:bg-white/15"
        >
          None
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-white/10 px-2.5 py-1 text-sm font-medium text-zinc-200 hover:bg-white/15"
        >
          Reset
        </button>
      </div>
      {isMobile && onApply && (
        <button
          type="button"
          onClick={onApply}
          className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/25 hover:bg-emerald-400"
        >
          Apply
        </button>
      )}
    </div>
  );
}

const showSyncButton =
  typeof process !== "undefined" &&
  (process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_SHOW_SYNC_BUTTON === "true");

function DesktopSidebar() {
  const state = useFilter();
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<"success" | "error" | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    setSyncError(null);
    try {
      const result = await triggerSyncViaCronApi();
      if (result.success) {
        setSyncMessage("success");
      } else {
        setSyncMessage("error");
        setSyncError(result.error);
      }
    } finally {
      setSyncing(false);
    }
  };

  return (
    <aside
      className="fixed right-0 top-[150px] z-30 hidden flex-shrink-0 flex-col border-l border-white/10 bg-white/[0.06] shadow-2xl backdrop-blur-xl lg:flex"
      style={{ width: SIDEBAR_WIDTH, height: "calc(100vh - 150px)" }}
    >
      <div className="flex-1 overflow-y-auto p-3">
        <ScreenNav />
        <h2 className="mb-2 text-sm font-semibold tracking-tight text-zinc-200">
          Filters
        </h2>
        <FilterFormContent state={state} isMobile={false} />
      </div>
      {showSyncButton && (
        <div className="border-t border-white/10 p-3">
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-zinc-200 shadow-sm transition-colors hover:bg-white/10 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {syncing ? (
              <>
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" />
                <span>Syncing...</span>
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 shrink-0 text-zinc-400" />
                <span>Sync Data</span>
              </>
            )}
          </button>
          {syncMessage === "success" && !syncing && (
            <p className="mt-2 text-center text-xs font-medium text-emerald-400">
              All synced!
            </p>
          )}
          {syncMessage === "error" && syncError && !syncing && (
            <p className="mt-2 truncate text-center text-xs text-red-400" title={syncError}>
              {syncError}
            </p>
          )}
        </div>
      )}
    </aside>
  );
}

function MobileFABAndSheet() {
  const globalState = useFilter();
  const [open, setOpen] = useState(false);
  const [localMonths, setLocalMonths] = useState<Set<string>>(globalState.selectedMonths);

  useEffect(() => {
    if (open) setLocalMonths(new Set(globalState.selectedMonths));
  }, [open, globalState.selectedMonths]);

  const apply = useCallback(() => {
    globalState.setSelectedMonths(new Set(localMonths));
    setOpen(false);
  }, [globalState, localMonths]);

  const localState: FilterState = {
    ...globalState,
    selectedMonths: localMonths,
    selectMonth: (k) => setLocalMonths((prev) => new Set(prev).add(k)),
    deselectMonth: (k) =>
      setLocalMonths((prev) => {
        const n = new Set(prev);
        n.delete(k);
        return n;
      }),
    toggleMonth: (k) =>
      setLocalMonths((prev) => {
        const n = new Set(prev);
        if (n.has(k)) n.delete(k);
        else n.add(k);
        return n;
      }),
    selectQuarter: (q) => {
      const keys = QUARTER_KEYS[q];
      setLocalMonths((prev) => {
        const n = new Set(prev);
        keys.forEach((k) => n.add(k));
        return n;
      });
    },
    deselectQuarter: (q) => {
      const keys = QUARTER_KEYS[q];
      setLocalMonths((prev) => {
        const n = new Set(prev);
        keys.forEach((k) => n.delete(k));
        return n;
      });
    },
    toggleQuarter: (q) => {
      const keys = QUARTER_KEYS[q];
      setLocalMonths((prev) => {
        const all = keys.every((k) => prev.has(k));
        const n = new Set(prev);
        if (all) keys.forEach((k) => n.delete(k));
        else keys.forEach((k) => n.add(k));
        return n;
      });
    },
    selectAll: () => setLocalMonths(new Set(globalState.monthKeys)),
    selectNone: () => setLocalMonths(new Set()),
    reset: () => setLocalMonths(new Set(globalState.monthKeys)),
    isMonthSelected: (k) => localMonths.has(k),
    isQuarterSelected: (q) => QUARTER_KEYS[q].every((k) => localMonths.has(k)),
  };

  const sheet = open && typeof document !== "undefined" && createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden"
      aria-modal
      role="dialog"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />
      <div
        className="relative z-10 max-h-[85vh] overflow-hidden rounded-t-3xl border-t border-white/10 bg-zinc-900/95 shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3.5">
          <h2 className="text-sm font-semibold tracking-tight text-zinc-200">
            Menu
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex flex-col overflow-y-auto p-4 pb-safe">
          <ScreenNav onNavigate={() => setOpen(false)} />
          <h3 className="mb-2.5 mt-2 text-sm font-semibold tracking-tight text-zinc-200">
            Filters
          </h3>
          <FilterFormContent state={localState} isMobile onApply={apply} />
        </div>
      </div>
    </div>,
    document.body
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex lg:hidden h-14 w-14 items-center justify-center rounded-full bg-white/10 text-zinc-200 shadow-lg backdrop-blur-xl hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
        style={{ width: FAB_SIZE, height: FAB_SIZE }}
        aria-label="Open filters"
      >
        <Filter className="h-6 w-6" />
      </button>
      {sheet}
    </>
  );
}

export default function FilterSidebar() {
  return (
    <>
      <DesktopSidebar />
      <MobileFABAndSheet />
    </>
  );
}

export const filterSidebarWidth = SIDEBAR_WIDTH;
