"use client";

import type { PnlEntity } from "@/app/actions/pnl";

const STORAGE_KEY = "adte:pnl-layout-metrics:v1";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface PnlLayoutMetrics {
  grossRows: number;
  opexRows: number;
  bottomRows: number;
  savedAt: number;
}

type Stored = Partial<Record<PnlEntity, PnlLayoutMetrics>>;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readPnlLayoutMetrics(entity: PnlEntity): PnlLayoutMetrics | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    const row = parsed?.[entity];
    if (!row || typeof row.savedAt !== "number") return null;
    if (Date.now() - row.savedAt > MAX_AGE_MS) return null;
    if (
      typeof row.grossRows !== "number" ||
      typeof row.opexRows !== "number" ||
      typeof row.bottomRows !== "number"
    ) {
      return null;
    }
    return row;
  } catch {
    return null;
  }
}

export function writePnlLayoutMetrics(entity: PnlEntity, metrics: Omit<PnlLayoutMetrics, "savedAt">): void {
  if (!canUseStorage()) return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = (raw ? (JSON.parse(raw) as Stored) : {}) ?? {};
    parsed[entity] = { ...metrics, savedAt: Date.now() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    /* quota / private mode */
  }
}
