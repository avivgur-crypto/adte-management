import { syncXDASHDataForMonth } from "@/lib/sync/xdash";

async function main() {
  console.log("Syncing January 2026...");
  const result = await syncXDASHDataForMonth(2026, 1);
  console.log(`Done: ${result.datesSynced} dates, ${result.rowsUpserted} rows`);
}

main().catch(console.error);
