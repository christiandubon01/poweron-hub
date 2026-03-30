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
 *   4. Correct passcode → Redis session created → dashboard loads.
 *   5. 5 failed attempts → 15-min lockout stored in Redis → owner notified.
 *
 * Uses Web Crypto API (PBKDF2 + SHA-256) instead of bcryptjs to avoid
 * Node "crypto" module incompatibility with Vite/browser environments.
 */

import { supabase } from '@/lib/supabase'
import { rGet, rSet, rIncr, rDel, rExpire, redisKeys, TTL } from '@/lib/redis'
import { logAudit } from '@/lib/memory/audit'

// ── Constants ────────────────────────────────────────────────────────────────
const PBKDF2_ITERATIONS = 100_000
const SALT_BYTES        = 16
const HASH_BYTES        = 32
const MAX_ATTEMPTS      = 5
const LOCK_DURATION_SEC = TTL.PASSCODE_LOCK  // 15 minutes

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

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
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

async function verifyHash(passcode: string, stored: string): Promise<boolean> {
  const parts = stored.split(':')
  if (parts[0] !== 'pbkdf2' || parts.length !== 4) return false

  const iterations = parseInt(parts[1], 10)
  const salt = fromHex(parts[2])
  const expectedHash = parts[3]

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passcode),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    HASH_BYTES * 8
  )
  return toHex(derived) === expectedHash
}

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

    const { error } = await supabase
      .from('profiles')
      .update({ passcode_hash: hash })
      .eq('id', userId)

    if (error) throw error

    // Clear any existing lockout when passcode is reset
    await rDel(redisKeys.passcodeLock(userId))
    await rDel(redisKeys.failedAttempts(userId))

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
    // 1. Check if account is currently locked (timeout 3s, fallback: not locked)
    const lockData = await withTimeout(
      rGet<{ expiresAt: string }>(redisKeys.passcodeLock(userId)),
      3000,
      null
    )
    if (lockData) {
      const expiresAt = new Date(lockData.expiresAt)
      if (expiresAt > new Date()) {
        return { success: false, locked: true, lockExpiresAt: expiresAt, attemptsUsed: MAX_ATTEMPTS }
      }
      // Lock expired — clear it (fire-and-forget)
      rDel(redisKeys.passcodeLock(userId)).catch(() => {})
      rDel(redisKeys.failedAttempts(userId)).catch(() => {})
    }

    // 2. Fetch the stored hash from Supabase (the source of truth)
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('passcode_hash')
      .eq('id', userId)
      .single()

    if (error || !profile?.passcode_hash) {
      return { success: false, locked: false, attemptsRemaining: MAX_ATTEMPTS }
    }

    // 3. Compare
    const isMatch = await verifyHash(passcode, profile.passcode_hash)

    if (isMatch) {
      // Success — clear failed attempt counter (fire-and-forget, don't block)
      rDel(redisKeys.failedAttempts(userId)).catch(() => {})
      logAudit({
        action:      'login',
        entity_type: 'profiles',
        entity_id:   userId,
        description: 'Passcode verified successfully',
      }).catch(() => {})
      return { success: true }
    }

    // 4. Failed — increment attempt counter (timeout 3s, fallback: 1)
    const attempts = await withTimeout(
      rIncr(redisKeys.failedAttempts(userId), LOCK_DURATION_SEC),
      3000,
      null
    ) ?? 1

    if (attempts >= MAX_ATTEMPTS) {
      // Lock the account
      const expiresAt = new Date(Date.now() + LOCK_DURATION_SEC * 1000)
      // Fire-and-forget Redis writes — don't block
      rSet(redisKeys.passcodeLock(userId), { expiresAt: expiresAt.toISOString() }, LOCK_DURATION_SEC).catch(() => {})
      rDel(redisKeys.failedAttempts(userId)).catch(() => {})

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

      return { success: false, locked: true, lockExpiresAt: expiresAt, attemptsUsed: MAX_ATTEMPTS }
    }

    return {
      success:           false,
      locked:            false,
      attemptsRemaining: MAX_ATTEMPTS - attempts,
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
    // Supabase is the source of truth for passcode_hash — always required.
    // Redis calls get a 3s timeout and null fallback so we never hang.
    const [profile, lockData, attempts] = await Promise.all([
      supabase.from('profiles').select('passcode_hash').eq('id', userId).single(),
      withTimeout(rGet<{ expiresAt: string }>(redisKeys.passcodeLock(userId)), 3000, null),
      withTimeout(rGet<number>(redisKeys.failedAttempts(userId)), 3000, null),
    ])

    const isLocked    = !!lockData && new Date(lockData.expiresAt) > new Date()
    const usedAttempts = (typeof attempts === 'number' ? attempts : 0)

    return {
      isSet:             !!profile.data?.passcode_hash,
      isLocked,
      attemptsRemaining: Math.max(0, MAX_ATTEMPTS - usedAttempts),
      lockExpiresAt:     isLocked && lockData ? new Date(lockData.expiresAt) : null,
    }
  } catch (err) {
    console.error('[Passcode] getPasscodeStatus error — falling back to Supabase only', err)
    // Fallback: check Supabase directly, assume no lock (Redis is down)
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
 * Admin unlock — called by org owner to manually clear a lockout.
 */
export async function adminUnlockUser(userId: string): Promise<void> {
  await Promise.all([
    rDel(redisKeys.passcodeLock(userId)),
    rDel(redisKeys.failedAttempts(userId)),
  ])
  await logAudit({
    action:      'unlock',
    entity_type: 'profiles',
    entity_id:   userId,
    description: 'Passcode lockout cleared by admin',
  })
}

// Refresh lock TTL — call this when showing the locked screen to keep
// the expiry accurate for display (the Redis TTL is the source of truth)
export async function refreshLockExpiry(userId: string): Promise<Date | null> {
  const data = await rGet<{ expiresAt: string }>(redisKeys.passcodeLock(userId))
  if (!data) return null
  await rExpire(redisKeys.passcodeLock(userId), LOCK_DURATION_SEC)
  return new Date(data.expiresAt)
}
