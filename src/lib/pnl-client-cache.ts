"use client";

import {
  getPnlSnapshot,
  type PnlEntity,
  type PnlRow,
  type PnlSnapshot,
  type PnlSummary,
} from "@/app/actions/pnl";

const CACHE_LIMIT = 48;
const STORAGE_KEY = "adte:pnl-month-cache:v1";
const VIEW_STATE_STORAGE_KEY = "adte:pnl-view-state:v1";
const STORAGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ENTITIES: PnlEntity[] = ["Consolidated", "TMS", "Adte"];

let activeEntity: PnlEntity = "Consolidated";
let storageHydrated = false;
let viewStateHydrated = false;

const resolvedCache = new Map<string, PnlSnapshot>();
const pendingCache = new Map<string, Promise<PnlSnapshot>>();

/**
 * Lightweight module-level "view state" store used to give the user the
 * impression of zero-flicker tab return without pulling in a state library.
 *
 * The active P&L view (entity + months + the currently rendered snapshot) is
 * remembered here so PnlTabClient can hydrate synchronously when it remounts
 * (e.g. when navigating Settings → P&L). It is intentionally minimal: anything
 * more ambitious (selectors, devtools, time-travel) would justify Zustand.
 */
export interface PnlViewState {
  entity: PnlEntity;
  monthsKey: string;
  snapshot: PnlSnapshot;
  savedAt: number;
}

let viewState: PnlViewState | null = null;
const viewStateListeners = new Set<(state: PnlViewState | null) => void>();

interface StoredPnlSnapshot {
  key: string;
  savedAt: number;
  snapshot: PnlSnapshot;
}

function normalizeMonthKey(key: string): string {
  const trimmed = key.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}$/.test(trimmed)) return `${trimmed}-01`;
  return trimmed;
}

function normalizeMonthKeys(months: string[]): string[] {
  return [...new Set(months.map(normalizeMonthKey).filter(Boolean))].sort();
}

function cacheKey(entity: PnlEntity, month: string): string {
  return `${entity}|${normalizeMonthKey(month)}`;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isFreshStoredSnapshot(entry: StoredPnlSnapshot, now: number): boolean {
  return (
    typeof entry.key === "string" &&
    typeof entry.savedAt === "number" &&
    !!entry.snapshot &&
    now - entry.savedAt <= STORAGE_MAX_AGE_MS
  );
}

function hydrateStorage(): void {
  if (storageHydrated || !canUseStorage()) return;
  storageHydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    const now = Date.now();
    for (const entry of parsed) {
      const stored = entry as StoredPnlSnapshot;
      if (!isFreshStoredSnapshot(stored, now)) continue;
      resolvedCache.set(stored.key, stored.snapshot);
    }
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

function persistStorage(): void {
  if (!canUseStorage()) return;
  try {
    const now = Date.now();
    const entries: StoredPnlSnapshot[] = [...resolvedCache.entries()].map(([key, snapshot]) => ({
      key,
      savedAt: now,
      snapshot,
    }));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage can fail in private mode or if quota is exceeded. Memory cache still works.
  }
}

function remember(key: string, snapshot: PnlSnapshot): void {
  hydrateStorage();
  if (resolvedCache.has(key)) resolvedCache.delete(key);
  while (resolvedCache.size >= CACHE_LIMIT) {
    const firstKey = resolvedCache.keys().next().value;
    if (firstKey === undefined) break;
    resolvedCache.delete(firstKey);
  }
  resolvedCache.set(key, snapshot);
  persistStorage();
}

function readResolved(key: string): PnlSnapshot | undefined {
  hydrateStorage();
  const hit = resolvedCache.get(key);
  if (!hit) return undefined;
  resolvedCache.delete(key);
  resolvedCache.set(key, hit);
  return hit;
}

function isMarginLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return lower.includes("margin") || lower.includes("%");
}

function toPnlRow(row: { category: string; label: string; amount: number }): PnlRow {
  return { category: row.category, label: row.label, amount: row.amount, prevAmount: null, momPercent: null };
}

function ensureSumRow(
  rows: Map<string, { category: string; label: string; amount: number }>,
  category: string,
  label: string,
  sourceLabels: string[],
): void {
  const sum = sourceLabels.reduce((total, sourceLabel) => total + (rows.get(sourceLabel)?.amount ?? 0), 0);
  const existing = rows.get(label);
  if (!existing && sum !== 0) {
    rows.set(label, { category, label, amount: sum });
    return;
  }
  if (existing && existing.amount === 0 && sum !== 0) {
    rows.set(label, { ...existing, amount: sum });
  }
}

function setDerivedMargin(
  rows: Map<string, { category: string; label: string; amount: number }>,
  label: string,
  numeratorLabel: string,
): void {
  const revenue = rows.get("Total Revenue")?.amount ?? 0;
  const numerator = rows.get(numeratorLabel)?.amount ?? 0;
  if (revenue === 0) return;
  const category = label === "G. Margin" ? "Gross Profit" : "Operating Profit";
  rows.set(label, { category, label, amount: (numerator / revenue) * 100 });
}

function buildSummary(rows: Map<string, { category: string; label: string; amount: number }>): PnlSummary {
  const totalRevenue = rows.get("Total Revenue") ?? { category: "Revenue", label: "Total Revenue", amount: 0 };
  const totalCogs = rows.get("Total COGS") ?? { category: "COGS", label: "Total COGS", amount: 0 };
  const grossProfit =
    rows.get("Gross Profit") ??
    { category: "Gross Profit", label: "Gross Profit", amount: totalRevenue.amount - totalCogs.amount };
  const totalOpex =
    rows.get("Total OPEX") ??
    {
      category: "OPEX",
      label: "Total OPEX",
      amount: [...rows.values()]
        .filter((row) => row.category === "OPEX" || row.category.startsWith("OPEX -"))
        .reduce((sum, row) => sum + row.amount, 0),
    };
  const ebitda =
    rows.get("Operating Profit (EBITDA)") ??
    {
      category: "Operating Profit",
      label: "Operating Profit (EBITDA)",
      amount: grossProfit.amount - totalOpex.amount,
    };

  return {
    totalRevenue: toPnlRow(totalRevenue),
    totalCogs: toPnlRow(totalCogs),
    grossProfit: toPnlRow(grossProfit),
    totalOpex: toPnlRow(totalOpex),
    ebitda: toPnlRow(ebitda),
  };
}

function aggregateSnapshots(months: string[], entity: PnlEntity, snapshots: PnlSnapshot[]): PnlSnapshot {
  const rows = new Map<string, { category: string; label: string; amount: number }>();

  for (const snapshot of snapshots) {
    for (const row of snapshot.rows) {
      if (isMarginLabel(row.label)) continue;
      const amount = Number.isFinite(row.amount) ? row.amount : 0;
      const existing = rows.get(row.label);
      if (existing) {
        existing.amount += amount;
      } else {
        rows.set(row.label, { category: row.category, label: row.label, amount });
      }
    }
  }

  ensureSumRow(rows, "Revenue", "Total Revenue", ["Media Revenue", "SAAS Revenue", "Revenue"]);
  ensureSumRow(rows, "COGS", "Total COGS", ["Media Costs", "Adash Costs", "SaaS Costs"]);
  setDerivedMargin(rows, "G. Margin", "Gross Profit");
  setDerivedMargin(rows, "P. Margin", "Operating Profit (EBITDA)");

  const lastSyncedAt = snapshots.reduce<string | null>((latest, snapshot) => {
    if (!snapshot.lastSyncedAt) return latest;
    if (latest == null || snapshot.lastSyncedAt > latest) return snapshot.lastSyncedAt;
    return latest;
  }, null);

  return {
    month: months[months.length - 1] ?? "",
    months,
    previousMonth: null,
    previousMonths: [],
    entity,
    rows: [...rows.values()].map(toPnlRow),
    summary: buildSummary(rows),
    lastSyncedAt,
  };
}

async function fetchMonth(entity: PnlEntity, month: string, options?: { force?: boolean }): Promise<PnlSnapshot> {
  const normalized = normalizeMonthKey(month);
  const key = cacheKey(entity, normalized);
  if (!options?.force) {
    const cached = readResolved(key);
    if (cached) return cached;
  }

  const pending = pendingCache.get(key);
  if (pending) return pending;

  const request = getPnlSnapshot(normalized, entity)
    .then((res) => {
      if (!res.ok) throw new Error(res.error);
      remember(key, res.data);
      return res.data;
    })
    .finally(() => {
      pendingCache.delete(key);
    });

  pendingCache.set(key, request);
  return request;
}

export function setActivePnlEntity(entity: PnlEntity): void {
  activeEntity = entity;
}

export function getCachedPnlSnapshot(months: string[], entity: PnlEntity): PnlSnapshot | null {
  const normalized = normalizeMonthKeys(months);
  if (normalized.length === 0) return null;
  const snapshots: PnlSnapshot[] = [];
  for (const month of normalized) {
    const cached = readResolved(cacheKey(entity, month));
    if (!cached) return null;
    snapshots.push(cached);
  }
  return aggregateSnapshots(normalized, entity, snapshots);
}

export async function getPnlSnapshotFromClientCache(months: string[], entity: PnlEntity): Promise<PnlSnapshot> {
  const normalized = normalizeMonthKeys(months);
  if (normalized.length === 0) throw new Error("At least one month is required.");
  const snapshots = await Promise.all(normalized.map((month) => fetchMonth(entity, month)));
  return aggregateSnapshots(normalized, entity, snapshots);
}

export async function revalidatePnlSnapshot(months: string[], entity: PnlEntity): Promise<PnlSnapshot> {
  const normalized = normalizeMonthKeys(months);
  if (normalized.length === 0) throw new Error("At least one month is required.");
  const snapshots = await Promise.all(normalized.map((month) => fetchMonth(entity, month, { force: true })));
  return aggregateSnapshots(normalized, entity, snapshots);
}

export function prefetchPnlMonth(month: string, entity: PnlEntity = activeEntity): void {
  void fetchMonth(entity, month).catch(() => undefined);
}

export function prefetchPnlMonthForAllEntities(month: string): void {
  for (const entity of ENTITIES) prefetchPnlMonth(month, entity);
}

/**
 * Stage 1 helper: warm the cache for the current calendar month, current entity,
 * before the user has even clicked "P&L". Safe to call eagerly at app boot.
 */
export function prefetchActiveMonthForCurrentEntity(): void {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  prefetchPnlMonth(month, activeEntity);
}

/**
 * Stage 4 helper: prefetch the same months the user is currently viewing for
 * the other entities. Cheap and bounded — only the months already on screen.
 */
export function prefetchOtherEntitiesForMonths(months: string[]): void {
  const normalized = normalizeMonthKeys(months);
  if (normalized.length === 0) return;
  for (const otherEntity of ENTITIES) {
    if (otherEntity === activeEntity) continue;
    for (const month of normalized) prefetchPnlMonth(month, otherEntity);
  }
}

/**
 * Hover / pointer-down intent helper: warm every selected month for the
 * candidate entity in parallel. Idempotent — already-cached months no-op.
 */
export function prefetchPnlSnapshot(months: string[], entity: PnlEntity): void {
  const normalized = normalizeMonthKeys(months);
  if (normalized.length === 0) return;
  for (const month of normalized) prefetchPnlMonth(month, entity);
}

// ---------------------------------------------------------------------------
// View-state store (Stage 3 — minimal alternative to Zustand)
// ---------------------------------------------------------------------------

function hydrateViewState(): void {
  if (viewStateHydrated || !canUseStorage()) return;
  viewStateHydrated = true;
  try {
    const raw = window.localStorage.getItem(VIEW_STATE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<PnlViewState> | null;
    if (
      !parsed ||
      typeof parsed.entity !== "string" ||
      typeof parsed.monthsKey !== "string" ||
      !parsed.snapshot ||
      typeof parsed.savedAt !== "number"
    ) {
      return;
    }
    if (Date.now() - parsed.savedAt > STORAGE_MAX_AGE_MS) return;
    if (!ENTITIES.includes(parsed.entity as PnlEntity)) return;
    viewState = {
      entity: parsed.entity as PnlEntity,
      monthsKey: parsed.monthsKey,
      snapshot: parsed.snapshot as PnlSnapshot,
      savedAt: parsed.savedAt,
    };
    activeEntity = viewState.entity;
  } catch {
    if (canUseStorage()) window.localStorage.removeItem(VIEW_STATE_STORAGE_KEY);
  }
}

function persistViewState(): void {
  if (!canUseStorage()) return;
  try {
    if (viewState == null) {
      window.localStorage.removeItem(VIEW_STATE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(VIEW_STATE_STORAGE_KEY, JSON.stringify(viewState));
  } catch {
    // Quota or private mode — non-fatal.
  }
}

export function getPnlViewState(): PnlViewState | null {
  hydrateViewState();
  return viewState;
}

export function setPnlViewState(next: { entity: PnlEntity; monthsKey: string; snapshot: PnlSnapshot }): void {
  viewState = { ...next, savedAt: Date.now() };
  persistViewState();
  for (const listener of viewStateListeners) listener(viewState);
}

export function subscribePnlViewState(listener: (state: PnlViewState | null) => void): () => void {
  viewStateListeners.add(listener);
  return () => {
    viewStateListeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// Snapshot equality (Stage 5 — render bailing for silent revalidations)
// ---------------------------------------------------------------------------

function rowsEqual(a: PnlRow, b: PnlRow): boolean {
  return (
    a.label === b.label &&
    a.category === b.category &&
    a.amount === b.amount &&
    a.prevAmount === b.prevAmount &&
    a.momPercent === b.momPercent
  );
}

function summaryEqual(a: PnlSummary, b: PnlSummary): boolean {
  return (
    rowsEqual(a.totalRevenue, b.totalRevenue) &&
    rowsEqual(a.totalCogs, b.totalCogs) &&
    rowsEqual(a.grossProfit, b.grossProfit) &&
    rowsEqual(a.totalOpex, b.totalOpex) &&
    rowsEqual(a.ebitda, b.ebitda)
  );
}

export function snapshotsEqual(a: PnlSnapshot | null, b: PnlSnapshot | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.entity !== b.entity) return false;
  if (a.month !== b.month) return false;
  if (a.lastSyncedAt !== b.lastSyncedAt) return false;
  if (a.months.length !== b.months.length) return false;
  for (let i = 0; i < a.months.length; i += 1) {
    if (a.months[i] !== b.months[i]) return false;
  }
  if (a.rows.length !== b.rows.length) return false;
  for (let i = 0; i < a.rows.length; i += 1) {
    if (!rowsEqual(a.rows[i]!, b.rows[i]!)) return false;
  }
  return summaryEqual(a.summary, b.summary);
}
