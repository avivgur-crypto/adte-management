/**
 * XDASH API Client
 *
 * Fetches financial data from the XDASH internal system:
 *   - Demand partners  → revenue
 *   - Supply partners  → cost
 *   - Ad-server overview (legacy)
 *
 * IMPORTANT: The auth token expires periodically. When it does, copy a fresh
 * token from your browser (DevTools > Network > copy as cURL) and update
 * XDASH_AUTH_TOKEN in your `.env.local` file.
 */

// ============================================================================
// Configuration — credentials loaded from environment variables (.env.local)
// ============================================================================
const XDASH_AUTH_TOKEN = process.env.XDASH_AUTH_TOKEN ?? "";
const XDASH_ORGANIZATION_ID = process.env.XDASH_ORGANIZATION_ID ?? "";
const XDASH_API_BASE = "https://api.xdash.adte-system.com";

function assertEnvVars() {
  if (!XDASH_AUTH_TOKEN) {
    throw new Error(
      "Missing XDASH_AUTH_TOKEN. Set it in .env.local (see .env.example)."
    );
  }
  if (!XDASH_ORGANIZATION_ID) {
    throw new Error(
      "Missing XDASH_ORGANIZATION_ID. Set it in .env.local (see .env.example)."
    );
  }
}

// ============================================================================
// Types
// ============================================================================

/** The date range payload sent to the XDASH API */
export interface XDashDateRange {
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD"
  specificComparisonDate?: string | null;
}

/** Totals object for a single ad-server or the aggregated totals */
export interface XDashTotals {
  impressions: number;
  cost: number;
  requests: number;
  revenue: number;
  completion: number;
  incomingRequests: number;
  netRevenue: number;
  netCost: number;
  vcr: number;
  fillRate: number;
  adFillRate: number;
  serviceCost: number;
  dpId?: string;
}

/** A single ad-server entry inside the response */
export interface XDashAdServer {
  _id: string;
  totals: XDashTotals;
  adServer: {
    _id: string;
    name: string;
  };
  dataPoints: unknown[];
}

/** A date-period breakdown (selectedDates, dayAgo, weekAgo, monthAgo, etc.) */
export interface XDashPeriodData {
  id: string | null;
  adServers: XDashAdServer[];
  totals: XDashTotals;
}

/** The full API response shape from /home/overview/adServers */
export interface XDashApiResponse {
  overviewTotals: {
    selectedDates: XDashPeriodData;
    dayAgo: XDashPeriodData;
    weekAgo: XDashPeriodData;
    monthAgo: XDashPeriodData;
    specificComparisonDate: XDashPeriodData;
  };
}

/** Simplified financial summary for dashboard use */
export interface FinancialSummary {
  revenue: number;
  cost: number;
  profit: number;
  netRevenue: number;
  netCost: number;
  impressions: number;
  serviceCost: number;
  adServers: Array<{
    name: string;
    revenue: number;
    cost: number;
    profit: number;
  }>;
}

// ---------------------------------------------------------------------------
// Partner-level types  (demand / supply endpoints) — based on actual API logs
// ---------------------------------------------------------------------------

/** Totals for a single partner; use netRevenue/netCost when revenue/cost are 0 */
export interface XDashPartnerTotals {
  revenue: number;
  cost: number;
  netRevenue?: number;
  netCost?: number;
  impressions: number;
}

/** A single partner entry in the demand/supply overview response */
export interface XDashPartnerItem {
  _id: string;
  partner: {
    name: string;
    side: string;
    _id: string;
  };
  totals: XDashPartnerTotals;
}

/** Response may have partners in different keys or be the array itself */
export interface XDashPartnerApiResponseObject {
  specificComparisonDate?: unknown;
  partners?: XDashPartnerItem[];
  selectedDates?: {
    partners?: XDashPartnerItem[];
    adServers?: XDashPartnerItem[];
  };
  data?: XDashPartnerItem[];
  rows?: XDashPartnerItem[];
  [key: string]: unknown;
}

export type XDashPartnerApiResponse =
  | XDashPartnerApiResponseObject
  | XDashPartnerItem[];

/** Simplified per-partner row ready for DB upsert */
export interface PartnerRow {
  name: string;
  revenue: number;
  cost: number;
  impressions: number;
}

// ============================================================================
// Shared helpers
// ============================================================================

/** Parse revenue/cost from API (handles numbers or strings with $ and commas; preserves cents). */
function parseCurrencyValue(v: unknown): number {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const s = String(v ?? "").replace(/\$/g, "").replace(/,/g, "").trim();
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}

/** Build common headers used by every XDASH API call */
function buildHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-organization": XDASH_ORGANIZATION_ID,
    Cookie: `auth-token=${XDASH_AUTH_TOKEN}`,
  };
}

/** Build the JSON body for a date-range request */
function buildDatePayload(date: string): string {
  return JSON.stringify({
    startDate: date,
    endDate: date,
    specificComparisonDate: null,
  });
}

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 3000;

/** Fetch with retry on network errors (ETIMEDOUT, ECONNRESET, etc.). */
async function fetchWithRetry(
  url: string,
  options: RequestInit
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, options);
      return res;
    } catch (e) {
      lastErr = e;
      const isNetwork =
        e instanceof TypeError && (e.message === "fetch failed" || e.cause != null);
      if (attempt < RETRY_ATTEMPTS && isNetwork) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

// ============================================================================
// Core fetch function (legacy — ad-server overview)
// ============================================================================

/**
 * Fetches the ad-server overview data from XDASH for a given date range.
 *
 * This replicates the exact headers, cookies, and payload captured from a
 * browser session so the server treats it as an authenticated request.
 */
export async function fetchAdServerOverview(
  dateRange: XDashDateRange
): Promise<XDashApiResponse> {
  assertEnvVars();
  const url = `${XDASH_API_BASE}/home/overview/adServers`;

  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      specificComparisonDate: dateRange.specificComparisonDate ?? null,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `XDASH API error ${response.status}: ${response.statusText}\n${errorBody}`
    );
  }

  const json: XDashApiResponse = await response.json();
  return json;
}

// ============================================================================
// Convenience: Fetch today's overview (legacy)
// ============================================================================

export async function fetchTodayOverview(): Promise<XDashApiResponse> {
  const today = new Date().toISOString().split("T")[0];
  return fetchAdServerOverview({
    startDate: today,
    endDate: today,
    specificComparisonDate: null,
  });
}

// ============================================================================
// Partner endpoints — Demand & Supply
// ============================================================================

/**
 * Fetch demand (revenue) partners overview for a single date.
 *
 * Endpoint: POST /partners/demand/overview
 */
export async function fetchDemandPartners(
  date: string
): Promise<XDashPartnerApiResponse> {
  assertEnvVars();
  const url = `${XDASH_API_BASE}/partners/demand/overview`;

  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: buildHeaders(),
    body: buildDatePayload(date),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `XDASH Demand API error ${response.status}: ${response.statusText}\n${errorBody}`
    );
  }

  return (await response.json()) as XDashPartnerApiResponse;
}

/**
 * Fetch supply (cost) partners overview for a single date.
 *
 * Endpoint: POST /partners/supply/overview
 */
export async function fetchSupplyPartners(
  date: string
): Promise<XDashPartnerApiResponse> {
  assertEnvVars();
  const url = `${XDASH_API_BASE}/partners/supply/overview`;

  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: buildHeaders(),
    body: buildDatePayload(date),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `XDASH Supply API error ${response.status}: ${response.statusText}\n${errorBody}`
    );
  }

  return (await response.json()) as XDashPartnerApiResponse;
}

// ============================================================================
// Mapping helpers — extract partner rows from raw API responses
// ============================================================================

/** Resolve partners array from response (priority: root partners → selectedDates.partners → selectedDates.adServers → data → array) */
function getPartnersArray(data: XDashPartnerApiResponse): XDashPartnerItem[] {
  if (Array.isArray(data)) return data;
  const obj = data as XDashPartnerApiResponseObject;
  return (
    obj.partners ??
    obj.selectedDates?.partners ??
    obj.selectedDates?.adServers ??
    obj.data ??
    obj.rows ??
    []
  );
}

/**
 * Map a demand response into PartnerRow[].
 * Name from item.partner.name; revenue from totals.revenue or totals.netRevenue; cost = 0.
 */
export function mapDemandPartners(
  data: XDashPartnerApiResponse
): PartnerRow[] {
  if (!Array.isArray(data)) {
    console.log("Response Keys:", Object.keys(data));
  }
  const partnersArray = getPartnersArray(data);
  console.log(`Found ${partnersArray.length} items to process.`);

  return partnersArray.map((item: XDashPartnerItem) => {
    const name =
      item.partner?.name ?? (item as { name?: string }).name ?? "Unknown Partner";
    const totals = item.totals ?? ({} as XDashPartnerTotals);
    const revenue = parseCurrencyValue(totals.revenue ?? totals.netRevenue ?? 0);

    return {
      name,
      revenue,
      cost: 0,
      impressions: totals.impressions ?? 0,
    };
  });
}

/**
 * Map a supply response into PartnerRow[].
 * Name from item.partner.name; cost from totals.cost or totals.netCost; revenue = 0.
 * Both demand and supply are fetched by the sync so revenue and cost are captured correctly.
 */
export function mapSupplyPartners(
  data: XDashPartnerApiResponse
): PartnerRow[] {
  if (!Array.isArray(data)) {
    console.log("Response Keys:", Object.keys(data));
  }
  const partnersArray = getPartnersArray(data);
  console.log(`Found ${partnersArray.length} items to process.`);

  return partnersArray.map((item: XDashPartnerItem) => {
    const name =
      item.partner?.name ?? (item as { name?: string }).name ?? "Unknown Partner";
    const totals = item.totals ?? ({} as XDashPartnerTotals);
    const cost = parseCurrencyValue(totals.cost ?? totals.netCost ?? 0);

    return {
      name,
      revenue: 0,
      cost,
      impressions: totals.impressions ?? 0,
    };
  });
}

// ============================================================================
// Helper: Extract a clean financial summary from the raw API response (legacy)
// ============================================================================

export function extractFinancialSummary(
  response: XDashApiResponse,
  period: keyof XDashApiResponse["overviewTotals"] = "selectedDates"
): FinancialSummary {
  const periodData = response.overviewTotals[period];
  const { totals } = periodData;

  return {
    revenue: totals.revenue,
    cost: totals.cost,
    profit: totals.revenue - totals.cost,
    netRevenue: totals.netRevenue,
    netCost: totals.netCost,
    impressions: totals.impressions,
    serviceCost: totals.serviceCost,
    adServers: periodData.adServers.map((server) => ({
      name: server.adServer.name,
      revenue: server.totals.revenue,
      cost: server.totals.cost,
      profit: server.totals.revenue - server.totals.cost,
    })),
  };
}
