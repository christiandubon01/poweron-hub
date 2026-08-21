/**
 * src/services/quickbooks/quickbooksSanitize.ts
 *
 * Architectural boundary between server-only raw OAuth token material and the
 * sanitized result shape safe for the browser/UI.
 *
 * sanitizeTokenSet drops access tokens, refresh tokens, Authorization headers,
 * Basic-auth material, and the client secret — only connected status, realmId,
 * safe company metadata, and connectedAt survive.
 */
import type { QboErrorCategory, QboRawTokenSet, QboSanitizedConnectionResult } from './quickbooksTypes'

export function sanitizeTokenSet(tokenSet: QboRawTokenSet): QboSanitizedConnectionResult {
  // issuedAt ≈ connect time, recovered from the parsed expiry + duration.
  const issuedAt = tokenSet.accessExpiresAt - tokenSet.expiresIn * 1000
  return {
    connected: true,
    realmId: tokenSet.realmId ?? null,
    company: tokenSet.realmId ? { id: tokenSet.realmId, name: null } : null,
    connectedAt: new Date(issuedAt).toISOString(),
    error: null,
  }
}

export function sanitizeFailure(category: QboErrorCategory, message: string): QboSanitizedConnectionResult {
  return {
    connected: false,
    realmId: null,
    company: null,
    connectedAt: null,
    error: { category, message },
  }
}