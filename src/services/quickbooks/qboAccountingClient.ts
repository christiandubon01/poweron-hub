/**
 * src/services/quickbooks/qboAccountingClient.ts
 *
 * SERVER-ONLY minimal QBO Accounting request helper for QBO-4A.3 Customer API.
 *
 * This is the SMALLEST reusable surface needed by the Customer search/read/create
 * endpoints. It intentionally supports only:
 *   - authenticated GET query  (search existing customers)
 *   - authenticated GET read    (verify a single customer exists in the current company)
 *   - authenticated POST create (explicit owner "Create customer in QuickBooks" action)
 *   - safe JSON parsing (tolerant of Intuit's occasional XML success bodies)
 *   - Intuit Fault error parsing -> sanitized QboCustomerApiError (incl. 6240)
 *
 * It REUSES — and does NOT duplicate — the existing QBO foundation:
 *   - getValidQboAccessToken(...)  (token load + decrypt + refresh + CAS rotation)
 *   - the current QBO connection repository (QboConnectionRepo)
 *   - loadQuickBooksConfig(...)    (server-side config from process.env)
 *   - loadQboTokenEncryptionKey(...) (server-only AES key)
 *   - qboApiBaseUrl(environment)   (sandbox vs production accounting base)
 *   - the server-authenticated org context (organizationId is resolved by the caller)
 *
 * It does NOT implement: token decryption, refresh logic, refresh-token rotation, CAS
 * token concurrency, OAuth, realm storage, a generic SDK, or any non-Customer entity.
 *
 * SECURITY: this module returns QboCustomerApiError (sanitized) and raw Customer
 * objects to CALLING SERVER CODE only. The Netlify handler is responsible for
 * running the raw result through the browser-safe sanitizer before returning to the
 * browser. realmId/accessToken never leave this module except as Bearer headers in
 * the injected fetchImpl call — they are never returned to the caller and never put
 * in an error message.
 *
 * Network is injected (QboFetchLike) so logic is unit-testable without a network and
 * without referencing global fetch in browser-bundled code.
 */
import { getValidQboAccessToken, type QboValidAccessToken } from './quickbooksTokenAuthority'
import {
  QBO_DUPLICATE_NAME_ERROR_CODE,
  QboCustomerApiError,
  buildCustomerCreateUrl,
  buildCustomerQueryUrl,
  buildCustomerReadUrl,
  isDuplicateNameFault,
  parseQboFault,
  qboAuthJsonHeaders,
  toCustomerSummary,
  type QboCustomerSummary,
} from './qboCustomerContract'
import { qboApiBaseUrl } from './quickbooksCompanyInfo'
import type { QboConnectionRepo } from './quickbooksConnectionStore'
import type { QboFetchLike } from './quickbooksOAuth'
import type { QuickBooksConfig } from './quickbooksTypes'

/** Everything a Customer API call needs, resolved server-side by the Netlify handler. */
export interface QboAccountingRequestContext {
  config: QuickBooksConfig
  encKey: Buffer
  connectionRepo: QboConnectionRepo
  /** Server-resolved org id (from the RLS profile row — never the request body). */
  organizationId: string
  fetchImpl: QboFetchLike
  now: Date
}

/** A resolved, usable QBO bearer + the company scope needed to build accounting URLs. */
export interface QboAccountingBearer {
  accessToken: string
  realmId: string
  environment: 'sandbox' | 'production'
  baseUrl: string
}

/**
 * Resolve a usable access token + company scope for the org. Throws a sanitized
 * QboCustomerApiError('not_connected') when the org has no usable connection. The
 * accessToken/realmId are NEVER returned to the caller except inside this bearer
 * object, which is consumed only by the request functions below and discarded.
 */
export async function resolveQboBearer(
  ctx: QboAccountingRequestContext,
): Promise<QboAccountingBearer> {
  let token: QboValidAccessToken | null
  try {
    token = await getValidQboAccessToken(
      ctx.config,
      ctx.encKey,
      ctx.connectionRepo,
      ctx.organizationId,
      ctx.fetchImpl,
      ctx.now,
    )
  } catch {
    // A refresh/network failure is surfaced as a provider error, never as a crash.
    throw new QboCustomerApiError('provider_error', 'QuickBooks connection could not be established.')
  }
  if (!token) {
    throw new QboCustomerApiError('not_connected', 'QuickBooks is not connected for this organization.')
  }
  return {
    accessToken: token.accessToken,
    realmId: token.realmId,
    environment: token.environment,
    baseUrl: qboApiBaseUrl(token.environment),
  }
}

/** Read the JSON body of a QBO response, tolerating Intuit's occasional XML success bodies. */
async function readJson(res: {
  ok: boolean
  status: number
  json(): Promise<unknown>
  text(): Promise<string>
}): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    // Some success responses come back as XML despite Content-Type: application/json.
    // Try text + JSON.parse as a fallback before giving up.
    let text = ''
    try {
      text = await res.text()
    } catch {
      throw new QboCustomerApiError('parse_error', 'QuickBooks returned an unreadable response.')
    }
    try {
      return JSON.parse(text)
    } catch {
      throw new QboCustomerApiError('parse_error', 'QuickBooks returned a non-JSON response.', {
        detail: text.slice(0, 200),
      })
    }
  }
}

/** Throw a sanitized error for a non-OK provider response, classifying known faults. */
async function throwForNonOk(res: {
  ok: boolean
  status: number
  json(): Promise<unknown>
  text(): Promise<string>
}): Promise<never> {
  const status = res.status
  if (status === 401 || status === 403) {
    throw new QboCustomerApiError('provider_error', 'QuickBooks authorization failed.', { httpStatus: status })
  }
  let body: unknown = null
  try {
    body = await readJson(res)
  } catch {
    // Fall through to a generic provider error if the body itself is unreadable.
  }
  const fault = parseQboFault(body)
  if (fault) {
    if (fault.code === QBO_DUPLICATE_NAME_ERROR_CODE || isDuplicateNameFault(fault)) {
      throw new QboCustomerApiError(
        'duplicate_name',
        'A QuickBooks customer with that name already exists.',
        { code: fault.code, detail: fault.detail, httpStatus: status },
      )
    }
    throw new QboCustomerApiError('provider_error', fault.message || 'QuickBooks request failed.', {
      code: fault.code,
      detail: fault.detail,
      httpStatus: status,
    })
  }
  throw new QboCustomerApiError('provider_error', 'QuickBooks request failed.', {
    httpStatus: status,
  })
}

/** Normalize the QueryResponse.Customer field into an array of raw Customer objects. */
function normalizeQueryCustomers(json: unknown): unknown[] {
  if (!json || typeof json !== 'object') return []
  const queryResponse = (json as Record<string, unknown>).QueryResponse as Record<string, unknown> | undefined
  if (!queryResponse) return []
  const customers = queryResponse.Customer
  if (customers === undefined || customers === null) return []
  if (Array.isArray(customers)) return customers
  return [customers]
}

/**
 * Run a Customer query (GET .../query) using a PRE-RESOLVED bearer. `query` is BUILT
 * BY THE CALLER server-side (never from the browser body). Returns an array of raw
 * Customer objects (empty when no matches); the caller sanitizes before returning
 * to the browser. The bearer-explicit form lets the auth bootstrap resolve the
 * token + company scope ONCE per request and reuse it across read + persist.
 */
export async function queryCustomersWithBearer(
  bearer: QboAccountingBearer,
  fetchImpl: QboFetchLike,
  query: string,
  options: { maxResults?: number; startPosition?: number } = {},
): Promise<unknown[]> {
  const url = buildCustomerQueryUrl(bearer.baseUrl, bearer.realmId, query, options)
  let res
  try {
    res = await fetchImpl(url, { method: 'GET', headers: qboAuthJsonHeaders(bearer.accessToken), body: '' })
  } catch {
    throw new QboCustomerApiError('network_error', 'QuickBooks could not be reached.')
  }
  if (!res.ok) await throwForNonOk(res)
  const json = await readJson(res)
  return normalizeQueryCustomers(json)
}

/** Context convenience wrapper: resolves the bearer then delegates. */
export async function queryCustomersRaw(
  ctx: QboAccountingRequestContext,
  query: string,
  options: { maxResults?: number; startPosition?: number } = {},
): Promise<unknown[]> {
  const bearer = await resolveQboBearer(ctx)
  return queryCustomersWithBearer(bearer, ctx.fetchImpl, query, options)
}

/**
 * Read a single Customer by id (GET .../customer/{id}) using a pre-resolved bearer.
 * Used to VERIFY a selected QBO customer exists in the CURRENT company before
 * persisting a link. Throws QboCustomerApiError('not_found') when the customer does
 * not exist (HTTP 404 or a provider "Object Not Found" fault). Returns the raw
 * Customer object on success.
 */
export async function readCustomerWithBearer(
  bearer: QboAccountingBearer,
  fetchImpl: QboFetchLike,
  qboCustomerId: string,
): Promise<Record<string, unknown>> {
  const url = buildCustomerReadUrl(bearer.baseUrl, bearer.realmId, qboCustomerId)
  let res
  try {
    res = await fetchImpl(url, { method: 'GET', headers: qboAuthJsonHeaders(bearer.accessToken), body: '' })
  } catch {
    throw new QboCustomerApiError('network_error', 'QuickBooks could not be reached.')
  }
  if (res.status === 404) {
    throw new QboCustomerApiError('not_found', 'That QuickBooks customer was not found in the current company.', {
      httpStatus: 404,
    })
  }
  if (!res.ok) {
    let body: unknown = null
    try {
      body = await readJson(res)
    } catch {
      // ignore — handled below
    }
    const fault = parseQboFault(body)
    // 610 = "Object Not Found"; a missing customer is surfaced as not_found, not a
    // generic provider error, so the link endpoint can reject cleanly.
    if (fault && (fault.code === '610' || /not found/i.test(fault.message))) {
      throw new QboCustomerApiError('not_found', 'That QuickBooks customer was not found in the current company.', {
        code: fault.code,
        httpStatus: res.status,
      })
    }
    await throwForNonOk(res)
  }
  const json = (await readJson(res)) as Record<string, unknown> | null
  const customer = json?.Customer as Record<string, unknown> | undefined
  if (!customer || typeof customer !== 'object') {
    throw new QboCustomerApiError('not_found', 'That QuickBooks customer was not found in the current company.')
  }
  return customer
}

/** Context convenience wrapper: resolves the bearer then delegates. */
export async function readCustomerRaw(
  ctx: QboAccountingRequestContext,
  qboCustomerId: string,
): Promise<Record<string, unknown>> {
  const bearer = await resolveQboBearer(ctx)
  return readCustomerWithBearer(bearer, ctx.fetchImpl, qboCustomerId)
}

/** Convenience: read a single Customer and return its browser-safe summary (or throw). */
export async function readCustomerSummary(
  ctx: QboAccountingRequestContext,
  qboCustomerId: string,
): Promise<QboCustomerSummary> {
  const raw = await readCustomerRaw(ctx, qboCustomerId)
  const summary = toCustomerSummary(raw)
  if (!summary) {
    throw new QboCustomerApiError('not_found', 'That QuickBooks customer was not found in the current company.')
  }
  return summary
}

/**
 * Create a Customer (POST .../customer) using a pre-resolved bearer. ONLY called by
 * an explicit owner "Create customer in QuickBooks" action — never automatically
 * from a lookup/search result. `payload` is the validated, bounded Customer body
 * built server-side from the owner-reviewed input. Returns the raw created Customer
 * object (the caller extracts the new QBO Customer Id + display fields and persists
 * the mapping).
 *
 * On 6240 duplicate-name: throws QboCustomerApiError('duplicate_name') — sanitized,
 * NO auto-suffix/merge/link. A future UI offers Search Existing or lets the owner
 * edit the name. The owner stays in control.
 */
export async function createCustomerWithBearer(
  bearer: QboAccountingBearer,
  fetchImpl: QboFetchLike,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = buildCustomerCreateUrl(bearer.baseUrl, bearer.realmId)
  let res
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: qboAuthJsonHeaders(bearer.accessToken),
      body: JSON.stringify(payload),
    })
  } catch {
    throw new QboCustomerApiError('network_error', 'QuickBooks could not be reached.')
  }
  if (!res.ok) await throwForNonOk(res)
  const json = (await readJson(res)) as Record<string, unknown> | null
  const customer = json?.Customer as Record<string, unknown> | undefined
  if (!customer || typeof customer !== 'object') {
    throw new QboCustomerApiError('parse_error', 'QuickBooks did not return the created customer.')
  }
  return customer
}

/** Context convenience wrapper: resolves the bearer then delegates. */
export async function createCustomerRaw(
  ctx: QboAccountingRequestContext,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const bearer = await resolveQboBearer(ctx)
  return createCustomerWithBearer(bearer, ctx.fetchImpl, payload)
}

export { toCustomerSummary, type QboCustomerSummary } from './qboCustomerContract'