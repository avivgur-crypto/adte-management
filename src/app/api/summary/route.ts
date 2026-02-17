import { NextResponse } from "next/server";
import { getPacingSummary } from "@/lib/pacing";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const summary = await getPacingSummary(supabaseAdmin);
    return NextResponse.json(summary);
  } catch (err) {
    console.error("Summary API error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load summary" },
      { status: 500 }
    );
  }
}
