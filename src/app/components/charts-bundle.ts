/**
 * The ONE lazy boundary for everything that depends on recharts.
 *
 * All chart components are re-exported from this single module, and every
 * `dynamic()` call that lazy-loads a chart must import THIS module (see
 * FinancialChartsDynamic / PartnersTabClient). With separate dynamic imports
 * per component, Turbopack put a full ~310 kB copy of recharts into each of
 * the three async chunk groups; a single shared entry makes it one chunk,
 * downloaded once and reused across the dashboard and Partners tab.
 */
export { default as RevenueGoalChart } from "./RevenueGoalChart";
export { default as DailyMovementChart } from "./DailyMovementChart";
export { default as PartnerDistributionCharts } from "./PartnerDistributionCharts";
