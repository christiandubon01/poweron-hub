/**
 * src/services/bankProvider/plaidConfig.ts
 *
 * SERVER-ONLY Plaid configuration. The environment is explicit and fails closed: only "sandbox" or "production" are accepted (never "development",
 * never a default, never inferred from the secret). A Production configuration changes nothing else: the same read-only flow, the same owner
 * authority, the same server-held encrypted tokens, and no adoption of any transaction into a canonical record.
 *
 * Server env (never VITE_*, never returned to the browser):
 *   PLAID_ENV         exactly "sandbox" or "production"
 *   PLAID_CLIENT_ID   Plaid client id
 *   PLAID_SECRET      the Plaid secret FOR THAT ENVIRONMENT (Sandbox and Production secrets differ)
 *   PLAID_WEBHOOK_URL optional https URL of the plaid-webhook function; when absent new Items simply have no webhook (BANK-4)
 *   PLAID_REDIRECT_URI optional https URL registered in the Plaid dashboard; REQUIRED by Plaid for OAuth banks (e.g. Wells Fargo) to complete sign-in
 *   POWERON_BANK_TOKEN_ENCRYPTION_KEY   (see providerTokenCrypto.ts)
 */
export const PLAID_ENV_VAR = 'PLAID_ENV'
export const PLAID_CLIENT_ID_VAR = 'PLAID_CLIENT_ID'
export const PLAID_SECRET_VAR = 'PLAID_SECRET'
export const PLAID_WEBHOOK_URL_VAR = 'PLAID_WEBHOOK_URL'
export const PLAID_REDIRECT_URI_VAR = 'PLAID_REDIRECT_URI'

export type PlaidEnvironmentName = 'sandbox' | 'production'
export const isPlaidEnvironment = (v: unknown): v is PlaidEnvironmentName => v === 'sandbox' || v === 'production'

export interface PlaidConfig {
  environment: PlaidEnvironmentName
  clientId: string
  secret: string
  /** Shown in Plaid Link. Plaid truncates names over 30 characters. */
  clientName: string
  countryCodes: ['US']
  language: 'en'
  /**
   * Transactions is initialized at Link (a new Item needs at least one entry in `products`, and Transactions is the only product Cash OS needs).
   * Transactions are retrieved only by the owner-triggered /transactions/sync (BANK-4). Production Transactions is billed per Item: a Production Item
   * is created only when the owner starts Link, never automatically.
   */
  products: ['transactions']
  /** Locked owner decision: 90-day history, set at Link initialization (transactions.days_requested in /link/token/create); Plaid fixes it once Transactions is added to an Item. */
  transactionsDaysRequested: 90
  /** Optional (BANK-4): where Plaid sends Transactions webhooks for NEW Items. A webhook is only a nudge; /transactions/sync is the truth. */
  webhookUrl: string | null
  /** Where an OAuth bank sends the owner back to Cash OS. Null = not configured (non-OAuth banks still work). */
  redirectUri: string | null
}

/** Names the missing/invalid variable but never carries a value. */
export class PlaidConfigError extends Error {
  readonly variable: string
  readonly reason: 'missing' | 'unsupported_environment' | 'invalid'
  constructor(variable: string, reason: 'missing' | 'unsupported_environment' | 'invalid') {
    super(reason === 'missing' ? `Plaid configuration missing: ${variable}` : reason === 'invalid' ? `Plaid configuration invalid: ${variable}` : `Unsupported Plaid environment (use sandbox or production): ${variable}`)
    this.name = 'PlaidConfigError'
    this.variable = variable
    this.reason = reason
  }
}

export function loadPlaidConfig(env: Record<string, string | undefined>): PlaidConfig {
  const environment = (env[PLAID_ENV_VAR] ?? '').trim().toLowerCase()
  if (!environment) throw new PlaidConfigError(PLAID_ENV_VAR, 'missing')
  if (!isPlaidEnvironment(environment)) throw new PlaidConfigError(PLAID_ENV_VAR, 'unsupported_environment')
  const clientId = (env[PLAID_CLIENT_ID_VAR] ?? '').trim()
  if (!clientId) throw new PlaidConfigError(PLAID_CLIENT_ID_VAR, 'missing')
  const secret = (env[PLAID_SECRET_VAR] ?? '').trim()
  if (!secret) throw new PlaidConfigError(PLAID_SECRET_VAR, 'missing')
  const webhookRaw = (env[PLAID_WEBHOOK_URL_VAR] ?? '').trim()
  if (webhookRaw && !/^https:\/\/[^\s]{4,500}$/.test(webhookRaw)) throw new PlaidConfigError(PLAID_WEBHOOK_URL_VAR, 'invalid')
  const redirectRaw = (env[PLAID_REDIRECT_URI_VAR] ?? '').trim()
  if (redirectRaw && !/^https:\/\/[^\s?#]{4,500}$/.test(redirectRaw)) throw new PlaidConfigError(PLAID_REDIRECT_URI_VAR, 'invalid')
  return { environment, clientId, secret, clientName: 'Power On Hub', countryCodes: ['US'], language: 'en',
    products: ['transactions'], transactionsDaysRequested: 90, webhookUrl: webhookRaw || null, redirectUri: redirectRaw || null }
}
