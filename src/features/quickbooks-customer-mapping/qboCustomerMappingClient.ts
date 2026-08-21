/**
 * src/features/quickbooks-customer-mapping/qboCustomerMappingClient.ts
 *
 * QBO-4A.4 — browser-side sanitized orchestration over the existing QBO-4A.3 secure
 * endpoints. This is the ONLY layer in the customer-mapping feature that issues
 * network calls. It sends/receives ONLY sanitized shapes (see qboCustomerMappingTypes):
 * the browser never sends org/realmId/fingerprint/token/env and never receives them.
 *
 * Design:
 *  - Pure-ish / injectable: `fetchImpl` + `getHeaders` are injected so the unit tests
 *    exercise the full request/response classification with a fake fetch (no DOM, no
 *    network). The React hook wires the real `fetch` + `authedJsonHeaders`.
 *  - Every non-OK response is classified into a QboCustomerMappingApiError category so
 *    the UI can render the right recovery path (duplicate-name → Search/Edit, split
 *    failure → Search Existing, not_connected → connect, claimed_by_other → info).
 *  - Never auto-links, never auto-creates, never auto-suffixes, never retries. Each
 *    mutation is a single explicit call; the server is the authority.
 *
 * Endpoints (top-level Netlify entries — Netlify does not route nested files):
 *   GET  /.netlify/functions/qbo-customer-mapping?poweronCustomerId=<uuid>
 *   GET  /.netlify/functions/qbo-customer-search?q=<term>&activeOnly=<1|0>
 *   POST /.netlify/functions/qbo-customer-link      { poweronCustomerId, qboCustomerId }
 *   POST /.netlify/functions/qbo-customer-create    { poweronCustomerId, displayName, ... }
 *   POST /.netlify/functions/qbo-customer-unlink    { poweronCustomerId }
 */
import type {
  CreateCustomerInput,
  QboCustomerSearchResult,
  QboLinkOrigin,
  QboLinkedCustomer,
  QboMappingResult,
} from './qboCustomerMappingTypes'
import { QboCustomerMappingApiError } from './qboCustomerMappingTypes'

const MAPPING_URL = '/.netlify/functions/qbo-customer-mapping'
const SEARCH_URL = '/.netlify/functions/qbo-customer-search'
const LINK_URL = '/.netlify/functions/qbo-customer-link'
const CREATE_URL = '/.netlify/functions/qbo-customer-create'
const UNLINK_URL = '/.netlify/functions/qbo-customer-unlink'

/** Injectable fetch shape (matches global fetch). */
export type FetchImpl = typeof fetch
/** Injectable auth-header getter (matches authedJsonHeaders). */
export type GetHeaders = () => Promise<Record<string, string>>

export interface QboCustomerMappingClient {
  loadMapping(poweronCustomerId: string): Promise<{ linked: false } | { linked: true; customer: QboLinkedCustomer; linkOrigin: QboLinkOrigin }>
  search(term: string, options?: { activeOnly?: boolean }): Promise<QboCustomerSearchResult[]>
  link(poweronCustomerId: string, qboCustomerId: string): Promise<QboMappingResult>
  create(poweronCustomerId: string, input: CreateCustomerInput): Promise<QboMappingResult>
  unlink(poweronCustomerId: string): Promise<{ linked: false }>
}

export function createQboCustomerMappingClient(args: {
  fetchImpl: FetchImpl
  getHeaders: GetHeaders
}): QboCustomerMappingClient {
  const { fetchImpl, getHeaders } = args

  async function request(url: string, init: { method: string; body?: string }): Promise<any> {
    const headers = await getHeaders()
    let res: Response
    try {
      res = await fetchImpl(url, { method: init.method, headers, body: init.body })
    } catch {
      throw new QboCustomerMappingApiError('network_error', 'Could not reach the server. Check your connection and try again.')
    }
    if (res.ok) {
      try {
        return await res.json()
      } catch {
        throw new QboCustomerMappingApiError('provider_error', 'QuickBooks returned an unreadable response.')
      }
    }
    // Non-OK: classify from status + body.
    let body: any = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    const message = typeof body?.error === 'string' && body.error ? body.error : 'QuickBooks request failed.'
    if (res.status === 401 || res.status === 403) {
      throw new QboCustomerMappingApiError('unauthorized', 'Your session has expired. Please sign in again.')
    }
    if (res.status === 422) {
      if (body?.category === 'duplicate_name') {
        throw new QboCustomerMappingApiError('duplicate_name', 'QuickBooks already has a customer, vendor, or employee using this name.')
      }
      // 422 without duplicate_name => not connected (resolveQboCompanyScope).
      throw new QboCustomerMappingApiError('not_connected', 'QuickBooks is not connected. Connect QuickBooks from the QuickBooks menu.')
    }
    if (res.status === 409) {
      // Split-failure race on create carries recoverable + qboCustomer.
      if (body?.recoverable && body?.qboCustomer) {
        throw new QboCustomerMappingApiError(
          'split_failure',
          body?.error ?? 'The QuickBooks customer was created but the mapping could not be saved.',
          { recoverableQboCustomer: body.qboCustomer },
        )
      }
      const msg = message.toLowerCase()
      if (msg.includes('another customer') || msg.includes('linked to another')) {
        throw new QboCustomerMappingApiError('claimed_by_other', message)
      }
      if (msg.includes('not found')) {
        throw new QboCustomerMappingApiError('not_found', message)
      }
      throw new QboCustomerMappingApiError('mapping_conflict', message)
    }
    if (res.status === 500 && body?.recoverable && body?.qboCustomer) {
      throw new QboCustomerMappingApiError(
        'split_failure',
        body?.error ?? 'The QuickBooks customer was created but the mapping could not be saved. You can link it from Search.',
        { recoverableQboCustomer: body.qboCustomer },
      )
    }
    if (res.status >= 500) {
      throw new QboCustomerMappingApiError('provider_error', message)
    }
    throw new QboCustomerMappingApiError('bad_request', message)
  }

  function toLinkedCustomer(raw: any): QboLinkedCustomer {
    return {
      id: String(raw?.id ?? ''),
      displayName: typeof raw?.displayName === 'string' ? raw.displayName : null,
      active: raw?.active !== false,
    }
  }

  return {
    async loadMapping(poweronCustomerId) {
      const data = await request(`${MAPPING_URL}?poweronCustomerId=${encodeURIComponent(poweronCustomerId)}`, { method: 'GET' })
      if (data?.linked && data?.customer) {
        return { linked: true, customer: toLinkedCustomer(data.customer), linkOrigin: data.linkOrigin }
      }
      return { linked: false }
    },

    async search(term, options) {
      const params = new URLSearchParams({ q: term })
      if (options?.activeOnly) params.set('activeOnly', '1')
      const data = await request(`${SEARCH_URL}?${params.toString()}`, { method: 'GET' })
      const list: any[] = Array.isArray(data?.customers) ? data.customers : []
      return list.map((c) => ({
        id: String(c?.id ?? ''),
        displayName: typeof c?.displayName === 'string' ? c.displayName : null,
        companyName: typeof c?.companyName === 'string' ? c.companyName : null,
        email: typeof c?.email === 'string' ? c.email : null,
        phone: typeof c?.phone === 'string' ? c.phone : null,
        active: c?.active !== false,
      }))
    },

    async link(poweronCustomerId, qboCustomerId) {
      const data = await request(LINK_URL, {
        method: 'POST',
        body: JSON.stringify({ poweronCustomerId, qboCustomerId }),
      })
      return { customer: toLinkedCustomer(data?.customer), linkOrigin: (data?.linkOrigin ?? 'linked') as QboLinkOrigin }
    },

    async create(poweronCustomerId, input) {
      const body: Record<string, unknown> = { poweronCustomerId, displayName: input.displayName }
      if (input.companyName) body.companyName = input.companyName
      if (input.email) body.email = input.email
      if (input.phone) body.phone = input.phone
      if (input.billAddr) body.billAddr = input.billAddr
      const data = await request(CREATE_URL, { method: 'POST', body: JSON.stringify(body) })
      return { customer: toLinkedCustomer(data?.customer), linkOrigin: (data?.linkOrigin ?? 'created') as QboLinkOrigin }
    },

    async unlink(poweronCustomerId) {
      await request(UNLINK_URL, { method: 'POST', body: JSON.stringify({ poweronCustomerId }) })
      return { linked: false }
    },
  }
}