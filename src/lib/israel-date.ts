/** Today's calendar date (YYYY-MM-DD) in Asia/Jerusalem. */
export function getIsraelDate(): string {
  return getIsraelDateDaysAgo(0);
}

/** YYYY-MM-DD for calendar date N days before today in Asia/Jerusalem. */
export function getIsraelDateDaysAgo(daysAgo: number): string {
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  const [y, m, d] = todayStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - daysAgo);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
