/**
 * CT-REL-2 Part B (goal 6): bounded exponential backoff with jitter for
 * transient control-plane failures.
 *
 *   - ONLY idempotent operations may be retried. A non-idempotent operation is
 *     refused BEFORE it runs — it must never be blindly retried.
 *   - Delay growth: exponential from RETRY_BASE_DELAY_MS (1s) with equal
 *     jitter, each individual delay capped at RETRY_MAX_DELAY_MS (30s).
 *   - Amendment 2: every retried operation has a total retry budget
 *     (RETRY_TOTAL_BUDGET_MS, default 60s). When the budget is spent the
 *     operation gives up, the last failure is rethrown to the caller, and the
 *     give-up is reported so it counts toward health.
 *   - A successful attempt simply returns (each call starts at delay 0 — the
 *     caller resets its own backoff state on success).
 *   - Abort signal: aborting rejects the in-flight wait immediately so a
 *     shutting-down Host never lingers on retries.
 */

export const RETRY_BASE_DELAY_MS = 1_000;
export const RETRY_MAX_DELAY_MS = 30_000;
export const RETRY_TOTAL_BUDGET_MS = 60_000;

export class NonIdempotentOperationError extends Error {
  constructor() {
    super('withRetry refused a non-idempotent operation: it must not be retried.');
    this.name = 'NonIdempotentOperationError';
  }
}

/**
 * One jittered backoff delay. Equal jitter lands in [0.5×, 1×) of the capped
 * exponential delay, so the sequence stays recognizable while avoiding
 * synchronized retry storms.
 */
export function jitteredBackoffDelay(attemptIndex: number, random: () => number = Math.random): number {
  const capped = Math.min(RETRY_BASE_DELAY_MS * 2 ** attemptIndex, RETRY_MAX_DELAY_MS);
  return capped / 2 + random() * capped / 2;
}

export interface RetryOptions<T> {
  /** The operation to attempt. */
  attempt: () => Promise<T>;
  /** Hard gate: only idempotent operations are retried. */
  idempotent: boolean;
  /** Total wall-clock retry budget in ms (amendment 2). Defaults to RETRY_TOTAL_BUDGET_MS. */
  totalBudgetMs?: number | undefined;
  signal?: AbortSignal | undefined;
  sleep?: ((ms: number, signal: AbortSignal) => Promise<void>) | undefined;
  random?: (() => number) | undefined;
  now?: (() => number) | undefined;
  onAttemptFailure?: ((error: unknown, attemptCount: number) => void) | undefined;
  /** Called once when the total budget is spent and the failure is rethrown. */
  onGiveUp?: ((error: unknown, attemptCount: number) => void) | undefined;
  /** Called once after a successful attempt (CT-REL-2.1: callers reset health/backoff on success). */
  onSuccess?: (() => void) | undefined;
}

export async function withRetry<T>(options: RetryOptions<T>): Promise<T> {
  if (!options.idempotent) {
    throw new NonIdempotentOperationError();
  }
  const totalBudgetMs = options.totalBudgetMs ?? RETRY_TOTAL_BUDGET_MS;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultRetrySleep;
  const startedAt = now();
  let attemptCount = 0;
  for (let attemptIndex = 0; ; attemptIndex += 1) {
    try {
      const value = await options.attempt();
      options.onSuccess?.();
      return value;
    } catch (error) {
      attemptCount += 1;
      options.onAttemptFailure?.(error, attemptCount);
      if (options.signal?.aborted) throw error;
      const elapsed = now() - startedAt;
      if (elapsed >= totalBudgetMs) {
        options.onGiveUp?.(error, attemptCount);
        throw error;
      }
      const delay = jitteredBackoffDelay(attemptIndex, random);
      if (elapsed + delay >= totalBudgetMs) {
        // The next delay cannot fit inside the budget: give up now instead of
        // running past the cap (amendment 2).
        options.onGiveUp?.(error, attemptCount);
        throw error;
      }
      try {
        await sleep(delay, options.signal ?? new AbortController().signal);
      } catch {
        // Aborted while waiting — surface the real failure, not the wait error.
        throw error;
      }
      if (options.signal?.aborted) throw error;
    }
  }
}

function defaultRetrySleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Retry wait aborted'));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('Retry wait aborted'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}