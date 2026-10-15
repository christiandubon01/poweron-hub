/**
 * Controlled Plaid history replacement. The replacement Item is durable provider evidence but remains unmapped until
 * account identity, sync coverage and overlap reconciliation all pass. Activation is a separate atomic database action;
 * this service never removes either Item and never resets either sync cursor.
 */
import type { Buffer } from 'node:buffer'
import { BANK_PROVIDER, BankConnectionError, assertAuthority, contextFor, note, type BankActor, type BankConnectionDeps } from './bankConnectionService'
import { encryptProviderToken } from './providerTokenCrypto'
import { PlaidApiFailure } from './plaidPort'
import type { PlaidEnvironmentName } from './plaidConfig'

const PUBLIC_TOKEN = /^public-[A-Za-z0-9_-]{8,190}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type HistoryRecoveryState = 'link_pending' | 'accounts_pending' | 'account_review' | 'syncing' | 'transaction_review' | 'ready' | 'activated' | 'error' | 'cancelled'

export interface HistoryRecoveryAccountView {
  id: string
  oldAccountId: string
  newAccountId: string | null
  oldLabel: string
  newLabel: string | null
  financialAccountName: string
  matchBasis: 'provider_account_id' | 'account_details' | 'owner_confirmed' | 'ambiguous'
  status: 'confirmed' | 'review'
  oldestDate: string | null
  newestDate: string | null
  transactionCount: number
}
export interface HistoryRecoveryTransactionReviewView {
  id: string
  sourceTransactionId: string
  replacementTransactionId: string
  accountLabel: string
  date: string
  name: string
  amountMinor: number
  sourceRef: string
  replacementRef: string
}

export interface HistoryRecoveryView {
  id: string
  sourceItemId: string
  replacementItemId: string | null
  institutionName: string | null
  state: HistoryRecoveryState
  requestedDays: 730
  createdAt: string
  updatedAt: string
  accounts: HistoryRecoveryAccountView[]
  overlap: { confirmed: number; review: number; missingFromReplacement: number }
  transactionReview: HistoryRecoveryTransactionReviewView[]
  errorCode: string | null
}

export interface HistoryRecoveryRecord extends HistoryRecoveryView {
  institutionId: string | null
  environment: PlaidEnvironmentName
  sourceProviderItemId: string
}

export interface HistoryRecoveryRepo {
  start(input: { organizationId: string; sourceItemId: string; actorUserId: string; environment: PlaidEnvironmentName; requestedDays: 730 }): Promise<HistoryRecoveryRecord>
  get(organizationId: string, recoveryId: string): Promise<HistoryRecoveryRecord | null>
  list(organizationId: string, environment: PlaidEnvironmentName): Promise<HistoryRecoveryView[]>
  connectReplacement(input: { organizationId: string; recoveryId: string; providerItemId: string; institutionId: string; institutionName: string | null
    encryptedAccessToken: string; actorUserId: string; environment: PlaidEnvironmentName }): Promise<{ itemId: string }>
  markError(organizationId: string, recoveryId: string, code: string): Promise<void>
  prepareAccounts(organizationId: string, recoveryId: string): Promise<void>
  confirmAccount(input: { organizationId: string; recoveryId: string; matchId: string; replacementAccountId: string; actorUserId: string }): Promise<void>
  confirmTransaction(input: { organizationId: string; recoveryId: string; matchId: string; actorUserId: string }): Promise<void>
  reconcile(organizationId: string, recoveryId: string): Promise<void>
  activate(input: { organizationId: string; recoveryId: string; actorUserId: string }): Promise<void>
  /** Shadow account excluded from consolidated balances: replacement before activation, source after activation. */
  excludedBalanceAccountIds(organizationId: string, environment: PlaidEnvironmentName): Promise<string[]>
}

export interface HistoryRecoveryDeps extends BankConnectionDeps {
  recovery: HistoryRecoveryRepo
  historyRecoveryEnabled?: boolean
}

const enabled = (deps: HistoryRecoveryDeps) => {
  if (deps.historyRecoveryEnabled !== true) throw new BankConnectionError('feature_disabled', 403, 'Older-history recovery is not enabled on this site yet.')
}
const id = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !UUID.test(value)) throw new BankConnectionError('invalid_request', 400, `A valid ${label} is required.`)
  return value
}

export async function createHistoryRecoveryLinkToken(deps: HistoryRecoveryDeps, actor: BankActor, input: { sourceItemId?: unknown }) {
  assertAuthority(actor); enabled(deps)
  if (deps.environment !== 'production') throw new BankConnectionError('conflict', 409, 'Older-history recovery is available only for Production bank connections.')
  const sourceItemId = id(input.sourceItemId, 'bank connection')
  const source = await deps.repo.getItem(actor.organizationId, sourceItemId)
  if (!source || source.environment !== deps.environment) throw new BankConnectionError('not_found', 404, 'Bank connection not found.')
  if (source.status === 'disconnected') throw new BankConnectionError('conflict', 409, 'The existing bank connection is disconnected.')
  const recovery = await deps.recovery.start({ organizationId: actor.organizationId, sourceItemId, actorUserId: actor.userId, environment: deps.environment, requestedDays: 730 })
  if (recovery.replacementItemId) throw new BankConnectionError('conflict', 409, 'The replacement connection already exists. Continue its account review or synchronization.')
  try {
    const result = await deps.plaid.createLinkToken({ clientUserId: `${actor.organizationId}.${actor.userId}` })
    note(deps, { event: 'bank.history_recovery.link_created', organizationId: actor.organizationId, itemId: sourceItemId, outcome: '730_days' })
    return { ...result, mode: 'history_recovery' as const, recoveryId: recovery.id, sourceItemId, requestedDays: 730 as const }
  } catch (error) {
    await deps.recovery.markError(actor.organizationId, recovery.id, error instanceof PlaidApiFailure ? error.code : 'LINK_FAILED').catch(() => undefined)
    throw new BankConnectionError('plaid_unavailable', 502, 'The bank connection service is unavailable. Your existing connection was not changed.')
  }
}

export async function exchangeHistoryRecoveryPublicToken(deps: HistoryRecoveryDeps, actor: BankActor, input: { recoveryId?: unknown; publicToken?: unknown; institutionId?: unknown }) {
  assertAuthority(actor); enabled(deps)
  const recoveryId = id(input.recoveryId, 'recovery')
  const publicToken = typeof input.publicToken === 'string' ? input.publicToken.trim() : ''
  if (!PUBLIC_TOKEN.test(publicToken)) throw new BankConnectionError('invalid_request', 400, 'A valid link session is required.')
  const recovery = await deps.recovery.get(actor.organizationId, recoveryId)
  if (!recovery || recovery.environment !== deps.environment) throw new BankConnectionError('not_found', 404, 'History recovery not found.')
  if (recovery.replacementItemId) return { recoveryId, connection: { id: recovery.replacementItemId, provider: BANK_PROVIDER, status: 'healthy' as const, institutionName: recovery.institutionName }, outcome: 'already_connected' as const }

  let accessToken = ''
  let providerItemId = ''
  try {
    const exchanged = await deps.plaid.exchangePublicToken(publicToken)
    accessToken = exchanged.accessToken; providerItemId = exchanged.itemId
    const item = await deps.plaid.getItem(accessToken)
    if (item.itemId !== providerItemId || !item.institutionId || !recovery.institutionId || item.institutionId !== recovery.institutionId) {
      throw new BankConnectionError('conflict', 409, 'The replacement must be the same bank as the existing connection. The existing connection was not changed.')
    }
    const hinted = typeof input.institutionId === 'string' ? input.institutionId : null
    if (hinted && hinted !== item.institutionId) throw new BankConnectionError('conflict', 409, 'The bank identity could not be verified. The existing connection was not changed.')
    const owner = await deps.repo.findItemOwner(BANK_PROVIDER, providerItemId)
    if (owner) throw new BankConnectionError('conflict', 409, 'This replacement connection is already stored. Refresh the recovery status.')
    const institutionName = await deps.plaid.getInstitutionName(item.institutionId)
    const encryptedAccessToken = encryptProviderToken(accessToken, deps.key as Buffer, contextFor(actor, BANK_PROVIDER, providerItemId))
    const saved = await deps.recovery.connectReplacement({ organizationId: actor.organizationId, recoveryId, providerItemId, institutionId: item.institutionId,
      institutionName, encryptedAccessToken, actorUserId: actor.userId, environment: deps.environment })
    note(deps, { event: 'bank.history_recovery.connected', organizationId: actor.organizationId, itemId: saved.itemId, outcome: 'old_item_preserved' })
    return { recoveryId, connection: { id: saved.itemId, provider: BANK_PROVIDER, status: 'healthy' as const, institutionName }, outcome: 'created' as const }
  } catch (error) {
    // Only the newly-created, not-yet-persisted replacement is compensated. The source Item and all durable evidence are untouchable here.
    if (accessToken && providerItemId) { try { if (!(await deps.repo.findItemOwner(BANK_PROVIDER, providerItemId))) await deps.plaid.removeItem(accessToken) } catch { /* best effort */ } }
    await deps.recovery.markError(actor.organizationId, recoveryId, error instanceof PlaidApiFailure ? error.code : 'EXCHANGE_FAILED').catch(() => undefined)
    if (error instanceof BankConnectionError) throw error
    throw new BankConnectionError('persistence_failed', 503, 'The replacement connection could not be saved. Your existing connection was not changed.')
  }
}

export async function getHistoryRecoveries(deps: HistoryRecoveryDeps, actor: BankActor) {
  assertAuthority(actor)
  if (deps.historyRecoveryEnabled !== true) return { enabled: false, recoveries: [] as HistoryRecoveryView[] }
  return { enabled: true, recoveries: await deps.recovery.list(actor.organizationId, deps.environment) }
}

export async function prepareHistoryRecoveryAccounts(deps: HistoryRecoveryDeps, actor: BankActor, recoveryIdValue: unknown) {
  assertAuthority(actor); enabled(deps); const recoveryId = id(recoveryIdValue, 'recovery')
  await deps.recovery.prepareAccounts(actor.organizationId, recoveryId)
  return { recovery: (await deps.recovery.list(actor.organizationId, deps.environment)).find(r => r.id === recoveryId) ?? null }
}

export async function confirmHistoryRecoveryAccount(deps: HistoryRecoveryDeps, actor: BankActor, input: { recoveryId?: unknown; matchId?: unknown; replacementAccountId?: unknown }) {
  assertAuthority(actor); enabled(deps)
  await deps.recovery.confirmAccount({ organizationId: actor.organizationId, recoveryId: id(input.recoveryId, 'recovery'), matchId: id(input.matchId, 'account match'), replacementAccountId: id(input.replacementAccountId, 'replacement account'), actorUserId: actor.userId })
  return { confirmed: true as const }
}

export async function confirmHistoryRecoveryTransaction(deps: HistoryRecoveryDeps, actor: BankActor, input: { recoveryId?: unknown; matchId?: unknown }) {
  assertAuthority(actor); enabled(deps)
  await deps.recovery.confirmTransaction({ organizationId: actor.organizationId, recoveryId: id(input.recoveryId, 'recovery'), matchId: id(input.matchId, 'transaction match'), actorUserId: actor.userId })
  return { confirmed: true as const }
}

export async function reconcileHistoryRecovery(deps: HistoryRecoveryDeps, actor: BankActor, recoveryIdValue: unknown) {
  assertAuthority(actor); enabled(deps); const recoveryId = id(recoveryIdValue, 'recovery')
  await deps.recovery.reconcile(actor.organizationId, recoveryId)
  return { recovery: (await deps.recovery.list(actor.organizationId, deps.environment)).find(r => r.id === recoveryId) ?? null }
}

export async function activateHistoryRecovery(deps: HistoryRecoveryDeps, actor: BankActor, recoveryIdValue: unknown) {
  assertAuthority(actor); enabled(deps); const recoveryId = id(recoveryIdValue, 'recovery')
  await deps.recovery.activate({ organizationId: actor.organizationId, recoveryId, actorUserId: actor.userId })
  note(deps, { event: 'bank.history_recovery.activated', organizationId: actor.organizationId, outcome: 'old_item_retained' })
  return { activated: true as const, oldConnectionRetained: true as const }
}
