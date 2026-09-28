/**
 * CT-REL-2 Part B (amendment 2): latest-wins snapshot publishing.
 *
 * Presence/heartbeat and run-snapshot publishing must NEVER block provider
 * execution or the claim loop. Each key (run id) has ONE pending slot and ONE
 * in-flight job: a publish that arrives while an older job is still pending
 * for the same key REPLACES it (superseded publishes are dropped, never
 * queued); a publish that arrives while a job is in flight runs once the
 * in-flight job settles. Retries live inside the control-plane call itself,
 * bounded by the 60s total budget; this publisher never waits for them.
 */

export interface LatestWinsPublisher {
  publish(key: string, job: () => Promise<void>): void;
  pendingKeys(): string[];
  inFlightKeys(): string[];
}

export function createLatestWinsPublisher(options: {
  onError?: ((error: unknown) => void) | undefined;
} = {}): LatestWinsPublisher {
  const pending = new Map<string, () => Promise<void>>();
  const inFlight = new Set<string>();

  const pump = (key: string): void => {
    if (inFlight.has(key)) return;
    const job = pending.get(key);
    if (!job) return;
    pending.delete(key);
    inFlight.add(key);
    void (async (): Promise<void> => {
      try {
        let current = job;
        for (;;) {
          try {
            await current();
          } catch (error) {
            try {
              await options.onError?.(error);
            } catch {
              // The error reporter itself is best-effort.
            }
          }
          const next = pending.get(key);
          if (!next) return;
          pending.delete(key);
          current = next;
        }
      } finally {
        inFlight.delete(key);
      }
    })();
  };

  return {
    publish(key: string, job: () => Promise<void>): void {
      pending.set(key, job); // latest wins: a pending, not-yet-started job is replaced
      pump(key);
    },
    pendingKeys(): string[] {
      return [...pending.keys()];
    },
    inFlightKeys(): string[] {
      return [...inFlight];
    },
  };
}