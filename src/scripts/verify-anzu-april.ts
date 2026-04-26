/**
 * After `npm run fetch:monday`, checks monday_items_activity for Anzu in April 2026.
 *
 *   npx tsx --env-file=.env.local src/scripts/verify-anzu-april.ts
 */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const sb = createClient(url, key);
  const { data, error } = await sb
    .from("monday_items_activity")
    .select("company_name, created_date, created_at, board_id")
    .eq("board_id", "8280704003")
    .ilike("company_name", "%Anzu%")
    .order("created_date", { ascending: false });

  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (!data?.length) {
    console.log("No contract rows matching company_name ILIKE '%Anzu%'. Run fetch:monday first.");
    process.exit(0);
    return;
  }
  console.log("Anzu-related contract activity rows:\n");
  for (const row of data) {
    console.log(JSON.stringify(row, null, 2));
  }
  const inApril2026 = data.filter((r) => String(r.created_date).startsWith("2026-04"));
  console.log(
    `\n→ Rows with created_date in April 2026: ${inApril2026.length} (expected ≥1 after won-date fix)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
