/**
 * Monday.com API v2 client (GraphQL).
 *
 * Fetches board items for funnel analysis. Requires MONDAY_API_TOKEN in .env.local.
 */

const MONDAY_API_TOKEN =
  process.env.MONDAY_API_TOKEN ?? process.env.mondays_api_key ?? "";
const MONDAY_API_URL = "https://api.monday.com/v2";

function assertToken() {
  if (!MONDAY_API_TOKEN) {
    throw new Error(
      "Missing MONDAY_API_TOKEN. Set it in .env.local (see .env.example)."
    );
  }
}

/** Run a GraphQL query against Monday.com v2 */
async function graphql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
  assertToken();
  const response = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: MONDAY_API_TOKEN,
      "API-Version": "2025-10",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Monday API HTTP ${response.status}: ${text}`);
  }

  const json = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new Error(`Monday API GraphQL: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (json.data == null) {
    throw new Error("Monday API returned no data");
  }
  return json.data;
}

// ---------------------------------------------------------------------------
// Types (match Monday.com API response shape)
// ---------------------------------------------------------------------------

export interface MondayColumnValue {
  id: string;
  text: string | null;
  value: string | null;
  type: string;
}

export interface MondayItem {
  id: string;
  name: string;
  /** ISO8601 from Monday API when requested */
  created_at?: string | null;
  state?: string | null;
  group?: { id: string } | null;
  column_values?: MondayColumnValue[];
}

export interface MondayItemsPage {
  cursor: string | null;
  items: MondayItem[];
}

export interface MondayBoardItemsResponse {
  boards: Array<{
    id: string;
    items_page: MondayItemsPage;
  }>;
}

/** Response for next_items_page query */
export interface MondayNextItemsPageResponse {
  next_items_page: MondayItemsPage;
}

// ---------------------------------------------------------------------------
// Board IDs for funnel
// ---------------------------------------------------------------------------

export const MONDAY_BOARD_IDS = {
  leads: "7832231403",
  deals: "7832231409",
  contracts: "8280704003",
} as const;

/** Single board ID for funnel (status-based mapping). Set MONDAY_BOARD_ID in .env.local. */
export const MONDAY_BOARD_ID = process.env.MONDAY_BOARD_ID ?? "";

/** Creation log column IDs — date for grouping (YYYY-MM-DD) and activity.created_date. */
export const CREATION_LOG_COLUMN_IDS = {
  /** Board 7832231403 (Leads / New Partners). Monday "Creation log" = pulse_log_mkzm1prs. */
  leads: "pulse_log_mkzm1prs",
  /** Board 8280704003 (Media Contracts). Same Creation log column id. */
  contracts: "pulse_log_mkzm1prs",
} as const;

/**
 * Media Contracts board: "Account Name" column (company label in Monday).
 * Override with MONDAY_CONTRACTS_ACCOUNT_NAME_COLUMN_ID if the board uses a different id.
 */
export const CONTRACTS_ACCOUNT_NAME_COLUMN_ID =
  process.env.MONDAY_CONTRACTS_ACCOUNT_NAME_COLUMN_ID?.trim() || "text_mkpw5mcs";

/** @deprecated Use CONTRACTS_ACCOUNT_NAME_COLUMN_ID */
export const CONTRACTS_COMPANY_COLUMN_ID = CONTRACTS_ACCOUNT_NAME_COLUMN_ID;

/** Contracts board: status column (cm_status_template). Only "Complete Storage" = signed deal. */
export const CONTRACTS_STATUS_COLUMN_ID = "cm_status_template";
export const CONTRACTS_SIGNED_STATUS = "Complete Storage";

/**
 * Deals board: column that holds pipeline stage (Legal Negotiation, Waiting for sign, etc.).
 * Set DEALS_STATUS_COLUMN_ID in .env.local so Ops Approved count is correct.
 * Read at runtime so it always uses current env.
 */
export const DEALS_STATUS_COLUMN_ID = process.env.DEALS_STATUS_COLUMN_ID ?? "";

/** Deals board: the specific status column used for Stage 3 (Ops Approved) filter. */
export const FUNNEL_DEALS_STATUS_COL = "status_mkmxymkn";

/** Stage 2 & 3: only Deals from these group IDs count. */
export const FUNNEL_DEALS_GROUP_IDS = new Set(["topics", "new_group_mkmgrv50"]);

/** Stage 3: exact status labels that qualify as Ops Approved. */
export const FUNNEL_OPS_STATUSES = new Set([
  "Legal Negotiation",
  "Waiting for sign",
  "Negotiation Failed",
]);

/** Filter helper: keep only items with state "active" (default for items_page). */
export function filterActiveItems(items: MondayItem[]): MondayItem[] {
  return items.filter((i) => (i.state ?? "active") === "active");
}

const ITEMS_PAGE_LIMIT = 500;

/**
 * Fetch all items from a single board, with optional column_values and created_at.
 * For activity (Leads/Contracts), pass includeColumnValues: true and use getCreationLogDate()
 * with CREATION_LOG_COLUMN_IDS.leads or .contracts to read creation date from pulse_log columns.
 * Paginates using items_page then next_items_page.
 */
export async function fetchBoardItems(
  boardId: string,
  options: { includeColumnValues?: boolean; includeCreatedAt?: boolean } = {}
): Promise<MondayItem[]> {
  const columnValuesFragment = options.includeColumnValues
    ? "column_values { id text value type }"
    : "";
  const createdAtFragment = options.includeCreatedAt ? "created_at" : "";

  const firstPageQuery = `
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
            ${createdAtFragment}
            ${columnValuesFragment}
          }
        }
      }
    }
  `;

  const nextPageQuery = `
    query GetBoardItemsNext($limit: Int!, $cursor: String!) {
      next_items_page(limit: $limit, cursor: $cursor) {
        cursor
        items {
          id
          name
          state
          group { id }
          ${createdAtFragment}
          ${columnValuesFragment}
        }
      }
    }
  `;

  const allItems: MondayItem[] = [];
  let cursor: string | null = null;

  // First page (under board)
  const data = await graphql<MondayBoardItemsResponse>(firstPageQuery, {
    boardId,
    limit: ITEMS_PAGE_LIMIT,
  });
  const board = data.boards?.[0];
  const firstPage = board?.items_page;
  if (!firstPage) return allItems;
  allItems.push(...firstPage.items);
  cursor = firstPage.cursor ?? null;

  // Subsequent pages (root-level next_items_page)
  while (cursor) {
    const nextData = await graphql<MondayNextItemsPageResponse>(nextPageQuery, {
      limit: ITEMS_PAGE_LIMIT,
      cursor,
    });
    const page = nextData.next_items_page;
    if (!page) break;
    allItems.push(...page.items);
    cursor = page.cursor ?? null;
  }

  return allItems;
}

/**
 * Get Status column text for an item (for Deals board).
 * Prefers a column whose id starts with "status_", then falls back to
 * any column of type "color"/"status", then any id containing "status".
 */
export function getItemStatus(item: MondayItem): string | null {
  const cols = item.column_values ?? [];
  const preferred =
    cols.find((c) => c.id.startsWith("status_") && (c.type === "color" || c.type === "status")) ??
    cols.find((c) => c.type === "color" || c.type === "status") ??
    cols.find((c) => c.id && c.id.toLowerCase().includes("status"));
  return preferred?.text ?? preferred?.value ?? null;
}

/**
 * Get text value of a column by id (e.g. Account Name / text_mkpw5mcs on Contracts board).
 */
export function getColumnText(item: MondayItem, columnId: string): string | null {
  const cols = item.column_values ?? [];
  const col = cols.find((c) => c.id === columnId);
  const raw = col?.text ?? col?.value ?? null;
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") return raw.trim() || null;
  return null;
}

/**
 * Get creation date from a creation-log column (e.g. pulse_log_mkzm1prs).
 * Prefer the column's value; fall back to item.created_at if present.
 * Parses JSON value with "date", "changed_at", or plain ISO date string.
 * Returns null if unparseable.
 */
export function getCreationLogDate(
  item: MondayItem,
  columnId: string
): Date | null {
  const cols = item.column_values ?? [];
  const col = cols.find((c) => c.id === columnId);
  const raw = col?.value ?? col?.text ?? null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as {
        date?: string;
        changed_at?: string;
        [key: string]: unknown;
      };
      const dateStr =
        parsed?.date ?? parsed?.changed_at ?? (typeof parsed === "string" ? parsed : null);
      if (dateStr) {
        const d = new Date(dateStr);
        if (!Number.isNaN(d.getTime())) return d;
      }
    } catch {
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  if (item.created_at) {
    const d = new Date(item.created_at);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}
