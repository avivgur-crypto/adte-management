import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Partner-pairs cron — DISABLED.
 * Partners UI and pair sync were removed; this route remains so old Vercel cron
 * configs / bookmarks return 410 instead of silently succeeding or 500ing.
 */
export async function GET(_request: NextRequest) {
  return NextResponse.json(
    {
      ok: false,
      skipped: true,
      error: "Partner pairs sync disabled — Partners feature removed",
    },
    { status: 410 },
  );
}

export async function POST(request: NextRequest) {
  return GET(request);
}
