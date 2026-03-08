/**
 * Diagnostic: verify funnel counts and check for double-counting.
 *
 * Run: DOTENV_CONFIG_PATH=.env.local npx tsx src/scripts/debug-deals-status.ts
 */
import "dotenv/config";
import { MONDAY_BOARD_IDS, fetchBoardItems, getColumnText } from "@/lib/monday-client";

const STATUS_COL = process.env.DEALS_STATUS_COLUMN_ID ?? "";
const OPS_KEYWORDS = ["ops", "legal", "sign"];

async function main() {
  console.log(`DEALS_STATUS_COLUMN_ID = "${STATUS_COL}"\n`);

  const [leads, deals, contracts] = await Promise.all([
    fetchBoardItems(MONDAY_BOARD_IDS.leads, { includeColumnValues: false }),
    fetchBoardItems(MONDAY_BOARD_IDS.deals, { includeColumnValues: true }),
    fetchBoardItems(MONDAY_BOARD_IDS.contracts, { includeColumnValues: false }),
  ]);

  console.log(`Leads board:     ${leads.length} items`);
  console.log(`Deals board:     ${deals.length} items`);
  console.log(`Contracts board: ${contracts.length} items\n`);

  // Ops-matching breakdown
  const matched: { name: string; status: string }[] = [];
  for (const item of deals) {
    const status = STATUS_COL
      ? (getColumnText(item, STATUS_COL) ?? "").trim()
      : "";
    const lower = status.toLowerCase();
    if (lower && OPS_KEYWORDS.some((kw) => lower.includes(kw))) {
      matched.push({ name: item.name, status });
    }
  }
  console.log(`Deals matching ops/legal/sign: ${matched.length}`);
  const byStatus = new Map<string, number>();
  for (const m of matched) byStatus.set(m.status, (byStatus.get(m.status) ?? 0) + 1);
  for (const [s, c] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  "${s}" → ${c}`);
  }

  // Funnel numbers
  const totalLeads = leads.length + contracts.length;
  const qualifiedLeads = deals.length + contracts.length;
  const opsApproved = matched.length + contracts.length;
  const wonDeals = contracts.length;
  const winRate = totalLeads > 0 ? ((wonDeals / totalLeads) * 100).toFixed(1) : "0.0";

  console.log(`\n── Funnel ──`);
  console.log(`Total Leads:     ${totalLeads} (${leads.length} + ${contracts.length})`);
  console.log(`Qualified Leads: ${qualifiedLeads} (${deals.length} + ${contracts.length})`);
  console.log(`Ops Approved:    ${opsApproved} (${matched.length} + ${contracts.length})`);
  console.log(`Won Deals:       ${wonDeals}`);
  console.log(`Win Rate:        ${winRate}%`);

  // Double-counting check: items appearing in both Leads and Contracts boards
  const leadsNames = new Set(leads.map((i) => i.name.trim().toLowerCase()));
  const contractNames = contracts.map((i) => i.name.trim().toLowerCase());
  const overlap = contractNames.filter((n) => leadsNames.has(n));
  console.log(`\n── Double-count check ──`);
  console.log(`Contract items also in Leads board (by name): ${overlap.length}`);
  if (overlap.length > 0) {
    for (const n of overlap.slice(0, 10)) console.log(`  "${n}"`);
    if (overlap.length > 10) console.log(`  … and ${overlap.length - 10} more`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
