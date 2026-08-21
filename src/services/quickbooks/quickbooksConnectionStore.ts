/**
 * src/services/quickbooks/quickbooksConnectionStore.ts
 *
 * SERVER-ONLY persistence authority for the organization-scoped QuickBooks
 * connection row (public.quickbooks_connections).
 *
 * One row per PowerOn organization (UNIQUE(organization_id)). Reconnect upserts
 * the same row; disconnect flips it to 'disconnected' and clears encrypted
 * credentials. The browser never touches this table directly — it is
 * server-only under RLS with no authenticated policies; the Netlify functions
 * drive it via the service role key through an injected QboConnectionRepo.
 *
 * Concurrency: token refresh uses token_version as an optimistic compare-and-set
 * guard (applyRefreshResult updates WHERE token_version = N and sets N + 1). A
 * zero-row update means another refresh won; the caller reloads and reuses the
 * winner's credential set rather than overwriting it.
 *
 * realmId is the QuickBooks company id, NOT a PowerOn org id. PowerOn org
 * identity comes exclusively from the validated signed OAuth state, so a
 * callback can never attach a connection to a different org.
 *
 * Testability: persistence is injected as QboConnectionRepo so upsert/reconnect/
 * CAS/sanitize behavior is unit-tested with an in-memory fake.
 */
import type { QboApiEnvironment, QboSanitizedConnectionStatus } from './quickbooksTypes'

/** Full server-side connection row, including encrypted credential envelopes. */
export interface QboConnectionRow {
  id: string
  organizationId: string
  status: 'connected' | 'disconnected'
  connectedAt: string | null
  disconnectedAt: string | null
  connectedBy: string | null
  environment: QboApiEnvironment
  companyName: string | null
  encryptedAccessToken: string | null
  encryptedRefreshToken: string | null
  encryptedRealmId: string | null
  accessTokenExpiresAt: string | null
  refreshTokenExpiresAt: string | null
  lastRefreshedAt: string | null
  tokenVersion: number
}

/** Input for upserting a connection on a successful OAuth callback. */
export interface QboUpsertConnectionInput {
  organizationId: string
  userId: string
  environment: QboApiEnvironment
  encryptedAccessToken: string
  encryptedRefreshToken: string
  encryptedRealmId: string
  accessTokenExpiresAt: string | null
  refreshTokenExpiresAt: string | null
  companyName: string | null
}

/** Fields updated by a token refresh (compare-and-set on token_version). */
export interface QboRefreshUpdateFields {
  encryptedAccessToken: string
  encryptedRefreshToken: string
  accessTokenExpiresAt: string | null
  refreshTokenExpiresAt: string | null
  lastRefreshedAt: string
}

/**
 * Injected persistence surface. The Supabase adapter (netlify/functions/
 * quickbooks/qboRepos.ts) implements this with the service role key.
 */
export interface QboConnectionRepo {
  upsertConnection(input: QboUpsertConnectionInput, now: string): Promise<QboConnectionRow>
  loadConnection(organizationId: string): Promise<QboConnectionRow | null>
  /**
   * Compare-and-set refresh update. Returns the new token_version when the CAS
   * succeeded (>=1 row), or null when zero rows matched (race lost).
   */
  applyRefreshResult(
    organizationId: string,
    expectedTokenVersion: number,
    fields: QboRefreshUpdateFields,
    now: string,
  ): Promise<number | null>
  markDisconnected(organizationId: string, now: string): Promise<void>
}

/** True when the row is a usable connected credential set. */
export function isConnectionUsable(row: QboConnectionRow | null): row is QboConnectionRow {
  return (
    !!row &&
    row.status === 'connected' &&
    !!row.encryptedAccessToken &&
    !!row.encryptedRefreshToken &&
    !!row.encryptedRealmId
  )
}

/**
 * Upsert the organization's ONE connection row on a successful OAuth callback.
 * Reuses the existing row on reconnect (INSERT ... ON CONFLICT(organization_id)
 * DO UPDATE). Resets token_version to 0 (fresh credential set), marks connected,
 * clears disconnected_at. Org identity is the verified signed-state org — never
 * attacker-controllable.
 */
export async function upsertConnection(
  repo: QboConnectionRepo,
  input: QboUpsertConnectionInput,
  now: Date,
): Promise<QboConnectionRow> {
  return repo.upsertConnection(input, now.toISOString())
}

/** Load the organization's connection row (server-side; includes secrets). */
export async function loadConnection(
  repo: QboConnectionRepo,
  organizationId: string,
): Promise<QboConnectionRow | null> {
  return repo.loadConnection(organizationId)
}

/**
 * Compare-and-set refresh persist. Returns the new token_version on success, or
 * null if another refresh won the race (caller reloads + reuses winner's creds).
 */
export async function applyRefreshResult(
  repo: QboConnectionRepo,
  organizationId: string,
  expectedTokenVersion: number,
  fields: QboRefreshUpdateFields,
  now: Date,
): Promise<number | null> {
  return repo.applyRefreshResult(organizationId, expectedTokenVersion, fields, now.toISOString())
}

/**
 * Mark the org's connection disconnected: status -> 'disconnected', clear all
 * encrypted credentials + expiry metadata, set disconnected_at. Preserve
 * company_name / connected_at / environment as safe audit/display metadata.
 */
export async function markDisconnected(
  repo: QboConnectionRepo,
  organizationId: string,
  now: Date,
): Promise<void> {
  await repo.markDisconnected(organizationId, now.toISOString())
}

/**
 * Build the sanitized, browser-safe connection status from a row. Carries no
 * realmId, no tokens, no encrypted blobs, no expiry, no technical metadata.
 * Disconnected (or no row) returns only { connected: false }.
 */
export function sanitizeConnectionStatus(row: QboConnectionRow | null): QboSanitizedConnectionStatus {
  if (!isConnectionUsable(row)) return { connected: false }
  return {
    connected: true,
    companyName: row.companyName,
    connectedAt: row.connectedAt,
  }
}

/**
 * Resolve the sanitized status for an org (load + sanitize). Used by the
 * qbo-connection-status endpoint. Performs NO provider API call and NO token
 * refresh — it is persisted metadata only.
 */
export async function getSanitizedStatus(
  repo: QboConnectionRepo,
  organizationId: string,
): Promise<QboSanitizedConnectionStatus> {
  const row = await repo.loadConnection(organizationId)
  return sanitizeConnectionStatus(row)
}