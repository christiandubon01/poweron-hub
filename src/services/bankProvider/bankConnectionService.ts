/**
 * src/services/bankProvider/bankConnectionService.ts
 *
 * SERVER-ONLY orchestration for the BANK-2 Plaid sandbox connection. Pure: every dependency (Plaid, persistence, key,
 * logging) is injected, so the whole security story is testable without a network or a database.
 *
 * What it does: create a Link token, exchange a public token for an encrypted server-held credential, report sanitized
 * status, support update-mode (re-authentication) tokens, and disconnect.
 * What it never does: sync or store transactions, touch the ledger, map accounts, or change any Cash OS number. Connecting
 * a bank is NOT a financial event.
 *
 * Authority: the caller's organization and role come from the trusted server-side profile resolution (never the request
 * body) and are re-checked here. Only owners/admins may act.
 */
import type { Buffer } from 'node:buffer'
import { BankTokenDecryptError, decryptProviderToken, encryptProviderToken } from './providerTokenCrypto'
import { PlaidApiFailure, type BankPlaidPort } from './plaidPort'

export const BANK_PROVIDER = 'plaid' as const
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Plaid public tokens look like `public-sandbox-<uuid>`; bounded and character-restricted before it is ever forwarded. */
const PUBLIC_TOKEN = /^public-[A-Za-z0-9_-]{8,190}$/

export type BankErrorCode = 'forbidden' | 'invalid_request' | 'not_found' | 'conflict' | 'item_owned_elsewhere'
  | 'invalid_public_token' | 'plaid_unavailable' | 'persistence_failed' | 'disconnect_incomplete' | 'credential_unreadable'
  | 'login_required' | 'sync_failed' | 'invalid_webhook'

/** Carries only a safe, owner-readable message; never a token, key, response body or stack. */
export class BankConnectionError extends Error {
  readonly code: BankErrorCode
  readonly httpStatus: number
  constructor(code: BankErrorCode, httpStatus: number, message: string) {
    super(message)
    this.name = 'BankConnectionError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

export interface BankActor { organizationId: string; userId: string; role: string }

/** Everything the browser may ever see about a connection. Deliberately has no token, cursor or provider response. */
export interface BankConnectionView {
  id: string
  provider: string
  status: 'connecting' | 'healthy' | 'login_required' | 'error' | 'disconnected'
  institutionName: string | null
  connectedAt: string | null
  disconnectedAt: string | null
  lastSuccessfulSyncAt: string | null
}

export interface BankConnectionRepo {
  findItemOwner(provider: string, providerItemId: string): Promise<{ id: string; organizationId: string } | null>
  /** One database transaction: item + credential. Throws item_owned_elsewhere if the item belongs to another organization. */
  connectItem(input: { organizationId: string; provider: string; providerItemId: string; institutionId: string | null
    institutionName: string | null; encryptedAccessToken: string; actorUserId: string }): Promise<{ itemId: string; outcome: 'created' | 'credential_rotated' | 'reconnected' }>
  getItem(organizationId: string, itemId: string): Promise<{ id: string; provider: string; providerItemId: string; status: BankConnectionView['status'] } | null>
  listItems(organizationId: string): Promise<BankConnectionView[]>
  getActiveCredential(organizationId: string, itemId: string): Promise<string | null>
  disconnectItem(organizationId: string, itemId: string): Promise<'disconnected' | 'already_disconnected'>
  markHealthy(organizationId: string, itemId: string): Promise<boolean>
}

/**
 * Everything a log line may carry. `stage` and `errorClass` are fixed vocabularies; `detail` is built ONLY from allowlisted pieces
 * (a Plaid error type/code, a database SQLSTATE and constraint name) and is re-sanitized by the logger.
 */
export interface SafeLogEvent { event: string; organizationId: string; itemId?: string; outcome?: string; code?: string; stage?: string; errorClass?: string; detail?: string }

export interface BankConnectionDeps {
  plaid: BankPlaidPort
  repo: BankConnectionRepo
  key: Buffer
  environment: 'sandbox'
  /** Receives only the safe fields above. */
  log?: (event: SafeLogEvent) => void
}

export function assertAuthority(actor: BankActor): void {
  if (!actor?.organizationId || !actor.userId || !['owner', 'admin'].includes(actor.role)) {
    throw new BankConnectionError('forbidden', 403, 'Only owners and admins can manage bank connections.')
  }
}
export const note = (deps: BankConnectionDeps, event: SafeLogEvent) => { try { deps.log?.(event) } catch { /* logging must never break the flow */ } }
export const contextFor = (actor: BankActor, provider: string, providerItemId: string) => ({ organizationId: actor.organizationId, provider, providerItemId })

export async function loadCredential(deps: BankConnectionDeps, actor: BankActor, itemId: string) {
  if (typeof itemId !== 'string' || !UUID.test(itemId)) throw new BankConnectionError('invalid_request', 400, 'A valid connection is required.')
  const item = await deps.repo.getItem(actor.organizationId, itemId) // organization-scoped: another org's id is simply "not found"
  if (!item) throw new BankConnectionError('not_found', 404, 'Bank connection not found.')
  const envelope = await deps.repo.getActiveCredential(actor.organizationId, itemId)
  return { item, envelope }
}

export function decryptFor(deps: BankConnectionDeps, actor: BankActor, item: { provider: string; providerItemId: string }, envelope: string): string {
  try {
    return decryptProviderToken(envelope, deps.key, contextFor(actor, item.provider, item.providerItemId))
  } catch (error) {
    if (error instanceof BankTokenDecryptError) throw new BankConnectionError('credential_unreadable', 500, 'The stored bank credential could not be read. Reconnect the bank.')
    throw error
  }
}

/** Link token for a NEW connection, or an update-mode (re-authentication) token for an existing one. */
export async function createLinkToken(deps: BankConnectionDeps, actor: BankActor, input: { mode?: unknown; itemId?: unknown } = {}) {
  assertAuthority(actor)
  const clientUserId = `${actor.organizationId}.${actor.userId}` // opaque UUIDs only: no email, name or phone
  let accessToken: string | undefined
  let mode: 'new' | 'update' = 'new'
  if (input.mode === 'update') {
    mode = 'update'
    const { item, envelope } = await loadCredential(deps, actor, input.itemId as string)
    if (item.status === 'disconnected' || !envelope) throw new BankConnectionError('conflict', 409, 'This bank connection is disconnected. Connect it again instead.')
    accessToken = decryptFor(deps, actor, item, envelope)
  } else if (input.mode !== undefined && input.mode !== 'new') {
    throw new BankConnectionError('invalid_request', 400, 'Unsupported request.')
  }
  try {
    const result = await deps.plaid.createLinkToken({ clientUserId, accessToken })
    note(deps, { event: 'bank.link_token.created', organizationId: actor.organizationId, outcome: mode })
    return { linkToken: result.linkToken, expiration: result.expiration, mode }
  } catch (error) {
    note(deps, { event: 'bank.link_token.failed', organizationId: actor.organizationId, code: error instanceof PlaidApiFailure ? error.code : 'ERROR' })
    throw new BankConnectionError('plaid_unavailable', 502, 'The bank connection service is unavailable. Try again shortly.')
  }
}

/**
 * Exchange a Link public token for an encrypted server-held credential.
 * Failure rules: nothing is persisted unless encryption succeeded; item + credential are saved in ONE transaction; an Item
 * that belongs to another organization fails closed (and is never removed, since it is someone else's live connection); an
 * Item this call just created at Plaid is removed again if it could not be saved, so no orphan is left behind.
 */
export async function exchangePublicToken(deps: BankConnectionDeps, actor: BankActor, input: { publicToken?: unknown }) {
  assertAuthority(actor)
  const publicToken = typeof input.publicToken === 'string' ? input.publicToken.trim() : ''
  if (!PUBLIC_TOKEN.test(publicToken)) throw new BankConnectionError('invalid_request', 400, 'A valid link session is required.')

  let exchanged: { accessToken: string; itemId: string }
  try {
    exchanged = await deps.plaid.exchangePublicToken(publicToken)
  } catch (error) {
    const code = error instanceof PlaidApiFailure ? error.code : 'ERROR'
    note(deps, { event: 'bank.exchange.failed', organizationId: actor.organizationId, code })
    if (error instanceof PlaidApiFailure && (error.type === 'INVALID_INPUT' || error.code === 'INVALID_PUBLIC_TOKEN')) {
      // Single-use + 30-minute expiry: a replayed or late submission lands here. The connection may already be saved.
      throw new BankConnectionError('invalid_public_token', 400, 'This link session was already used or has expired. Check the connection status, or start again.')
    }
    throw new BankConnectionError('plaid_unavailable', 502, 'The bank connection service is unavailable. Try again shortly.')
  }
  const { accessToken, itemId: providerItemId } = exchanged

  const existing = await deps.repo.findItemOwner(BANK_PROVIDER, providerItemId)
  if (existing && existing.organizationId !== actor.organizationId) {
    // Fail closed: never transfer ownership, and never remove an Item that is another organization's live connection.
    note(deps, { event: 'bank.exchange.cross_org_refused', organizationId: actor.organizationId, code: 'item_owned_elsewhere' })
    throw new BankConnectionError('item_owned_elsewhere', 409, 'This bank connection cannot be completed.')
  }
  const preExisting = !!existing
  const compensate = async () => { if (!preExisting) { try { await deps.plaid.removeItem(accessToken) } catch { /* best effort */ } } }

  let institutionId: string | null = null
  let institutionName: string | null = null
  let encrypted: string
  try {
    const summary = await deps.plaid.getItem(accessToken)
    if (summary.itemId !== providerItemId) throw new Error('item mismatch')
    institutionId = summary.institutionId
    if (institutionId) institutionName = await deps.plaid.getInstitutionName(institutionId)
    encrypted = encryptProviderToken(accessToken, deps.key, contextFor(actor, BANK_PROVIDER, providerItemId))
  } catch {
    await compensate()
    note(deps, { event: 'bank.exchange.prepare_failed', organizationId: actor.organizationId, code: 'persistence_failed' })
    throw new BankConnectionError('persistence_failed', 503, 'The bank connection could not be saved. Nothing was connected; please try again.')
  }

  try {
    const saved = await deps.repo.connectItem({ organizationId: actor.organizationId, provider: BANK_PROVIDER, providerItemId, institutionId,
      institutionName, encryptedAccessToken: encrypted, actorUserId: actor.userId })
    note(deps, { event: 'bank.connected', organizationId: actor.organizationId, itemId: saved.itemId, outcome: saved.outcome })
    return { connection: { id: saved.itemId, provider: BANK_PROVIDER, status: 'healthy' as const, institutionName }, outcome: saved.outcome }
  } catch (error) {
    if (error instanceof BankConnectionError && error.code === 'item_owned_elsewhere') throw error // raced with another org: still no removal
    await compensate()
    note(deps, { event: 'bank.exchange.persist_failed', organizationId: actor.organizationId, code: 'persistence_failed' })
    throw new BankConnectionError('persistence_failed', 503, 'The bank connection could not be saved. Nothing was connected; please try again.')
  }
}

/** Sanitized status for the caller's organization only. */
export async function getConnectionStatus(deps: BankConnectionDeps, actor: BankActor) {
  assertAuthority(actor)
  const items = await deps.repo.listItems(actor.organizationId)
  return { environment: deps.environment, connected: items.some(i => i.status === 'healthy'), connections: items }
}

/** Remove at Plaid, then revoke locally. Deletes no financial history. Retry-safe in both directions. */
export async function disconnectConnection(deps: BankConnectionDeps, actor: BankActor, input: { itemId?: unknown }) {
  assertAuthority(actor)
  const { item, envelope } = await loadCredential(deps, actor, input.itemId as string)
  if (envelope && item.status !== 'disconnected') {
    const token = decryptFor(deps, actor, item, envelope)
    try {
      await deps.plaid.removeItem(token) // already-removed items count as success inside the adapter
    } catch (error) {
      note(deps, { event: 'bank.disconnect.plaid_failed', organizationId: actor.organizationId, itemId: item.id, code: error instanceof PlaidApiFailure ? error.code : 'ERROR' })
      throw new BankConnectionError('plaid_unavailable', 502, 'The bank could not be disconnected right now. Nothing changed; try again.')
    }
  }
  try {
    const outcome = await deps.repo.disconnectItem(actor.organizationId, item.id)
    note(deps, { event: 'bank.disconnected', organizationId: actor.organizationId, itemId: item.id, outcome })
    return { id: item.id, status: 'disconnected' as const, outcome }
  } catch {
    throw new BankConnectionError('disconnect_incomplete', 503, 'The bank was disconnected at the provider but not yet recorded here. Try again to finish.')
  }
}

/** After a successful update-mode Link: confirm with the provider that the Item is healthy, then clear the warning state. */
export async function completeUpdateMode(deps: BankConnectionDeps, actor: BankActor, input: { itemId?: unknown }) {
  assertAuthority(actor)
  const { item, envelope } = await loadCredential(deps, actor, input.itemId as string)
  if (!envelope || item.status === 'disconnected') throw new BankConnectionError('conflict', 409, 'This bank connection is disconnected.')
  const token = decryptFor(deps, actor, item, envelope)
  let hasError: boolean
  try {
    hasError = (await deps.plaid.getItem(token)).hasError
  } catch {
    throw new BankConnectionError('plaid_unavailable', 502, 'The bank connection service is unavailable. Try again shortly.')
  }
  if (hasError) return { id: item.id, healthy: false }
  await deps.repo.markHealthy(actor.organizationId, item.id)
  note(deps, { event: 'bank.update_mode.completed', organizationId: actor.organizationId, itemId: item.id })
  return { id: item.id, healthy: true }
}
