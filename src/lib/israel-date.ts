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
 * Reused formatter for Israel wall-clock reads.  Intl.DateTimeFormat
 * construction is one of the most expensive operations in JS (~50µs); the
 * previous implementation of `utcMillisForIsraelWallClock` constructed
 * ~24,500 of them per call (minute sweep + 1s refine loop) which cost
 * 1–2 SECONDS of blocking CPU per call and dominated getComparisonData.
 */
const israelWallPartsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ_IL,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Israel wall-clock at a UTC instant, re-encoded as a UTC epoch for arithmetic. */
function israelWallClockAsUtcMs(ms: number): number {
  const parts = israelWallPartsFmt.formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "0";
  return Date.UTC(
    parseInt(get("year"), 10),
    parseInt(get("month"), 10) - 1,
    parseInt(get("day"), 10),
    parseInt(get("hour"), 10),
    parseInt(get("minute"), 10),
    parseInt(get("second"), 10),
  );
}

/**
 * UTC epoch milliseconds for the instant when Asia/Jerusalem reads `isoDate` at
 * `hour:minute:second` wall clock.
 *
 * Fixed-point iteration: start from a UTC guess, read the Israel wall clock at
 * that guess, shift by the difference, repeat.  Real timezone offsets are
 * minute-aligned so this converges exactly in ≤2 steps for any wall time that
 * exists.  For the one hour per year erased by the DST spring-forward jump the
 * loop oscillates between the two instants ±60min from the requested wall
 * time and returns one of them — equivalent for callers matching within a
 * time window (the Pulse snapshot matcher, this function's only consumer).
 */
export function utcMillisForIsraelWallClock(
  isoDate: string,
  hour: number,
  minute: number,
  second: number,
): number {
  const [Y, M, D] = isoDate.split("-").map(Number);
  if (!Number.isFinite(Y) || !Number.isFinite(M) || !Number.isFinite(D)) {
    throw new Error(`Invalid YYYY-MM-DD: ${isoDate}`);
  }
  const targetWallAsUtc = Date.UTC(Y!, M! - 1, D!, hour, minute, second);

  // Israel is UTC+2 (standard) / UTC+3 (DST) — start from the standard offset.
  let guess = targetWallAsUtc - 2 * 3_600_000;
  for (let i = 0; i < 4; i++) {
    const diff = targetWallAsUtc - israelWallClockAsUtcMs(guess);
    if (diff === 0) return guess;
    guess += diff;
  }
  return guess;
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
