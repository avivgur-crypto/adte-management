import { NextResponse, type NextRequest } from "next/server";
import { getWeeklyExecReport } from "@/lib/weekly-report/data";
import { renderWeeklyReportPdf } from "@/lib/weekly-report/pdf";
import { renderWeeklyReportHtml } from "@/lib/weekly-report/template";
import { getLastCompletedReportWeek } from "@/lib/weekly-report/period";

/**
 * Preview / download the weekly C-level exec report for the last completed
 * Thu→Wed week (Israel). No email — design & numbers review only.
 *
 *   GET /api/admin/weekly-report          → HTML preview
 *   GET /api/admin/weekly-report?format=pdf → PDF download
 *   GET /api/admin/weekly-report?asOf=2026-08-14 → week as of that Israel date
 *
 * Auth: logged-in session (proxy) or Bearer CRON_SECRET.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function getReceivedSecret(request: NextRequest): string {
  const q = request.nextUrl.searchParams.get("secret");
  if (q) return q;
  const auth = request.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? "";
}

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && getReceivedSecret(request) === secret) return true;
  // Session cookie path is enforced by proxy for /api/admin/* —
  // if we got here without secret, proxy already validated the user.
  return true;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const asOf = request.nextUrl.searchParams.get("asOf") ?? undefined;
  const format = (request.nextUrl.searchParams.get("format") ?? "html").toLowerCase();

  try {
    const week = getLastCompletedReportWeek(asOf);
    const report = await getWeeklyExecReport({ week });

    if (format === "pdf") {
      const pdf = await renderWeeklyReportPdf(report);
      const filename = `adtex-weekly-${week.start}_${week.end}.pdf`;
      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const html = renderWeeklyReportHtml(report);
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[weekly-report]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
