import { NextResponse, type NextRequest } from "next/server";
import { syncBillingData } from "@/lib/sync/billing";
import { syncMondayData } from "@/lib/sync/monday";
import { syncPartnerPairsData } from "@/lib/sync/partner-pairs";
import { syncPnlData } from "@/lib/sync/pnl";
import { syncXDASHData } from "@/lib/sync/xdash";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function getReceivedSecret(request: NextRequest): string {
  const q = request.nextUrl.searchParams.get("secret");
  if (q != null && String(q).trim() !== "") return String(q).trim();
  const auth = request.headers.get("authorization") ?? "";
  return auth.replace(/^Bearer\s+/i, "").trim();
}

function checkAuth(request: NextRequest): { ok: boolean; detail?: string } {
  const expected = (process.env.CRON_SECRET ?? "").trim();
  if (!expected) {
    console.log("[cron/sync] CRON_SECRET not set — rejecting request");
    return { ok: false, detail: "CRON_SECRET not configured" };
  }
  const received = getReceivedSecret(request);
  if (received === expected) return { ok: true };
  console.log(
    `[cron/sync] auth fail: received ${received.length} chars, expected ${expected.length} chars`,
  );
  return {
    ok: false,
    detail: `Secret mismatch (${received.length} vs ${expected.length} chars)`,
  };
}

export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: "Unauthorized", detail: auth.detail },
      { status: 401 },
    );
  }

  const summary: {
    monday?: { funnelRows: number; activityRows: number };
    billing?: { monthsUpdated: number };
    pnl?: { rowsUpserted: number; entities: string[] };
    xdash?: { datesSynced: number; rowsUpserted: number };
    partnerPairs?: { datesRequested: number; datesSynced: number; rowsUpserted: number };
    errors: string[];
  } = { errors: [] };

  const xdashDisabled = (process.env.XDASH_DISABLED ?? "false").toLowerCase() === "true";

  // Phase 1: Monday + Billing + P&L + XDASH in parallel
  const [mondayResult, billingResult, pnlResult, xdashResult] = await Promise.allSettled([
    syncMondayData(),
    syncBillingData(),
    syncPnlData(),
    xdashDisabled
      ? Promise.resolve({ datesSynced: 0, rowsUpserted: 0 })
      : syncXDASHData(),
  ]);

  // Phase 2: Partner pairs AFTER XDASH (same table → deadlock if parallel)
  const partnerPairsResult = await (async () => {
    if (xdashDisabled) return { status: "fulfilled" as const, value: { datesRequested: 0, datesSynced: 0, rowsUpserted: 0 } };
    try {
      const value = await syncPartnerPairsData();
      return { status: "fulfilled" as const, value };
    } catch (reason) {
      return { status: "rejected" as const, reason };
    }
  })();

  function maskReason(label: string, reason: unknown): string {
    const raw = reason instanceof Error ? reason.message : String(reason);
    console.error(`[cron-sync] ${label} failed:`, raw);
    if (process.env.NODE_ENV === "production") return `${label}: sync failed`;
    return `${label}: ${raw}`;
  }

  if (mondayResult.status === "fulfilled") {
    summary.monday = mondayResult.value;
  } else {
    summary.errors.push(maskReason("Monday", mondayResult.reason));
  }

  if (billingResult.status === "fulfilled") {
    summary.billing = billingResult.value;
  } else {
    summary.errors.push(maskReason("Billing", billingResult.reason));
  }

  if (pnlResult.status === "fulfilled") {
    summary.pnl = pnlResult.value;
  } else {
    summary.errors.push(maskReason("P&L", pnlResult.reason));
  }

  if (xdashResult.status === "fulfilled") {
    summary.xdash = xdashResult.value;
  } else {
    summary.errors.push(maskReason("XDASH", xdashResult.reason));
  }

  if (partnerPairsResult.status === "fulfilled") {
    summary.partnerPairs = partnerPairsResult.value;
  } else {
    summary.errors.push(maskReason("Partner pairs", partnerPairsResult.reason));
  }

  const ok = summary.errors.length === 0;
  return NextResponse.json({ ok, summary }, { status: ok ? 200 : 500 });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
