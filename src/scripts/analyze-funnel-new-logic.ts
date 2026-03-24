/**
 * Standalone script: exploratory funnel math (active items only). Not the production sync.
 *
 * Production writes to Supabase via:
 *   - `src/lib/sync/funnel.ts` → cached_funnel_metrics (Sankey / stage counts)
 *   - `src/lib/sync/monday.ts` → daily_funnel_metrics + monday_items_activity (Activity cards)
 *
 * To refresh Activity + daily funnel from Monday, run:
 *   npm run fetch:monday
 *   (or: npx tsx --env-file=.env.local src/scripts/fetch-monday.ts)
 *
 * Stage 1: All items in Leads board.
 * Stage 2: (Deals in groups "topics" or "new_group_mkmgrv50") + (all Contracts).
 * Stage 3: (Deals from same 2 groups where status_mkmxymkn in Legal Negotiation / Waiting for sign / Negotiation Failed) + (all Contracts).
 * Stage 4: All items in Contracts board.
 *
 * Run: npx tsx --env-file=.env.local src/scripts/analyze-funnel-new-logic.ts
 */
import "dotenv/config";

const MONDAY_API_TOKEN =
  process.env.MONDAY_API_TOKEN ?? process.env.mondays_api_key ?? "";
const MONDAY_API_URL = "https://api.monday.com/v2";

const BOARD_IDS = {
  leads: "7832231403",
  deals: "7832231409",
  contracts: "8280704003",
} as const;

/** Deals board: column for pipeline stage (Stage 3 filter). */
const DEALS_STATUS_COLUMN_ID = "status_mkmxymkn";

/** Stage 3: only these exact status labels (case-sensitive match). */
const STAGE_3_STATUSES = [
  "Legal Negotiation",
  "Waiting for sign",
  "Negotiation Failed",
] as const;

/** Stage 2 & 3: only Deals in these group IDs. */
const DEALS_GROUP_IDS = new Set(["topics", "new_group_mkmgrv50"]);

// ---------------------------------------------------------------------------
// Types (minimal for script)
// ---------------------------------------------------------------------------

interface MondayColumnValue {
  id: string;
  text: string | null;
  value: string | null;
  type: string;
}

interface MondayItem {
  id: string;
  name: string;
  state?: string | null;
  group?: { id: string } | null;
  column_values?: MondayColumnValue[];
}

interface ItemsPageResponse {
  boards: Array<{
    id: string;
    items_page: { cursor: string | null; items: MondayItem[] };
  }>;
}

interface NextPageResponse {
  next_items_page: { cursor: string | null; items: MondayItem[] };
}

// ---------------------------------------------------------------------------
// Monday API (standalone)
// ---------------------------------------------------------------------------

async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  if (!MONDAY_API_TOKEN) {
    throw new Error("Missing MONDAY_API_TOKEN. Set it in .env.local");
  }
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: MONDAY_API_TOKEN,
      "API-Version": "2025-10",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Monday API HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new Error(`Monday API: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (json.data == null) throw new Error("Monday API returned no data");
  return json.data;
}

function getColumnText(item: MondayItem, columnId: string): string | null {
  const cols = item.column_values ?? [];
  const col = cols.find((c) => c.id === columnId);
  const raw = col?.text ?? col?.value ?? null;
  if (raw == null || raw === "") return null;
  const s = typeof raw === "string" ? raw.trim() : String(raw).trim();
  return s || null;
}

/**
 * Fetch all items from a board, including state and group.
 * We then filter to state === "active" in this script.
 */
async function fetchBoardItemsWithStateAndGroup(
  boardId: string,
  options: { includeColumnValues?: boolean } = {}
): Promise<MondayItem[]> {
  const columnValuesFragment = options.includeColumnValues
    ? "column_values { id text value type }"
    : "";

  const firstQuery = `
    query GetBoardItemsFirst($boardId: ID!, $limit: Int!) {
      boards(ids: [$boardId]) {
        id
        items_page(limit: $limit) {
          cursor
          items {
            id
            name
            state
            group { id }
            ${columnValuesFragment}
          }
        }
      }
    }
  `;

  const nextQuery = `
    query GetBoardItemsNext($limit: Int!, $cursor: String!) {
      next_items_page(limit: $limit, cursor: $cursor) {
        cursor
        items {
          id
          name
          state
          group { id }
          ${columnValuesFragment}
        }
      }
    }
  `;

  const limit = 500;
  const all: MondayItem[] = [];
  let cursor: string | null = null;

  const first = await graphql<ItemsPageResponse>(firstQuery, { boardId, limit });
  const firstPage = first.boards?.[0]?.items_page;
  if (!firstPage) return all;
  all.push(...firstPage.items);
  cursor = firstPage.cursor ?? null;

  while (cursor) {
    const next = await graphql<NextPageResponse>(nextQuery, { limit, cursor });
    const page = next.next_items_page;
    if (!page) break;
    all.push(...page.items);
    cursor = page.cursor ?? null;
  }

  return all;
}

// ---------------------------------------------------------------------------
// New funnel logic
// ---------------------------------------------------------------------------

function filterActive(items: MondayItem[]): MondayItem[] {
  return items.filter((i) => (i.state ?? "active") === "active");
}

async function run() {
  console.log("=== Funnel analysis (NEW logic) ===\n");
  console.log("Rules: state = active only.");
  console.log("Boards: Leads", BOARD_IDS.leads, "| Deals", BOARD_IDS.deals, "| Contracts", BOARD_IDS.contracts);
  console.log("Deals groups for Stage 2/3:", [...DEALS_GROUP_IDS].join(", "));
  console.log("Stage 3 status column:", DEALS_STATUS_COLUMN_ID);
  console.log("Stage 3 statuses:", STAGE_3_STATUSES.join(", "));
  console.log("");
  console.log("Fetching from Monday…\n");

  const [leadsRaw, dealsRaw, contractsRaw] = await Promise.all([
    fetchBoardItemsWithStateAndGroup(BOARD_IDS.leads),
    fetchBoardItemsWithStateAndGroup(BOARD_IDS.deals, { includeColumnValues: true }),
    fetchBoardItemsWithStateAndGroup(BOARD_IDS.contracts),
  ]);

  const leads = filterActive(leadsRaw);
  const deals = filterActive(dealsRaw);
  const contracts = filterActive(contractsRaw);

  // ---- Raw counts ----
  console.log("--- Raw counts (active only) ---");
  console.log("Leads board:    ", leads.length, `(total items fetched: ${leadsRaw.length}, active: ${leads.length})`);
  console.log("Deals board:    ", deals.length, `(total items fetched: ${dealsRaw.length}, active: ${deals.length})`);
  console.log("Contracts board:", contracts.length, `(total items fetched: ${contractsRaw.length}, active: ${contracts.length})`);
  console.log("");

  // ---- Deals by group ----
  const dealsByGroup = new Map<string, number>();
  for (const item of deals) {
    const gid = item.group?.id ?? "(no group)";
    dealsByGroup.set(gid, (dealsByGroup.get(gid) ?? 0) + 1);
  }
  console.log("--- Deals board: count by Group ID ---");
  const sortedGroups = [...dealsByGroup.entries()].sort((a, b) => b[1] - a[1]);
  for (const [gid, count] of sortedGroups) {
    const inScope = DEALS_GROUP_IDS.has(gid) ? " [IN SCOPE Stage 2/3]" : "";
    console.log(`  ${gid}: ${count}${inScope}`);
  }
  console.log("");

  // ---- Stage 2: Deals in topics or new_group_mkmgrv50 + all Contracts ----
  const dealsStage2 = deals.filter((i) => {
    const gid = i.group?.id;
    return gid != null && DEALS_GROUP_IDS.has(gid);
  });
  const stage2 = dealsStage2.length + contracts.length;

  // ---- Stage 3: Same 2 groups, status in Legal Negotiation / Waiting for sign / Negotiation Failed + all Contracts ----
  const stage3StatusSet = new Set(STAGE_3_STATUSES);
  const dealsStage3 = deals.filter((i) => {
    const gid = i.group?.id;
    if (!gid || !DEALS_GROUP_IDS.has(gid)) return false;
    const status = getColumnText(i, DEALS_STATUS_COLUMN_ID);
    return status != null && stage3StatusSet.has(status as (typeof STAGE_3_STATUSES)[number]);
  });
  const stage3 = dealsStage3.length + contracts.length;

  // ---- Final report ----
  console.log("--- Final calculated stages (NEW logic) ---");
  console.log("Stage 1 (Leads):              ", leads.length);
  console.log("Stage 2 (Qualified):           ", stage2, `= Deals in (topics | new_group_mkmgrv50) (${dealsStage2.length}) + Contracts (${contracts.length})`);
  console.log("Stage 3 (Ops Approved):        ", stage3, `= Deals same groups + status in [Legal Negotiation, Waiting for sign, Negotiation Failed] (${dealsStage3.length}) + Contracts (${contracts.length})`);
  console.log("Stage 4 (Won Deals):          ", contracts.length);
  console.log("");
  console.log("--- Summary ---");
  console.log("  Stage 1:", leads.length);
  console.log("  Stage 2:", stage2);
  console.log("  Stage 3:", stage3);
  console.log("  Stage 4:", contracts.length);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
