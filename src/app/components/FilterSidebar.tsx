"use client";

import { Funnel, LayoutDashboard, LogOut, Menu, Settings, Users } from "lucide-react";
import { logout } from "@/app/actions/auth";
import AdminSyncPanel from "./AdminSyncPanel";
import { useAuth } from "@/app/context/AuthContext";
import { useState, useCallback, useEffect, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  useFilter,
  monthKeyToMonthIndex,
  type FilterState,
  type AppScreen,
} from "@/app/context/FilterContext";
import {
  getNotificationSettings,
  setLowMarginEnabled as updateLowMarginSetting,
} from "@/app/actions/notification-settings";

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
const MOBILE_PANEL_WIDTH = 300;

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

function NotificationSettingsSection() {
  const { user } = useAuth();
  const [lowMarginEnabled, setLowMarginEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const s = await getNotificationSettings();
      if (!cancelled && s) setLowMarginEnabled(s.low_margin_enabled);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) return null;

  return (
    <div className="mb-3 border-b border-white/10 pb-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        <Settings className="h-3 w-3" aria-hidden />
        Settings
      </p>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-0.5 py-1 transition-colors hover:bg-white/5">
        <input
          type="checkbox"
          checked={lowMarginEnabled}
          disabled={loading || pending}
          onChange={(e) => {
            const next = e.target.checked;
            const prev = lowMarginEnabled;
            setLowMarginEnabled(next);
            startTransition(async () => {
              const r = await updateLowMarginSetting(next);
              if (!r.ok) setLowMarginEnabled(prev);
            });
          }}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-white/20 bg-white/5 text-emerald-500 focus:ring-emerald-500/50 disabled:opacity-50"
        />
        <span className="text-xs leading-snug text-zinc-400">
          <span className="font-medium text-zinc-300">Low margin alerts</span>
          <span className="block text-[11px] text-zinc-500">
            Notify when margin stays below 33% for 3 consecutive syncs (after 12:00 IL).
          </span>
        </span>
      </label>
    </div>
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

function DesktopSidebar() {
  const state = useFilter();
  const { user } = useAuth();
  const [loggingOut, startLogout] = useTransition();

  const handleLogout = () => {
    startLogout(async () => {
      await logout();
    });
  };

  return (
    <aside
      className="fixed right-0 top-[112px] z-30 hidden flex-shrink-0 flex-col border-l border-white/10 bg-white/[0.06] shadow-2xl backdrop-blur-xl lg:flex"
      style={{ width: SIDEBAR_WIDTH, height: "calc(100vh - 112px)" }}
    >
      <div className="flex-1 overflow-y-auto p-3">
        <ScreenNav />
        <NotificationSettingsSection />
        <h2 className="mb-2 text-sm font-semibold tracking-tight text-zinc-200">
          Filters
        </h2>
        <FilterFormContent state={state} isMobile={false} />
      </div>
      {user?.isAdmin && (
        <div className="border-t border-white/10 p-3">
          <AdminSyncPanel />
        </div>
      )}
      {user && (
        <div className="border-t border-white/10 p-3">
          <p className="mb-2 truncate text-xs text-zinc-500" title={user.email}>
            {user.email}
          </p>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200 disabled:opacity-60"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span>{loggingOut ? "Signing out…" : "Sign out"}</span>
          </button>
        </div>
      )}
    </aside>
  );
}

function MobileMenuPanel() {
  const globalState = useFilter();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [loggingOut, startLogout] = useTransition();
  const [localMonths, setLocalMonths] = useState<Set<string>>(globalState.selectedMonths);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) setLocalMonths(new Set(globalState.selectedMonths));
  }, [open, globalState.selectedMonths]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const apply = useCallback(() => {
    globalState.setSelectedMonths(new Set(localMonths));
    setOpen(false);
  }, [globalState, localMonths]);

  const toggle = useCallback(() => setOpen((o) => !o), []);

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

  const panel = mounted && createPortal(
    <div
      className={`fixed inset-0 z-40 lg:hidden ${open ? "" : "pointer-events-none"}`}
      aria-modal={open}
      role="dialog"
      aria-hidden={!open}
    >
      {/* Backdrop: smooth fade, tap to close */}
      <div
        className={`absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-300 ease-out ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setOpen(false)}
        aria-hidden
      />
      {/* Panel: slide in from right */}
      <div
        className="absolute right-0 top-0 h-full w-full max-w-[min(100vw,320px)] flex flex-col border-l border-white/10 bg-zinc-900/98 shadow-2xl backdrop-blur-xl transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
        style={{
          transform: open ? "translateX(0)" : "translateX(100%)",
          willChange: "transform",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-1 flex-col overflow-y-auto p-4 pb-safe">
          <ScreenNav onNavigate={() => setOpen(false)} />
          <NotificationSettingsSection />
          <h3 className="mb-2.5 mt-2 text-sm font-semibold tracking-tight text-zinc-200">
            Filters
          </h3>
          <FilterFormContent state={localState} isMobile onApply={apply} />
          {user?.isAdmin && (
            <div className="mt-4 border-t border-white/10 pt-3">
              <AdminSyncPanel />
            </div>
          )}
          {user && (
            <div className="mt-4 border-t border-white/10 pt-3">
              <button
                type="button"
                onClick={() => {
                  startLogout(async () => {
                    await logout();
                  });
                }}
                disabled={loggingOut}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200 disabled:opacity-60"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                <span>{loggingOut ? "Signing out…" : "Sign out"}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        className="fixed top-4 right-4 z-50 flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-zinc-200 shadow-lg backdrop-blur-xl transition-colors hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 lg:hidden"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
      >
        <Menu className="h-5 w-5" />
      </button>
      {panel}
    </>
  );
}

export default function FilterSidebar() {
  return (
    <>
      <DesktopSidebar />
      <MobileMenuPanel />
    </>
  );
}

export const filterSidebarWidth = SIDEBAR_WIDTH;
