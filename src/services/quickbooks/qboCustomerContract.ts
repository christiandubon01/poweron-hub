/**
 * src/services/quickbooks/qboCustomerContract.ts
 *
 * SERVER-ONLY verified Intuit Customer API contract (QBO-4A.3 Task 9).
 *
 * Verified against official Intuit developer documentation (Aug 2026):
 *
 *  ENDPOINTS (base is sandbox-quickbooks.api.intuit.com | quickbooks.api.intuit.com):
 *   - Create: POST {base}/v3/company/{realmId}/customer
 *             Content-Type: application/json, Authorization: Bearer {accessToken}
 *   - Query:  GET  {base}/v3/company/{realmId}/query?query=SELECT ... &minorversion=70
 *   - Read:   GET  {base}/v3/company/{realmId}/customer/{customerId}
 *
 *  QUERY LANGUAGE:
 *   - SELECT, WHERE (AND only — Intuit forbids OR), ORDERBY, STARTPOSITION, MAXRESULTS.
 *   - MAXRESULTS cap is 1000; the default page size is 100.
 *   - Entity names are case-sensitive-ish in practice (Customer, Vendor, Employee).
 *
 *  DISPLAYNAME (the unique display identifier for a Customer):
 *   - REQUIRED when creating (or auto-generated from Title/GivenName/MiddleName/
 *     FamilyName/Suffix when omitted).
 *   - UNIQUE across Customer + Vendor + Employee COMBINED namespace — not just
 *     within Customers. A duplicate-name probe must consider all three entity types.
 *   - Cannot be removed via sparse update.
 *   - Intuit docs state max 100 chars; in practice more may be accepted. We bound
 *     to the DOCUMENTED 100 so a provider that enforces the doc limit never rejects
 *     a value we allowed through.
 *
 *  DUPLICATE NAME — error code 6240:
 *   - Message: "Duplicate Name Exists Error"
 *   - Detail:  "The name supplied already exists. : null"
 *   - Fault type: ValidationFault (HTTP 400).
 *   - Inactive/deleted entities can also collide — the uniqueness check spans
 *     Active=false rows too.
 *
 *  ERROR RESPONSE SHAPE (always JSON for errors):
 *   {
 *     "Fault": {
 *       "Error": [ { "Message": "...", "Detail": "...", "code": "6240", "element": "..." } ],
 *       "type": "ValidationFault"
 *     },
 *     "time": "2022-03-12T23:52:39.915-08:00"
 *   }
 *   - Error is ALWAYS an array, even for a single error.
 *   - type ∈ ValidationFault | SystemFault | AuthenticationFault | AuthorizationFault.
 *   - HTTP statuses: 400 (bad syntax/validation), 401 (expired/revoked token),
 *     403 (forbidden), 500/503 (provider-side).
 *   - GOTCHA: even with Content-Type: application/json on the request, success
 *     responses may occasionally come back as XML. Errors come back as JSON. We
 *     parse defensively and never trust a single content type.
 *
 *  DIFFERENCE vs QBO-4A.1 ASSUMPTIONS:
 *   - DisplayName uniqueness spans Customer+Vendor+Employee combined, NOT just
 *     Customers. This phase does NOT attempt a client-side duplicate probe across
 *     three entity types; it surfaces the provider's 6240 sanitized and keeps the
 *     owner in control (no auto-suffix / merge / link). A future UI offers Search
 *     Existing or lets the owner edit the name.
 *   - The duplicate check includes inactive/deleted entities, so a freshly
 *     "deleted" Sandbox customer can still trip 6240 for a short window.
 *
 * This module is server-only (imported by the accounting client + Netlify handlers
 * + tests). It contains no node:crypto / network / Supabase imports and no
 * credential handling — it is pure constants + a tolerant JSON fault parser.
 */
import { QBO_API_MINOR_VERSION } from './quickbooksConstants'
import type { QboApiEnvironment } from './quickbooksTypes'

/** Maximum results a single QBO query page may request (provider cap). */
export const QBO_QUERY_MAX_RESULTS = 1000
/** Default query page size when the caller omits MAXRESULTS. */
export const QBO_QUERY_DEFAULT_MAX = 100

/** Intuit error code for a duplicate DisplayName (spans Customer/Vendor/Employee). */
export const QBO_DUPLICATE_NAME_ERROR_CODE = '6240'
export const QBO_DUPLICATE_NAME_ERROR_MESSAGE = 'Duplicate Name Exists Error'

/** Documented max lengths for the Customer create payload (bound to spec). */
export const QBO_CUSTOMER_DISPLAY_NAME_MAX = 100
export const QBO_CUSTOMER_GIVEN_NAME_MAX = 25
export const QBO_CUSTOMER_FAMILY_NAME_MAX = 15
export const QBO_CUSTOMER_MIDDLE_NAME_MAX = 15
export const QBO_CUSTOMER_TITLE_MAX = 15
export const QBO_CUSTOMER_SUFFIX_MAX = 15
export const QBO_CUSTOMER_COMPANY_NAME_MAX = 50
export const QBO_CUSTOMER_EMAIL_MAX = 100
export const QBO_CUSTOMER_PHONE_MAX = 30

/** Sanitized, browser-safe error categories for Customer API operations. */
export type QboCustomerApiErrorCategory =
  | 'not_connected'
  | 'not_found'
  | 'duplicate_name'
  | 'provider_error'
  | 'parse_error'
  | 'network_error'
  | 'bad_request'

export interface QboSanitizedCustomerApiError {
  category: QboCustomerApiErrorCategory
  message: string
}

/**
 * Raised by the accounting client for any QBO Customer API failure. The raw
 * provider detail/code is retained server-side only via `.code`/`.detail`;
 * `toSanitized()` yields the only shape ever returned to the browser. Never
 * includes a token, realmId, or raw Intuit response beyond the safe fields.
 */
export class QboCustomerApiError extends Error {
  readonly category: QboCustomerApiErrorCategory
  readonly code: string | null
  readonly detail: string
  readonly httpStatus: number | null
  constructor(
    category: QboCustomerApiErrorCategory,
    message: string,
    opts: { code?: string | null; detail?: string; httpStatus?: number | null } = {},
  ) {
    super(message)
    this.name = 'QboCustomerApiError'
    this.category = category
    this.code = opts.code ?? null
    this.detail = opts.detail ?? ''
    this.httpStatus = opts.httpStatus ?? null
  }
  toSanitized(): QboSanitizedCustomerApiError {
    return { category: this.category, message: this.message }
  }
}

/** Parsed Intuit Fault error (first error in the array). */
export interface QboParsedFault {
  code: string
  message: string
  detail: string
  type: string
}

/**
 * Tolerantly extract the first Intuit Fault error from a provider JSON response.
 * Returns null when the response is not a recognizable fault shape (so a caller can
 * distinguish "provider returned an error body" from "provider returned data").
 * Never throws — malformed JSON or a missing Fault just yields null.
 */
export function parseQboFault(json: unknown): QboParsedFault | null {
  if (!json || typeof json !== 'object') return null
  const fault = (json as Record<string, unknown>).Fault as Record<string, unknown> | undefined
  if (!fault || typeof fault !== 'object') return null
  const errors = fault.Error
  if (!Array.isArray(errors) || errors.length === 0) return null
  const first = errors[0] as Record<string, unknown> | undefined
  if (!first || typeof first !== 'object') return null
  const code = typeof first.code === 'string' || typeof first.code === 'number' ? String(first.code) : ''
  const message = typeof first.Message === 'string' ? first.Message : ''
  const detail = typeof first.Detail === 'string' ? first.Detail : ''
  const type = typeof fault.type === 'string' ? fault.type : ''
  if (!code && !message) return null
  return { code, message, detail, type }
}

/** True when a parsed fault is the 6240 duplicate-name error. */
export function isDuplicateNameFault(fault: QboParsedFault | null): boolean {
  if (!fault) return false
  return fault.code === QBO_DUPLICATE_NAME_ERROR_CODE || /duplicate name/i.test(fault.message)
}

/** Build a Customer query URL for the current company (GET .../query?query=...). */
export function buildCustomerQueryUrl(
  baseUrl: string,
  realmId: string,
  query: string,
  options: { maxResults?: number; startPosition?: number } = {},
): string {
  const params = new URLSearchParams({
    query,
    minorversion: String(QBO_API_MINOR_VERSION),
  })
  if (options.maxResults !== undefined) params.set('MAXRESULTS', String(options.maxResults))
  if (options.startPosition !== undefined) params.set('STARTPOSITION', String(options.startPosition))
  return `${baseUrl}/v3/company/${encodeURIComponent(realmId)}/query?${params.toString()}`
}

/** Build a single-Customer read URL: GET .../customer/{customerId}. */
export function buildCustomerReadUrl(baseUrl: string, realmId: string, qboCustomerId: string): string {
  return `${baseUrl}/v3/company/${encodeURIComponent(realmId)}/customer/${encodeURIComponent(qboCustomerId)}?minorversion=${QBO_API_MINOR_VERSION}`
}

/** Build a Customer create URL: POST .../customer. */
export function buildCustomerCreateUrl(baseUrl: string, realmId: string): string {
  return `${baseUrl}/v3/company/${encodeURIComponent(realmId)}/customer?minorversion=${QBO_API_MINOR_VERSION}`
}

/** Bearer + JSON headers for an authenticated QBO accounting request. */
export function qboAuthJsonHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

/**
 * The browser-safe Customer summary returned by search/read. No SyncToken, no
 * raw provider metadata, no balance/financial truth — only identity + display +
 * active flag. `active` is derived from the provider Active field (default true).
 */
export interface QboCustomerSummary {
  id: string
  displayName: string | null
  companyName: string | null
  email: string | null
  phone: string | null
  active: boolean
}

/**
 * Tolerantly reduce a raw QBO Customer object to a browser-safe summary. Never
 * throws; missing fields become null and active defaults to true (a Customer with
 * no Active field is treated as active, matching Intuit's default).
 */
export function toCustomerSummary(raw: unknown): QboCustomerSummary | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = r.Id
  if (id === undefined || id === null) return null
  const idStr = typeof id === 'string' || typeof id === 'number' ? String(id) : ''
  if (!idStr) return null
  const displayName = typeof r.DisplayName === 'string' ? r.DisplayName : null
  const companyName = typeof r.CompanyName === 'string' ? r.CompanyName : null
  const primaryEmail = r.PrimaryEmailAddr as Record<string, unknown> | undefined
  const email = primaryEmail && typeof primaryEmail.Address === 'string' ? primaryEmail.Address : null
  const primaryPhone = r.PrimaryPhone as Record<string, unknown> | undefined
  const phone = primaryPhone && typeof primaryPhone.FreeFormNumber === 'string' ? primaryPhone.FreeFormNumber : null
  const active = r.Active === undefined ? true : r.Active === true || r.Active === 'true'
  return { id: idStr, displayName, companyName, email, phone, active }
}

/** Base URL for an environment (re-exported here so Customer handlers import one module). */
export { qboApiBaseUrl } from './quickbooksCompanyInfo'
export type { QboApiEnvironment }

/**
 * Escape a QBO SQL string literal by doubling single quotes — the ONLY injection
 * vector in a query operand. With single quotes doubled, the operand can never
 * break out of its quoted LIKE literal.
 */
export function escapeQboStringLiteral(s: string): string {
  return s.replace(/'/g, "''")
}

/**
 * Build the server-side QBO query for a DisplayName search. PURE — no network, no
 * secrets. The term is bounded + single-quote-escaped by the caller; this places it
 * inside a quoted LIKE operand. `activeOnly` ANDs an Active=true predicate (QBO
 * forbids OR); the default returns BOTH active and inactive so the owner can see
 * inactive names that may trip the 6240 duplicate-name error.
 */
export function buildCustomerSearchQuery(
  term: string,
  options: { activeOnly?: boolean; maxResults?: number } = {},
): string {
  const escaped = escapeQboStringLiteral(term)
  let where = `DisplayName LIKE '%${escaped}%'`
  if (options.activeOnly) where += ' AND Active = true'
  const max = options.maxResults ?? QBO_QUERY_DEFAULT_MAX
  return `SELECT * FROM Customer WHERE ${where} ORDERBY DisplayName MAXRESULTS ${max}`
}