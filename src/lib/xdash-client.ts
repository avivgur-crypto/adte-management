/**
 * XDASH Backup API Client
 *
 * Fetches financial data from the XDASH **backup** system (weak/unstable).
 * All requests are throttled to avoid overloading it.
 *
 *   - Partners overview: /partners/demand/overview + /partners/supply/overview (2 calls per date)
 *   - Reports API: one call per date with metrics Revenue/Cost/Impressions — set XDASH_USE_REPORTS=true
 *   - Ad-server overview (legacy): /home/overview/adServers
 *
 * IMPORTANT: The auth token expires periodically. Copy a fresh token from the backup site
 * (DevTools > Network > auth-token cookie) and update XDASH_AUTH_TOKEN in `.env.local`.
 */

// ============================================================================
// KILL SWITCH — set XDASH_DISABLED=true in .env.local to block ALL API calls.
// Remove or set to false once XDASH server issues are resolved.
// ============================================================================
const XDASH_DISABLED = (process.env.XDASH_DISABLED ?? "false").toLowerCase() === "true";

class XDashDisabledError extends Error {
  constructor() {
    super("[xdash-client] XDASH API calls are disabled (XDASH_DISABLED=true). No requests will be sent.");
    this.name = "XDashDisabledError";
  }
}

function assertNotDisabled() {
  if (XDASH_DISABLED) throw new XDashDisabledError();
}

// ============================================================================
// Configuration — credentials loaded from environment variables (.env.local)
// ============================================================================
const XDASH_AUTH_TOKEN = process.env.XDASH_AUTH_TOKEN ?? "";
const XDASH_ORGANIZATION_ID = process.env.XDASH_ORGANIZATION_ID ?? "";
const XDASH_API_BASE = process.env.XDASH_API_BASE ?? "https://xdash-for-aviv-temp-txe5v.ondigitalocean.app";

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
// Reports API — lighter than Home/Partners overview, one query per date
// ============================================================================

const XDASH_USE_REPORTS = (process.env.XDASH_USE_REPORTS ?? "false").toLowerCase() === "true";
const XDASH_REPORT_PATH = process.env.XDASH_REPORT_PATH ?? "/report";

const REPORT_PATH_404_FALLBACKS = ["/reports", "/reports/run", "/api/report", "/api/reports"];

/** Report payload shape required by XDASH API: dimensions camelCase, aggregationPeriod, metrics include profit. */
const REPORT_DIMENSIONS = ["supplyTag", "demandTag"] as const;
const REPORT_AGGREGATION_PERIOD = "sum";
const REPORT_METRICS = ["revenue", "cost", "impressions", "profit"];

function buildReportPayload(date: string): string {
  return JSON.stringify({
    startDate: date,
    endDate: date,
    aggregationPeriod: REPORT_AGGREGATION_PERIOD,
    dimensions: [...REPORT_DIMENSIONS],
    metrics: [...REPORT_METRICS],
  });
}

/** Report payload for a date range (used by pair-level fetch). */
function buildReportPayloadRange(startDate: string, endDate: string): string {
  return JSON.stringify({
    startDate,
    endDate,
    aggregationPeriod: REPORT_AGGREGATION_PERIOD,
    dimensions: [...REPORT_DIMENSIONS],
    metrics: [...REPORT_METRICS],
  });
}

/**
 * Report row shape — supports both nested and flat structures:
 *   Nested: { dimensions: { demandTag: { name: "X" }, supplyTag: { name: "Y" } }, metrics: { revenue: 100 } }
 *   Flat:   { demandTag: "X", supplyTag: "Y", revenue: 100 }
 */
interface ReportRowLike {
  revenue?: number;
  cost?: number;
  impressions?: number;
  profit?: number;
  partnerName?: string;
  name?: string;
  demandTag?: string | { name?: string; [k: string]: unknown };
  supplyTag?: string | { name?: string; [k: string]: unknown };
  dimensions?: {
    demandTag?: { name?: string; [k: string]: unknown };
    supplyTag?: { name?: string; [k: string]: unknown };
    [k: string]: unknown;
  };
  metrics?: {
    revenue?: number;
    cost?: number;
    impressions?: number;
    profit?: number;
    [k: string]: unknown;
  };
  "Demand Partner"?: string;
  "Supply Partner"?: string;
  "Demand Tag"?: string;
  "Supply Tag"?: string;
  demandPartner?: string;
  supplyPartner?: string;
  dimension?: string;
  side?: string;
  [key: string]: unknown;
}

/** Resolve a tag value from nested (dimensions.demandTag.name) or flat (demandTag as string) or legacy keys. */
function resolveDemandTag(row: ReportRowLike): string {
  const nested = row.dimensions?.demandTag?.name;
  if (nested) return nested.trim();
  const flat = row.demandTag;
  if (typeof flat === "string" && flat.trim()) return flat.trim();
  if (typeof flat === "object" && flat?.name) return String(flat.name).trim();
  const legacy =
    row.demandPartner ?? row["Demand Partner"] ?? row["Demand Tag"];
  if (typeof legacy === "string" && legacy.trim()) return legacy.trim();
  return "";
}

function resolveSupplyTag(row: ReportRowLike): string {
  const nested = row.dimensions?.supplyTag?.name;
  if (nested) return nested.trim();
  const flat = row.supplyTag;
  if (typeof flat === "string" && flat.trim()) return flat.trim();
  if (typeof flat === "object" && flat?.name) return String(flat.name).trim();
  const legacy =
    row.supplyPartner ?? row["Supply Partner"] ?? row["Supply Tag"];
  if (typeof legacy === "string" && legacy.trim()) return legacy.trim();
  return "";
}

/** Extract a numeric metric from nested (row.metrics.X) or flat (row.X), with currency parsing. */
function resolveMetric(row: ReportRowLike, key: "revenue" | "cost" | "impressions" | "profit"): number {
  const nested = row.metrics?.[key];
  if (nested !== undefined && nested !== null) return parseCurrencyValue(nested);
  const flat = (row as Record<string, unknown>)[key];
  if (flat !== undefined && flat !== null) return parseCurrencyValue(flat);
  const titleCase = key.charAt(0).toUpperCase() + key.slice(1);
  const alt = (row as Record<string, unknown>)[titleCase];
  if (alt !== undefined && alt !== null) return parseCurrencyValue(alt);
  return 0;
}

function parseReportRowToPartnerRows(row: ReportRowLike): PartnerRow[] {
  const revenue = resolveMetric(row, "revenue");
  const cost = resolveMetric(row, "cost");
  const impressions = resolveMetric(row, "impressions");
  const name = resolveDemandTag(row) || resolveSupplyTag(row) || (row.partnerName as string) || (row.name as string) || "Unknown";

  const out: PartnerRow[] = [];
  if (revenue > 0) out.push({ name, revenue, cost: 0, impressions });
  if (cost > 0) out.push({ name, revenue: 0, cost, impressions });
  return out;
}

/** Extract array of rows from report response (tries common keys) */
function getReportRows(data: unknown): ReportRowLike[] {
  if (Array.isArray(data)) return data as ReportRowLike[];
  const obj = data as Record<string, unknown>;
  const arr = obj?.data ?? obj?.rows ?? obj?.result ?? obj?.reportData;
  if (Array.isArray(arr)) return arr as ReportRowLike[];
  const inner = obj?.data as Record<string, unknown> | undefined;
  if (inner && typeof inner === "object" && Array.isArray(inner.rows)) {
    return inner.rows as ReportRowLike[];
  }
  return [];
}

/** Pair-level row for Dependency Mapping (demand × supply per date). API may return profit; we compute if missing. */
export interface ReportPairRow {
  demandPartner: string;
  supplyPartner: string;
  revenue: number;
  cost: number;
  profit?: number;
}

const REPORT_RETRY_ON_STATUS = [502, 503, 504];
const REPORT_RETRY_ATTEMPTS = 2;
const REPORT_RETRY_DELAY_MS = 8000;

/**
 * Fetch one day of partner data via the Reports API (lighter than partners/demand + partners/supply).
 * Returns { demand, supply } so sync can use the same record format.
 * If the backend uses a different path or body, set XDASH_REPORT_PATH and/or adapt buildReportPayload.
 */
export async function fetchReportForDate(
  date: string
): Promise<{ demand: PartnerRow[]; supply: PartnerRow[] }> {
  assertNotDisabled();
  assertEnvVars();

  const url = `${XDASH_API_BASE}${XDASH_REPORT_PATH}`;
  const body = buildReportPayload(date);

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= REPORT_RETRY_ATTEMPTS; attempt++) {
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: buildHeaders(),
      body,
    });

    if (response.ok) {
      const raw = (await response.json()) as unknown;
      const rows = getReportRows(raw);

      const demand: PartnerRow[] = [];
      const supply: PartnerRow[] = [];

      for (const row of rows) {
        const parsed = parseReportRowToPartnerRows(row);
        for (const p of parsed) {
          if (p.revenue > 0) demand.push(p);
          else if (p.cost > 0) supply.push(p);
        }
      }

      return { demand, supply };
    }

    const errorBody = await response.text();
    lastError = new Error(`XDASH Report API error ${response.status}: ${response.statusText}\n${errorBody}`);
    if (!REPORT_RETRY_ON_STATUS.includes(response.status) || attempt === REPORT_RETRY_ATTEMPTS) {
      throw lastError;
    }
    console.warn(`[xdash-client] Report got ${response.status}, retrying in ${REPORT_RETRY_DELAY_MS / 1000}s …`);
    await new Promise((r) => setTimeout(r, REPORT_RETRY_DELAY_MS));
  }
  throw lastError ?? new Error("XDASH report fetch failed");
}

/**
 * Fetch report for a date range and return pair-level rows (demand × supply).
 * On 404, tries fallback paths from REPORT_PATH_404_FALLBACKS.
 */
export async function fetchReportPairsForDateRange(
  startDate: string,
  endDate: string
): Promise<ReportPairRow[]> {
  assertNotDisabled();
  assertEnvVars();

  const body = buildReportPayloadRange(startDate, endDate);
  const pathsToTry = [
    XDASH_REPORT_PATH,
    ...REPORT_PATH_404_FALLBACKS.filter((p) => p !== XDASH_REPORT_PATH),
  ];

  let lastError: Error | null = null;

  for (const path of pathsToTry) {
    const url = `${XDASH_API_BASE}${path}`;

    for (let attempt = 1; attempt <= REPORT_RETRY_ATTEMPTS; attempt++) {
      const response = await fetchWithRetry(url, {
        method: "POST",
        headers: buildHeaders(),
        body,
      });

      if (response.ok) {
        const raw = (await response.json()) as unknown;
        const rows = getReportRows(raw);
        const pairs: ReportPairRow[] = [];

        for (const row of rows) {
          const demandPartner = resolveDemandTag(row);
          const supplyPartner = resolveSupplyTag(row);
          if (!demandPartner || !supplyPartner) continue;
          const revenue = resolveMetric(row, "revenue");
          const cost = resolveMetric(row, "cost");
          if (revenue <= 0 && cost <= 0) continue;
          const rawProfit = resolveMetric(row, "profit");
          const profit = rawProfit !== 0 ? rawProfit : revenue - cost;
          pairs.push({ demandPartner, supplyPartner, revenue, cost, profit });
        }
        return pairs;
      }

      const errorBody = await response.text();
      lastError = new Error(
        `XDASH Report API error ${response.status}: ${response.statusText}\n${errorBody}`
      );

      if (response.status === 404) {
        break;
      }
      if (!REPORT_RETRY_ON_STATUS.includes(response.status) || attempt === REPORT_RETRY_ATTEMPTS) {
        throw lastError;
      }
      await new Promise((r) => setTimeout(r, REPORT_RETRY_DELAY_MS));
    }
  }

  const pathsTried = pathsToTry.join(", ");
  const hint =
    "To enable Dependency Mapping, find the Reports endpoint in your XDASH UI (DevTools > Network when running a report) and set XDASH_REPORT_PATH in .env.local.";
  throw new Error(
    `${lastError?.message ?? "XDASH report pairs fetch failed"} Tried paths: ${pathsTried}. ${hint}`
  );
}

/** True when the error indicates the Report API endpoint was not found (caller can fail fast). */
export function isReportApi404(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("404") || msg.includes("Not Found") || msg.includes("Cannot POST");
}

function datesBetween(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const cur = new Date(start);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

const PAIRS_DAY_BY_DAY_DELAY_MS = 2000;

/**
 * Fetch report pairs day-by-day and aggregate. Use when the API returns empty for a date range.
 */
export async function fetchReportPairsDayByDay(
  startDate: string,
  endDate: string
): Promise<ReportPairRow[]> {
  const days = datesBetween(startDate, endDate);
  const pairSums = new Map<string, { revenue: number; cost: number }>();
  const sep = "\u0001";

  for (let i = 0; i < days.length; i++) {
    const day = days[i]!;
    const rows = await fetchReportPairsForDateRange(day, day);
    for (const p of rows) {
      const key = `${p.demandPartner}${sep}${p.supplyPartner}`;
      const cur = pairSums.get(key) ?? { revenue: 0, cost: 0 };
      cur.revenue += p.revenue;
      cur.cost += p.cost;
      pairSums.set(key, cur);
    }
    if (i < days.length - 1) {
      await new Promise((r) => setTimeout(r, PAIRS_DAY_BY_DAY_DELAY_MS));
    }
  }

  return Array.from(pairSums.entries()).map(([key, { revenue, cost }]) => {
    const i = key.indexOf(sep);
    const demandPartner = i >= 0 ? key.slice(0, i) : key;
    const supplyPartner = i >= 0 ? key.slice(i + 1) : "Unknown";
    return { demandPartner, supplyPartner, revenue, cost };
  });
}

/** True if sync should use Reports API instead of partners/demand and partners/supply. */
export function useReportsForSync(): boolean {
  return XDASH_USE_REPORTS;
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

const RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 5000;

// Throttle: minimum gap between consecutive API calls to protect the backup server.
const THROTTLE_MS = 3000;
let _lastRequestTime = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - _lastRequestTime;
  if (elapsed < THROTTLE_MS) {
    await new Promise((r) => setTimeout(r, THROTTLE_MS - elapsed));
  }
  _lastRequestTime = Date.now();
}

/** Fetch with retry on network errors (ETIMEDOUT, ECONNRESET, etc.). Throttled to protect backup server. */
async function fetchWithRetry(
  url: string,
  options: RequestInit
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      await throttle();
      const res = await fetch(url, {
        ...options,
        cache: "no-store",
        next: { revalidate: 0 },
      } as RequestInit);
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

const HOME_OVERVIEW_TIMEOUT_MS = 90_000;
const HOME_OVERVIEW_RETRY_ON_STATUS = [502, 503, 504];
const HOME_OVERVIEW_RETRY_ATTEMPTS = 2;
const HOME_OVERVIEW_RETRY_DELAY_MS = 5000;

/**
 * Fetches the ad-server overview data from XDASH backup for a given date range.
 * Retries on 502/503/504 (Bad Gateway / Unavailable).
 */
export async function fetchAdServerOverview(
  dateRange: XDashDateRange
): Promise<XDashApiResponse> {
  assertNotDisabled();
  assertEnvVars();

  const url = `${XDASH_API_BASE}/home/overview/adServers`;
  const body = JSON.stringify({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    specificComparisonDate: dateRange.specificComparisonDate ?? null,
  });

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= HOME_OVERVIEW_RETRY_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HOME_OVERVIEW_TIMEOUT_MS);
    try {
      const response = await fetchWithRetry(url, {
        method: "POST",
        headers: buildHeaders(),
        body,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const json: XDashApiResponse = await response.json();
        return json;
      }

      const errorBody = await response.text();
      lastError = new Error(
        `XDASH API error ${response.status}: ${response.statusText}\n${errorBody}`
      );
      if (!HOME_OVERVIEW_RETRY_ON_STATUS.includes(response.status) || attempt === HOME_OVERVIEW_RETRY_ATTEMPTS) {
        throw lastError;
      }
    } catch (e) {
      clearTimeout(timeoutId);
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt === HOME_OVERVIEW_RETRY_ATTEMPTS) throw lastError;
    }
    await new Promise((r) => setTimeout(r, HOME_OVERVIEW_RETRY_DELAY_MS));
  }
  throw lastError ?? new Error("XDASH home overview failed");
}

/** Lightweight: fetch Home API totals for a single date. Returns {revenue, cost, impressions}. */
export async function fetchHomeForDate(
  date: string
): Promise<{ revenue: number; cost: number; impressions: number }> {
  const raw = await fetchAdServerOverview({ startDate: date, endDate: date });
  const sd = (raw as unknown as Record<string, unknown>).overviewTotals as Record<string, unknown> | undefined;
  const totals = (sd?.selectedDates as Record<string, unknown> | undefined)?.totals as
    | { revenue?: number; cost?: number; impressions?: number }
    | undefined;
  return {
    revenue: Number(totals?.revenue ?? 0),
    cost: Number(totals?.cost ?? 0),
    impressions: Number(totals?.impressions ?? 0),
  };
}

const REVENUE_KEYS = ["revenue", "netRevenue", "totalRevenue", "revenueAmount"];

function readRevenueFromTotals(totals: unknown): number {
  if (totals == null) return 0;
  const t = totals as Record<string, unknown>;
  for (const key of REVENUE_KEYS) {
    const v = t[key];
    if (v !== undefined && v !== null) {
      const n = parseCurrencyValue(v);
      if (n > 0) return n;
    }
  }
  return parseCurrencyValue(t.revenue ?? t.netRevenue);
}

/** Recursively find max revenue in object (single aggregate object). */
function findRevenueInObject(obj: unknown, depth = 0): number {
  if (depth > 10) return 0;
  if (obj == null) return 0;
  let best = readRevenueFromTotals(obj);
  if (Array.isArray(obj)) {
    for (const item of obj) {
      best = Math.max(best, findRevenueInObject(item, depth + 1));
    }
    return best;
  }
  if (typeof obj === "object") {
    const rec = obj as Record<string, unknown>;
    for (const key of ["totals", "selectedDates", "overviewTotals", "data", "selectedPeriod"]) {
      best = Math.max(best, findRevenueInObject(rec[key], depth + 1));
    }
    for (const v of Object.values(rec)) {
      best = Math.max(best, findRevenueInObject(v, depth + 1));
    }
  }
  return best;
}

/** Sum all revenue values in tree (for responses that have only per-item revenue, no top-level totals). */
function sumAllRevenueInObject(obj: unknown, depth = 0): number {
  if (depth > 12) return 0;
  if (obj == null) return 0;
  let sum = 0;
  const v = readRevenueFromTotals(obj);
  if (v > 0) sum += v;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      sum += sumAllRevenueInObject(item, depth + 1);
    }
    return sum;
  }
  if (typeof obj === "object") {
    for (const val of Object.values(obj as Record<string, unknown>)) {
      sum += sumAllRevenueInObject(val, depth + 1);
    }
  }
  return sum;
}

/**
 * Extract revenue from a raw XDASH home/overview response (for debugging and for getHomeRevenueForRange).
 */
export function extractRevenueFromHomeResponse(raw: unknown): number {
  const data = raw as Record<string, unknown>;
  const ot = data?.overviewTotals as Record<string, unknown> | undefined;
  const sd = data?.selectedDates as Record<string, unknown> | undefined;

  const candidates: unknown[] = [
    ot?.selectedDates && (ot.selectedDates as Record<string, unknown>)?.totals,
    ot?.totals,
    sd?.totals,
    data?.totals,
    data?.data && (data.data as Record<string, unknown>)?.totals,
  ].filter(Boolean);

  for (const totals of candidates) {
    const revenue = readRevenueFromTotals(totals);
    if (revenue > 0) return revenue;
  }

  const fromMax = findRevenueInObject(data);
  const fromSum = sumAllRevenueInObject(data);
  return Math.max(fromMax, fromSum);
}

/**
 * Revenue from XDASH backup home screen for a date range.
 * Uses /home/overview/adServers — same source as the main dashboard, not "All Demand Partners".
 */
export async function getHomeRevenueForRange(
  startDate: string,
  endDate: string
): Promise<number> {
  assertNotDisabled();
  const raw = await fetchAdServerOverview({
    startDate,
    endDate,
    specificComparisonDate: null,
  });
  return extractRevenueFromHomeResponse(raw);
}

// ============================================================================
// Partner endpoints — Demand & Supply
// ============================================================================

/** Fetch demand (revenue) partners overview for a single date. */
export async function fetchDemandPartners(
  date: string
): Promise<XDashPartnerApiResponse> {
  return _fetchPartners("demand", date);
}

/** Fetch supply (cost) partners overview for a single date. */
export async function fetchSupplyPartners(
  date: string
): Promise<XDashPartnerApiResponse> {
  return _fetchPartners("supply", date);
}

const PARTNER_RETRY_ON_STATUS = [502, 503, 504];
const PARTNER_RETRY_ATTEMPTS = 2;
const PARTNER_RETRY_DELAY_MS = 8000;

async function _fetchPartners(
  side: "demand" | "supply",
  date: string
): Promise<XDashPartnerApiResponse> {
  assertNotDisabled();
  assertEnvVars();
  const url = `${XDASH_API_BASE}/partners/${side}/overview`;

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= PARTNER_RETRY_ATTEMPTS; attempt++) {
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: buildHeaders(),
      body: buildDatePayload(date),
    });

    if (response.ok) {
      return (await response.json()) as XDashPartnerApiResponse;
    }

    const errorBody = await response.text();
    lastError = new Error(
      `XDASH ${side} API error ${response.status}: ${response.statusText}\n${errorBody}`
    );

    if (!PARTNER_RETRY_ON_STATUS.includes(response.status) || attempt === PARTNER_RETRY_ATTEMPTS) {
      throw lastError;
    }
    console.warn(`[xdash-client] Partners ${side} got ${response.status}, retrying in ${PARTNER_RETRY_DELAY_MS / 1000}s …`);
    await new Promise((r) => setTimeout(r, PARTNER_RETRY_DELAY_MS));
  }
  throw lastError ?? new Error(`XDASH ${side} partners fetch failed`);
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

