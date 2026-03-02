import { NextResponse } from "next/server";
import { syncBillingData } from "@/lib/sync/billing";
import { syncMondayData } from "@/lib/sync/monday";
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
    errors: string[];
  } = { errors: [] };

  const xdashDisabled = (process.env.XDASH_DISABLED ?? "false").toLowerCase() === "true";

  const [mondayResult, billingResult, xdashResult] = await Promise.allSettled([
    syncMondayData(),
    syncBillingData(),
    xdashDisabled
      ? Promise.resolve({ datesSynced: 0, rowsUpserted: 0 })
      : syncXDASHData(),
  ]);

  if (mondayResult.status === "fulfilled") {
    summary.monday = mondayResult.value;
  } else {
    summary.errors.push(`Monday: ${mondayResult.reason}`);
  }

  if (billingResult.status === "fulfilled") {
    summary.billing = billingResult.value;
  } else {
    summary.errors.push(`Billing: ${billingResult.reason}`);
  }

  if (xdashResult.status === "fulfilled") {
    summary.xdash = xdashResult.value;
  } else {
    summary.errors.push(`XDASH: ${xdashResult.reason}`);
  }

  const ok = summary.errors.length === 0;
  return NextResponse.json({ ok, summary }, { status: ok ? 200 : 500 });
}

export async function POST(request: Request) {
  return GET(request);
}
