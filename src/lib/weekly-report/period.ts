/**
 * Thursday→Wednesday report week in Asia/Jerusalem calendar dates.
 * Last completed week = most recent Wed strictly before `asOf` (so Thursday
 * morning reports cover the week that just closed).
 */

import { addCalendarDaysToIsoDate, getIsraelDate } from "@/lib/israel-date";

export type ReportWeek = {
  /** Inclusive Thursday YYYY-MM-DD */
  start: string;
  /** Inclusive Wednesday YYYY-MM-DD */
  end: string;
  label: string;
};

/** 0=Sun … 3=Wed … 4=Thu … 6=Sat for an Israel calendar YYYY-MM-DD. */
export function israelWeekday(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  // Noon UTC on that civil date is safely inside the Israel calendar day.
  const utc = Date.UTC(y!, m! - 1, d!, 12, 0, 0);
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    weekday: "short",
  }).format(new Date(utc));
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[wd] ?? 0;
}

function formatRangeLabel(start: string, end: string): string {
  const fmt = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(Date.UTC(y!, m! - 1, d!));
    return dt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  };
  const year = end.slice(0, 4);
  return `${fmt(start)} – ${fmt(end)}, ${year}`;
}

/** Most recently completed Thu→Wed window as of an Israel calendar date. */
export function getLastCompletedReportWeek(asOf?: string): ReportWeek {
  const asOfDate = asOf ?? getIsraelDate();
  // End must be a Wednesday on or before yesterday (week fully closed).
  let end = addCalendarDaysToIsoDate(asOfDate, -1);
  while (israelWeekday(end) !== 3) {
    end = addCalendarDaysToIsoDate(end, -1);
  }
  const start = addCalendarDaysToIsoDate(end, -6);
  return {
    start,
    end,
    label: formatRangeLabel(start, end),
  };
}

export function getPriorReportWeek(week: ReportWeek): ReportWeek {
  const end = addCalendarDaysToIsoDate(week.start, -1);
  const start = addCalendarDaysToIsoDate(end, -6);
  return { start, end, label: formatRangeLabel(start, end) };
}
