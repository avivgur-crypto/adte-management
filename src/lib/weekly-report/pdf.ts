/**
 * Render weekly report HTML to a PDF buffer via Playwright Chromium.
 */

import { chromium } from "playwright";
import { renderWeeklyReportHtml } from "@/lib/weekly-report/template";
import type { WeeklyExecReport } from "@/lib/weekly-report/data";

export async function renderWeeklyReportPdf(
  report: WeeklyExecReport,
): Promise<Buffer> {
  const html = renderWeeklyReportHtml(report);
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
      preferCSSPageSize: true,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
