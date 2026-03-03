import { NextResponse } from "next/server";
import { syncBillingData } from "@/lib/sync/billing";
import { syncMondayData } from "@/lib/sync/monday";
import { syncPartnerPairsData } from "@/lib/sync/partner-pairs";
import { syncXDASHData } from "@/lib/sync/xdash";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function assertCronSecret(request: Request): void {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw new Error("CRON_SECRET is not set");
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    throw new Error("Unauthorized");
  }
}

export async function GET(request: Request) {
  try {
    assertCronSecret(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: message }, { status: 401 });
  }

  const summary: {
    monday?: { funnelRows: number; activityRows: number };
    billing?: { monthsUpdated: number };
    xdash?: { datesSynced: number; rowsUpserted: number };
    partnerPairs?: { datesRequested: number; datesSynced: number; rowsUpserted: number };
    errors: string[];
  } = { errors: [] };

  const xdashDisabled = (process.env.XDASH_DISABLED ?? "false").toLowerCase() === "true";

  // Phase 1: Monday + Billing + XDASH in parallel
  const [mondayResult, billingResult, xdashResult] = await Promise.allSettled([
    syncMondayData(),
    syncBillingData(),
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

export async function POST(request: Request) {
  return GET(request);
}
