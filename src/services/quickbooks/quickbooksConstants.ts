/**
 * src/services/quickbooks/quickbooksConstants.ts
 *
 * Intuit QuickBooks Online OAuth 2.0 endpoints and constants.
 * Source: Intuit developer documentation (OAuth 2.0).
 */

/** Authorization endpoint — user consent / sign-in. */
export const QBO_AUTHORIZATION_ENDPOINT = 'https://appcenter.intuit.com/connect/oauth2'

/** Token endpoint — code exchange and refresh. Requires Basic auth. */
export const QBO_TOKEN_ENDPOINT = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'

/** Revocation endpoint — disconnect / revoke a token. Requires Basic auth. */
export const QBO_REVOKE_ENDPOINT = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'

/** QuickBooks Online Accounting scope — the only scope requested. */
export const QBO_ACCOUNTING_SCOPE = 'com.intuit.quickbooks.accounting'

/** Signed-state envelope version (reject envelopes with a different version). */
export const QBO_STATE_VERSION = 1

/** Default signed-state lifetime: 10 minutes. */
export const QBO_STATE_TTL_SECONDS = 10 * 60

/**
 * QuickBooks Online REST API base URLs (CompanyInfo / query reads). The OAuth
 * authorize/token/revoke endpoints are shared across environments; only the
 * accounting API base differs between sandbox and production. Stored per
 * connection record so a sandbox credential is never treated as production.
 */
export const QBO_API_BASE_PRODUCTION = 'https://quickbooks.api.intuit.com'
export const QBO_API_BASE_SANDBOX = 'https://sandbox-quickbooks.api.intuit.com'

/** QBO API minorversion for read queries (CompanyInfo). */
export const QBO_API_MINOR_VERSION = 70

/**
 * Refresh skew: if the access token expires within this many seconds, treat it
 * as near-expiry and refresh proactively. Keeps server callers from receiving a
 * token that is already stale by the time it reaches the provider.
 */
export const QBO_REFRESH_SKEW_SECONDS = 60

/** Versioned encrypted-envelope prefix (AES-256-GCM token-at-rest format). */
export const QBO_TOKEN_ENVELOPE_VERSION = 'v1'