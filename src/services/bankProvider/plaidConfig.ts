/**
 * src/services/bankProvider/plaidConfig.ts
 *
 * SERVER-ONLY Plaid configuration. BANK-2 is SANDBOX ONLY: any other environment fails closed (it never silently
 * defaults, and production is refused outright until a later, separately reviewed phase).
 *
 * Server env (never VITE_*, never returned to the browser):
 *   PLAID_ENV         must be exactly "sandbox"
 *   PLAID_CLIENT_ID   Plaid client id
 *   PLAID_SECRET      Plaid SANDBOX secret
 *   POWERON_BANK_TOKEN_ENCRYPTION_KEY   (see providerTokenCrypto.ts)
 */
export const PLAID_ENV_VAR = 'PLAID_ENV'
export const PLAID_CLIENT_ID_VAR = 'PLAID_CLIENT_ID'
export const PLAID_SECRET_VAR = 'PLAID_SECRET'

export type PlaidEnvironmentName = 'sandbox'

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
   * BANK-2 still RETRIEVES no transaction data: /transactions/sync is BANK-4. Production Transactions is subscription-billed per Item, so
   * Plaid Production must NOT be enabled without a separate owner-approved production-enablement checkpoint (current pricing/product access).
   */
  products: ['transactions']
  /** Locked owner decision: 90-day history, set at Link initialization (transactions.days_requested in /link/token/create); Plaid fixes it once Transactions is added to an Item. */
  transactionsDaysRequested: 90
}

/** Names the missing/invalid variable but never carries a value. */
export class PlaidConfigError extends Error {
  readonly variable: string
  readonly reason: 'missing' | 'unsupported_environment'
  constructor(variable: string, reason: 'missing' | 'unsupported_environment') {
    super(reason === 'missing' ? `Plaid configuration missing: ${variable}` : `Unsupported Plaid environment (BANK-2 allows sandbox only): ${variable}`)
    this.name = 'PlaidConfigError'
    this.variable = variable
    this.reason = reason
  }
}

export function loadPlaidConfig(env: Record<string, string | undefined>): PlaidConfig {
  const environment = (env[PLAID_ENV_VAR] ?? '').trim().toLowerCase()
  if (!environment) throw new PlaidConfigError(PLAID_ENV_VAR, 'missing')
  if (environment !== 'sandbox') throw new PlaidConfigError(PLAID_ENV_VAR, 'unsupported_environment')
  const clientId = (env[PLAID_CLIENT_ID_VAR] ?? '').trim()
  if (!clientId) throw new PlaidConfigError(PLAID_CLIENT_ID_VAR, 'missing')
  const secret = (env[PLAID_SECRET_VAR] ?? '').trim()
  if (!secret) throw new PlaidConfigError(PLAID_SECRET_VAR, 'missing')
  return { environment: 'sandbox', clientId, secret, clientName: 'Power On Hub', countryCodes: ['US'], language: 'en',
    products: ['transactions'], transactionsDaysRequested: 90 }
}
