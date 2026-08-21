/**
 * src/services/quickbooks/quickbooksTypes.ts
 *
 * QuickBooks Online OAuth 2.0 — shared types and sanitized result model.
 *
 * SERVER-ONLY CONTEXT: these types describe the QuickBooks connection flow.
 * The raw token types (QboRawTokenSet) carry credential material and must
 * never be returned to the browser. Only QboSanitizedConnectionResult is safe
 * for client consumption. This module defines types only — it reads no
 * environment and touches no secrets.
 */

/** Server-side QuickBooks OAuth configuration. Built by loadQuickBooksConfig. */
export interface QuickBooksConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  stateSecret: string
}

/** Environment keys required for QuickBooks OAuth. */
export type QuickBooksConfigKey =
  | 'INTUIT_CLIENT_ID'
  | 'INTUIT_CLIENT_SECRET'
  | 'INTUIT_REDIRECT_URI'
  | 'INTUIT_OAUTH_STATE_SECRET'

/**
 * Raised when a required server-side configuration key is missing.
 * Fail-closed: names the missing key but never carries a secret value.
 */
export class QuickBooksConfigError extends Error {
  readonly missingKey: QuickBooksConfigKey
  constructor(missingKey: QuickBooksConfigKey) {
    super(`QuickBooks configuration missing: ${missingKey}`)
    this.name = 'QuickBooksConfigError'
    this.missingKey = missingKey
  }
}

/** PowerOn user/org context bound into a signed OAuth state envelope. */
export interface QboStateContext {
  userId: string
  orgId: string
}

/** A signed, stateless OAuth state envelope returned to the caller. */
export interface QboSignedState {
  /** Opaque token to send as the OAuth `state` parameter. */
  state: string
  nonce: string
  expiresAt: number
}

/**
 * RAW token material returned by Intuit. SERVER-ONLY — never serialize into a
 * response, log, BackupData, or browser store. Confined to server QuickBooks code.
 */
export interface QboRawTokenSet {
  accessToken: string
  refreshToken: string
  tokenType: string
  /** Seconds until the access token expires. */
  expiresIn: number
  /** Seconds until the refresh token expires, when Intuit provides it. */
  refreshTokenExpiresIn?: number
  /** Epoch ms at which the access token expires (derived at parse time). */
  accessExpiresAt: number
  /** Epoch ms at which the refresh token expires, when known. */
  refreshExpiresAt?: number
  /** QuickBooks company id accompanying a code exchange. NOT a PowerOn org id. */
  realmId?: string
}

/** Raw QuickBooks OAuth callback query parameters. */
export interface QboCallbackInput {
  state?: string | null
  code?: string | null
  realmId?: string | null
  error?: string | null
  errorDescription?: string | null
}

/** Safe, non-secret error categories surfaced to the browser/UI. */
export type QboErrorCategory =
  | 'provider_denied'
  | 'missing_state'
  | 'invalid_state'
  | 'expired_state'
  | 'missing_context'
  | 'missing_code'
  | 'missing_realm_id'
  | 'config_error'
  | 'token_exchange_failed'
  | 'refresh_failed'
  | 'revoke_failed'

/** Sanitized error safe for client consumption. Never includes secret material. */
export interface QboSanitizedError {
  category: QboErrorCategory
  message: string
}

/**
 * Sanitized connection result — the ONLY shape future UI may consume.
 * Deliberately excludes access tokens, refresh tokens, Authorization headers,
 * Basic-auth material, and the client secret.
 */
export interface QboSanitizedConnectionResult {
  connected: boolean
  realmId: string | null
  company?: { id: string; name?: string | null } | null
  connectedAt?: string | null
  error?: QboSanitizedError | null
}

/**
 * QuickBooks API environment. The OAuth authorize/token/revoke endpoints are
 * shared; this selects the accounting API base URL (sandbox vs production) used
 * for read queries such as CompanyInfo. Stored per connection record so a
 * sandbox credential is never accidentally treated as production.
 */
export type QboApiEnvironment = 'sandbox' | 'production'

/**
 * Sanitized connection STATUS — the minimal, browser-safe shape returned by the
 * qbo-connection-status endpoint and consumed by the QuickBooks menu. Carries no
 * realmId, no tokens, no encrypted blobs, no expiry, no technical metadata.
 * Disconnected returns only `{ connected: false }`.
 */
export type QboSanitizedConnectionStatus =
  | { connected: false }
  | { connected: true; companyName: string | null; connectedAt: string | null }