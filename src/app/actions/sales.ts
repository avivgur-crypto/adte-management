/**
 * Funnel metrics type. Live data comes from getSalesFunnelMetricsFromMonday (Monday API).
 */

export interface SalesFunnelMetrics {
  totalLeads: number;
  qualifiedLeads: number;
  opsApprovedLeads: number;
  wonDeals: number;
  leadToQualifiedPercent: number | null;
  /** Qualified → Ops Approved (ops/qualified); capped at 100%. */
  qualifiedToOpsPercent: number | null;
  /** Ops Approved → Won (won/ops); capped at 100%. */
  opsToWonPercent: number | null;
  overallWinRatePercent: number | null;
  /** "All time" or first month for display. */
  month: string;
  /** Empty = all-time; otherwise months used for label. */
  months: string[];
}
