/**
 * src/services/quickbooks/quickbooksCustomerMappingStore.ts
 *
 * SERVER-ONLY persistence authority for the customer-LEVEL QuickBooks customer
 * mapping (public.quickbooks_customer_mappings).
 *
 * One ACTIVE mapping per (organization, PowerOn customer, QBO company
 * fingerprint, environment). The mapping is customer-level — never
 * project/service/draft-specific — so a single link is reusable across every
 * source record for that customer.
 *
 * CANONICAL IDENTITY CONTRACT (QBO-4A.6): poweron_customer_id is the canonical
 * PowerOn customer identity = relationship_accounts.id, which is a TEXT PRIMARY
 * KEY (stable, immutable, org-scoped) — NOT a UUID. Real PowerOn customer ids are
 * legacy TEXT values such as 'gc...' / 'import_gc...' ; they are temporary only
 * while unpersisted, and become the stable canonical identity once upserted into
 * relationship_accounts. Identity is therefore NEVER validated by format here.
 *
 * This pure module enforces only the SHAPE of poweron_customer_id (non-empty,
 * bounded, no control characters) — the database-agnostic sanity bound. The real
 * authority — that the id EXISTS as relationship_accounts.id AND belongs to the
 * authenticated organization — is enforced at the SERVER boundary by
 * assertCanonicalPowerOnCustomerId (netlify/functions/quickbooks/qboCustomerIdentity),
 * which the endpoints call BEFORE createCustomerMapping. This module never guesses
 * identity from a name and never assumes a UUID.
 *
 * RETAINED UNLINK/RELINK HISTORY: unlink flips is_active to false with
 * unlinked_at + unlinked_by_user_id; the row is retained as provenance. Partial
 * UNIQUE indexes (WHERE is_active = true) enforce "at most one active mapping
 * per scope" while old links survive. This is the minimal history model — not a
 * broad event/audit subsystem.
 *
 * BROWSER BOUNDARY: sanitizeCustomerMapping() produces the only shape ever
 * returned to the browser — { linked, customer: { id, displayName, active } | null }.
 * It carries NO realmId, NO company fingerprint, NO tokens, NO envelopes.
 *
 * Testability: persistence is injected as QboCustomerMappingRepo so all logic is
 * unit-tested with an in-memory fake (mirrors QboConnectionRepo).
 */
import { isUuid } from '@/lib/uuid'
import type { QboApiEnvironment } from './quickbooksTypes'

/** Full server-side mapping row. */
export interface QboCustomerMappingRow {
  id: string
  organizationId: string
  poweronCustomerId: string
  qboCustomerId: string
  qboCompanyFingerprint: string
  qboEnvironment: QboApiEnvironment
  linkOrigin: 'linked' | 'created'
  qboDisplayName: string | null
  poweronCustomerSnapshot: Record<string, unknown> | null
  isActive: boolean
  unlinkedAt: string | null
  unlinkedByUserId: string | null
  linkedByUserId: string | null
  createdAt: string
  updatedAt: string
}

/** Input for creating/linking a customer mapping. */
export interface QboCustomerMappingInput {
  organizationId: string
  /**
   * Canonical PowerOn customer identity = relationship_accounts.id (TEXT). Validated
   * for SHAPE here (assertPowerOnCustomerIdShape) and for ORG-SCOPED EXISTENCE at the
   * server boundary (assertCanonicalPowerOnCustomerId) BEFORE this input is built.
   * Never a UUID format requirement; never derived from a name.
   */
  poweronCustomerId: string
  qboCustomerId: string
  qboCompanyFingerprint: string
  qboEnvironment: QboApiEnvironment
  linkOrigin: 'linked' | 'created'
  qboDisplayName: string | null
  poweronCustomerSnapshot: Record<string, unknown> | null
  /** auth.users id of the owner/admin who established the link. */
  linkedByUserId: string | null
}

/** The composite scope that identifies a mapping for one PowerOn customer. */
export interface QboCustomerMappingScope {
  organizationId: string
  poweronCustomerId: string
  qboCompanyFingerprint: string
  qboEnvironment: QboApiEnvironment
}

/**
 * Injected persistence surface. The Supabase adapter
 * (netlify/functions/quickbooks/qboCustomerMappingRepo.ts) implements this with
 * the service role key. All methods require the server-resolved scope fields;
 * the browser/request body never chooses organization authority.
 */
export interface QboCustomerMappingRepo {
  /** The single ACTIVE mapping for this scope, or null. */
  loadActiveMapping(scope: QboCustomerMappingScope): Promise<QboCustomerMappingRow | null>
  /** Insert a new ACTIVE mapping. Caller enforces canonical identity + uniqueness preflight. */
  insertMapping(input: QboCustomerMappingInput, now: string): Promise<QboCustomerMappingRow>
  /** Flip the active mapping for this scope to inactive (retained history). */
  deactivateMapping(
    scope: QboCustomerMappingScope,
    unlinkedByUserId: string | null,
    now: string,
  ): Promise<void>
}

/** Identity-error codes for the canonical PowerOn customer identity contract. */
export type QboCustomerIdentityErrorCode =
  /** Shape failure: not a string, empty, too long, or contains control characters. */
  | 'poweron_customer_id_invalid'
  /** Existence/org failure: no relationship_accounts row for (id, org) — not canonical. */
  | 'poweron_customer_id_not_canonical'

/**
 * Raised when poweron_customer_id fails the canonical identity contract (QBO-4A.6).
 * `poweron_customer_id_invalid` = SHAPE failure (pure, database-agnostic).
 * `poweron_customer_id_not_canonical` = EXISTENCE/ORG failure (server-only lookup).
 * The browser never receives the raw error; endpoints map it to a sanitized 400.
 */
export class QboCustomerMappingIdentityError extends Error {
  readonly code: QboCustomerIdentityErrorCode
  constructor(code: QboCustomerIdentityErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'QboCustomerMappingIdentityError'
    this.code = code
  }
}

/**
 * The maximum length of a canonical PowerOn customer id (relationship_accounts.id).
 * Real ids are short ('gc…' / 'import_gc…' / 'acct_…'); 128 is a generous bound that
 * rejects absurd payloads without constraining any real id. Not a format rule.
 */
export const POWERON_CUSTOMER_ID_MAX_LENGTH = 128

/**
 * Validate the SHAPE of a canonical PowerOn customer id — the pure, database-agnostic
 * sanity bound. The real authority (existence as relationship_accounts.id AND belonging
 * to the authenticated organization) is enforced at the SERVER boundary by
 * assertCanonicalPowerOnCustomerId (netlify/functions/quickbooks/qboCustomerIdentity),
 * which calls this shape check first. Rejects non-strings, empty, > 128 chars, and
 * control characters. NEVER rejects a valid TEXT id for not looking like a UUID —
 * 'gc2', 'import_gc_7', and 'acct_…' are all valid shapes. Throws
 * QboCustomerMappingIdentityError('poweron_customer_id_invalid') on failure.
 */
export function assertPowerOnCustomerIdShape(poweronCustomerId: unknown): asserts poweronCustomerId is string {
  if (typeof poweronCustomerId !== 'string') {
    throw new QboCustomerMappingIdentityError(
      'poweron_customer_id_invalid',
      'poweron_customer_id must be a string.',
    )
  }
  // Reject control characters ANYWHERE in the raw input (before trim), so a trailing
  // newline or an embedded NUL is caught even though trim would strip edge whitespace.
  if (/[\x00-\x1F\x7F]/.test(poweronCustomerId)) {
    throw new QboCustomerMappingIdentityError(
      'poweron_customer_id_invalid',
      'poweron_customer_id must not contain control characters.',
    )
  }
  const value = poweronCustomerId.trim()
  if (value.length === 0) {
    throw new QboCustomerMappingIdentityError(
      'poweron_customer_id_invalid',
      'poweron_customer_id must not be empty.',
    )
  }
  if (value.length > POWERON_CUSTOMER_ID_MAX_LENGTH) {
    throw new QboCustomerMappingIdentityError(
      'poweron_customer_id_invalid',
      `poweron_customer_id must not exceed ${POWERON_CUSTOMER_ID_MAX_LENGTH} characters.`,
    )
  }
}

/** True when the environment is a valid QBO environment. */
function isValidEnvironment(env: string): env is QboApiEnvironment {
  return env === 'sandbox' || env === 'production'
}

/**
 * Load the active mapping for a PowerOn customer in the current QBO company/env.
 * Server-only. Returns null when no active link exists (the UI then prompts the
 * owner to link/create).
 */
export async function loadCurrentCustomerMapping(
  repo: QboCustomerMappingRepo,
  scope: QboCustomerMappingScope,
): Promise<QboCustomerMappingRow | null> {
  return repo.loadActiveMapping(scope)
}

/**
 * Create (link) a customer mapping. Enforces the canonical identity SHAPE safeguard
 * and rejects a malformed poweron_customer_id before any persistence. The real
 * org-scoped existence authority is enforced by the endpoint BEFORE calling this
 * (assertCanonicalPowerOnCustomerId); this pure layer only bounds the shape.
 * organization_id stays a real UUID (organizations.id is UUID). The repo's partial
 * UNIQUE indexes are the backstop if two tabs race to link the same PowerOn customer
 * to the same QBO company/env — the second insert fails, which the caller surfaces
 * as "already linked" (idempotent).
 */
export async function createCustomerMapping(
  repo: QboCustomerMappingRepo,
  input: QboCustomerMappingInput,
  now: Date,
): Promise<QboCustomerMappingRow> {
  assertPowerOnCustomerIdShape(input.poweronCustomerId)
  if (!isUuid(input.organizationId)) {
    throw new Error('organization_id must be a UUID.')
  }
  if (!isValidEnvironment(input.qboEnvironment)) {
    throw new Error('qbo_environment must be sandbox or production.')
  }
  if (!input.qboCustomerId.trim()) {
    throw new Error('qbo_customer_id is required.')
  }
  if (!input.qboCompanyFingerprint.trim()) {
    throw new Error('qbo_company_fingerprint is required.')
  }
  return repo.insertMapping(input, now.toISOString())
}

/**
 * Unlink (deactivate) the active mapping for a scope. Retained-history model: the
 * row stays with is_active=false + unlinked_at + unlinked_by_user_id so the
 * accounting-link provenance survives for future "Change mapping" / audit.
 */
export async function unlinkCustomerMapping(
  repo: QboCustomerMappingRepo,
  scope: QboCustomerMappingScope,
  unlinkedByUserId: string | null,
  now: Date,
): Promise<void> {
  await repo.deactivateMapping(scope, unlinkedByUserId, now.toISOString())
}

/**
 * The ONLY shape ever returned to the browser. Carries no realmId, no company
 * fingerprint, no tokens, no envelopes — just whether a link exists and the
 * display fields the UI needs. `qboCustomerId` is included so the UI can show
 * "Linked" and later pass it back for relink; it is a QBO-side id, not a secret.
 */
export interface QboSanitizedCustomerMapping {
  linked: boolean
  customer: {
    id: string
    displayName: string | null
    active: boolean
  } | null
  linkOrigin: 'linked' | 'created' | null
}

/** Build the browser-safe mapping shape from a row. No secrets cross this boundary. */
export function sanitizeCustomerMapping(row: QboCustomerMappingRow | null): QboSanitizedCustomerMapping {
  if (!row || !row.isActive) return { linked: false, customer: null, linkOrigin: null }
  return {
    linked: true,
    customer: {
      id: row.qboCustomerId,
      displayName: row.qboDisplayName,
      active: true,
    },
    linkOrigin: row.linkOrigin,
  }
}