/**
 * authedFetch.ts — SEC1
 *
 * Shared auth headers for calls to cost-per-call Netlify functions
 * (/.netlify/functions/claude, /blueprintVision, /speak).
 *
 * Those functions verify the caller's Supabase JWT and return 401 without it,
 * so every browser call site must attach the current session token.
 *
 * Mirrors the token-retrieval pattern in services/geocoding/GeocodingClient.ts.
 */

import { supabase } from '@/lib/supabase'

/** Current user's Supabase access token, or null when there is no session. */
export async function getAuthToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token ?? null
  } catch {
    return null
  }
}

/**
 * JSON request headers with the caller's bearer token attached.
 *
 * The Authorization header is omitted when no session exists — the server
 * returns 401 in that case, which is the intended behaviour (an unauthenticated
 * caller must not be able to spend Anthropic/ElevenLabs credits).
 */
export async function authedJsonHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}
