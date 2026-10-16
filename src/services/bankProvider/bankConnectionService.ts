/**
 * src/services/bankProvider/bankConnectionService.ts
 *
 * SERVER-ONLY orchestration for the Plaid bank connection (Sandbox or Production, never both at once). Pure: every dependency (Plaid, persistence, key,
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
import type { PlaidEnvironmentName } from './plaidConfig'

export const BANK_PROVIDER = 'plaid' as const
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Plaid public tokens look like `public-sandbox-<uuid>`; bounded and character-restricted before it is ever forwarded. */
const PUBLIC_TOKEN = /^public-[A-Za-z0-9_-]{8,190}$/

export type BankErrorCode = 'forbidden' | 'invalid_request' | 'not_found' | 'conflict' | 'item_owned_elsewhere'
  | 'invalid_public_token' | 'plaid_unavailable' | 'persistence_failed' | 'disconnect_incomplete' | 'credential_unreadable'
  | 'login_required' | 'sync_failed' | 'invalid_webhook'
  | 'duplicate_institution' | 'duplicate_unverifiable' | 'update_mode_unsupported' | 'feature_disabled'

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
  /** Where the Item lives at the provider. Sandbox and Production Items are never interchangeable. */
  environment: PlaidEnvironmentName
  connectedAt: string | null
  disconnectedAt: string | null
  lastSuccessfulSyncAt: string | null
}

export interface BankConnectionRepo {
  findItemOwner(provider: string, providerItemId: string): Promise<{ id: string; organizationId: string } | null>
  /** One database transaction: item + credential. Throws item_owned_elsewhere if the item belongs to another organization. */
  connectItem(input: { organizationId: string; provider: string; providerItemId: string; institutionId: string | null
    institutionName: string | null; encryptedAccessToken: string; actorUserId: string; environment: PlaidEnvironmentName }): Promise<{ itemId: string; outcome: 'created' | 'credential_rotated' | 'reconnected' }>
  getItem(organizationId: string, itemId: string): Promise<{ id: string; provider: string; providerItemId: string; status: BankConnectionView['status']; environment?: PlaidEnvironmentName } | null>
  listItems(organizationId: string): Promise<BankConnectionView[]>
  getActiveCredential(organizationId: string, itemId: string): Promise<string | null>
  /**
   * PLAID-1A: every NOT-disconnected Item of the organization with its provider institution id (e.g. "ins_127991"). Used only to stop a second
   * Item being created for an institution that is already connected. Never returned to the browser.
   */
  listLiveInstitutions(organizationId: string): Promise<Array<{ id: string; institutionId: string | null; environment: PlaidEnvironmentName; status: BankConnectionView['status'] }>>
  disconnectItem(organizationId: string, itemId: string): Promise<'disconnected' | 'already_disconnected'>
  markHealthy(organizationId: string, itemId: string): Promise<boolean>
  /** PLAID-2A (automatic sync only, service role): one Item by id across organizations, and every healthy Item of an environment. */
  findItemById?(itemId: string): Promise<{ id: string; organizationId: string; status: BankConnectionView['status']; environment: PlaidEnvironmentName; provider: string } | null>
  listSyncableItems?(environment: PlaidEnvironmentName): Promise<Array<{ id: string; organizationId: string }>>
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
  /** The environment this server is configured for. Items of any other environment are never read, synced, re-linked or disconnected here. */
  environment: PlaidEnvironmentName
  /**
   * PLAID-1A server switch (env PLAID_ACCOUNT_ADDITIONS_ENABLED === 'true'). Off by default: adding accounts to an existing Item through update
   * mode with Account Select, and saving newly shared accounts, are refused until the owner enables it after validation.
   */
  accountAdditionsEnabled?: boolean
  /** PLAID-2A: the configured webhook URL (PLAID_WEBHOOK_URL), used only by the one-time registration on an existing Item. */
  webhookUrl?: string | null
  /** Receives only the safe fields above. */
  log?: (event: SafeLogEvent) => void
}

/** Internal: the Link just created a second Item for an institution that already has a live connection. */
class DuplicateItem extends Error {
  readonly code: 'duplicate_institution' | 'duplicate_unverifiable'
  constructor(code: 'duplicate_institution' | 'duplicate_unverifiable') { super(code); this.name = 'DuplicateItem'; this.code = code }
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
  // A Sandbox Item's token is meaningless to the Production API (and the reverse): refuse before any credential is decrypted or any provider call is made.
  if ((item.environment ?? 'sandbox') !== deps.environment) throw new BankConnectionError('conflict', 409, `This connection belongs to the ${item.environment ?? 'sandbox'} environment and cannot be used while Cash OS is configured for ${deps.environment}.`)
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

/** Plaid failures that mean "this request shape is not supported for this Item/institution" rather than "Plaid is unavailable". */
const UNSUPPORTED_TYPES = new Set(['INVALID_REQUEST', 'INVALID_INPUT'])
const UNSUPPORTED_CODES = new Set(['INVALID_FIELD', 'INVALID_CONFIGURATION', 'INSTITUTION_NOT_SUPPORTED', 'PRODUCTS_NOT_SUPPORTED', 'INVALID_PRODUCT'])

/** PLAID-1A: the organization's live Items in THIS server environment (another environment's Items are never compared or touched). */
async function liveInstitutions(deps: BankConnectionDeps, actor: BankActor) {
  return (await deps.repo.listLiveInstitutions(actor.organizationId)).filter(i => i.status !== 'disconnected' && i.environment === deps.environment)
}

/**
 * Link token for:
 *   - 'new'          a NEW connection. When the organization already has a live connection in this environment, the caller must state that the
 *                    owner is connecting a DIFFERENT bank (`differentInstitution: true`); same-bank accounts belong in 'add_accounts'.
 *   - 'update'       re-authentication of an existing Item (unchanged behaviour).
 *   - 'add_accounts' PLAID-1A: update mode with Account Select on the EXISTING Item, so more accounts from the same login join that Item. The Item,
 *                    its access token, its account ids and its transaction history are untouched. Server-switched off by default.
 */
export async function createLinkToken(deps: BankConnectionDeps, actor: BankActor, input: { mode?: unknown; itemId?: unknown; differentInstitution?: unknown } = {}) {
  assertAuthority(actor)
  const clientUserId = `${actor.organizationId}.${actor.userId}` // opaque UUIDs only: no email, name or phone
  let accessToken: string | undefined
  let mode: 'new' | 'update' | 'add_accounts' = 'new'
  if (input.mode === 'update' || input.mode === 'add_accounts') {
    mode = input.mode
    if (mode === 'add_accounts' && deps.accountAdditionsEnabled !== true) {
      throw new BankConnectionError('feature_disabled', 403, 'Adding accounts to an existing bank connection is not enabled yet.')
    }
    const { item, envelope } = await loadCredential(deps, actor, input.itemId as string)
    if (item.status === 'disconnected' || !envelope) throw new BankConnectionError('conflict', 409, 'This bank connection is disconnected. Connect it again instead.')
    // Account additions start only from a healthy Item: a connection that needs sign-in is repaired first with Reconnect (plain update mode).
    if (mode === 'add_accounts' && item.status !== 'healthy') throw new BankConnectionError('login_required', 409, 'This bank connection needs attention first. Use Reconnect, then add accounts.')
    accessToken = decryptFor(deps, actor, item, envelope)
  } else if (input.mode !== undefined && input.mode !== 'new') {
    throw new BankConnectionError('invalid_request', 400, 'Unsupported request.')
  } else if (input.differentInstitution !== true && (await liveInstitutions(deps, actor)).length > 0) {
    // A new Item for a bank that is already connected would duplicate it (a second subscription, new ids for the same accounts).
    throw new BankConnectionError('duplicate_institution', 409, 'A bank is already connected. To add more accounts from the same bank login, use "Add accounts" on that connection. Connect a new bank only for a different bank.')
  }
  try {
    const result = await deps.plaid.createLinkToken({ clientUserId, accessToken, ...(mode === 'add_accounts' ? { accountSelection: true } : {}) })
    note(deps, { event: 'bank.link_token.created', organizationId: actor.organizationId, outcome: mode })
    return { linkToken: result.linkToken, expiration: result.expiration, mode }
  } catch (error) {
    const code = error instanceof PlaidApiFailure ? error.code : 'ERROR'
    note(deps, { event: 'bank.link_token.failed', organizationId: actor.organizationId, outcome: mode, code })
    if (mode === 'add_accounts' && error instanceof PlaidApiFailure && (UNSUPPORTED_TYPES.has(error.type) || UNSUPPORTED_CODES.has(error.code))) {
      // Never fall back to a new Item: that is exactly the duplicate this path exists to avoid. The owner reviews the situation instead.
      throw new BankConnectionError('update_mode_unsupported', 409, 'The bank connection service could not open account selection for this connection. Nothing was changed and no new connection was created. This needs owner review.')
    }
    throw new BankConnectionError('plaid_unavailable', 502, 'The bank connection service is unavailable. Try again shortly.')
  }
}

const INSTITUTION_ID = /^ins_[A-Za-z0-9]{1,40}$/

/**
 * Exchange a Link public token for an encrypted server-held credential.
 * Failure rules: nothing is persisted unless encryption succeeded; item + credential are saved in ONE transaction; an Item
 * that belongs to another organization fails closed (and is never removed, since it is someone else's live connection); an
 * Item this call just created at Plaid is removed again if it could not be saved, so no orphan is left behind.
 */
export async function exchangePublicToken(deps: BankConnectionDeps, actor: BankActor, input: { publicToken?: unknown; institutionId?: unknown }) {
  assertAuthority(actor)
  const publicToken = typeof input.publicToken === 'string' ? input.publicToken.trim() : ''
  if (!PUBLIC_TOKEN.test(publicToken)) throw new BankConnectionError('invalid_request', 400, 'A valid link session is required.')

  // PLAID-1A duplicate guard, stage 1 (before any access token exists, so no Plaid subscription starts). Link reports the institution the owner
  // chose; it is advisory browser input, so stage 2 below re-checks it from Plaid itself. Institution NAMES are never compared, only ids.
  const live = await liveInstitutions(deps, actor)
  const hinted = typeof input.institutionId === 'string' && INSTITUTION_ID.test(input.institutionId) ? input.institutionId : null
  if (hinted && live.some(i => i.institutionId === hinted)) {
    note(deps, { event: 'bank.exchange.duplicate_refused', organizationId: actor.organizationId, stage: 'pre_exchange', code: 'duplicate_institution' })
    throw new BankConnectionError('duplicate_institution', 409, 'This bank is already connected. To add more accounts from the same login, use "Add accounts" on the existing connection. Nothing new was connected.')
  }

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
    // PLAID-1A duplicate guard, stage 2 (authoritative, from Plaid): another live Item of this organization at the same institution means this
    // Link created a second Item for a bank that is already connected. A re-exchange of the SAME Item (credential rotation) is not a duplicate.
    const others = live.filter(i => !existing || i.id !== existing.id)
    if (others.length > 0 && (!institutionId || others.some(i => !i.institutionId))) throw new DuplicateItem('duplicate_unverifiable')
    if (institutionId && others.some(i => i.institutionId === institutionId)) throw new DuplicateItem('duplicate_institution')
    if (institutionId) institutionName = await deps.plaid.getInstitutionName(institutionId)
    encrypted = encryptProviderToken(accessToken, deps.key, contextFor(actor, BANK_PROVIDER, providerItemId))
  } catch (error) {
    if (error instanceof DuplicateItem) {
      // The extra Item was never saved here. Remove it at Plaid so it is not billed; the existing connection is not touched.
      let removed = preExisting
      if (!preExisting) { try { await deps.plaid.removeItem(accessToken); removed = true } catch { removed = false } }
      note(deps, { event: 'bank.exchange.duplicate_refused', organizationId: actor.organizationId, stage: 'post_exchange', code: error.code, outcome: removed ? 'extra_item_removed' : 'extra_item_cleanup_failed' })
      if (error.code === 'duplicate_unverifiable') {
        throw new BankConnectionError('duplicate_unverifiable', 409, 'Cash OS could not confirm this is a different bank from your existing connection, so nothing was connected. This needs owner review.')
      }
      throw new BankConnectionError('duplicate_institution', 409, removed
        ? 'This bank is already connected. To add more accounts from the same login, use "Add accounts" on the existing connection. The extra connection was removed and your existing connection was not changed.'
        : 'This bank is already connected. The extra connection could not be removed automatically and needs owner review. Your existing connection was not changed.')
    }
    await compensate()
    note(deps, { event: 'bank.exchange.prepare_failed', organizationId: actor.organizationId, code: 'persistence_failed' })
    throw new BankConnectionError('persistence_failed', 503, 'The bank connection could not be saved. Nothing was connected; please try again.')
  }

  try {
    const saved = await deps.repo.connectItem({ organizationId: actor.organizationId, provider: BANK_PROVIDER, providerItemId, institutionId,
      institutionName, encryptedAccessToken: encrypted, actorUserId: actor.userId, environment: deps.environment })
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
  return { environment: deps.environment, connected: items.some(i => i.status === 'healthy' && i.environment === deps.environment), connections: items, accountAdditionsEnabled: deps.accountAdditionsEnabled === true }
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

/**
 * PLAID-2A: ONE-TIME owner action. Points an EXISTING production Item at the configured webhook URL (/item/webhook/update) so Plaid can nudge Cash OS
 * without reconnecting: same Item, same access token, same transaction ids, so every review stays attached. Needs the typed confirmation REGISTER
 * and a configured PLAID_WEBHOOK_URL. If the Item already points at that URL nothing is changed.
 */
export async function registerItemWebhook(deps: BankConnectionDeps, actor: BankActor, input: { itemId?: unknown; confirm?: unknown }) {
  assertAuthority(actor)
  if (input.confirm !== 'REGISTER') throw new BankConnectionError('invalid_request', 400, 'Type REGISTER to confirm. Nothing was changed.')
  const url = deps.webhookUrl
  if (!url) throw new BankConnectionError('feature_disabled', 409, 'The webhook address is not configured on this server yet. Nothing was changed.')
  if (!deps.plaid.updateItemWebhook) throw new BankConnectionError('feature_disabled', 409, 'Webhook registration is not available. Nothing was changed.')
  const { item, envelope } = await loadCredential(deps, actor, input.itemId as string)
  if (item.environment !== 'production') throw new BankConnectionError('conflict', 409, 'Automatic updates are only for Production bank connections.')
  if (!envelope || item.status === 'disconnected') throw new BankConnectionError('conflict', 409, 'This bank connection is disconnected.')
  const token = decryptFor(deps, actor, item, envelope)
  try {
    const info = await deps.plaid.getItem(token)
    if (info.webhook === url) return { id: item.id, registered: true, changed: false }
    await deps.plaid.updateItemWebhook(token, url)
  } catch {
    throw new BankConnectionError('plaid_unavailable', 502, 'The bank connection service is unavailable. Nothing was changed; try again shortly.')
  }
  note(deps, { event: 'bank.webhook.registered', organizationId: actor.organizationId, itemId: item.id })
  return { id: item.id, registered: true, changed: true }
}
