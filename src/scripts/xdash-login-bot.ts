/**
 * XDASH login bot (Playwright):
 * - Logs into https://backup.xdash.adte-system.com/login
 * - Extracts the `auth-token` cookie
 * - Saves it to Supabase table `xdash_auth` row id='current_session'
 *
 * Usage:
 *   npx tsx --env-file=.env.local src/scripts/xdash-login-bot.ts
 */
import { config } from "dotenv";
import { chromium, type BrowserContext, type Cookie, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const LOGIN_URL = "https://backup.xdash.adte-system.com/login";
const LOGIN_TIMEOUT_MS = 60_000;

function mustEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function fillFirstVisible(page: Page, selectors: string[], value: string): Promise<string> {
  for (const selector of selectors) {
    try {
      const input = page.locator(selector).first();
      if (await input.isVisible({ timeout: 2000 })) {
        await input.fill(value);
        return selector;
      }
    } catch {
      // Try next selector.
    }
  }
  throw new Error(`No matching visible input found for selectors: ${selectors.join(", ")}`);
}

async function clickFirstVisible(page: Page, selectors: string[]): Promise<string> {
  for (const selector of selectors) {
    try {
      const button = page.locator(selector).first();
      if (await button.isVisible({ timeout: 2000 })) {
        await button.click();
        return selector;
      }
    } catch {
      // Try next selector.
    }
  }
  throw new Error(`No matching visible button found for selectors: ${selectors.join(", ")}`);
}

async function waitForAuthTokenCookie(context: BrowserContext): Promise<Cookie> {
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const cookies = await context.cookies();
    const auth = cookies.find((c) => c.name === "auth-token");
    if (auth?.value) return auth;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("auth-token cookie not found after login timeout.");
}

async function persistTokenToSupabase(token: string): Promise<void> {
  const supabaseClient = createClient(
    mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
    mustEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // CRITICAL FIX: Only update the token_value column for id='current_session'
  const { error } = await supabaseClient
    .from("xdash_auth")
    .update({ token_value: token })
    .eq("id", "current_session");

  if (!error) {
    console.log(`[xdash-login-bot] Saved token to xdash_auth.token_value (id=current_session).`);
    return;
  }

  throw new Error(
    `Failed to write token to xdash_auth.token_value: ${error.message}`
  );
}

// --- Fixed getXDashAuthToken: fetch token_value, access data.token_value, log if missing ---
async function getXDashAuthToken(): Promise<string> {
  // 1. קודם כל בודקים ב-ENV (למקרה חירום)
  const envToken = process.env.XDASH_AUTH_TOKEN;
  if (envToken) return envToken;

  // 2. אם אין ב-ENV, הולכים ל-Supabase
  console.log('[xdash-client] Fetching token from Supabase (xdash_auth.token_value)...');
  
  const { data, error } = await supabase
    .from('xdash_auth')
    .select('token_value')
    .eq('id', 'current_session')
    .single();

  if (error || !data?.token_value) {
    console.error('[xdash-client] Supabase fetch error:', error?.message);
    throw new Error("Missing XDASH auth token: provide XDASH_AUTH_TOKEN in .env.local or xdash_auth.id=current_session in Supabase.");
  }

  return data.token_value;
}

async function main() {
  const username = mustEnv("XDASH_USERNAME");
  const password = mustEnv("XDASH_PASSWORD");

  const headless = (process.env.PLAYWRIGHT_HEADLESS ?? "true").toLowerCase() !== "false";
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log(`[xdash-login-bot] Opening login page (${headless ? "headless" : "headed"})...`);
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: LOGIN_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

    const userSelector = await fillFirstVisible(
      page,
      [
        'input[name="username"]',
        'input[name="email"]',
        'input[type="email"]',
        'input[placeholder*="user" i]',
        'input[placeholder*="mail" i]',
      ],
      username,
    );
    const passSelector = await fillFirstVisible(
      page,
      ['input[name="password"]', 'input[type="password"]', 'input[placeholder*="password" i]'],
      password,
    );
    console.log(`[xdash-login-bot] Filled login form (${userSelector}, ${passSelector}).`);

    const loginButtonSelector = await clickFirstVisible(page, [
      'button[type="submit"]',
      "button:has-text('Login')",
      "button:has-text('Log in')",
      "button:has-text('Sign in')",
      "form button",
    ]);

    await page
      .waitForURL((url) => !url.pathname.toLowerCase().includes("/login"), {
        timeout: LOGIN_TIMEOUT_MS,
      })
      .catch(() => undefined);
    console.log(`[xdash-login-bot] Submitted login via ${loginButtonSelector}, waiting for cookie...`);

    const authCookie = await waitForAuthTokenCookie(context);
    const token = authCookie.value;
    if (!token) throw new Error("auth-token cookie exists but value is empty.");

    await persistTokenToSupabase(token);
    console.log("[xdash-login-bot] Done.");

    // Example usage: retrieve the saved token
    // const savedToken = await getXDashAuthToken();
    // console.log(`Fetched token_value from Supabase: ${savedToken}`);

  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[xdash-login-bot] Failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
