"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Bell } from "lucide-react";
import { useAuth } from "@/app/context/AuthContext";
import {
  getNotificationSettings,
  updateNotificationSetting,
  type NotificationSettings,
  type NotificationSettingKey,
} from "@/app/actions/notification-settings";

type Toggle = {
  key: NotificationSettingKey;
  label: string;
  description: string;
};

const TOGGLES: Toggle[] = [
  {
    key: "morning_summary_enabled",
    label: "Morning Summary",
    description: "Get a daily performance report at 08:00 Israel time.",
  },
  {
    key: "daily_goal_reached_enabled",
    label: "Daily Goal Reached",
    description: "Notify me as soon as today\u2019s profit crosses the target.",
  },
  {
    key: "monthly_goal_reached_enabled",
    label: "Monthly Goal Reached",
    description: "Notify me when the MTD profit crosses the monthly goal.",
  },
  {
    key: "low_margin_enabled",
    label: "Low Margin Alert",
    description: "Alert me if margin stays below 33% for 1.5 hours (after 12:00).",
  },
];

const DEFAULT: NotificationSettings = {
  morning_summary_enabled: true,
  daily_goal_reached_enabled: true,
  monthly_goal_reached_enabled: true,
  low_margin_enabled: true,
};

export default function SettingsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT);
  const [initialLoad, setInitialLoad] = useState(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const errorClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setMounted(true), []);

  // Every time the modal opens (`open === true`), refetch from the server so toggles
  // match the DB (e.g. changes from another device). `user?.id` gates the fetch without
  // re-running on unrelated `user` object identity churn.
  useEffect(() => {
    if (!open || !user?.id) return;

    let cancelled = false;
    setInitialLoad(true);
    setErrorBanner(null);

    console.log("[SettingsModal] Re-fetching settings from DB...");

    void (async () => {
      const s = await getNotificationSettings();
      if (cancelled) return;
      // Full replace with server snapshot (or defaults if the action returned null).
      setSettings(s ?? DEFAULT);
      setInitialLoad(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, user?.id]);

  useEffect(() => {
    return () => {
      if (errorClearTimer.current) clearTimeout(errorClearTimer.current);
    };
  }, []);

  function showError(message: string) {
    setErrorBanner(message);
    if (errorClearTimer.current) clearTimeout(errorClearTimer.current);
    errorClearTimer.current = setTimeout(() => setErrorBanner(null), 4500);
  }

  function handleToggle(key: NotificationSettingKey, next: boolean) {
    const prev = settings[key];
    setSettings((s) => ({ ...s, [key]: next }));

    void (async () => {
      const r = await updateNotificationSetting(key, next);
      if (!r.ok) {
        setSettings((s) => ({ ...s, [key]: prev }));
        showError(r.error ?? "Could not save settings. Please try again.");
      }
    })();
  }

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal
        aria-label="Account Settings"
        className="relative z-10 mx-4 w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-base font-semibold text-zinc-100">
            Account Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            <Bell className="h-3.5 w-3.5" aria-hidden />
            Notification Preferences
          </div>

          {errorBanner && (
            <div
              role="alert"
              className="mb-3 rounded-lg border border-red-500/30 bg-red-950/50 px-3 py-2 text-sm text-red-200/95"
            >
              {errorBanner}
            </div>
          )}

          <div
            className={`flex flex-col gap-1 ${initialLoad ? "pointer-events-none opacity-60" : ""}`}
            aria-busy={initialLoad}
          >
            {TOGGLES.map((t) => (
              <SettingToggle
                key={t.key}
                toggle={t}
                checked={settings[t.key]}
                disabled={initialLoad}
                onToggle={handleToggle}
              />
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SettingToggle({
  toggle,
  checked,
  disabled,
  onToggle,
}: {
  toggle: Toggle;
  checked: boolean;
  disabled: boolean;
  onToggle: (key: NotificationSettingKey, next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-white/5">
      <span className="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => {
            onToggle(toggle.key, e.target.checked);
          }}
          className="peer sr-only"
        />
        <span
          className={`block h-5 w-9 rounded-full transition-colors duration-200 ${
            checked ? "bg-emerald-500" : "bg-zinc-700"
          } ${disabled ? "opacity-50" : ""}`}
        />
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </span>
      <span className="flex-1 select-none">
        <span className="block text-sm font-medium leading-tight text-zinc-200">
          {toggle.label}
        </span>
        <span className="block text-xs leading-snug text-zinc-500">
          {toggle.description}
        </span>
      </span>
    </label>
  );
}
