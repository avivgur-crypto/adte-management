import { NextResponse } from "next/server";

export async function POST() {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET not set" }, { status: 500 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  const response = await fetch(`${baseUrl}/api/cron/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
    },
  });

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
