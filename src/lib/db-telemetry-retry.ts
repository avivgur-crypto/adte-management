/**
 * One-shot retry for fire-and-forget telemetry DB writes.
 *
 * On Vercel lambda thaw, the first fetch against a stale keep-alive socket
 * often dies with `TypeError: fetch failed`; a fresh attempt ~400ms later
 * opens a new socket and succeeds. Data-path writes don't need this — they
 * run after the connection is warm.
 *
 * Callers must throw inside `op` on soft failures (e.g. Supabase `{ error }`)
 * so the retry actually covers them — returning `{ error }` is treated as
 * success by this helper.
 *
 * Never throws: after the retry fails, warns and returns undefined so
 * callers stay non-fatal. First-attempt failures that the retry recovers
 * produce a console.warn only (no error event — that is the caller's job
 * after this returns undefined).
 */
export async function withOneRetry<T>(
  op: () => Promise<T>,
  label: string,
): Promise<T | undefined> {
  try {
    return await op();
  } catch (first) {
    const firstMsg = first instanceof Error ? first.message : String(first);
    await new Promise((r) => setTimeout(r, 400));
    try {
      const value = await op();
      console.warn(
        `[${label}] first attempt failed, retry succeeded (stale socket): ${firstMsg}`,
      );
      return value;
    } catch (second) {
      const msg = second instanceof Error ? second.message : String(second);
      console.warn(`[${label}] failed after retry:`, msg);
      return undefined;
    }
  }
}
