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

// SEC2: session records live in Redis behind /.netlify/functions/session-store.
// The server stamps userId/orgId/role/tier from the caller's profile row and
// refuses any session record that belongs to a different user, so nothing here
// needs the Upstash token — or the stripe chain that used to resolve the tier.
import { sessionStoreCall } from '@/lib/auth/sessionStoreClient'

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
 * Returns the sessionId stored in sessionStorage, or '' if the store was
 * unreachable (the caller must not block login on this — same as before, when a
 * failed Redis write was swallowed).
 *
 * `userId`, `orgId` and `role` are still accepted so callers stay unchanged,
 * but they are no longer sent: the server reads them from the caller's own
 * profile row, so a client cannot mint a session for another org or role.
 */
export async function createAppSession(params: {
  userId:   string
  orgId:    string
  role:     string
  deviceInfo: DeviceInfo
  deviceId?: string
  module?: string
  visibilityState?: string
  /** Prevent a superseded auth operation from replacing a newer tab session. */
  isCurrent?: () => boolean
}): Promise<string> {
  const res = await sessionStoreCall<{ sessionId: string | null }>('session.create', {
    deviceInfo:      params.deviceInfo,
    deviceId:        params.deviceId ?? '',
    module:          params.module ?? 'home',
    visibilityState: params.visibilityState ?? (typeof document !== 'undefined' ? document.visibilityState : 'visible'),
  })

  if (!res?.sessionId) {
    console.warn('[session] Could not create app session — store unreachable')
    return ''
  }

  if (params.isCurrent && !params.isCurrent()) {
    // The server session belongs to the superseded operation. Destroy that exact
    // session, but never touch the sessionStorage entry owned by a newer attempt.
    try { await sessionStoreCall('session.destroy', { sessionId: res.sessionId }) } catch {}
    return res.sessionId
  }

  // Persist sessionId in sessionStorage (tab-scoped)
  sessionStorage.setItem(SESSION_STORAGE_KEY, res.sessionId)

  return res.sessionId
}

/**
 * Validate the current or explicitly expected session and refresh its TTL.
 * Call this on every route change to keep active sessions alive.
 * Returns null if the session has expired or doesn't exist.
 */
export async function validateAppSession(expectedSessionId?: string): Promise<AppSession | null> {
  const sessionId = expectedSessionId ?? sessionStorage.getItem(SESSION_STORAGE_KEY)
  if (!sessionId) return null

  // The server refreshes the TTL and lastActiveAt as part of this call.
  const res = await sessionStoreCall<{ session: AppSession | null }>('session.validate', {
    sessionId,
  })

  // null — could be a network hiccup, a cold start, or genuine expiry.
  // Do NOT remove the session ID — treat as unknown, not expired.
  return res?.session ?? null
}

/**
 * Get current session without refreshing TTL (for reads only).
 */
export async function getAppSession(): Promise<AppSession | null> {
  const sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY)
  if (!sessionId) return null
  const res = await sessionStoreCall<{ session: AppSession | null }>('session.get', {
    sessionId,
  })
  return res?.session ?? null
}

/**
 * Destroy the current session (sign out, lock, or inactivity timeout).
 *
 * Called before supabase.auth.signOut(), so the JWT the store needs is still
 * valid. Untargeted cleanup clears the local key even if the server call fails;
 * targeted cleanup clears it only while that expected session still owns it.
 *
 * Pass `endedReason` to record the termination cause in the persistent presence row.
 */
export async function destroyAppSession(
  expectedSessionId?: string,
  endedReason?: 'signout' | 'manual_lock' | 'inactivity_timeout',
): Promise<void> {
  const storedSessionId = sessionStorage.getItem(SESSION_STORAGE_KEY)
  const sessionId = expectedSessionId ?? storedSessionId
  try {
    if (sessionId) {
      await sessionStoreCall('session.destroy', { sessionId, endedReason: endedReason ?? null })
    }
  } finally {
    // Targeted cleanup must not remove a newer operation's current session ID.
    if (!expectedSessionId || storedSessionId === expectedSessionId) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY)
    }
  }
}

/**
 * Get the current tab's session ID (tab-scoped, from sessionStorage).
 */
export function getCurrentSessionId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY)
  } catch {
    return null
  }
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
