/**
 * src/services/bankProvider/plaidPort.ts
 *
 * SERVER-ONLY. A narrow port for the five Plaid calls BANK-2 needs, plus the official-SDK adapter.
 * The connection service depends on the PORT (so tests use fakes and never reach the network); only this file imports `plaid`.
 *
 * Every adapter method returns a minimal, explicitly selected shape. Raw SDK responses are never passed on, never logged and
 * never persisted. Plaid failures are reduced to a sanitized { code, type, httpStatus } with no message body or credentials.
 *
 * Calls used (verified against current Plaid docs): /link/token/create, /item/public_token/exchange, /item/get,
 * /institutions/get_by_id, /item/remove. NOT used in BANK-2: /transactions/*, /accounts/*, /sandbox/* .
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

export interface LinkTokenResult { linkToken: string; expiration: string }
export interface ExchangeResult { accessToken: string; itemId: string }
export interface ItemSummary { itemId: string; institutionId: string | null; hasError: boolean }

export interface BankPlaidPort {
  /** New connection (no accessToken) or update mode (accessToken of the existing Item, no products). */
  createLinkToken(input: { clientUserId: string; accessToken?: string }): Promise<LinkTokenResult>
  exchangePublicToken(publicToken: string): Promise<ExchangeResult>
  getItem(accessToken: string): Promise<ItemSummary>
  getInstitutionName(institutionId: string): Promise<string | null>
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
      const base = { user: { client_user_id: clientUserId }, client_name: config.clientName, country_codes: [CountryCode.Us], language: config.language }
      // Update mode is triggered by the Item's access token and carries NO products (per Plaid docs).
      const request = accessToken
        ? { ...base, access_token: accessToken }
        : { ...base, additional_consented_products: [Products.Transactions] } // consent only: Transactions is not initialized or billed until BANK-4 calls it
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
