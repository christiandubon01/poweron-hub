/**
 * sessionStoreClient.ts - SEC2
 *
 * Thin client for /.netlify/functions/session-store, which replaced the
 * browser-side Upstash Redis client. The server derives every Redis key from
 * the caller's verified JWT, so this module only ever sends an intent name and
 * a small payload - never a key.
 *
 * Auth headers come from the SEC1 authedFetch helper.
 */

import { authedJsonHeaders } from '@/services/authedFetch'

const ENDPOINT = '/.netlify/functions/session-store'

export class SessionStoreAccessUnavailableError extends Error {
  code: string
  statusCode: number

  constructor(message = 'Access unavailable', statusCode = 403) {
    super(message)
    this.name = 'SessionStoreAccessUnavailableError'
    this.code = 'access_unavailable'
    this.statusCode = statusCode
  }
}

export function isSessionStoreAccessUnavailableError(error: unknown): error is SessionStoreAccessUnavailableError {
  return error instanceof SessionStoreAccessUnavailableError
}

/**
 * Call a session-store intent.
 *
 * Returns null on generic failure (no session, network error, Redis
 * unavailable server-side). Access-unavailable is raised explicitly so auth
 * flows can swap to the generic blocked screen instead of treating it as a
 * transient store outage.
 */
export async function sessionStoreCall<T>(
  intent: string,
  payload: Record<string, unknown> = {},
): Promise<T | null> {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: await authedJsonHeaders(),
      body: JSON.stringify({ intent, ...payload }),
    })

    if (!res.ok) {
      let parsed: Record<string, unknown> | null = null
      try {
        parsed = await res.json()
      } catch {
        parsed = null
      }

      if (parsed?.code === 'access_unavailable') {
        throw new SessionStoreAccessUnavailableError(
          typeof parsed.error === 'string' ? parsed.error : 'Access unavailable',
          res.status,
        )
      }

      console.warn(`[sessionStore] ${intent} -> HTTP ${res.status}`)
      return null
    }

    return (await res.json()) as T
  } catch (err) {
    if (isSessionStoreAccessUnavailableError(err)) {
      throw err
    }
    console.error(`[sessionStore] ${intent} failed`, err)
    return null
  }
}
