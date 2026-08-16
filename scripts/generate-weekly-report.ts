/**
 * Generate last completed week's exec report to tmp/ for local review.
 * Usage: npx tsx --env-file=.env.local scripts/generate-weekly-report.ts
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { getWeeklyExecReport } from "../src/lib/weekly-report/data";
import { renderWeeklyReportHtml } from "../src/lib/weekly-report/template";
import { renderWeeklyReportPdf } from "../src/lib/weekly-report/pdf";
import { getLastCompletedReportWeek } from "../src/lib/weekly-report/period";

async function main() {
  const week = getLastCompletedReportWeek();
  console.log(`Report week: ${week.label} (${week.start} → ${week.end})`);

  const report = await getWeeklyExecReport({ week });
  console.log("Status:", report.statusLabel);
  console.log(
    `Week Rev ${report.weekTotals.revenue} · GP ${report.weekTotals.profit} · Margin ${report.weekTotals.marginPct}%`,
  );
  console.log(
    `MTD pace Rev ${report.mtd.pace.revenue.pacePercent}% · Contracts: ${report.contracts.map((c) => c.companyName).join(", ") || "none"}`,
  );

  const outDir = join(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });

  const base = `adtex-weekly-${week.start}_${week.end}`;
  const htmlPath = join(outDir, `${base}.html`);
  const pdfPath = join(outDir, `${base}.pdf`);

  writeFileSync(htmlPath, renderWeeklyReportHtml(report), "utf8");
  console.log("Wrote", htmlPath);

  const pdf = await renderWeeklyReportPdf(report);
  writeFileSync(pdfPath, pdf);
  console.log("Wrote", pdfPath, `(${pdf.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
