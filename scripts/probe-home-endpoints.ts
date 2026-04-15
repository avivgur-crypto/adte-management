/**
 * POST candidate XDASH home paths with the same date body as /home/overview/adServers.
 * Usage: npx tsx --env-file=.env.local scripts/probe-home-endpoints.ts [YYYY-MM-DD]
 */

import { createClient } from "@supabase/supabase-js";

const CANDIDATES = [
  "/home/overview",
  "/home/overview/total",
  "/home/overview/all",
  "/home/overview/global",
  "/home/overview/summary",
  "/home/summary",
  "/api/home/overview",
];

function findNumbers(obj: unknown, path = "", out: { path: string; value: number }[] = []): typeof out {
  if (obj == null) return out;
  if (typeof obj === "number" && Number.isFinite(obj) && obj > 40_000 && obj < 60_000) {
    out.push({ path, value: obj });
  }
  if (typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      findNumbers(v, path ? `${path}.${k}` : k, out);
    }
  }
  if (Array.isArray(obj)) {
    obj.slice(0, 3).forEach((item, i) => findNumbers(item, `${path}[${i}]`, out));
  }
  return out;
}

async function main() {
  const date = (process.argv[2]?.trim() || "2026-04-15").slice(0, 10);
  const base = (process.env.XDASH_API_BASE ?? "").replace(/\/$/, "");
  const org = process.env.XDASH_ORGANIZATION_ID ?? "";
  if (!base || !org) {
    console.error("Set XDASH_API_BASE and XDASH_ORGANIZATION_ID");
    process.exit(1);
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await sb.from("xdash_auth").select("token_value").eq("id", "current_session").single();
  const token = data?.token_value;
  if (!token) {
    console.error("No xdash_auth token");
    process.exit(1);
  }

  const body = JSON.stringify({
    startDate: date,
    endDate: date,
    specificComparisonDate: null,
  });

  const headers = {
    "Content-Type": "application/json",
    "x-organization": org,
    Cookie: `auth-token=${token}`,
  };

  console.log(`Base: ${base}\nDate: ${date}\n`);

  for (const path of CANDIDATES) {
    const url = `${base}${path}?_t=${Date.now()}`;
    try {
      const res = await fetch(url, { method: "POST", headers, body });
      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        console.log(`--- ${path} --- HTTP ${res.status} (non-JSON) ${text.slice(0, 120)}...\n`);
        continue;
      }
      const nums = findNumbers(json);
      const interesting = nums.filter((n) => n.value > 48_000 && n.value < 50_000);
      console.log(`--- ${path} --- HTTP ${res.status}`);
      if (interesting.length) {
        console.log("  ~49k candidates:", JSON.stringify(interesting, null, 2));
      } else if (nums.length) {
        console.log("  sample 40-60k nums:", nums.slice(0, 8));
      } else {
        const keys = json && typeof json === "object" ? Object.keys(json as object).slice(0, 12) : [];
        console.log("  topKeys:", keys, "(no 40-60k leaf found in shallow scan)");
      }
      console.log("");
    } catch (e) {
      console.log(`--- ${path} --- error`, e instanceof Error ? e.message : e, "\n");
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
