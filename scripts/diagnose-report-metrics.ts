/**
 * Probe XDASH POST /report `metrics` enum (one metric per request).
 * Used to discover invalid values (e.g. `netprofit` → 400; valid: `netProfit`).
 *
 * Usage: npx tsx --env-file=.env.local scripts/diagnose-report-metrics.ts [YYYY-MM-DD]
 */

import { createClient } from "@supabase/supabase-js";

async function main() {
  const date = (process.argv[2]?.trim() || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" })).slice(0, 10);
  const base = process.env.XDASH_API_BASE ?? "https://xdash-for-aviv-temp-txe5v.ondigitalocean.app";
  const path = process.env.XDASH_REPORT_PATH ?? "/report";
  const org = process.env.XDASH_ORGANIZATION_ID ?? "";
  const url = `${base}${path}`;
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await sb.from("xdash_auth").select("token_value").eq("id", "current_session").single();
  const token = data?.token_value;
  if (!token || !org) {
    console.error("Missing token or XDASH_ORGANIZATION_ID");
    process.exit(1);
  }

  const singles = [
    "revenue",
    "cost",
    "impressions",
    "profit",
    "netprofit",
    "netProfit",
    "grossProfit",
    "netRevenue",
    "grossRevenue",
  ];
  const dims = ["supplyTag", "demandTag"];

  console.log(`Probing ${url} for ${date}\n`);
  for (const m of singles) {
    const body = JSON.stringify({
      startDate: date,
      endDate: date,
      aggregationPeriod: "sum",
      dimensions: dims,
      metrics: [m],
    });
    const res = await fetch(`${url}?_t=${Date.now()}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-organization": org,
        Cookie: `auth-token=${token}`,
      },
      body,
    });
    const ok = res.ok;
    const snippet = (await res.text()).slice(0, 120);
    console.log(`${res.status}\t${m}\t${ok ? "OK" : snippet}`);
    await new Promise((r) => setTimeout(r, 2100));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
