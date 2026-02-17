"use server";

import { getPacingSummary } from "@/lib/pacing";
import { supabaseAdmin } from "@/lib/supabase";
import type { PacingSummary } from "@/lib/pacing";

export async function fetchPacingSummary(): Promise<PacingSummary> {
  return getPacingSummary(supabaseAdmin);
}
