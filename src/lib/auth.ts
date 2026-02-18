/**
 * Edge-safe auth helpers for middleware.
 * Node-only helpers (hashPassword) are in auth-server.ts.
 */

export const AUTH_COOKIE_NAME = "dashboard_auth";

/** SHA-256 hash as hex. Use in Edge (middleware). */
export async function hashPasswordEdge(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
