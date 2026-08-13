/**
 * One-shot retry for fire-and-forget telemetry DB writes.
 *
 * On Vercel lambda thaw, the first fetch against a stale keep-alive socket
 * often dies with `TypeError: fetch failed`; a fresh attempt ~400ms later
 * opens a new socket and succeeds. Data-path writes don't need this — they
 * run after the connection is warm.
 *
 * Never throws: after the retry fails, warns and returns undefined so
 * callers stay non-fatal.
 */
export async function withOneRetry<T>(
  op: () => Promise<T>,
  label: string,
): Promise<T | undefined> {
  try {
    return await op();
  } catch (first) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      return await op();
    } catch (second) {
      const msg = second instanceof Error ? second.message : String(second);
      console.warn(`[${label}] failed after retry:`, msg);
      return undefined;
    }
  }
}
