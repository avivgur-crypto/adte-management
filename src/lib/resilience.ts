/**
 * Helpers for API resilience: timeout and retry.
 * Use in server actions so one slow/failing source doesn't break the dashboard.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;

export class TimeoutError extends Error {
  constructor(public readonly ms: number) {
    super(`Request timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Run a promise with a timeout. Rejects with TimeoutError if it exceeds ms.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number = DEFAULT_TIMEOUT_MS
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Run an async function with retries. Retries on rejection (except TimeoutError after first try).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; timeoutMs?: number } = {}
): Promise<T> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs);
    } catch (err) {
      lastError = err;
      if (attempt < retries && !(err instanceof TimeoutError)) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError;
}
