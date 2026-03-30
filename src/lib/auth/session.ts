/**
 * App session layer — Redis-backed session on top of the Supabase JWT.
 *
 * Why a separate session?
 *   Supabase Auth handles the JWT (proof of email identity).
 *   The Redis session tracks the *passcode/biometric verification step*
 *   that happens on every app open. A valid Supabase JWT alone is not
 *   enough to access the dashboard — the passcode check must also pass.
 *
 * Session lifecycle:
 *   1. Supabase JWT valid    → show passcode screen
 *   2. Passcode/biometric ok → createAppSession() → store in Redis (24h)
 *   3. Every route change    → validateAppSession() → refresh TTL
 *   4. Sign out / inactivity → destroyAppSession() → delete from Redis
 */

import { rSet, rGet, rDel, rExpire, redisKeys, TTL } from '@/lib/redis'
// NOTE: getOrgSubscription is imported dynamically inside createAppSession()
// to avoid pulling the entire stripe→subscriptionTiers chain into the auth
// initialization chunk, which causes TDZ crashes in Vite production builds.

// ── Types ────────────────────────────────────────────────────────────────────

export interface AppSession {
  sessionId:    string
  userId:       string
  orgId:        string
  role:         string
  tier:         string   // 'free' | 'solo' | 'team' | 'enterprise'
  deviceInfo:   DeviceInfo
  createdAt:    number   // unix ms
  lastActiveAt: number   // unix ms
}

export interface DeviceInfo {
  platform:    string   // 'ios' | 'android' | 'web' | 'desktop'
  userAgent:   string
  appVersion:  string
}

// sessionId is stored in sessionStorage (not localStorage) so it
// clears when the browser tab is closed — forcing re-passcode on reopen.
const SESSION_STORAGE_KEY = 'poweron-session-id'


// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a new app session after successful passcode or biometric auth.
 * Returns the sessionId stored in sessionStorage.
 */
export async function createAppSession(params: {
  userId:   string
  orgId:    string
  role:     string
  deviceInfo: DeviceInfo
}): Promise<string> {
  const sessionId = crypto.randomUUID()

  // Load subscription tier on login so it's available throughout the session.
  // Dynamic import to avoid pulling stripe→subscriptionTiers into the auth chunk
  // (prevents Vite production TDZ crash).
  let tier = 'free'
  try {
    const { getOrgSubscription } = await import('@/services/stripe')
    const sub = await getOrgSubscription(params.orgId)
    tier = sub.isActive ? sub.tierSlug : 'free'
  } catch {
    console.warn('[session] Could not load subscription tier, defaulting to free')
  }

  const session: AppSession = {
    sessionId,
    userId:       params.userId,
    orgId:        params.orgId,
    role:         params.role,
    tier,
    deviceInfo:   params.deviceInfo,
    createdAt:    Date.now(),
    lastActiveAt: Date.now(),
  }

  await rSet(redisKeys.session(sessionId), session, TTL.SESSION)

  // Persist sessionId in sessionStorage (tab-scoped)
  sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId)

  return sessionId
}

/**
 * Validate the current session and refresh its TTL.
 * Call this on every route change to keep active sessions alive.
 * Returns null if the session has expired or doesn't exist.
 */
export async function validateAppSession(): Promise<AppSession | null> {
  const sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY)
  if (!sessionId) return null

  const session = await rGet<AppSession>(redisKeys.session(sessionId))
  if (!session) {
    sessionStorage.removeItem(SESSION_STORAGE_KEY)
    return null
  }

  // Refresh TTL and update lastActiveAt
  const updated: AppSession = { ...session, lastActiveAt: Date.now() }
  await rSet(redisKeys.session(sessionId), updated, TTL.SESSION)

  return updated
}

/**
 * Get current session without refreshing TTL (for reads only).
 */
export async function getAppSession(): Promise<AppSession | null> {
  const sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY)
  if (!sessionId) return null
  return rGet<AppSession>(redisKeys.session(sessionId))
}

/**
 * Destroy the current session (sign out, lock, or inactivity timeout).
 */
export async function destroyAppSession(): Promise<void> {
  const sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY)
  if (sessionId) {
    await rDel(redisKeys.session(sessionId))
  }
  sessionStorage.removeItem(SESSION_STORAGE_KEY)
}

/**
 * Check if we have a valid session right now (synchronous — no network call).
 * Use this for fast initial routing before the async validateAppSession resolves.
 */
export function hasLocalSession(): boolean {
  return !!sessionStorage.getItem(SESSION_STORAGE_KEY)
}

/**
 * Get current device info for session creation.
 */
export function getDeviceInfo(): DeviceInfo {
  const ua = navigator.userAgent

  let platform = 'web'
  if ((window as unknown as Record<string, unknown>)['Capacitor']) {
    const cap = (window as unknown as { Capacitor: { getPlatform: () => string } }).Capacitor
    platform = cap.getPlatform()
  } else if ((window as unknown as Record<string, unknown>)['__TAURI__']) {
    platform = 'desktop'
  }

  return {
    platform,
    userAgent:  ua.slice(0, 200),   // truncate for storage
    appVersion: import.meta.env.VITE_APP_VERSION ?? '0.1.0',
  }
}
