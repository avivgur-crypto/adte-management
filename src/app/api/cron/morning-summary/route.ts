import { NextResponse, type NextRequest } from "next/server";
import { morningSummary } from "@/app/actions/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const NO_CACHE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
} as const;

function getReceivedSecret(request: NextRequest): string {
  const q = request.nextUrl.searchParams.get("secret");
  if (q != null && String(q).trim() !== "") return String(q).trim();
  const auth = request.headers.get("authorization") ?? "";
  return auth.replace(/^Bearer\s+/i, "").trim();
}

function checkAuth(request: NextRequest): { ok: boolean; detail?: string } {
  const expected = (process.env.CRON_SECRET ?? "").trim();
  if (!expected) return { ok: true };
  const received = getReceivedSecret(request);
  if (received === expected) return { ok: true };
  console.log(
    `[morning-summary] auth fail: received ${received.length} chars, expected ${expected.length} chars`,
  );
  return {
    ok: false,
    detail: `Secret mismatch (${received.length} vs ${expected.length} chars)`,
  };
}

function isTrueish(v: string | null | undefined): boolean {
  if (v == null) return false;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: "Unauthorized", detail: auth.detail },
      { status: 401, headers: NO_CACHE },
    );
  }

  // Manual test trigger: pass ?test=true to bypass per-user dedupe and prefix
  // the title with [TEST]. Lets you verify the format/data without burning the
  // real once-per-day slot recorded in `sent_notifications`.
  const test = isTrueish(request.nextUrl.searchParams.get("test"));

  try {
    const result = await morningSummary({ test });
    return NextResponse.json(
      { ok: true, test, ...result },
      { status: 200, headers: NO_CACHE },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[morning-summary]", msg);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500, headers: NO_CACHE },
    );
  }
}
