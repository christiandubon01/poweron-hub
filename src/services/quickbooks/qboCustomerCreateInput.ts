/**
 * src/services/quickbooks/qboCustomerCreateInput.ts
 *
 * Pure, network-free validation + QBO Customer payload builder for the explicit
 * "Create customer in QuickBooks" action (QBO-4A.3 Task 6).
 *
 * The owner reviews/confirms customer data; this module bounds, trims, and rejects
 * malformed input and builds the EXACT QBO Customer object sent to Intuit. There is
 * NO passthrough of unknown fields — only the explicitly allow-listed fields are
 * emitted. displayName is REQUIRED (it is QBO's unique display identifier across
 * Customer+Vendor+Employee). poweronCustomerId must be a valid canonical PowerOn
 * customer identity SHAPE (non-empty, bounded, no control chars) — it is NEVER
 * derived from a name, and NEVER validated by UUID format here. The org-scoped
 * EXISTENCE authority (relationship_accounts.id belongs to the authenticated org)
 * is enforced by the endpoint via assertCanonicalPowerOnCustomerId, NOT here.
 *
 * This module is safe for unit testing (no node:crypto / network / Supabase). It
 * imports only the contract length constants + the pure shape guard.
 */
import { assertPowerOnCustomerIdShape } from './quickbooksCustomerMappingStore'
import {
  QBO_CUSTOMER_COMPANY_NAME_MAX,
  QBO_CUSTOMER_DISPLAY_NAME_MAX,
  QBO_CUSTOMER_EMAIL_MAX,
  QBO_CUSTOMER_FAMILY_NAME_MAX,
  QBO_CUSTOMER_GIVEN_NAME_MAX,
  QBO_CUSTOMER_MIDDLE_NAME_MAX,
  QBO_CUSTOMER_PHONE_MAX,
  QBO_CUSTOMER_SUFFIX_MAX,
  QBO_CUSTOMER_TITLE_MAX,
} from './qboCustomerContract'

/** Owner-reviewed input for an explicit create. All optional fields are trimmed. */
export interface QboCreateCustomerInput {
  /** Canonical PowerOn customer identity (relationship_accounts.id TEXT) — never derived from a name. */
  poweronCustomerId: string
  /** Required QBO unique display identifier (1..100 chars). */
  displayName: string
  companyName?: string
  givenName?: string
  familyName?: string
  middleName?: string
  suffix?: string
  title?: string
  email?: string
  phone?: string
  billAddr?: {
    line1?: string
    city?: string
    state?: string
    postalCode?: string
    country?: string
  }
}

/** The validated QBO Customer object sent to Intuit. Only allow-listed fields. */
export type QboCreateCustomerPayload = Record<string, unknown>

export interface QboCreateCustomerValidation {
  ok: boolean
  /** Present when ok is false — a browser-safe 400 error message. */
  error?: string
  /** The validated canonical PowerOn customer id, echoed back so the caller does not re-read the body. */
  poweronCustomerId?: string
  /** The validated QBO Customer object (only when ok). */
  payload?: QboCreateCustomerPayload
}

/** Bound + trim a string field; return null when empty or too long. */
function boundedTrim(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > max) return null
  return trimmed
}

/** Basic email shape check (not exhaustive — QBO is the final authority). */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= QBO_CUSTOMER_EMAIL_MAX
}

/**
 * Validate the owner-reviewed create input and build the exact QBO Customer payload.
 * Rejects: missing/invalid poweronCustomerId SHAPE, missing/oversized displayName,
 * oversized/unknown fields, malformed email, unknown extra fields (no passthrough).
 * The org-scoped EXISTENCE of poweronCustomerId (relationship_accounts row in this
 * org) is NOT checked here — the endpoint does that via assertCanonicalPowerOnCustomerId
 * after this returns ok. Returns {ok:false,error} for a 400, or {ok:true,payload}.
 */
export function validateAndBuildCreateCustomerPayload(body: unknown): QboCreateCustomerValidation {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Invalid request body.' }
  }
  const b = body as Record<string, unknown>

  const poweronCustomerIdRaw = typeof b.poweronCustomerId === 'string' ? b.poweronCustomerId : ''
  // Shape-check the RAW value (control chars are caught before trim strips edge
  // whitespace). The trimmed id is used downstream + echoed to the caller.
  try {
    assertPowerOnCustomerIdShape(poweronCustomerIdRaw)
  } catch {
    return { ok: false, error: 'A valid PowerOn customer id is required.' }
  }
  const poweronCustomerId = poweronCustomerIdRaw.trim()

  const displayName = boundedTrim(b.displayName, QBO_CUSTOMER_DISPLAY_NAME_MAX)
  if (displayName === null) {
    return { ok: false, error: 'A display name is required (1-100 characters).' }
  }

  // Optional bounded string fields. Unknown fields are simply ignored (no passthrough).
  const companyName = boundedTrim(b.companyName, QBO_CUSTOMER_COMPANY_NAME_MAX)
  const givenName = boundedTrim(b.givenName, QBO_CUSTOMER_GIVEN_NAME_MAX)
  const familyName = boundedTrim(b.familyName, QBO_CUSTOMER_FAMILY_NAME_MAX)
  const middleName = boundedTrim(b.middleName, QBO_CUSTOMER_MIDDLE_NAME_MAX)
  const suffix = boundedTrim(b.suffix, QBO_CUSTOMER_SUFFIX_MAX)
  const title = boundedTrim(b.title, QBO_CUSTOMER_TITLE_MAX)

  const emailRaw = typeof b.email === 'string' ? b.email.trim() : ''
  if (emailRaw && !looksLikeEmail(emailRaw)) {
    return { ok: false, error: 'A valid email is required.' }
  }
  const phone = boundedTrim(b.phone, QBO_CUSTOMER_PHONE_MAX)

  // Optional billing address — each line bounded, no passthrough of unknown subfields.
  let billAddr: Record<string, unknown> | undefined
  if (b.billAddr && typeof b.billAddr === 'object') {
    const a = b.billAddr as Record<string, unknown>
    const line1 = boundedTrim(a.line1, 100)
    const city = boundedTrim(a.city, 50)
    const state = boundedTrim(a.state, 50)
    const postalCode = boundedTrim(a.postalCode, 30)
    const country = boundedTrim(a.country, 50)
    const addr: Record<string, unknown> = {}
    if (line1 !== null) addr.Line1 = line1
    if (city !== null) addr.City = city
    if (state !== null) addr.CountrySubDivisionCode = state
    if (postalCode !== null) addr.PostalCode = postalCode
    if (country !== null) addr.Country = country
    if (Object.keys(addr).length > 0) billAddr = addr
  }

  // Build the EXACT payload — only allow-listed fields. Active defaults to true.
  const payload: QboCreateCustomerPayload = {
    DisplayName: displayName,
    Active: true,
  }
  if (companyName !== null) payload.CompanyName = companyName
  if (givenName !== null) payload.GivenName = givenName
  if (familyName !== null) payload.FamilyName = familyName
  if (middleName !== null) payload.MiddleName = middleName
  if (suffix !== null) payload.Suffix = suffix
  if (title !== null) payload.Title = title
  if (emailRaw) payload.PrimaryEmailAddr = { Address: emailRaw }
  if (phone !== null) payload.PrimaryPhone = { FreeFormNumber: phone }
  if (billAddr) payload.BillAddr = billAddr

  return { ok: true, poweronCustomerId, payload }
}