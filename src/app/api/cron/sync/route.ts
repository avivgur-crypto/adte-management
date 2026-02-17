import { NextResponse } from "next/server";
import { syncBillingData } from "@/lib/sync/billing";
import { syncMondayData } from "@/lib/sync/monday";
import { syncXDASHData } from "@/lib/sync/xdash";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
    error?: string;
  } = {};

  try {
    const monday = await syncMondayData();
    summary.monday = monday;
  } catch (err) {
    summary.error = `Monday: ${err instanceof Error ? err.message : String(err)}`;
    return NextResponse.json({ ok: false, summary }, { status: 500 });
  }

  try {
    const billing = await syncBillingData();
    summary.billing = billing;
  } catch (err) {
    summary.error = `Billing: ${err instanceof Error ? err.message : String(err)}`;
    return NextResponse.json({ ok: false, summary }, { status: 500 });
  }

  try {
    const xdash = await syncXDASHData();
    summary.xdash = xdash;
  } catch (err) {
    summary.error = `XDASH: ${err instanceof Error ? err.message : String(err)}`;
    return NextResponse.json({ ok: false, summary }, { status: 500 });
  }

  return NextResponse.json({ ok: true, summary });
}

export async function POST(request: Request) {
  return GET(request);
}
