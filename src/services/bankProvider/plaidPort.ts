/**
 * src/services/bankProvider/plaidPort.ts
 *
 * SERVER-ONLY. A narrow port for the six Plaid calls BANK-2/BANK-3 need, plus the official-SDK adapter.
 * The connection service depends on the PORT (so tests use fakes and never reach the network); only this file imports `plaid`.
 *
 * Every adapter method returns a minimal, explicitly selected shape. Raw SDK responses are never passed on, never logged and
 * never persisted. Plaid failures are reduced to a sanitized { code, type, httpStatus } with no message body or credentials.
 *
 * Calls used (verified against current Plaid docs): /link/token/create, /item/public_token/exchange, /item/get,
 * /institutions/get_by_id, /item/remove, /accounts/get (BANK-3), and (BANK-4) /transactions/sync + /webhook_verification_key/get.
 * NOT used anywhere: /transactions/get, /transactions/refresh, /sandbox/* .
 */
import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products } from 'plaid'
import type { PlaidConfig } from './plaidConfig'

export class PlaidApiFailure extends Error {
  readonly code: string
  readonly type: string
  readonly httpStatus: number | null
  constructor(code: string, type: string, httpStatus: number | null) {
    super(`Plaid request failed: ${type}/${code}`)
    this.name = 'PlaidApiFailure'
    this.code = code
    this.type = type
    this.httpStatus = httpStatus
  }
}

/** The provider answered, but the answer could not be read in the expected shape (a bug or an API change). Carries nothing from the response. */
export class ProviderResponseError extends Error {
  constructor() { super('provider response could not be read'); this.name = 'ProviderResponseError' }
}

export interface LinkTokenResult { linkToken: string; expiration: string }
export interface ExchangeResult { accessToken: string; itemId: string }
export interface ItemSummary { itemId: string; institutionId: string | null; hasError: boolean }

/**
 * BANK-4: the ONLY transaction fields that leave this adapter (explicitly picked, never spread). Everything else Plaid returns
 * (location, payment_meta, counterparties, logo/website, account_owner, running_balance, merchant ids, ...) is discarded here.
 */
export interface SyncedTransaction {
  transactionId: string
  accountId: string
  /** Plaid's amount exactly as reported: POSITIVE = money out of the account (or a charge on a credit account), NEGATIVE = money in. */
  amount: number | null
  currency: string | null
  date: string | null
  authorizedDate: string | null
  name: string | null
  merchantName: string | null
  pending: boolean
  pendingTransactionId: string | null
  categoryPrimary: string | null
  categoryDetailed: string | null
  categoryConfidence: string | null
}
export interface SyncPage {
  added: SyncedTransaction[]
  modified: SyncedTransaction[]
  removed: Array<{ transactionId: string; accountId: string | null }>
  nextCursor: string
  hasMore: boolean
  updateStatus: string | null
  accounts: Array<{ accountId: string; currency: string | null }>
}
export interface WebhookVerificationKey { kid: string; alg: string; kty: string; crv: string; x: string; y: string; expiredAt: number | null }

/** The ONLY account fields that leave this adapter. Balances are deliberately absent: only the ISO currency code is read from them. */
export interface ProviderAccountSummary {
  accountId: string
  name: string | null
  officialName: string | null
  mask: string | null
  type: string | null
  subtype: string | null
  currency: string | null
}

export interface BankPlaidPort {
  /** New connection (no accessToken) or update mode (accessToken of the existing Item, no products). */
  createLinkToken(input: { clientUserId: string; accessToken?: string }): Promise<LinkTokenResult>
  exchangePublicToken(publicToken: string): Promise<ExchangeResult>
  getItem(accessToken: string): Promise<ItemSummary>
  getInstitutionName(institutionId: string): Promise<string | null>
  /** /accounts/get: the accounts at the Item (free; not tied to any product). Returns an allowlisted shape, never the raw response or any balance. */
  getAccounts(accessToken: string): Promise<ProviderAccountSummary[]>
  /** /transactions/sync, ONE page. `cursor` null = first call for the Item. Returns an allowlisted page, never the raw response. */
  syncTransactions(input: { accessToken: string; cursor: string | null; count: number }): Promise<SyncPage>
  /** /webhook_verification_key/get: the public key used to verify a webhook's signed JWT. */
  getWebhookVerificationKey(keyId: string): Promise<WebhookVerificationKey>
  /** Removes the Item at Plaid. An Item that is already gone is treated as success (idempotent). */
  removeItem(accessToken: string): Promise<void>
}

/** Plaid error codes meaning "this Item/token no longer exists at Plaid": removing again is a successful no-op. */
const ALREADY_REMOVED_CODES = new Set(['ITEM_NOT_FOUND', 'INVALID_ACCESS_TOKEN'])

function sanitize(error: unknown): PlaidApiFailure {
  const data = (error as { response?: { data?: { error_code?: unknown; error_type?: unknown }; status?: unknown } })?.response
  const code = typeof data?.data?.error_code === 'string' ? data.data.error_code : 'UNKNOWN'
  const type = typeof data?.data?.error_type === 'string' ? data.data.error_type : 'UNKNOWN'
  const status = typeof data?.status === 'number' ? data.status : null
  return new PlaidApiFailure(code.slice(0, 64), type.slice(0, 64), status)
}

export function createPlaidSdkPort(config: PlaidConfig, apiOverride?: PlaidApi): BankPlaidPort {
  const api = apiOverride ?? new PlaidApi(new Configuration({
    basePath: PlaidEnvironments[config.environment],
    baseOptions: { headers: { 'PLAID-CLIENT-ID': config.clientId, 'PLAID-SECRET': config.secret } },
  }))
  const call = async <T>(fn: () => Promise<T>): Promise<T> => { try { return await fn() } catch (error) { throw sanitize(error) } }

  return {
    async createLinkToken({ clientUserId, accessToken }) {
      const base = { user: { client_user_id: clientUserId }, client_name: config.clientName, country_codes: [CountryCode.Us], language: config.language, ...(config.redirectUri ? { redirect_uri: config.redirectUri } : {}) }
      // Update mode is triggered by the Item's access token and carries NO products (per Plaid docs).
      const request = accessToken
        ? { ...base, access_token: accessToken }
        : { ...base, products: [Products.Transactions], transactions: { days_requested: config.transactionsDaysRequested }, ...(config.webhookUrl ? { webhook: config.webhookUrl } : {}) } // Transactions is initialized at Link; the optional webhook URL is only a nudge (BANK-4)
      const { data } = await call(() => api.linkTokenCreate(request))
      return { linkToken: data.link_token, expiration: data.expiration }
    },
    async exchangePublicToken(publicToken) {
      const { data } = await call(() => api.itemPublicTokenExchange({ public_token: publicToken }))
      return { accessToken: data.access_token, itemId: data.item_id }
    },
    async getItem(accessToken) {
      const { data } = await call(() => api.itemGet({ access_token: accessToken }))
      return { itemId: data.item.item_id, institutionId: data.item.institution_id ?? null, hasError: !!data.item.error }
    },
    async getInstitutionName(institutionId) {
      try {
        const { data } = await api.institutionsGetById({ institution_id: institutionId, country_codes: [CountryCode.Us] })
        const name = data.institution?.name
        return typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : null
      } catch {
        return null // a display name is optional; the institution id alone is enough to connect
      }
    },
    async getAccounts(accessToken) {
      const { data } = await call(() => api.accountsGet({ access_token: accessToken }))
      const text = (v: unknown) => (typeof v === 'string' ? v : null)
      return (data.accounts ?? []).map(a => ({
        accountId: String(a.account_id), name: text(a.name), officialName: text(a.official_name), mask: text(a.mask),
        type: text(a.type), subtype: text(a.subtype), currency: text(a.balances?.iso_currency_code),
      }))
    },
    async syncTransactions({ accessToken, cursor, count }) {
      const { data } = await call(() => api.transactionsSync({
        access_token: accessToken, ...(cursor ? { cursor } : {}), count,
        options: { include_personal_finance_category: true }, // no original description, logos or counterparties are requested
      }))
      const str = (v: unknown) => (typeof v === 'string' ? v : null)
      const pick = (t: any): SyncedTransaction => ({
        transactionId: String(t.transaction_id), accountId: String(t.account_id),
        amount: typeof t.amount === 'number' && Number.isFinite(t.amount) ? t.amount : null,
        currency: str(t.iso_currency_code), date: str(t.date), authorizedDate: str(t.authorized_date),
        name: str(t.name), merchantName: str(t.merchant_name), pending: t.pending === true, pendingTransactionId: str(t.pending_transaction_id),
        categoryPrimary: str(t.personal_finance_category?.primary), categoryDetailed: str(t.personal_finance_category?.detailed),
        categoryConfidence: str(t.personal_finance_category?.confidence_level),
      })
      try {
      return {
        added: (data.added ?? []).map(pick), modified: (data.modified ?? []).map(pick),
        removed: (data.removed ?? []).map((r: any) => ({ transactionId: String(r.transaction_id), accountId: str(r.account_id) })),
        nextCursor: typeof data.next_cursor === 'string' ? data.next_cursor : '', hasMore: data.has_more === true,
        updateStatus: str(data.transactions_update_status),
        accounts: (data.accounts ?? []).map((a: any) => ({ accountId: String(a.account_id), currency: str(a.balances?.iso_currency_code) })),
      }
      } catch { throw new ProviderResponseError() }
    },
    async getWebhookVerificationKey(keyId) {
      const { data } = await call(() => api.webhookVerificationKeyGet({ key_id: keyId }))
      const k: any = data.key
      return { kid: String(k.kid), alg: String(k.alg), kty: String(k.kty), crv: String(k.crv), x: String(k.x), y: String(k.y), expiredAt: typeof k.expired_at === 'number' ? k.expired_at : null }
    },
    async removeItem(accessToken) {
      try {
        await api.itemRemove({ access_token: accessToken })
      } catch (error) {
        const failure = sanitize(error)
        if (!ALREADY_REMOVED_CODES.has(failure.code)) throw failure
      }
    },
  }
}
