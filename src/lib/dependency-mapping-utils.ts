/**
 * Pure (non-server-action) helpers for dependency mapping.
 * Shared between the server action and client components.
 */

const RISK_THRESHOLD_PERCENT = 60;
const MAX_TABLE_ROWS = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DependencyMappingRow {
  demandPartner: string;
  supplyPartner: string;
  revenue: number;
  cost: number;
  profit: number;
  profitMarginPercent: number;
}

export interface DependencyMappingResult {
  rows: DependencyMappingRow[];
  riskDemandPartners: string[];
  fromXdash: boolean;
  errorMessage?: string;
}

export interface PairEntry {
  demandPartner: string;
  supplyPartner: string;
  revenue: number;
  cost: number;
  profit?: number;
}

// ---------------------------------------------------------------------------
// Pure merge + aggregate (runs client-side in useMemo)
// ---------------------------------------------------------------------------

export function buildDependencyResult(
  pairsByMonth: Record<string, PairEntry[]>,
  selectedMonthKeys: string[],
): DependencyMappingResult {
  const sums = new Map<string, { revenue: number; cost: number; profit: number }>();
  for (const mk of selectedMonthKeys) {
    const entries = pairsByMonth[mk];
    if (!entries) continue;
    for (const p of entries) {
      const key = `${p.demandPartner}\u0001${p.supplyPartner}`;
      const pProfit = p.profit ?? 0;
      const cur = sums.get(key);
      if (cur) {
        cur.revenue += p.revenue;
        cur.cost += p.cost;
        cur.profit += pProfit;
      } else {
        sums.set(key, { revenue: p.revenue, cost: p.cost, profit: pProfit });
      }
    }
  }

  if (sums.size === 0) {
    return {
      rows: [],
      riskDemandPartners: [],
      fromXdash: false,
      errorMessage: "No pair data in database for the selected months.",
    };
  }

  const rows: DependencyMappingRow[] = [];
  const demandTotalRevenue = new Map<string, number>();
  const demandSupplyRevenue = new Map<string, Map<string, number>>();

  for (const [key, { revenue, cost, profit: aggregatedProfit }] of sums) {
    const i = key.indexOf("\u0001");
    const demandPartner = i >= 0 ? key.slice(0, i) : key;
    const supplyPartner = i >= 0 ? key.slice(i + 1) : "Unknown";
    /** Sum of pair-level profit from XDASH (netprofit → profit → revenue−cost at sync time). */
    const profit = aggregatedProfit;
    const profitMarginPercent = revenue > 0 ? (profit / revenue) * 100 : 0;
    rows.push({ demandPartner, supplyPartner, revenue, cost, profit, profitMarginPercent });

    demandTotalRevenue.set(demandPartner, (demandTotalRevenue.get(demandPartner) ?? 0) + revenue);
    let supplyMap = demandSupplyRevenue.get(demandPartner);
    if (!supplyMap) { supplyMap = new Map(); demandSupplyRevenue.set(demandPartner, supplyMap); }
    supplyMap.set(supplyPartner, (supplyMap.get(supplyPartner) ?? 0) + revenue);
  }

  const riskDemandPartners: string[] = [];
  for (const [demand, totalRev] of demandTotalRevenue) {
    if (totalRev <= 0) continue;
    const supplyMap = demandSupplyRevenue.get(demand);
    if (!supplyMap) continue;
    for (const [, rev] of supplyMap) {
      if ((rev / totalRev) * 100 > RISK_THRESHOLD_PERCENT) {
        riskDemandPartners.push(demand);
        break;
      }
    }
  }

  rows.sort((a, b) => b.profit - a.profit);
  return { rows: rows.slice(0, MAX_TABLE_ROWS), riskDemandPartners, fromXdash: false };
}
