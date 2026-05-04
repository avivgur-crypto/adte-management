/**
 * Pure P&L multi-month aggregation — safe to run in a Web Worker (no React / DOM).
 * Structural types mirror `@/app/actions/pnl` snapshots for JSON round-trips.
 */

export type PnlEntityAgg = "Consolidated" | "TMS" | "Adte";

export interface PnlRowAgg {
  category: string;
  label: string;
  amount: number;
  prevAmount: number | null;
  momPercent: number | null;
}

export interface PnlSummaryAgg {
  totalRevenue: PnlRowAgg;
  totalCogs: PnlRowAgg;
  grossProfit: PnlRowAgg;
  totalOpex: PnlRowAgg;
  ebitda: PnlRowAgg;
}

export interface PnlSnapshotAgg {
  month: string;
  months: string[];
  previousMonth: string | null;
  previousMonths: string[];
  entity: PnlEntityAgg;
  rows: PnlRowAgg[];
  summary: PnlSummaryAgg;
  lastSyncedAt: string | null;
}

function isMarginLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return lower.includes("margin") || lower.includes("%");
}

function toPnlRow(row: { category: string; label: string; amount: number }): PnlRowAgg {
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

function buildSummary(rows: Map<string, { category: string; label: string; amount: number }>): PnlSummaryAgg {
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

export function aggregateSnapshotsPure(
  months: string[],
  entity: PnlEntityAgg,
  snapshots: PnlSnapshotAgg[],
): PnlSnapshotAgg {
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
