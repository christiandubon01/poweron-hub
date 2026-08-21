/**
 * src/features/quickbooks-customer-mapping/qboCustomerMappingTypes.ts
 *
 * QBO-4A.4 — BROWSER-SIDE sanitized types for the owner QuickBooks customer-mapping
 * experience. These mirror the server contracts from QBO-4A.2/4A.3 but carry NO
 * realmId, NO company fingerprint, NO access/refresh token, NO SyncToken, and NO raw
 * Intuit metadata. Nothing here is ever sent to QuickBooks; this is the display/action
 * layer over the existing secure endpoints.
 *
 * The browser NEVER holds or sends: organizationId as authority, realmId, company
 * fingerprint, access token, refresh token, environment authority, or a raw QBO SQL
 * string. The server derives all of those. These types intentionally have no field for
 * any of them so a leak is a compile error, not an accident.
 */

/** A QuickBooks customer as seen by search results (browser-safe). */
export interface QboCustomerSearchResult {
  readonly id: string
  readonly displayName: string | null
  readonly companyName: string | null
  readonly email: string | null
  readonly phone: string | null
  /** Inactive QuickBooks customers are returned with active:false so the owner can see
   *  names that may trip the 6240 duplicate-name error. */
  readonly active: boolean
}

/** The linked QuickBooks customer summary (browser-safe). */
export interface QboLinkedCustomer {
  readonly id: string
  readonly displayName: string | null
  readonly active: boolean
}

/** How the active mapping was established. */
export type QboLinkOrigin = 'linked' | 'created'

/**
 * The mapping state for one PowerOn customer in the current QBO company/environment.
 * Discriminated by `kind`. The status component switches on this; it never guesses.
 *
 *  - loading      : initial fetch in flight
 *  - unresolved   : the PowerOn source has NO canonical customer identity (name-only /
 *                   legacy record, or an id absent from relationship_accounts). The UI
 *                   must NOT match by name.
 *  - disconnected : QBO is not connected (host-reported, or a mutation returned
 *                   not_connected). Linking is unavailable until connected.
 *  - unlinked     : connected + no active mapping
 *  - linked       : connected + active mapping present
 *  - error        : a recoverable error occurred loading the mapping
 */
export type QboCustomerMappingState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unresolved' }
  | { readonly kind: 'disconnected' }
  | { readonly kind: 'unlinked' }
  | { readonly kind: 'linked'; readonly customer: QboLinkedCustomer; readonly linkOrigin: QboLinkOrigin }
  | { readonly kind: 'error'; readonly message: string }

/**
 * Sanitized error categories the UI renders distinctly. None carry a token, realmId,
 * or raw provider detail beyond the owner-safe message.
 */
export type QboCustomerApiErrorCategory =
  | 'not_connected'
  | 'not_found'
  | 'duplicate_name'
  | 'mapping_conflict'
  | 'claimed_by_other'
  | 'split_failure'
  | 'unauthorized'
  | 'provider_error'
  | 'network_error'
  | 'bad_request'
  | 'unknown'

/**
 * A sanitized customer-mapping API error. Raised by the client/hook; rendered by the
 * modal. For split_failure, `recoverableQboCustomer` carries the safe provider identity
 * (id + displayName only) so the UI can steer the owner to Search Existing rather than
 * retry Create blindly.
 */
export class QboCustomerMappingApiError extends Error {
  readonly category: QboCustomerApiErrorCategory
  readonly recoverableQboCustomer: { readonly id: string; readonly displayName: string | null } | null
  constructor(
    category: QboCustomerApiErrorCategory,
    message: string,
    opts: { recoverableQboCustomer?: { id: string; displayName: string | null } | null } = {},
  ) {
    super(message)
    this.name = 'QboCustomerMappingApiError'
    this.category = category
    this.recoverableQboCustomer = opts.recoverableQboCustomer ?? null
  }
}

/** Owner-reviewed input for an explicit Create-customer-in-QuickBooks action. */
export interface CreateCustomerInput {
  readonly displayName: string
  readonly companyName?: string | null
  readonly email?: string | null
  readonly phone?: string | null
  readonly billAddr?: {
    readonly line1?: string | null
    readonly city?: string | null
    readonly state?: string | null
    readonly postalCode?: string | null
    readonly country?: string | null
  } | null
}

/**
 * Safe prefill values for the Create form, resolved from the reconciled PowerOn
 * relationship account. Missing values are simply absent (null) — NEVER invented
 * from a project name or an unrelated snapshot. `displayName` is always present when
 * the prefill is non-null (it is required to create).
 */
export interface CreateCustomerPrefill {
  readonly displayName: string
  readonly companyName: string | null
  readonly email: string | null
  readonly phone: string | null
}

/**
 * The minimal customer-directory shape the prefill resolver consumes. The host maps
 * its in-memory customer directory (e.g. backup.gcContacts) onto this. Carries no
 * billing authority — identity + contact only.
 */
export interface CustomerDirectoryEntry {
  readonly id: string
  readonly company?: string | null
  readonly contact?: string | null
  readonly email?: string | null
  readonly phone?: string | null
}

/** The result of a successful link or create — drives the immediate Linked transition. */
export interface QboMappingResult {
  readonly customer: QboLinkedCustomer
  readonly linkOrigin: QboLinkOrigin
}