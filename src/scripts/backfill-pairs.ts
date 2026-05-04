/**
 * Backfill `daily_partner_pairs` for an arbitrary date range.
 *
 * Usage:
 *   npx tsx --env-file=.env.local src/scripts/backfill-pairs.ts                 # default: 2026-01-01 → today_IL
 *   npx tsx --env-file=.env.local src/scripts/backfill-pairs.ts --start=2026-03-08 --end=2026-05-04
 *   npx tsx --env-file=.env.local src/scripts/backfill-pairs.ts --start=2026-03-08 --end=2026-05-04 --force
 *
 * Skips dates that already have rows (idempotent) unless --force is passed.
 * Logs every date as it syncs and surfaces XDASH Report API 404s with a hint.
 */
import { syncPartnerPairsForDateRange } from "@/lib/sync/partner-pairs";
import { isReportApi404 } from "@/lib/xdash-client";

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : undefined;
}

function todayIsrael(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

async function main() {
  const start = parseArg("start") ?? "2026-01-01";
  const end = parseArg("end") ?? todayIsrael();
  const force = process.argv.includes("--force");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    console.error(`Invalid date(s): start=${start} end=${end}. Expected YYYY-MM-DD.`);
    process.exit(1);
  }
  if (start > end) {
    console.error(`Empty range: ${start} > ${end}`);
    process.exit(1);
  }

  console.log(`Backfilling daily_partner_pairs from ${start} to ${end} (force=${force})...`);
  const t0 = Date.now();
  const result = await syncPartnerPairsForDateRange(start, end, { force });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(
    `\nDone in ${elapsed}s — datesRequested=${result.datesRequested}, datesSynced=${result.datesSynced}, rowsUpserted=${result.rowsUpserted}`,
  );
  if (result.rowsUpserted === 0 && result.datesRequested > 0 && result.datesSynced === 0) {
    console.log(
      "(No rows written. Either every date was already present, or the XDASH Report API returned no data.)",
    );
  }
}

main().catch((e) => {
  if (isReportApi404(e)) {
    console.error("\nReport API returned 404 for all tried paths.");
    console.error(
      "Open XDASH Reports in the browser, run a report, then in DevTools > Network find the POST request and copy its path. Set XDASH_REPORT_PATH in .env.local.",
    );
  }
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
