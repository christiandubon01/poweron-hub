// @ts-nocheck
/**
 * Passcode layer — sits on top of Supabase Auth.
 *
 * Flow:
 *   1. User signs in via Supabase (email/magic-link) once.
 *   2. During onboarding they set a 6-digit passcode → stored as PBKDF2 hash
 *      in profiles.passcode_hash.
 *   3. On every subsequent app open (after the Supabase JWT is still valid),
 *      the passcode screen appears instead of the email login.
 *   4. Correct passcode → session created → dashboard loads.
 *   5. 5 failed attempts → 15-min lockout → owner notified.
 *
 * SEC2: verification moved server-side, to
 * /.netlify/functions/session-store (intent `passcode.verify`).
 *
 * Comparing the hash in the browser and then reporting the verdict made the
 * lockout advisory — the attempt counter only incremented if the client chose
 * to say it had failed, and the attacker here already holds a valid Supabase
 * JWT (the passcode is a second factor, not the login). The server now runs
 * PBKDF2 and increments the counter before it answers, so an ignored response
 * still burns an attempt.
 *
 * Hashing a *new* passcode stays here: the browser legitimately knows the
 * passcode at that point, and the stored format is unchanged, so hashes written
 * by this file verify byte-identically on the server.
 */

import { supabase } from '@/lib/supabase'
import { sessionStoreCall } from '@/lib/auth/sessionStoreClient'
import { logAudit } from '@/lib/memory/audit'

// ── Constants ────────────────────────────────────────────────────────────────
const PBKDF2_ITERATIONS = 100_000
const SALT_BYTES        = 16
const HASH_BYTES        = 32
const MAX_ATTEMPTS      = 5

// ── Timeout helper ──────────────────────────────────────────────────────────
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

// ── Web Crypto hashing (PBKDF2 + SHA-256) ───────────────────────────────────
function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function hashPasscode(passcode: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passcode),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    HASH_BYTES * 8
  )
  // Format: pbkdf2:iterations:salt_hex:hash_hex
  return `pbkdf2:${PBKDF2_ITERATIONS}:${toHex(salt.buffer)}:${toHex(derived)}`
}

// Verification lives on the server — see netlify/functions/session-store.ts.

// ── Types ────────────────────────────────────────────────────────────────────
export interface PasscodeStatus {
  isSet:   boolean
  isLocked: boolean
  attemptsRemaining: number
  lockExpiresAt: Date | null
}

export type SetPasscodeResult =
  | { success: true }
  | { success: false; error: string }

export type VerifyPasscodeResult =
  | { success: true }
  | { success: false; locked: true;  lockExpiresAt: Date; attemptsUsed: number }
  | { success: false; locked: false; attemptsRemaining: number }


// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Hash and store a new 6-digit passcode for the authenticated user.
 * Called during onboarding and from the "Change passcode" settings screen.
 */
export async function setPasscode(
  userId: string,
  passcode: string
): Promise<SetPasscodeResult> {
  if (!/^\d{6}$/.test(passcode)) {
    return { success: false, error: 'Passcode must be exactly 6 digits.' }
  }

  try {
    const hash = await hashPasscode(passcode)

    // COMM-PROD-1 Step 9 (defect C). PostgREST returns success with zero rows
    // when the UPDATE matches nothing — a missing profiles row or a row-level
    // policy miss both look identical to a real save. Onboarding reported
    // "PIN saved" while profiles.passcode_hash stayed NULL, so the next reload
    // read no hash and sent the owner back through PIN setup. The readback is
    // the server-side confirmation: a save is only successful once the stored
    // hash comes back from the database.
    const { data: saved, error } = await supabase
      .from('profiles')
      .update({ passcode_hash: hash })
      .eq('id', userId)
      .select('id, passcode_hash')
      .maybeSingle()

    if (error) throw error

    if (!saved || (saved as { passcode_hash?: string }).passcode_hash !== hash) {
      console.error('[Passcode] setPasscode wrote no profile row', { userId })
      return {
        success: false,
        error: 'Passcode could not be saved to your account. Please try again.',
      }
    }

    // Clear any existing lockout when passcode is reset.
    // Server-scoped to the caller — userId is not sent.
    await sessionStoreCall('passcode.clearLock')

    await logAudit({
      action:      'update',
      entity_type: 'profiles',
      entity_id:   userId,
      description: 'Passcode updated',
    })

    return { success: true }
  } catch (err) {
    console.error('[Passcode] setPasscode error', err)
    return { success: false, error: 'Failed to save passcode. Try again.' }
  }
}

/**
 * Verify a passcode attempt.
 * Tracks failed attempts in Redis and locks the account after MAX_ATTEMPTS.
 */
export async function verifyPasscode(
  userId: string,
  orgId:  string,
  passcode: string
): Promise<VerifyPasscodeResult> {
  try {
    // The server checks the lockout, compares the hash and increments the
    // failure counter in one call. Timeout 10s covers PBKDF2 + a cold start.
    const result = await withTimeout(
      sessionStoreCall<{
        success:            boolean
        locked?:            boolean
        justLocked?:        boolean
        lockExpiresAt?:     string
        attemptsRemaining?: number
      }>('passcode.verify', { passcode }),
      10000,
      null
    )

    if (!result) {
      // Store unreachable. Same posture as an unavailable Redis before SEC2:
      // fail open so a store outage cannot lock everyone out of the app.
      return { success: false, locked: false, attemptsRemaining: MAX_ATTEMPTS }
    }

    if (result.success) {
      logAudit({
        action:      'login',
        entity_type: 'profiles',
        entity_id:   userId,
        description: 'Passcode verified successfully',
      }).catch(() => {})
      return { success: true }
    }

    if (result.locked) {
      const expiresAt = result.lockExpiresAt
        ? new Date(result.lockExpiresAt)
        : new Date()

      // Only on the transition into lockout — otherwise every further attempt
      // during the 15 minutes would re-audit and re-notify the owner.
      if (result.justLocked) {
        logAudit({
          action:      'lock',
          entity_type: 'profiles',
          entity_id:   userId,
          description: `Account locked after ${MAX_ATTEMPTS} failed passcode attempts`,
        }).catch(() => {})

        supabase.from('notifications').insert({
          org_id:   orgId,
          user_id:  userId,
          type:     'alert',
          title:    'Account Locked',
          body:     `${MAX_ATTEMPTS} failed passcode attempts. Account locked for 15 minutes.`,
          channel:  'in_app',
          data:     { lock_expires_at: expiresAt.toISOString() },
        } as never).then(() => {}).catch(() => {})
      }

      return { success: false, locked: true, lockExpiresAt: expiresAt, attemptsUsed: MAX_ATTEMPTS }
    }

    return {
      success:           false,
      locked:            false,
      attemptsRemaining: result.attemptsRemaining ?? MAX_ATTEMPTS,
    }
  } catch (err) {
    console.error('[Passcode] verifyPasscode error', err)
    // Never hang — return a generic failure so the UI can recover
    return { success: false, locked: false, attemptsRemaining: MAX_ATTEMPTS }
  }
}

/**
 * Check current passcode status for a user (used to decide which screen to show).
 */
export async function getPasscodeStatus(userId: string): Promise<PasscodeStatus> {
  try {
    // The server reads passcode_hash plus both counters under the caller's RLS.
    // 3s timeout with a null fallback so we never hang the auth flow.
    const status = await withTimeout(
      sessionStoreCall<{
        isSet:             boolean
        isLocked:          boolean
        attemptsRemaining: number
        lockExpiresAt:     string | null
      }>('passcode.status'),
      3000,
      null
    )

    if (!status) throw new Error('session-store unreachable')

    return {
      isSet:             status.isSet,
      isLocked:          status.isLocked,
      attemptsRemaining: status.attemptsRemaining,
      lockExpiresAt:     status.lockExpiresAt ? new Date(status.lockExpiresAt) : null,
    }
  } catch (err) {
    console.error('[Passcode] getPasscodeStatus error — falling back to Supabase only', err)
    // Fallback: check Supabase directly, assume no lock (store is down)
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('passcode_hash')
        .eq('id', userId)
        .single()

      return {
        isSet:             !!profile?.passcode_hash,
        isLocked:          false,
        attemptsRemaining: MAX_ATTEMPTS,
        lockExpiresAt:     null,
      }
    } catch {
      // Total failure — report not set so UI can recover
      return {
        isSet:             false,
        isLocked:          false,
        attemptsRemaining: MAX_ATTEMPTS,
        lockExpiresAt:     null,
      }
    }
  }
}

/**
 * Admin unlock — clear a lockout.
 *
 * Currently unused (no call sites). SEC2 NOTE: the server scopes every intent
 * to the JWT caller, so this clears *the caller's own* lockout — `userId` is
 * only used for the audit entry. Unlocking a different user needs a new
 * server-side intent with an explicit owner/admin check; do not wire this into
 * an admin UI as-is.
 */
export async function adminUnlockUser(userId: string): Promise<void> {
  await sessionStoreCall('passcode.clearLock')
  await logAudit({
    action:      'unlock',
    entity_type: 'profiles',
    entity_id:   userId,
    description: 'Passcode lockout cleared by admin',
  })
}

// Current lock expiry — call this when showing the locked screen to keep the
// expiry accurate for display (the server-side TTL is the source of truth).
// Currently unused (no call sites). Scoped to the caller, as above.
export async function refreshLockExpiry(_userId: string): Promise<Date | null> {
  const status = await sessionStoreCall<{ lockExpiresAt: string | null }>('passcode.status')
  if (!status?.lockExpiresAt) return null
  return new Date(status.lockExpiresAt)
}
