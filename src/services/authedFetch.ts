/**
 * authedFetch.ts — SEC1
 *
 * Shared auth headers for calls to cost-per-call Netlify functions
 * (/.netlify/functions/claude, /blueprintVision, /speak, /whisper).
 *
 * Those functions verify the caller's Supabase JWT and return 401 without it,
 * so every browser call site must attach the current session token.
 *
 * Mirrors the token-retrieval pattern in services/geocoding/GeocodingClient.ts,
 * with a refresh-before-use step so an expired access_token is not sent while
 * a refresh_token is still available (common on long-lived desktop sessions and
 * localhost:8888 after the UI already passed passcode/Redis resume).
 */

import { supabase } from '@/lib/supabase'

/** Refresh when the access token is missing or within this window of expiry. */
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000

function accessTokenNeedsRefresh(session: {
  access_token?: string | null
  expires_at?: number | null
} | null): boolean {
  if (!session?.access_token) return true
  if (typeof session.expires_at !== 'number') return false
  return session.expires_at * 1000 <= Date.now() + ACCESS_TOKEN_REFRESH_SKEW_MS
}

/**
 * Current user's Supabase access token, or null when there is no usable session.
 *
 * Prefer a freshly refreshed token when the stored access_token is missing or
 * near expiry. Does not invent credentials and does not bypass server auth —
 * if refresh fails and no valid token remains, callers omit Authorization and
 * Netlify functions correctly return 401.
 */
export async function getAuthToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    let session = data?.session ?? null

    if (accessTokenNeedsRefresh(session)) {
      const { data: refreshed, error } = await supabase.auth.refreshSession()
      if (!error && refreshed?.session?.access_token) {
        session = refreshed.session
      } else if (!session?.access_token) {
        return null
      } else if (
        typeof session.expires_at === 'number' &&
        session.expires_at * 1000 <= Date.now()
      ) {
        // Expired access token and refresh failed — do not send a dead JWT.
        return null
      }
    }

    return session?.access_token ?? null
  } catch {
    return null
  }
}

/**
 * JSON request headers with the caller's bearer token attached.
 *
 * The Authorization header is omitted when no session exists — the server
 * returns 401 in that case, which is the intended behaviour (an unauthenticated
 * caller must not be able to spend Anthropic/ElevenLabs/OpenAI credits).
 */
export async function authedJsonHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}
