/**
 * src/services/quickbooks/quickbooksOauthStateStore.ts
 *
 * SERVER-ONLY single-use OAuth state store — closes the QBO-1A replay gap.
 *
 * QBO-1A's signed HMAC state gave integrity, PowerOn user/org binding, and TTL,
 * but a replay inside the TTL remained possible because the state was stateless.
 * This module persists only the cryptographic HASH of the signed-state nonce
 * (never the raw nonce) and atomically consumes it on callback. A replay fails
 * even while the original signed state is still inside its HMAC TTL.
 *
 * Flow:
 *   authorize: createState(...) -> inserts nonce_hash + org + user + return_path
 *   callback:  consumeState(...) -> atomic compare-and-set
 *                UPDATE ... SET consumed_at = now
 *                WHERE nonce_hash = $1 AND consumed_at IS NULL AND expires_at > now
 *              A second callback using the same state finds the row already
 *              consumed (or expired) and is rejected.
 *
 * The raw nonce travels in the signed HMAC state (bound + integrity-protected);
 * it is recovered server-side on callback via verifyState and hashed here to
 * locate the row. Only the hash is ever persisted.
 *
 * Testability: the persistence mechanism is injected as a QboStateRepo so the
 * replay/CAS behavior is unit-tested with an in-memory fake. The Netlify
 * functions supply a Supabase-backed adapter using the service role key.
 */
import { hashNonce } from './quickbooksTokenCrypto'
import type { QboStateContext } from './quickbooksTypes'

/** A consumed/created state row as read back from the store. */
export interface QboStateRow {
  id: string
  organizationId: string
  userId: string
  returnPath: string | null
  expiresAt: string
  consumedAt: string | null
}

/** Input for inserting a single-use state row. */
export interface QboCreateStateInput {
  /** The raw signed-state nonce (only its hash is persisted). */
  nonce: string
  organizationId: string
  userId: string
  /** Validated safe return path (see safeReturnPath). */
  returnPath: string | null
  /** Absolute expiry timestamp. */
  expiresAt: Date
}

/** Injected persistence surface so logic is unit-testable without a database. */
export interface QboStateRepo {
  insertState(row: {
    nonceHash: string
    organizationId: string
    userId: string
    returnPath: string | null
    expiresAt: string
  }): Promise<void>
  /**
   * Atomically consume a live, unconsumed state row by nonce hash.
   * Returns the row if the compare-and-set succeeded (one winner), else null.
   */
  consumeState(nonceHash: string, now: string): Promise<QboStateRow | null>
  /** Opportunistically delete expired rows. */
  pruneStates(now: string): Promise<void>
}

export type QboConsumeStateReason =
  | 'replay_or_expired'
  | 'org_mismatch'
  | 'user_mismatch'

export type QboConsumeStateResult =
  | { ok: true; returnPath: string | null }
  | { ok: false; reason: QboConsumeStateReason }

/**
 * Validate a return path so it can only target a safe PowerOn relative/internal
 * destination. Never an open redirect. Defaults to "/".
 *
 * Allowed: a path beginning with a single "/", containing only safe path
 * characters, with no scheme, no protocol-relative "//", and no backslash.
 */
export function safeReturnPath(input: string | null | undefined): string {
  if (!input || typeof input !== 'string') return '/'
  const trimmed = input.trim()
  if (!trimmed) return '/'
  if (!trimmed.startsWith('/')) return '/'
  if (trimmed.startsWith('//')) return '/'
  if (trimmed.includes(':')) return '/'
  if (trimmed.includes('\\')) return '/'
  if (!/^\/[A-Za-z0-9._~/-]*$/.test(trimmed)) return '/'
  return trimmed
}

/**
 * Persist a single-use OAuth state row. Only the hash of the nonce is stored.
 * The return path is normalized through safeReturnPath before persistence.
 */
export async function createState(
  repo: QboStateRepo,
  input: QboCreateStateInput,
): Promise<{ nonceHash: string; expiresAt: string }> {
  const nonceHash = hashNonce(input.nonce)
  const returnPath = safeReturnPath(input.returnPath)
  const expiresAtIso = input.expiresAt.toISOString()
  await repo.insertState({
    nonceHash,
    organizationId: input.organizationId,
    userId: input.userId,
    returnPath,
    expiresAt: expiresAtIso,
  })
  return { nonceHash, expiresAt: expiresAtIso }
}

/**
 * Atomically consume the single-use state row matching the signed-state nonce.
 * Rejects replays, expired rows, and org/user mismatch vs the verified context.
 */
export async function consumeState(
  repo: QboStateRepo,
  nonce: string,
  expected: QboStateContext,
  now: Date,
): Promise<QboConsumeStateResult> {
  const nonceHash = hashNonce(nonce)
  const row = await repo.consumeState(nonceHash, now.toISOString())
  if (!row) return { ok: false, reason: 'replay_or_expired' }
  if (row.organizationId !== expected.orgId) return { ok: false, reason: 'org_mismatch' }
  if (row.userId !== expected.userId) return { ok: false, reason: 'user_mismatch' }
  return { ok: true, returnPath: row.returnPath }
}

/** Opportunistically prune expired state rows (safe at any time). */
export async function pruneExpired(repo: QboStateRepo, now: Date): Promise<void> {
  await repo.pruneStates(now.toISOString())
}