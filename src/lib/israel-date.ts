const TZ_IL = "Asia/Jerusalem";

/** Today's calendar date (YYYY-MM-DD) in Asia/Jerusalem. */
export function getIsraelDate(): string {
  return getIsraelDateDaysAgo(0);
}

/** Local hour 0–23 in Asia/Jerusalem (for cron / notification windows). */
export function getIsraelHour(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ_IL,
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const h = parts.find((p) => p.type === "hour")?.value;
  return h != null ? parseInt(h, 10) : 0;
}

/** YYYY-MM-DD for calendar date N days before today in Asia/Jerusalem. */
export function getIsraelDateDaysAgo(daysAgo: number): string {
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: TZ_IL });
  const [y, m, d] = todayStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - daysAgo);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Israel calendar date (YYYY-MM-DD) at a given UTC instant. */
export function getIsraelCalendarDateAtUtc(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: TZ_IL });
}

/** Wall-clock parts in Israel at `now` (same clock used for Pulse fuzzy matching). */
export function getIsraelDateTimeParts(now = new Date()): {
  date: string;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ_IL,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: parseInt(get("hour"), 10) || 0,
    minute: parseInt(get("minute"), 10) || 0,
    second: parseInt(get("second"), 10) || 0,
  };
}

/** Add `deltaDays` to a YYYY-MM-DD string (neutral calendar math; used with Israel date strings from this module). */
export function addCalendarDaysToIsoDate(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * First UTC instant where the Israel calendar reads `ymd` (start of that civil day in Asia/Jerusalem).
 * Binary search — stable across DST.
 */
export function firstUtcInstantOfIsraelCalendarDate(ymd: string): number {
  const [Y, M, D] = ymd.split("-").map(Number);
  if (!Number.isFinite(Y) || !Number.isFinite(M) || !Number.isFinite(D)) {
    throw new Error(`Invalid YYYY-MM-DD: ${ymd}`);
  }
  let lo = Date.UTC(Y, M - 1, D - 3, 0, 0, 0);
  let hi = Date.UTC(Y, M - 1, D + 3, 23, 59, 59, 999);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const cal = getIsraelCalendarDateAtUtc(mid);
    if (cal < ymd) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * UTC epoch milliseconds for the instant when Asia/Jerusalem reads `isoDate` at
 * `hour:minute:second` wall clock. Coarse minute sweep + 1s refinement handles
 * 23/24/25h civil days.
 */
export function utcMillisForIsraelWallClock(
  isoDate: string,
  hour: number,
  minute: number,
  second: number,
): number {
  const wantSec = hour * 3600 + minute * 60 + second;
  const dayStart = firstUtcInstantOfIsraelCalendarDate(isoDate);
  const nextDay = addCalendarDaysToIsoDate(isoDate, 1);
  const dayEnd = firstUtcInstantOfIsraelCalendarDate(nextDay);

  function secondsSinceMidnightAt(ms: number, ymd: string): number | null {
    if (getIsraelCalendarDateAtUtc(ms) !== ymd) return null;
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ_IL,
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(ms));
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? "";
    const h = parseInt(get("hour"), 10) || 0;
    const mi = parseInt(get("minute"), 10) || 0;
    const s = parseInt(get("second"), 10) || 0;
    return h * 3600 + mi * 60 + s;
  }

  let bestMs = dayStart;
  let bestDiff = Infinity;
  for (let t = dayStart; t < dayEnd; t += 60_000) {
    const sec = secondsSinceMidnightAt(t, isoDate);
    if (sec == null) continue;
    const d = Math.abs(sec - wantSec);
    if (d < bestDiff) {
      bestDiff = d;
      bestMs = t;
    }
  }
  const refineRadius = 90 * 60 * 1000;
  for (let t = bestMs - refineRadius; t <= bestMs + refineRadius; t += 1000) {
    const sec = secondsSinceMidnightAt(t, isoDate);
    if (sec == null) continue;
    const d = Math.abs(sec - wantSec);
    if (d < bestDiff) {
      bestDiff = d;
      bestMs = t;
    }
  }
  return bestMs;
}

/**
 * Fraction of the current Israel civil day that has elapsed (0 at 00:00:00, 1 at 24:00:00),
 * based on wall-clock hour:minute:second in Asia/Jerusalem. Used for intraday scaling
 * (e.g. Pulse “daily total × progress” estimates at ~50% around 12:00).
 */
export function getIsraelDayElapsedFraction(now = new Date()): number {
  const p = getIsraelDateTimeParts(now);
  const sec = p.hour * 3600 + p.minute * 60 + p.second;
  return Math.max(0, Math.min(1, sec / 86_400));
}
