import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("Checking if daily_home_totals exists...");
  const { error: checkError } = await supabase
    .from("daily_home_totals")
    .select("date")
    .limit(1);

  if (!checkError) {
    console.log("Table daily_home_totals already exists!");
    process.exit(0);
  }

  console.log("Table does not exist. Please run the following SQL in the Supabase SQL Editor:\n");
  console.log(`
CREATE TABLE IF NOT EXISTS daily_home_totals (
  date          date        PRIMARY KEY,
  revenue       numeric     NOT NULL DEFAULT 0,
  cost          numeric     NOT NULL DEFAULT 0,
  impressions   bigint      NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dht_date ON daily_home_totals (date);

ALTER TABLE daily_home_totals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access on daily_home_totals"
  ON daily_home_totals FOR ALL
  USING (true) WITH CHECK (true);
  `);
}

main().catch(console.error);
