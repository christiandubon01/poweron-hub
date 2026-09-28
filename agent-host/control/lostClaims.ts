/**
 * CT-REL-2 amendment 3: lost-claim recovery.
 *
 * A claim RPC whose RESPONSE is lost leaves rows 'claimed' that this Host
 * never processed, and NO existing mechanism recovers them: the claim RPC only
 * ever touches pending rows (supabase/migrations/135_agent_control_plane.sql,
 * claim_agent_control_requests: UPDATE ... WHERE status = 'pending'),
 * findPlanByPlanId reads completed rows only, and the browser renders a claimed
 * row as in-flight forever. Attribution needs NO schema change —
 * agent_control_requests.claimed_by_host already records which Host INSTANCE
 * claimed a row — so the Host lists its own claimed rows and fails any row
 * claimed by THIS instance that it does NOT hold and has been claimed for more
 * than LOST_CLAIM_THRESHOLD_MS. CT-REL-2.1 goal 1: "held" covers every row a
 * claim call returned — a sibling still waiting its turn in the same batch is
 * just as held as the row being dispatched — so only rows whose claim response
 * was actually lost are ever recovered. Failed with the exact HOST_CLAIM_LOST
 * message so the owner can submit it again. NEVER re-executed automatically.
 */

export const LOST_CLAIM_THRESHOLD_MS = 120_000;
export const LOST_CLAIM_CHECK_INTERVAL_MS = 30_000;
export const HOST_CLAIM_LOST_MESSAGE = 'HOST_CLAIM_LOST: the Host lost track of this request — submit it again.';

export interface ClaimedRequestRow {
  id: string;
  claimed_at: string | null;
}

export interface HeldRequestTracker {
  /** Register a row as held by THIS Host instance (claim receipt or dispatch). */
  hold(id: string): void;
  /** Release a row once its handling is finished (completed / failed / refused). */
  release(id: string): void;
  isHeld(id: string): boolean;
  /** Record a row recovery has failed as HOST_CLAIM_LOST (CT-REL-2.1 goal 1c). */
  markPoisoned(id: string): void;
  isPoisoned(id: string): boolean;
}

/**
 * In-memory tracking of request ids THIS Host instance holds. Every row a
 * claim call returns is held the moment the response arrives — before any
 * dispatch — and stays held until its handler finishes. A poisoned row (failed
 * by lost-claim recovery) can never be dispatched again, even if it later
 * appears in a batch.
 */
export function createHeldRequestTracker(): HeldRequestTracker {
  const held = new Set<string>();
  const poisoned = new Set<string>();
  return {
    hold(id: string): void {
      held.add(id);
    },
    release(id: string): void {
      held.delete(id);
    },
    isHeld(id: string): boolean {
      return held.has(id);
    },
    markPoisoned(id: string): void {
      poisoned.add(id);
    },
    isPoisoned(id: string): boolean {
      return poisoned.has(id);
    },
  };
}

/**
 * Fail rows this Host instance lost track of — rows claimed by THIS instance
 * that are NOT held (their claim response was actually lost). Returns the
 * number of rows failed. Never re-executes anything — the only mutation is
 * failRequest.
 */
export async function recoverLostClaims(options: {
  listOwnClaimed: () => Promise<ClaimedRequestRow[]>;
  isHeld: (id: string) => boolean;
  failRequest: (id: string, error: string) => Promise<void>;
  now?: (() => number) | undefined;
  onRecovered?: ((id: string) => void) | undefined;
  onError?: ((error: unknown) => void) | undefined;
}): Promise<number> {
  let rows: ClaimedRequestRow[];
  try {
    rows = await options.listOwnClaimed();
  } catch (error) {
    options.onError?.(error);
    return 0;
  }
  const now = options.now ?? Date.now;
  let recovered = 0;
  for (const row of rows) {
    if (row.claimed_at === null) continue;
    const claimedMs = Date.parse(row.claimed_at);
    if (!Number.isFinite(claimedMs)) continue;
    // CT-REL-2.1 goal 1b: a held row — dispatched, refused, or still waiting
    // its turn in a batch — is NOT a lost claim, no matter how long the batch
    // takes. Only rows this Host claimed but never received are recovered.
    if (options.isHeld(row.id)) continue;
    if (now() - claimedMs <= LOST_CLAIM_THRESHOLD_MS) continue;
    try {
      await options.failRequest(row.id, HOST_CLAIM_LOST_MESSAGE);
      options.onRecovered?.(row.id);
      recovered += 1;
    } catch (error) {
      options.onError?.(error);
    }
  }
  return recovered;
}