/**
 * CT-REL-3 goal 6: previous-Host orphan-claim sweep.
 *
 * Each Host process gets a fresh instance id. CT-REL-2's lost-claim recovery only
 * fails rows claimed by THIS instance, so rows left 'claimed' by a PREVIOUS Host
 * that was killed stay claimed forever and the browser shows them as an endless
 * spinner. This sweep fails those rows — but ONLY when it is safe to conclude the
 * claiming Host is gone:
 *
 *   - the row is still 'claimed' and was claimed by a DIFFERENT instance,
 *   - it was claimed more than ORPHAN_CLAIM_THRESHOLD_MS ago, AND
 *   - that claiming instance has no fresh presence (no presence row, or its
 *     last_seen_at is older than the offline threshold).
 *
 * A live sibling instance's claim, or a claim younger than the threshold, is
 * NEVER touched. Swept rows are failed with HOST_CLAIM_ORPHAN_MESSAGE and are
 * NEVER executed. Runs already created by a dead Host keep using the existing
 * restart-resume logic — this sweep only clears stuck REQUEST rows.
 *
 * failRequest is not guarded by claimed_by_host and runs with the service role
 * (bypasses RLS), so failing another instance's row needs no schema/RPC/policy
 * change (see supabaseControl.ts listForeignClaimedRequests).
 */

import { HEARTBEAT_STALE_MS } from '../types.ts';

/** A claim must be at least this old before the sweep will consider it orphaned. */
export const ORPHAN_CLAIM_THRESHOLD_MS = 120_000;
/** Cadence of the periodic sweep (also run once at startup). */
export const ORPHAN_SWEEP_INTERVAL_MS = 60_000;
/** The exact owner-facing message for a swept orphan claim (goal 6). */
export const HOST_CLAIM_ORPHAN_MESSAGE =
  'HOST_CLAIM_LOST: the previous Host stopped before finishing this request — submit it again.';

export interface ForeignClaimedRow {
  id: string;
  claimed_by_host: string | null;
  claimed_at: string | null;
}

export interface PresenceRow {
  host_instance_id: string;
  last_seen_at: string;
}

/**
 * Pure decision: which foreign claimed rows are orphaned and should be failed.
 * A claiming instance is "alive" only if it has a presence row whose last_seen_at
 * is within HEARTBEAT_STALE_MS of `now` (and not absurdly in the future). Rows
 * with an unattributed/unparseable claim time or claimer are skipped (fail safe:
 * never touch what we cannot reason about).
 */
export function findOrphanClaims(options: {
  rows: readonly ForeignClaimedRow[];
  presence: readonly PresenceRow[];
  now: number;
}): string[] {
  const freshestByInstance = new Map<string, number>();
  for (const row of options.presence) {
    const seenMs = Date.parse(row.last_seen_at);
    if (!Number.isFinite(seenMs)) {
      continue;
    }
    const existing = freshestByInstance.get(row.host_instance_id);
    if (existing === undefined || seenMs > existing) {
      freshestByInstance.set(row.host_instance_id, seenMs);
    }
  }

  const isInstanceAlive = (instanceId: string): boolean => {
    const seenMs = freshestByInstance.get(instanceId);
    if (seenMs === undefined) {
      return false;
    }
    const ageMs = options.now - seenMs;
    // Fresh within the offline window; a symmetric guard rejects absurd future skew.
    return ageMs < HEARTBEAT_STALE_MS && ageMs > -HEARTBEAT_STALE_MS;
  };

  const orphaned: string[] = [];
  for (const row of options.rows) {
    if (!row.claimed_by_host || row.claimed_at === null) {
      continue;
    }
    const claimedMs = Date.parse(row.claimed_at);
    if (!Number.isFinite(claimedMs)) {
      continue;
    }
    if (options.now - claimedMs <= ORPHAN_CLAIM_THRESHOLD_MS) {
      continue; // too young — the claiming Host may simply be busy
    }
    if (isInstanceAlive(row.claimed_by_host)) {
      continue; // a live sibling instance owns it — never touch it
    }
    orphaned.push(row.id);
  }
  return orphaned;
}

/**
 * List foreign claimed rows + repo presence, compute the orphans, and fail each
 * with HOST_CLAIM_ORPHAN_MESSAGE. Never executes a row. Returns the count failed.
 * Every fault is reported through onError and never thrown to the caller (the
 * periodic timer must survive a transient control-plane outage).
 */
export async function sweepOrphanClaims(options: {
  listForeignClaimed: () => Promise<ForeignClaimedRow[]>;
  listPresence: () => Promise<PresenceRow[]>;
  failRequest: (id: string, error: string) => Promise<void>;
  now?: (() => number) | undefined;
  onRecovered?: ((id: string) => void) | undefined;
  onError?: ((error: unknown) => void) | undefined;
}): Promise<number> {
  let rows: ForeignClaimedRow[];
  let presence: PresenceRow[];
  try {
    [rows, presence] = await Promise.all([options.listForeignClaimed(), options.listPresence()]);
  } catch (error) {
    options.onError?.(error);
    return 0;
  }
  const now = (options.now ?? Date.now)();
  const orphaned = findOrphanClaims({ rows, presence, now });
  let recovered = 0;
  for (const id of orphaned) {
    try {
      await options.failRequest(id, HOST_CLAIM_ORPHAN_MESSAGE);
      options.onRecovered?.(id);
      recovered += 1;
    } catch (error) {
      options.onError?.(error);
    }
  }
  return recovered;
}
