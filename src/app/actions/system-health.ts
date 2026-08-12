"use server";

import { getTodayPulse, type TodayPulseState } from "@/app/actions/financials";
import { getIsraelDate, getIsraelHour } from "@/lib/israel-date";
import { supabaseAdmin } from "@/lib/supabase";

export type HealthDot = "green" | "amber" | "red" | "unknown";

export type SyncFreshnessRow = {
  source: string;
  lastSuccessAt: string | null;
  ageMs: number | null;
  ageLabel: string;
  dot: HealthDot;
};

export type SyncFailureRow = {
  source: string;
  failures24h: number;
  failures7d: number;
  latestError: string | null;
};

export type GuardActivityRow = {
  event: string;
  count: number;
  explanation: string;
};

export type TodayDataAge = {
  createdAt: string | null;
  ageMs: number | null;
  ageLabel: string;
  pulseState: TodayPulseState;
  dot: HealthDot;
  note: string | null;
};

export type SystemHealthPayload = {
  fetchedAt: string;
  freshness: SyncFreshnessRow[];
  failures: SyncFailureRow[];
  guards: {
    rows: GuardActivityRow[];
    quiet: boolean;
  };
  today: TodayDataAge;
};

const MS_H = 60 * 60 * 1000;

/** Prefer these sources first; any other sources found in the logs follow alphabetically. */
const PREFERRED_SOURCES = [
  "refresh_today_home",
  "cron_sync",
  "monday_sync",
  "cron_golden_sync",
] as const;

const GUARD_EXPLANATIONS: Record<string, string> = {
  skip_vacuous:
    "skip_vacuous — empty XDASH payload blocked from overwriting good data",
  today_regression_blocked:
    "today_regression_blocked — today's revenue dipped past the guard; kept last-known-good",
  regression_blocked:
    "regression_blocked — historical revenue regression blocked from overwriting",
};

function formatAge(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "never";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function freshnessDot(source: string, ageMs: number | null): HealthDot {
  if (ageMs == null) return "unknown";
  const isMonday = source === "monday_sync";
  if (isMonday) {
    if (ageMs < 25 * MS_H) return "green";
    if (ageMs < 48 * MS_H) return "amber";
    return "red";
  }
  if (ageMs < 1 * MS_H) return "green";
  if (ageMs < 6 * MS_H) return "amber";
  return "red";
}

function todayDot(
  ageMs: number | null,
  pulseState: TodayPulseState,
  hourIL: number,
): HealthDot {
  if (pulseState === "pending" && hourIL >= 10) return "red";
  if (ageMs == null) {
    return pulseState === "pending" ? (hourIL >= 10 ? "red" : "amber") : "unknown";
  }
  if (ageMs < 15 * 60 * 1000) return "green";
  if (ageMs < 60 * 60 * 1000) return "amber";
  return "red";
}

function guardKey(event: string): string | null {
  if (event.endsWith("skip_vacuous") || event.includes(".skip_vacuous")) {
    return "skip_vacuous";
  }
  if (
    event.endsWith("today_regression_blocked") ||
    event.includes(".today_regression_blocked")
  ) {
    return "today_regression_blocked";
  }
  if (
    event.endsWith("regression_blocked") ||
    event.includes(".regression_blocked")
  ) {
    // Exclude today_regression_blocked (already matched above) and .summary variants.
    if (event.includes("today_regression_blocked")) return null;
    if (event.includes("regression_guard")) return null;
    return "regression_blocked";
  }
  return null;
}

export async function getSystemHealth(): Promise<SystemHealthPayload> {
  const now = Date.now();
  const cutoff24h = new Date(now - 24 * MS_H).toISOString();
  const cutoff7d = new Date(now - 7 * 24 * MS_H).toISOString();
  const today = getIsraelDate();
  const hourIL = getIsraelHour();

  const [
    sourcesRes,
    successRes,
    fail24Res,
    fail7Res,
    eventsRes,
    todayRowRes,
    pulse,
  ] = await Promise.all([
    supabaseAdmin.from("daily_sync_logs").select("source").limit(1000),
    supabaseAdmin
      .from("daily_sync_logs")
      .select("source, created_at")
      .eq("ok", true)
      .order("created_at", { ascending: false })
      .limit(500),
    supabaseAdmin
      .from("daily_sync_logs")
      .select("source, error_message, created_at")
      .eq("ok", false)
      .gte("created_at", cutoff24h)
      .order("created_at", { ascending: false })
      .limit(500),
    supabaseAdmin
      .from("daily_sync_logs")
      .select("source, error_message, created_at")
      .eq("ok", false)
      .gte("created_at", cutoff7d)
      .order("created_at", { ascending: false })
      .limit(1000),
    supabaseAdmin
      .from("sync_pro_events")
      .select("event, status")
      .gte("created_at", cutoff7d)
      .limit(2000),
    supabaseAdmin
      .from("daily_home_totals")
      .select("created_at")
      .eq("date", today)
      .maybeSingle(),
    getTodayPulse(),
  ]);

  const sourceSet = new Set<string>();
  for (const s of PREFERRED_SOURCES) sourceSet.add(s);
  for (const row of sourcesRes.data ?? []) {
    if (row?.source) sourceSet.add(String(row.source));
  }
  // Drop known-disabled / dead sources from the primary view (pairs removed).
  sourceSet.delete("cron_pairs");

  const sources = [
    ...PREFERRED_SOURCES.filter((s) => sourceSet.has(s)),
    ...[...sourceSet]
      .filter((s) => !(PREFERRED_SOURCES as readonly string[]).includes(s))
      .sort(),
  ];

  const lastSuccess = new Map<string, string>();
  for (const row of successRes.data ?? []) {
    const src = String(row.source);
    if (!lastSuccess.has(src) && row.created_at) {
      lastSuccess.set(src, String(row.created_at));
    }
  }

  const freshness: SyncFreshnessRow[] = sources.map((source) => {
    const lastSuccessAt = lastSuccess.get(source) ?? null;
    const ageMs = lastSuccessAt
      ? Math.max(0, now - new Date(lastSuccessAt).getTime())
      : null;
    return {
      source,
      lastSuccessAt,
      ageMs,
      ageLabel: formatAge(ageMs),
      dot: freshnessDot(source, ageMs),
    };
  });

  const countBy = (
    rows: Array<{ source: string; error_message: string | null; created_at: string }> | null,
  ) => {
    const map = new Map<string, { count: number; latestError: string | null }>();
    for (const row of rows ?? []) {
      const src = String(row.source);
      const cur = map.get(src) ?? { count: 0, latestError: null };
      cur.count += 1;
      if (cur.latestError == null && row.error_message) {
        cur.latestError = String(row.error_message).slice(0, 240);
      }
      map.set(src, cur);
    }
    return map;
  };

  const fail24 = countBy(fail24Res.data as any);
  const fail7 = countBy(fail7Res.data as any);
  const failSources = new Set([...fail24.keys(), ...fail7.keys()]);
  const failures: SyncFailureRow[] = [...failSources]
    .sort()
    .map((source) => ({
      source,
      failures24h: fail24.get(source)?.count ?? 0,
      failures7d: fail7.get(source)?.count ?? 0,
      latestError:
        fail24.get(source)?.latestError ?? fail7.get(source)?.latestError ?? null,
    }));

  const guardCounts = new Map<string, number>();
  const errorCounts = new Map<string, number>();
  for (const row of eventsRes.data ?? []) {
    const event = String(row.event ?? "");
    const status = row.status != null ? String(row.status) : null;
    const key = guardKey(event);
    if (key) {
      guardCounts.set(key, (guardCounts.get(key) ?? 0) + 1);
    }
    if (status === "error") {
      errorCounts.set(event, (errorCounts.get(event) ?? 0) + 1);
    }
  }

  const guardRows: GuardActivityRow[] = [];
  for (const key of Object.keys(GUARD_EXPLANATIONS)) {
    const count = guardCounts.get(key) ?? 0;
    if (count > 0) {
      guardRows.push({
        event: key,
        count,
        explanation: GUARD_EXPLANATIONS[key]!,
      });
    }
  }
  for (const [event, count] of [...errorCounts.entries()].sort((a, b) => b[1] - a[1])) {
    // Skip errors already counted as protective-skip keys.
    if (guardKey(event)) continue;
    guardRows.push({
      event,
      count,
      explanation: `${event} — logged as status=error`,
    });
  }

  const todayCreatedAt =
    todayRowRes.data?.created_at != null
      ? String(todayRowRes.data.created_at)
      : null;
  const todayAgeMs = todayCreatedAt
    ? Math.max(0, now - new Date(todayCreatedAt).getTime())
    : null;

  let todayNote: string | null = null;
  if (pulse.state === "pending" && hourIL >= 10) {
    todayNote = "pending after 10:00 Israel — no usable today row yet";
  } else if (pulse.state === "stale_snapshot") {
    todayNote = `pulse: stale snapshot${pulse.asOfHour != null ? ` as of ${String(pulse.asOfHour).padStart(2, "0")}:00` : ""}`;
  } else if (pulse.state === "pending") {
    todayNote = "pulse: awaiting first sync";
  }

  return {
    fetchedAt: new Date(now).toISOString(),
    freshness,
    failures,
    guards: {
      rows: guardRows,
      quiet: guardRows.length === 0,
    },
    today: {
      createdAt: todayCreatedAt,
      ageMs: todayAgeMs,
      ageLabel: formatAge(todayAgeMs),
      pulseState: pulse.state,
      dot: todayDot(todayAgeMs, pulse.state, hourIL),
      note: todayNote,
    },
  };
}
