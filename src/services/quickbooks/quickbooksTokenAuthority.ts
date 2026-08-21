/**
 * src/services/quickbooks/quickbooksTokenAuthority.ts
 *
 * SERVER-ONLY token authority — the single place future QBO API functions
 * obtain a usable access token for an organization.
 *
 * getValidQboAccessToken(organizationId):
 *   1. Load the org's connection row. If not connected / no credentials -> null.
 *   2. Decrypt the stored access token, refresh token, and realmId server-side.
 *   3. If the access token is sufficiently valid (beyond the refresh skew) ->
 *      return it without refreshing.
 *   4. Otherwise refresh via the existing QBO-1A refreshTokens primitive. The
 *      NEW refresh token returned by Intuit is authoritative — the old one is
 *      never reused.
 *   5. Persist BOTH new provider values (access + refresh) with new expiry
 *      metadata, last_refreshed_at, and token_version incremented by one.
 *   6. Concurrency: the persist is a compare-and-set on token_version
 *      (UPDATE ... WHERE token_version = N). If zero rows matched, another
 *      refresh won the race — reload the connection and return the winner's
 *      current access token. Never overwrite the winner with stale results.
 *   7. Return only the usable access token (+ realmId + environment for the
 *      caller's QBO API call) to calling SERVER code. Never to the browser.
 *
 * realmId is preserved across refresh (Intuit does not reissue it on refresh);
 * the stored encrypted_realm_id is decrypted and returned unchanged.
 *
 * This module is server-only (used by netlify functions + tests); it never
 * returns credentials to the browser.
 */
import { QBO_REFRESH_SKEW_SECONDS } from './quickbooksConstants'
import {
  applyRefreshResult,
  isConnectionUsable,
  loadConnection,
  type QboConnectionRepo,
  type QboRefreshUpdateFields,
} from './quickbooksConnectionStore'
import { refreshTokens, type QboFetchLike } from './quickbooksOAuth'
import { decryptToken, encryptToken } from './quickbooksTokenCrypto'
import type { QboApiEnvironment, QuickBooksConfig } from './quickbooksTypes'

/** Server-only usable credential view returned to calling server code. */
export interface QboValidAccessToken {
  accessToken: string
  realmId: string
  environment: QboApiEnvironment
}

function toIso(ms: number): string {
  return new Date(ms).toISOString()
}

/**
 * Resolve a usable access token for the org, refreshing (with compare-and-set
 * rotation) if needed. Returns null when the org has no usable connection.
 * Propagates a refresh failure (QboOAuthError) to the caller — the stale stored
 * credentials are left untouched so a subsequent call may retry.
 */
export async function getValidQboAccessToken(
  config: QuickBooksConfig,
  encKey: Buffer,
  repo: QboConnectionRepo,
  organizationId: string,
  fetchImpl: QboFetchLike,
  now: Date,
): Promise<QboValidAccessToken | null> {
  const row = await loadConnection(repo, organizationId)
  if (!isConnectionUsable(row)) return null

  const accessToken = decryptToken(row.encryptedAccessToken as string, encKey)
  const refreshToken = decryptToken(row.encryptedRefreshToken as string, encKey)
  const realmId = decryptToken(row.encryptedRealmId as string, encKey)
  const environment = row.environment

  const accessExpiresMs = row.accessTokenExpiresAt ? new Date(row.accessTokenExpiresAt).getTime() : 0
  const msUntilExpiry = accessExpiresMs - now.getTime()

  // Sufficiently valid -> return without refreshing (no provider call).
  if (msUntilExpiry > QBO_REFRESH_SKEW_SECONDS * 1000) {
    return { accessToken, realmId, environment }
  }

  // Near or past expiry -> refresh. The returned refresh token is authoritative.
  const result = await refreshTokens(config, refreshToken, fetchImpl)
  const newTokenSet = result.tokenSet

  // Encrypt the new provider values with a fresh IV per field. The stored
  // encrypted_realm_id is preserved (Intuit does not reissue realmId on refresh).
  const casFields: QboRefreshUpdateFields = {
    encryptedAccessToken: encryptToken(newTokenSet.accessToken, encKey),
    encryptedRefreshToken: encryptToken(newTokenSet.refreshToken, encKey),
    accessTokenExpiresAt: toIso(newTokenSet.accessExpiresAt),
    refreshTokenExpiresAt: newTokenSet.refreshExpiresAt ? toIso(newTokenSet.refreshExpiresAt) : null,
    lastRefreshedAt: now.toISOString(),
  }

  const newVersion = await applyRefreshResult(repo, organizationId, row.tokenVersion, casFields, now)

  if (newVersion === null) {
    // Another refresh won the race. Reload and return the winner's current
    // access token — do NOT overwrite it with our (now stale) refresh result.
    const winner = await loadConnection(repo, organizationId)
    if (!isConnectionUsable(winner)) return null
    const winnerAccess = decryptToken(winner.encryptedAccessToken as string, encKey)
    const winnerRealm = decryptToken(winner.encryptedRealmId as string, encKey)
    return { accessToken: winnerAccess, realmId: winnerRealm, environment: winner.environment }
  }

  return { accessToken: newTokenSet.accessToken, realmId, environment }
}