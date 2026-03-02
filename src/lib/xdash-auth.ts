/**
 * XDASH Auth Token Refresh via Playwright
 *
 * Automates browser login to https://www.xdash.adte-system.com to obtain a
 * fresh auth-token cookie.  The token is written back to .env.local so
 * subsequent API calls pick it up.
 *
 * Requires: XDASH_EMAIL and XDASH_PASSWORD in .env.local
 *           Playwright + Chromium installed (`npx playwright install chromium`)
 */

import { chromium, type Cookie } from "playwright";
import * as fs from "fs";
import * as path from "path";

const XDASH_URL = "https://www.xdash.adte-system.com";
const LOGIN_TIMEOUT_MS = 45_000;
const NAV_TIMEOUT_MS = 30_000;

const ENV_LOCAL_PATH = path.resolve(process.cwd(), ".env.local");

// ── helpers ──────────────────────────────────────────────────────────────────

function readEnvFile(): string {
  try {
    return fs.readFileSync(ENV_LOCAL_PATH, "utf-8");
  } catch {
    return "";
  }
}

function writeEnvFile(contents: string) {
  fs.writeFileSync(ENV_LOCAL_PATH, contents, "utf-8");
}

/** Replace or append XDASH_AUTH_TOKEN in .env.local */
function persistToken(token: string) {
  let env = readEnvFile();
  const regex = /^XDASH_AUTH_TOKEN=.*/m;
  const line = `XDASH_AUTH_TOKEN=${token}`;
  if (regex.test(env)) {
    env = env.replace(regex, line);
  } else {
    env = env.trimEnd() + "\n" + line + "\n";
  }
  writeEnvFile(env);
}

// ── main ─────────────────────────────────────────────────────────────────────

export interface RefreshResult {
  token: string;
  expiresAt?: string;
}

/**
 * Launch headless Chromium, log into XDASH, and return the new auth-token.
 * Also persists the token to .env.local and updates `process.env`.
 */
export async function refreshXDashToken(): Promise<RefreshResult> {
  const email = process.env.XDASH_EMAIL;
  const password = process.env.XDASH_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Missing XDASH_EMAIL or XDASH_PASSWORD in .env.local — cannot auto-refresh token."
    );
  }

  console.log("[xdash-auth] Launching headless browser …");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 1. Navigate to XDASH (redirects to login if unauthenticated)
    await page.goto(XDASH_URL, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    console.log("[xdash-auth] DOM loaded, waiting for SPA to render login form …");

    // Wait for any input element to appear (login form rendered by React)
    try {
      await page.waitForSelector("input", { timeout: LOGIN_TIMEOUT_MS });
    } catch {
      // If no input appears, the page might already be logged in or still loading
      await page.waitForTimeout(10000);
    }
    console.log("[xdash-auth] Page loaded:", page.url());

    // 2. Fill login form — try several common selector patterns
    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[placeholder*="mail" i]',
      'input[placeholder*="user" i]',
      "input:first-of-type",
    ];
    const passwordSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      'input[placeholder*="assword" i]',
    ];

    // Debug: screenshot + HTML dump on selector issues
    const debugDir = path.resolve(process.cwd(), ".debug");
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
    await page.screenshot({ path: path.join(debugDir, "xdash-login.png"), fullPage: true });
    const html = await page.content();
    fs.writeFileSync(path.join(debugDir, "xdash-login.html"), html, "utf-8");
    console.log("[xdash-auth] Debug screenshot + HTML saved to .debug/");

    let emailFilled = false;
    for (const sel of emailSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 3000 })) {
          await el.fill(email);
          emailFilled = true;
          console.log("[xdash-auth] Email filled via", sel);
          break;
        }
      } catch { /* try next */ }
    }
    if (!emailFilled) {
      throw new Error("Could not find the email input on the XDASH login page. Check .debug/xdash-login.png");
    }

    let passwordFilled = false;
    for (const sel of passwordSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 3000 })) {
          await el.fill(password);
          passwordFilled = true;
          console.log("[xdash-auth] Password filled via", sel);
          break;
        }
      } catch { /* try next */ }
    }
    if (!passwordFilled) {
      throw new Error("Could not find the password input on the XDASH login page.");
    }

    // 3. Click login button
    const buttonSelectors = [
      'button[type="submit"]',
      "button:has-text('Log in')",
      "button:has-text('Login')",
      "button:has-text('Sign in')",
      "button:has-text('Sign In')",
      "button:has-text('Submit')",
      "form button",
    ];

    let clicked = false;
    for (const sel of buttonSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          await btn.click();
          clicked = true;
          console.log("[xdash-auth] Login button clicked via", sel);
          break;
        }
      } catch { /* try next */ }
    }
    if (!clicked) {
      throw new Error("Could not find a login button on the XDASH page.");
    }

    // 4. Wait for successful login — the auth-token cookie should appear
    console.log("[xdash-auth] Waiting for auth-token cookie …");
    let authToken: Cookie | undefined;
    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const cookies = await context.cookies();
      authToken = cookies.find((c) => c.name === "auth-token");
      if (authToken) break;
      await page.waitForTimeout(1000);
    }

    if (!authToken) {
      const currentUrl = page.url();
      throw new Error(
        `Login succeeded but no auth-token cookie found after ${LOGIN_TIMEOUT_MS / 1000}s. Current URL: ${currentUrl}`
      );
    }

    const token = authToken.value;
    console.log(
      "[xdash-auth] Got fresh token:",
      token.slice(0, 20) + "…",
      authToken.expires ? `expires ${new Date(authToken.expires * 1000).toISOString()}` : ""
    );

    // 5. Persist to .env.local + update process.env
    persistToken(token);
    process.env.XDASH_AUTH_TOKEN = token;
    console.log("[xdash-auth] Token saved to .env.local");

    return {
      token,
      expiresAt: authToken.expires
        ? new Date(authToken.expires * 1000).toISOString()
        : undefined,
    };
  } finally {
    await browser.close();
  }
}

// ── CLI entry point ──────────────────────────────────────────────────────────

if (require.main === module || process.argv[1]?.endsWith("xdash-auth.ts")) {
  refreshXDashToken()
    .then((r) => {
      console.log("\nDone! Token refreshed.");
      if (r.expiresAt) console.log("Expires:", r.expiresAt);
      process.exit(0);
    })
    .catch((e) => {
      console.error("Token refresh failed:", e);
      process.exit(1);
    });
}
