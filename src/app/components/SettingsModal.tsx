"use client";

import { useEffect, useState, useTransition } from "react";
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
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const s = await getNotificationSettings();
      if (!cancelled && s) setSettings(s);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, user]);

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

          <div className="flex flex-col gap-1">
            {TOGGLES.map((t) => (
              <SettingToggle
                key={t.key}
                toggle={t}
                checked={settings[t.key]}
                disabled={loading}
                onChange={(v) => setSettings((s) => ({ ...s, [t.key]: v }))}
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
  onChange,
}: {
  toggle: Toggle;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-white/5">
      <span className="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled || pending}
          onChange={(e) => {
            const next = e.target.checked;
            const prev = checked;
            onChange(next);
            startTransition(async () => {
              const r = await updateNotificationSetting(toggle.key, next);
              if (!r.ok) onChange(prev);
            });
          }}
          className="peer sr-only"
        />
        <span
          className={`block h-5 w-9 rounded-full transition-colors duration-200 ${
            checked ? "bg-emerald-500" : "bg-zinc-700"
          } ${disabled || pending ? "opacity-50" : ""}`}
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
