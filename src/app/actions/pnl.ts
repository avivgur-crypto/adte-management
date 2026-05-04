"use server";

import { cache } from "react";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { monthKeysSchema } from "@/lib/validation";
import { safeErrorMessage } from "@/lib/validation";

const PNL_DEBUG = process.env.PNL_DEBUG === "1";

function debug<T>(label: string, run: () => T): T {
  if (!PNL_DEBUG) return run();
  const start = performance.now();
  try {
    return run();
  } finally {
    console.log(`[pnl] ${label} ${(performance.now() - start).toFixed(1)}ms`);
  }
}

async function debugAsync<T>(label: string, run: () => Promise<T>): Promise<T> {
  if (!PNL_DEBUG) return run();
  const start = performance.now();
  try {
    return await run();
  } finally {
    console.log(`[pnl] ${label} ${(performance.now() - start).toFixed(1)}ms`);
  }
}

export type PnlEntity = "Consolidated" | "TMS" | "Adte";

export interface PnlRow {
  category: string;
  label: string;
  amount: number;
  prevAmount: number | null;
  momPercent: number | null;
}

export interface PnlSummary {
  totalRevenue: PnlRow;
  totalCogs: PnlRow;
  grossProfit: PnlRow;
  totalOpex: PnlRow;
  ebitda: PnlRow;
}

export interface PnlSnapshot {
  month: string;
  months: string[];
  previousMonth: string | null;
  previousMonths: string[];
  entity: PnlEntity;
  rows: PnlRow[];
  summary: PnlSummary;
  lastSyncedAt: string | null;
}

const entitySchema = z.enum(["Consolidated", "TMS", "Adte"]);

function normalizeMonthKey(key: string): string {
  const t = key.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  if (/^\d{4}-\d{2}$/.test(t)) return `${t}-01`;
  return t;
}

function normalizeMonthKeys(input: string | string[]): string[] {
  const raw = Array.isArray(input) ? input : [input];
  const parsed = monthKeysSchema.parse(raw);
  return [...new Set(parsed.map(normalizeMonthKey))].sort();
}

function aggregateRows(
  data: PnlDbRow[],
  months: Set<string>,
): Map<string, { category: string; label: string; amount: number }> {
  const out = new Map<string, { category: string; label: string; amount: number }>();
  for (const r of data) {
    if (!months.has(r.month)) continue;
    const amount = Number(r.amount);
    const existing = out.get(r.label);
    if (existing) {
      existing.amount += Number.isFinite(amount) ? amount : 0;
    } else {
      out.set(r.label, {
        category: r.category,
        label: r.label,
        amount: Number.isFinite(amount) ? amount : 0,
      });
    }
  }
  return out;
}

interface PnlDbRow {
  month: string;
  category: string;
  label: string;
  amount: number;
  updated_at: string | null;
}

function maxUpdatedAt(data: PnlDbRow[], months: Set<string>): string | null {
  let max: string | null = null;
  for (const row of data) {
    if (!months.has(row.month) || !row.updated_at) continue;
    if (max == null || row.updated_at > max) max = row.updated_at;
  }
  return max;
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

function toPnlRow(row: { category: string; label: string; amount: number }): PnlRow {
  return {
    category: row.category,
    label: row.label,
    amount: row.amount,
    prevAmount: null,
    momPercent: null,
  };
}

function buildSummary(rows: Map<string, { category: string; label: string; amount: number }>): PnlSummary {
  const totalRevenue =
    rows.get("Total Revenue") ??
    { category: "Revenue", label: "Total Revenue", amount: 0 };
  const totalCogsRow =
    rows.get("Total COGS") ??
    { category: "COGS", label: "Total COGS", amount: 0 };
  const grossProfit =
    rows.get("Gross Profit") ??
    {
      category: "Gross Profit",
      label: "Gross Profit",
      amount: totalRevenue.amount - totalCogsRow.amount,
    };
  const totalOpex =
    rows.get("Total OPEX") ??
    {
      category: "OPEX",
      label: "Total OPEX",
      amount: [...rows.values()]
        .filter((row) => row.category.startsWith("OPEX -"))
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
    totalCogs: toPnlRow(totalCogsRow),
    grossProfit: toPnlRow(grossProfit),
    totalOpex: toPnlRow(totalOpex),
    ebitda: toPnlRow(ebitda),
  };
}

const getPnlSnapshotCached = cache(async (monthsKey: string, entity: PnlEntity): Promise<PnlSnapshot> => {
  const months = monthsKey.split("|").filter(Boolean);
  const currentMonths = new Set(months);

  const data = await debugAsync(`db.fetch entity=${entity} months=${months.length}`, async () => {
    const res = await supabaseAdmin
      .from("pnl_data")
      .select("month,category,label,amount,updated_at")
      .eq("entity", entity)
      .in("month", months);
    if (res.error) throw new Error(res.error.message);
    return (res.data ?? []) as PnlDbRow[];
  });

  return debug(`derive entity=${entity} rows=${data.length}`, () => {
    const currentMap = aggregateRows(data, currentMonths);

    ensureSumRow(currentMap, "Revenue", "Total Revenue", ["Media Revenue", "SAAS Revenue", "Revenue"]);
    ensureSumRow(currentMap, "COGS", "Total COGS", ["Media Costs", "Adash Costs", "SaaS Costs"]);
    setDerivedMargin(currentMap, "G. Margin", "Gross Profit");
    setDerivedMargin(currentMap, "P. Margin", "Operating Profit (EBITDA)");

    const rows: PnlRow[] = [...currentMap.values()].map(toPnlRow);
    const summary = buildSummary(currentMap);

    return {
      month: months[months.length - 1]!,
      months,
      previousMonth: null,
      previousMonths: [],
      entity,
      rows,
      summary,
      lastSyncedAt: maxUpdatedAt(data, currentMonths),
    };
  });
});

export async function getPnlSnapshot(
  monthKey: string | string[],
  entity: PnlEntity,
): Promise<{ ok: true; data: PnlSnapshot } | { ok: false; error: string }> {
  const start = PNL_DEBUG ? performance.now() : 0;
  try {
    const months = normalizeMonthKeys(monthKey);
    if (months.length === 0) throw new Error("At least one month is required.");
    entitySchema.parse(entity);
    const data = await getPnlSnapshotCached(months.join("|"), entity);
    if (PNL_DEBUG) {
      console.log(`[pnl] getPnlSnapshot total ${(performance.now() - start).toFixed(1)}ms entity=${entity} months=${months.length}`);
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: safeErrorMessage(e, "Could not load P&L.") };
  }
}
