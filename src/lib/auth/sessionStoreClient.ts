/**
 * sessionStoreClient.ts — SEC2
 *
 * Thin client for /.netlify/functions/session-store, which replaced the
 * browser-side Upstash Redis client. The server derives every Redis key from
 * the caller's verified JWT, so this module only ever sends an intent name and
 * a small payload — never a key.
 *
 * Auth headers come from the SEC1 authedFetch helper.
 */

import { authedJsonHeaders } from '@/services/authedFetch'

const ENDPOINT = '/.netlify/functions/session-store'

/**
 * Call a session-store intent.
 *
 * Returns null on any failure (no session, network error, non-2xx, Redis
 * unavailable server-side). Callers treat null exactly as they used to treat an
 * unavailable Redis: degrade gracefully rather than block the auth flow.
 */
export async function sessionStoreCall<T>(
  intent: string,
  payload: Record<string, unknown> = {}
): Promise<T | null> {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: await authedJsonHeaders(),
      body: JSON.stringify({ intent, ...payload }),
    })

    if (!res.ok) {
      console.warn(`[sessionStore] ${intent} → HTTP ${res.status}`)
      return null
    }

    return (await res.json()) as T
  } catch (err) {
    console.error(`[sessionStore] ${intent} failed`, err)
    return null
  }
}
