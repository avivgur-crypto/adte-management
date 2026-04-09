"use server";

import { createClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase";

export type NotificationSettings = {
  morning_summary_enabled: boolean;
  daily_goal_reached_enabled: boolean;
  monthly_goal_reached_enabled: boolean;
  low_margin_enabled: boolean;
};

const DEFAULT_SETTINGS: NotificationSettings = {
  morning_summary_enabled: true,
  daily_goal_reached_enabled: true,
  monthly_goal_reached_enabled: true,
  low_margin_enabled: true,
};

export type NotificationSettingKey = keyof NotificationSettings;

function normalizeSettings(raw: unknown): NotificationSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
  const o = raw as Record<string, unknown>;
  return {
    morning_summary_enabled: o.morning_summary_enabled !== false,
    daily_goal_reached_enabled: o.daily_goal_reached_enabled !== false,
    monthly_goal_reached_enabled: o.monthly_goal_reached_enabled !== false,
    low_margin_enabled: o.low_margin_enabled !== false,
  };
}

export async function getNotificationSettings(): Promise<NotificationSettings | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("notification_settings")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[notification-settings] get", error.message);
    return DEFAULT_SETTINGS;
  }

  return normalizeSettings(data?.notification_settings);
}

export async function updateNotificationSetting(
  key: NotificationSettingKey,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: existing } = await supabaseAdmin
    .from("profiles")
    .select("notification_settings")
    .eq("id", user.id)
    .maybeSingle();

  const prev = normalizeSettings(existing?.notification_settings);
  const merged = { ...prev, [key]: enabled };

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ notification_settings: merged })
    .eq("id", user.id);

  if (error) {
    console.error("[notification-settings] update", error.message);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
