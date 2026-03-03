import { syncPartnerPairsDataForMonth } from "@/lib/sync/partner-pairs";
import { isReportApi404 } from "@/lib/xdash-client";

async function main() {
  const months = [
    { year: 2026, month: 1, label: "Jan 2026" },
    { year: 2026, month: 2, label: "Feb 2026" },
    { year: 2026, month: 3, label: "Mar 2026" },
  ];

  for (const { year, month, label } of months) {
    console.log(`Backfilling partner pairs for ${label}...`);
    const result = await syncPartnerPairsDataForMonth(year, month);
    console.log(`${label}: ${result.datesSynced} dates synced, ${result.rowsUpserted} rows upserted`);
    if (result.rowsUpserted === 0 && result.datesSynced === 0 && result.datesRequested > 0) {
      console.log(`  (no new data — already synced or API unavailable)`);
    }
  }

  console.log("Done.");
}

main().catch((e) => {
  if (isReportApi404(e)) {
    console.error("\nReport API returned 404 for all tried paths.");
    console.error("Find the correct path: open your XDASH Reports page, run a report, then in DevTools > Network find the POST request and copy the path (e.g. /reports/run). Set XDASH_REPORT_PATH in .env.local to that path.");
  }
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
