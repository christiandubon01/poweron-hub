/**
 * src/services/quickbooks/quickbooksOAuth.ts
 *
 * QuickBooks Online OAuth 2.0 primitives:
 *  - authorization URL builder (Accounting scope, signed state)
 *  - authorization-code → token exchange
 *  - refresh-token request (with rotation)
 *  - revoke / disconnect request
 *
 * SECURITY: client credentials are injected via `config` (built server-side
 * from process.env by the Netlify handler). This module never reads process.env,
 * never logs credentials, and returns raw token material ONLY as QboRawTokenSet
 * (server-only). Sanitize via quickbooksSanitize before any browser-bound path.
 *
 * Network access is injected (`fetchImpl`) so the pure logic is testable without
 * a network and without referencing the global `fetch` in browser-bundled code.
 */
import { Buffer } from 'node:buffer'
import {
  QBO_ACCOUNTING_SCOPE,
  QBO_AUTHORIZATION_ENDPOINT,
  QBO_REVOKE_ENDPOINT,
  QBO_TOKEN_ENDPOINT,
} from './quickbooksConstants'
import { signState } from './quickbooksState'
import type { QboRawTokenSet, QboSanitizedError, QboSignedState, QuickBooksConfig } from './quickbooksTypes'

/** Minimal fetch shape injected into token operations. */
export interface QboFetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
  text(): Promise<string>
}
export type QboFetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<QboFetchResponse>

/**
 * Sanitized OAuth operation error. The raw provider detail is retained
 * server-side only via `.detail`; `toSanitized()` yields a browser-safe error.
 */
export class QboOAuthError extends Error {
  readonly category: QboSanitizedError['category']
  readonly detail: string
  constructor(category: QboSanitizedError['category'], message: string, detail = '') {
    super(message)
    this.name = 'QboOAuthError'
    this.category = category
    this.detail = detail
  }
  toSanitized(): QboSanitizedError {
    return { category: this.category, message: this.message }
  }
}

function basicAuthHeader(config: QuickBooksConfig): string {
  return 'Basic ' + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
}

function tokenHeaders(config: QuickBooksConfig): Record<string, string> {
  return {
    Authorization: basicAuthHeader(config),
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
  }
}

/**
 * Build the QuickBooks Online authorization URL for the Accounting scope.
 * The OAuth state is signed and bound to the PowerOn user/org context.
 */
export function buildAuthorizationUrl(
  config: QuickBooksConfig,
  ctx: { userId: string; orgId: string },
  options?: { now?: number; nonce?: string },
): { url: string; state: QboSignedState } {
  const state = signState(ctx, config.stateSecret, options)
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    scope: QBO_ACCOUNTING_SCOPE,
    redirect_uri: config.redirectUri,
    state: state.state,
  })
  return { url: `${QBO_AUTHORIZATION_ENDPOINT}?${params.toString()}`, state }
}

/**
 * Parse an Intuit token response into a QboRawTokenSet. Throws on missing
 * required token fields. SERVER-ONLY output — never return to the browser.
 */
export function parseTokenResponse(json: unknown, now: number, realmId?: string): QboRawTokenSet {
  const obj = (json ?? {}) as Record<string, unknown>
  const accessToken = typeof obj.access_token === 'string' ? obj.access_token : ''
  const refreshToken = typeof obj.refresh_token === 'string' ? obj.refresh_token : ''
  const tokenType = typeof obj.token_type === 'string' ? obj.token_type : 'bearer'
  const expiresIn = Number(obj.expires_in)
  if (!accessToken || !refreshToken || !Number.isFinite(expiresIn)) {
    throw new QboOAuthError('token_exchange_failed', 'QuickBooks token response was missing required fields.')
  }
  const tokenSet: QboRawTokenSet = {
    accessToken,
    refreshToken,
    tokenType,
    expiresIn,
    accessExpiresAt: now + expiresIn * 1000,
    realmId,
  }
  const refreshExp = obj.x_refresh_token_expires_in
  if (refreshExp !== undefined && refreshExp !== null) {
    const n = Number(refreshExp)
    if (Number.isFinite(n)) {
      tokenSet.refreshTokenExpiresIn = n
      tokenSet.refreshExpiresAt = now + n * 1000
    }
  }
  return tokenSet
}

async function readProviderDetail(res: QboFetchResponse): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

/** Exchange an authorization code for a raw token set. SERVER-ONLY result. */
export async function exchangeAuthorizationCode(
  config: QuickBooksConfig,
  code: string,
  realmId: string,
  fetchImpl: QboFetchLike,
): Promise<QboRawTokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
  })
  const res = await fetchImpl(QBO_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: tokenHeaders(config),
    body: body.toString(),
  })
  if (!res.ok) {
    throw new QboOAuthError('token_exchange_failed', 'QuickBooks token exchange failed.', await readProviderDetail(res))
  }
  return parseTokenResponse(await res.json(), Date.now(), realmId)
}

/** Result of a refresh. The new token set is authoritative. */
export interface QboRefreshResult {
  /** The new authoritative token set. Read the refresh token from here after rotation. */
  tokenSet: QboRawTokenSet
  /** True when Intuit issued a new refresh-token value (rotation). */
  rotated: boolean
}

/**
 * Refresh the access token. The returned tokenSet.refreshToken is the new
 * authoritative refresh token; the input token must not be reused afterward.
 * The shape intentionally exposes only the new token set, so callers cannot
 * accidentally keep referencing the stale refresh token.
 */
export async function refreshTokens(
  config: QuickBooksConfig,
  currentRefreshToken: string,
  fetchImpl: QboFetchLike,
): Promise<QboRefreshResult> {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: currentRefreshToken })
  const res = await fetchImpl(QBO_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: tokenHeaders(config),
    body: body.toString(),
  })
  if (!res.ok) {
    throw new QboOAuthError('refresh_failed', 'QuickBooks token refresh failed.', await readProviderDetail(res))
  }
  const tokenSet = parseTokenResponse(await res.json(), Date.now())
  return { tokenSet, rotated: tokenSet.refreshToken !== currentRefreshToken }
}

/**
 * Revoke (disconnect) a token. Fails closed: any provider/network error throws
 * a sanitized QboOAuthError rather than reporting success. Never returns
 * credential material.
 */
export async function revokeTokens(
  config: QuickBooksConfig,
  token: string,
  fetchImpl: QboFetchLike,
): Promise<{ revoked: boolean }> {
  const body = new URLSearchParams({ token })
  let res: QboFetchResponse
  try {
    res = await fetchImpl(QBO_REVOKE_ENDPOINT, {
      method: 'POST',
      headers: tokenHeaders(config),
      body: body.toString(),
    })
  } catch {
    throw new QboOAuthError('revoke_failed', 'QuickBooks disconnect request failed.')
  }
  if (!res.ok) {
    throw new QboOAuthError('revoke_failed', 'QuickBooks disconnect failed.', await readProviderDetail(res))
  }
  return { revoked: true }
}

/**
 * Detailed revoke result for disconnect, which must distinguish a transient
 * provider/network failure (do NOT falsely mark disconnected — owner may retry)
 * from an already-revoked/invalid token (access is gone — normalize to
 * disconnected). Unlike revokeTokens, this does not throw on a provider HTTP
 * error; it returns the status so the caller can decide. It still throws
 * (QboOAuthError 'revoke_failed') only on a network failure.
 */
export type QboRevokeDetailResult =
  | { revoked: true }
  | { revoked: false; status: number }

export async function revokeTokensDetail(
  config: QuickBooksConfig,
  token: string,
  fetchImpl: QboFetchLike,
): Promise<QboRevokeDetailResult> {
  const body = new URLSearchParams({ token })
  let res: QboFetchResponse
  try {
    res = await fetchImpl(QBO_REVOKE_ENDPOINT, {
      method: 'POST',
      headers: tokenHeaders(config),
      body: body.toString(),
    })
  } catch {
    // Network/server-unreachable failure is transient — surface as a thrown
    // sanitized error so the caller does not falsely mark disconnected.
    throw new QboOAuthError('revoke_failed', 'QuickBooks disconnect request failed.')
  }
  if (!res.ok) {
    // Provider responded with an HTTP error. The caller inspects status: 400/401
    // typically means the token is already invalid/revoked (access gone ->
    // normalize to disconnected); 5xx is transient (fail safely, do not mark).
    return { revoked: false, status: res.status }
  }
  return { revoked: true }
}