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

async function waitForAuthTokenCookie(context: BrowserContext, timeoutMs = 30_000): Promise<Cookie> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cookies = await context.cookies();
    const auth = cookies.find((c) => c.name === "auth-token");
    if (auth?.value) return auth;
    await new Promise((r) => setTimeout(r, 1000));
  }
  // Dump all cookies for debugging
  const allCookies = await context.cookies();
  console.log(`[xdash-login-bot] All cookies (${allCookies.length}):`);
  for (const c of allCookies) {
    console.log(`  ${c.name} = ${c.value.slice(0, 30)}… (domain: ${c.domain})`);
  }
  throw new Error(`auth-token cookie not found after ${timeoutMs / 1000}s.`);
}

async function persistTokenToSupabase(token: string): Promise<void> {
  const supabaseClient = createClient(
    mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
    mustEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { error } = await supabaseClient
    .from("xdash_auth")
    .update({ token_value: token, updated_at: new Date().toISOString() })
    .eq("id", "current_session");

  if (!error) {
    console.log(`[xdash-login-bot] Saved token to xdash_auth.token_value (id=current_session).`);
    return;
  }

  throw new Error(
    `Failed to write token to xdash_auth.token_value: ${error.message}`
  );
}

async function main() {
  console.log("[xdash-login-bot] === Starting XDASH auth refresh ===");
  console.log("[xdash-login-bot] Step 1/7: Reading environment variables…");
  const username = mustEnv("XDASH_USERNAME");
  const password = mustEnv("XDASH_PASSWORD");
  console.log(`[xdash-login-bot] Username: ${username.slice(0, 3)}*** (${username.length} chars)`);

  console.log("[xdash-login-bot] Step 2/7: Launching Playwright Chromium…");
  const headless = (process.env.PLAYWRIGHT_HEADLESS ?? "true").toLowerCase() !== "false";
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log(`[xdash-login-bot] Step 3/7: Navigating to ${LOGIN_URL} (${headless ? "headless" : "headed"})…`);
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: LOGIN_TIMEOUT_MS });
    console.log(`[xdash-login-bot] Page loaded. URL: ${page.url()}`);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {
      console.log("[xdash-login-bot] networkidle timeout (non-fatal, continuing)");
    });
    console.log(`[xdash-login-bot] Current URL after load: ${page.url()}`);

    // SPA login forms may render asynchronously — wait for any input to appear
    console.log("[xdash-login-bot] Waiting for SPA login form to render (up to 30s)…");
    try {
      await page.waitForSelector("input", { state: "visible", timeout: 30_000 });
      console.log("[xdash-login-bot] Login form input detected.");
    } catch {
      // Dump HTML for remote debugging even if inputs never appear
      const html = await page.content();
      const snippet = html.slice(0, 2000);
      console.error(`[xdash-login-bot] No <input> appeared after 30s. HTML snippet:\n${snippet}`);
      throw new Error("Login form never rendered — no <input> visible after 30s. See HTML dump above.");
    }

    const title = await page.title();
    const inputCount = await page.locator("input").count();
    const buttonCount = await page.locator("button").count();
    console.log(`[xdash-login-bot] Page title: "${title}", inputs: ${inputCount}, buttons: ${buttonCount}`);

    console.log("[xdash-login-bot] Step 4/7: Filling username…");
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
    console.log(`[xdash-login-bot] Username filled via: ${userSelector}`);

    console.log("[xdash-login-bot] Step 5/7: Filling password…");
    const passSelector = await fillFirstVisible(
      page,
      ['input[name="password"]', 'input[type="password"]', 'input[placeholder*="password" i]'],
      password,
    );
    console.log(`[xdash-login-bot] Password filled via: ${passSelector}`);

    // Enumerate all inputs/buttons on the page for diagnostics
    const allInputs = await page.locator("input").all();
    for (let i = 0; i < allInputs.length; i++) {
      const attrs = await allInputs[i].evaluate((el) => ({
        name: el.getAttribute("name"),
        type: el.getAttribute("type"),
        placeholder: el.getAttribute("placeholder"),
        id: el.id,
        visible: el instanceof HTMLElement ? el.offsetParent !== null : false,
      }));
      console.log(`[xdash-login-bot] input[${i}]:`, JSON.stringify(attrs));
    }
    const allButtons = await page.locator("button").all();
    for (let i = 0; i < allButtons.length; i++) {
      const text = await allButtons[i].textContent();
      const type = await allButtons[i].getAttribute("type");
      console.log(`[xdash-login-bot] button[${i}]: type="${type}", text="${text?.trim()}"`);
    }

    // Intercept network responses to capture login API result
    const loginResponses: { url: string; status: number; body: string }[] = [];
    page.on("response", async (resp) => {
      const url = resp.url();
      if (url.includes("login") || url.includes("auth") || url.includes("signin")) {
        try {
          const body = await resp.text().catch(() => "(binary)");
          loginResponses.push({ url, status: resp.status(), body: body.slice(0, 500) });
          console.log(`[xdash-login-bot] Network response: ${resp.status()} ${url.slice(0, 120)}`);
        } catch { /* ignore */ }
      }
    });

    console.log("[xdash-login-bot] Step 6/7: Clicking login button…");
    const loginButtonSelector = await clickFirstVisible(page, [
      'button[type="submit"]',
      "button:has-text('Login')",
      "button:has-text('Log in')",
      "button:has-text('Sign in')",
      "form button",
    ]);
    console.log(`[xdash-login-bot] Clicked: ${loginButtonSelector}`);

    // Wait a bit for the login API call to complete
    await page.waitForTimeout(5_000);

    // Check for error messages on the page
    const pageText = await page.locator("body").textContent();
    const errorIndicators = ["invalid", "incorrect", "wrong", "error", "denied", "failed", "expired", "captcha"];
    for (const indicator of errorIndicators) {
      if (pageText?.toLowerCase().includes(indicator)) {
        const context = pageText.toLowerCase();
        const idx = context.indexOf(indicator);
        const nearby = pageText.slice(Math.max(0, idx - 50), idx + 80).trim();
        console.log(`[xdash-login-bot] Page contains "${indicator}": …${nearby}…`);
      }
    }

    // Log captured login API responses
    if (loginResponses.length > 0) {
      for (const r of loginResponses) {
        console.log(`[xdash-login-bot] Login API: ${r.status} ${r.url}`);
        console.log(`[xdash-login-bot] Login API body: ${r.body}`);
      }
    } else {
      console.log("[xdash-login-bot] No login/auth network responses captured.");
    }

    await page
      .waitForURL((url) => !url.pathname.toLowerCase().includes("/login"), {
        timeout: 15_000,
      })
      .catch(() => {
        console.log(`[xdash-login-bot] URL still contains /login after wait. Current URL: ${page.url()}`);
      });
    console.log(`[xdash-login-bot] Post-login URL: ${page.url()}`);

    console.log("[xdash-login-bot] Step 7/7: Waiting for auth-token cookie…");
    const authCookie = await waitForAuthTokenCookie(context);
    const token = authCookie.value;
    if (!token) throw new Error("auth-token cookie exists but value is empty.");
    console.log(`[xdash-login-bot] Got token (${token.length} chars): ${token.slice(0, 20)}…`);

    await persistTokenToSupabase(token);
    console.log("[xdash-login-bot] === Auth refresh completed successfully ===");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : "";
  console.error(`[xdash-login-bot] FAILED: ${msg}`);
  if (stack) console.error(stack);
  process.exit(1);
});
