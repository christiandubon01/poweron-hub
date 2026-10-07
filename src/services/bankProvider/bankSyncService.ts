/**
 * src/services/bankProvider/bankSyncService.ts
 *
 * SERVER-ONLY (BANK-4). Durable /transactions/sync as a RAW EVIDENCE layer, provider-neutral above the Plaid adapter.
 *
 *   PLAID TRANSACTION = EVIDENCE, NOT A CASH OS TRANSACTION.
 *
 * It writes ONLY provider evidence (financial_provider_transactions), the Item's sync cursor/state, and webhook idempotency rows.
 * It never creates ledger rows, changes any Cash OS account, balance or include_in_cash, and interprets nothing (no categories,
 * transfers, obligations, projects, payroll or debt). Mapping a provider account is NOT required to store its evidence, and
 * unmapped evidence has no effect on Cash OS (mapping is a BANK-5 prerequisite for adoption, not for storage).
 *
 * Cursor rules: the durable cursor lives on the provider Item, server-side only, and moves ONLY after the whole update (every page,
 * until has_more is false) has been persisted. Evidence writes are idempotent upserts, so a retry from the previous committed cursor
 * is safe. TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION restarts the ENTIRE loop from the original cursor (bounded), and pages are
 * buffered in memory and applied only after a complete loop, so an aborted attempt leaves nothing behind.
 */
import { BankConnectionError, assertAuthority, decryptFor, loadCredential, note, type BankActor } from './bankConnectionService'
import type { BankAccountDeps } from './bankAccountService'
import { PlaidApiFailure, type SyncPage } from './plaidPort'
import { toTransactionEvidence, EvidenceRejected, type TransactionEvidence } from './transactionEvidence'

export const SYNC_PAGE_SIZE = 500
export const MAX_MUTATION_RESTARTS = 3
export const MAX_PAGES = 100
/** Explicit memory bound: every page is buffered before anything is written (<= 100 pages x 500 = 50,000 transactions, a few tens of MB). */
export const MAX_BUFFERED_TRANSACTIONS = MAX_PAGES * SYNC_PAGE_SIZE
/**
 * Wall-clock budget for one sync request. plaid-sync has NO function-specific timeout in netlify.toml, so it runs under Netlify's
 * default synchronous limit (10 s). The guard stops cleanly BEFORE that limit instead of being killed mid-write.
 */
export const SYNC_TIME_BUDGET_MS = 8_000
/** A `syncing` lease older than this is considered abandoned (a killed invocation) and may be re-claimed. Far above the longest possible run. */
export const SYNC_LEASE_MS = 2 * 60 * 1000
const WEBHOOK_CODE = 'SYNC_UPDATES_AVAILABLE'

export interface SyncState {
  status: 'idle' | 'syncing' | 'failed'
  cursor: string | null
  startedAt: string | null
  completedAt: string | null
  lastSuccessfulAt: string | null
  lastErrorCode: string | null
}
export interface EvidenceRow { evidence: TransactionEvidence; providerAccountRef: string }
export interface EvidenceCounts { posted: number; pending: number; removed: number }

export interface BankSyncRepo {
  getSyncState(organizationId: string, itemId: string): Promise<SyncState | null>
  /** Atomic compare-and-set to `syncing`; false when another sync holds a fresh lease. */
  claimSync(organizationId: string, itemId: string, staleBeforeIso: string): Promise<boolean>
  /** Sets the cursor and releases the lease. Only `synced` stamps last_successful_sync_at; `waiting`/`unconfirmed` are remembered as a non-success reason. */
  finishSync(organizationId: string, itemId: string, input: { cursor: string | null; state: SyncOutcome }): Promise<void>
  failSync(organizationId: string, itemId: string, code: string): Promise<void>
  markLoginRequired(organizationId: string, itemId: string): Promise<void>
  /** Idempotent on (item, provider transaction id). Re-seen/modified rows are un-removed and updated; first_seen_at/created_at never change. */
  upsertEvidence(organizationId: string, itemId: string, rows: EvidenceRow[]): Promise<void>
  /** Marks removed_at (never deletes). Returns how many existing, not-yet-removed rows were marked. */
  markRemoved(organizationId: string, itemId: string, providerTransactionIds: string[]): Promise<number>
  countEvidence(organizationId: string, itemId: string): Promise<EvidenceCounts>
  recordWebhook(input: { organizationId: string; itemId: string; eventKey: string; webhookType: string; webhookCode: string }): Promise<'recorded' | 'duplicate'>
  hasPendingNudge(organizationId: string, itemId: string): Promise<boolean>
  markNudgesProcessed(organizationId: string, itemId: string, receivedBeforeIso: string): Promise<void>
}
export interface BankSyncDeps extends BankAccountDeps { sync: BankSyncRepo; now?: () => number }
const clock = (deps: BankSyncDeps) => (deps.now ? deps.now() : Date.now())

export type SyncOutcome = 'synced' | 'waiting' | 'unconfirmed'
export type SyncUiState = SyncOutcome | 'not_synced' | 'syncing' | 'error' | 'login_required'
/** Persisted (in last_error_code, which is otherwise empty after a non-failed sync) so Waiting survives a page reload. */
export const WAITING_MARKER = 'WAITING_FOR_PLAID'
const COMPLETE_STATUSES = new Set(['INITIAL_UPDATE_COMPLETE', 'HISTORICAL_UPDATE_COMPLETE'])

/**
 * Exact status mapping, based ONLY on Plaid's documented transactions_update_status:
 *   INITIAL_UPDATE_COMPLETE / HISTORICAL_UPDATE_COMPLETE -> synced (even if no transaction came back: Plaid says the pull is done)
 *   NOT_READY ("the Item is pending transaction pull") -> waiting, unless we already synced successfully before
 *   anything else (absent / TRANSACTIONS_UPDATE_STATUS_UNKNOWN / future values) -> synced ONLY if data actually arrived or an earlier sync
 *     succeeded; otherwise `unconfirmed`. An empty answer with an unknown status is NOT assumed to mean "still preparing".
 */
export function classifySyncOutcome(updateStatus: string | null, hadData: boolean, hadPriorSuccess: boolean): SyncOutcome {
  if (updateStatus !== null && COMPLETE_STATUSES.has(updateStatus)) return 'synced'
  if (updateStatus === 'NOT_READY') return hadPriorSuccess ? 'synced' : 'waiting'
  return hadData || hadPriorSuccess ? 'synced' : 'unconfirmed'
}

export function deriveSyncState(item: { status: string }, s: SyncState | null, leaseMs = SYNC_LEASE_MS, nowMs = Date.now()): SyncUiState {
  if (item.status === 'login_required') return 'login_required'
  if (!s) return 'not_synced'
  if (s.status === 'syncing' && s.startedAt && nowMs - Date.parse(s.startedAt) < leaseMs) return 'syncing'
  if (s.status === 'failed') return 'error'
  if (s.lastSuccessfulAt) return 'synced'
  if (s.completedAt) return s.lastErrorCode === WAITING_MARKER ? 'waiting' : 'unconfirmed' // the call worked but "synced" is not proven; waiting ONLY when Plaid said NOT_READY
  return 'not_synced'
}

/** Sanitized sync status for every live connection of the caller's organization. Counts only: no descriptions, ids or amounts. */
export async function getSyncStatus(deps: BankSyncDeps, actor: BankActor) {
  assertAuthority(actor)
  const items = (await deps.repo.listItems(actor.organizationId)).filter(i => i.status !== 'disconnected')
  const out = []
  for (const item of items) {
    const [state, counts, updatesAvailable] = await Promise.all([
      deps.sync.getSyncState(actor.organizationId, item.id), deps.sync.countEvidence(actor.organizationId, item.id), deps.sync.hasPendingNudge(actor.organizationId, item.id),
    ])
    out.push({ connectionId: item.id, state: deriveSyncState(item, state, SYNC_LEASE_MS, clock(deps)), lastSyncedAt: state?.lastSuccessfulAt ?? null, counts, updatesAvailable })
  }
  return { syncs: out }
}

const unavailable = () => new BankConnectionError('plaid_unavailable', 502, 'The bank connection service is unavailable. Try again shortly.')

/** Internal: a failure that has a sanitized code for the Item's error state and a safe message for the owner. */
class SyncFailure extends Error {
  readonly code: string
  readonly publicError: BankConnectionError
  constructor(code: string, publicError: BankConnectionError) { super(code); this.name = 'SyncFailure'; this.code = code; this.publicError = publicError }
}
/**
 * One full owner-requested sync of a connected Item. Never automatic. Safe to retry at any point.
 */
export async function syncTransactions(deps: BankSyncDeps, actor: BankActor, input: { itemId?: unknown }) {
  assertAuthority(actor)
  const org = actor.organizationId
  const { item, envelope } = await loadCredential(deps, actor, input.itemId as string)
  if (item.status === 'disconnected' || !envelope) throw new BankConnectionError('conflict', 409, 'This bank connection is disconnected. Connect it again first.')
  const claimed = await deps.sync.claimSync(org, item.id, new Date(clock(deps) - SYNC_LEASE_MS).toISOString())
  if (!claimed) throw new BankConnectionError('conflict', 409, 'A sync is already running. Try again in a moment.')
  const startedAt = new Date(clock(deps)).toISOString()
  note(deps, { event: 'bank.sync.started', organizationId: org, itemId: item.id })

  const run = async () => {
    const token = decryptFor(deps, actor, item, envelope)
    const state = await deps.sync.getSyncState(org, item.id)
    const startCursor = state?.cursor ? state.cursor : null // the ORIGINAL cursor of this update; replaced only after a complete success
    const hadPriorSuccess = !!state?.lastSuccessfulAt

    // Account discovery belongs to BANK-3: this sync does NOT call /accounts/get. Every transaction must resolve to a provider account of
    // THIS Item and organization that discovery already stored; anything else fails closed (below) and asks the owner to refresh accounts.
    const deadline = clock(deps) + SYNC_TIME_BUDGET_MS
    const withinBudget = () => {
      if (clock(deps) > deadline) throw new SyncFailure('SYNC_TIME_BUDGET', new BankConnectionError('sync_failed', 503, 'The sync took too long to finish in one request. Nothing was marked as synced and your previous position is kept. Try again.'))
    }

    // Collect the whole update. A mutation mid-pagination discards everything and restarts from the ORIGINAL cursor.
    let pages: SyncPage[] = []
    let restarts = 0
    for (;;) {
      pages = []
      let cursor = startCursor
      try {
        for (;;) {
          withinBudget()
          if (pages.length >= MAX_PAGES) throw new SyncFailure('SYNC_TOO_LARGE', new BankConnectionError('sync_failed', 502, 'The bank returned more data than one sync can handle. Nothing was saved; try again.'))
          const page = await deps.plaid.syncTransactions({ accessToken: token, cursor, count: SYNC_PAGE_SIZE })
          pages.push(page)
          if (pages.reduce((n, p) => n + p.added.length + p.modified.length + p.removed.length, 0) > MAX_BUFFERED_TRANSACTIONS) throw new SyncFailure('SYNC_TOO_LARGE', new BankConnectionError('sync_failed', 502, 'The bank returned more data than one sync can handle. Nothing was saved; try again.'))
          cursor = page.nextCursor || null
          if (!page.hasMore) break
        }
        break
      } catch (error) {
        if (error instanceof PlaidApiFailure && error.code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION') {
          restarts += 1
          note(deps, { event: 'bank.sync.mutation_restart', organizationId: org, itemId: item.id, outcome: String(restarts) })
          if (restarts > MAX_MUTATION_RESTARTS) throw new SyncFailure('SYNC_CONFLICT', new BankConnectionError('conflict', 409, 'The bank data kept changing during the sync. Nothing was saved; try again shortly.'))
          continue
        }
        if (error instanceof PlaidApiFailure && error.code === 'PRODUCT_NOT_READY') {
          // Plaid is still preparing the first data: a WAITING state, not a failure. The cursor stays where it was.
          await deps.sync.finishSync(org, item.id, { cursor: startCursor, state: hadPriorSuccess ? 'synced' : 'waiting' })
          note(deps, { event: 'bank.sync.waiting', organizationId: org, itemId: item.id, code: 'PRODUCT_NOT_READY' })
          return { state: hadPriorSuccess ? 'synced' as const : 'waiting' as const, added: 0, modified: 0, removed: 0, pending: 0, pages: 0, restarts, skipped: 0 }
        }
        throw error
      }
    }
    const finalPage = pages[pages.length - 1]
    const finalCursor = finalPage.nextCursor || null

    // Resolve + transform EVERYTHING before writing anything: a rejected row fails the whole sync with the cursor untouched.
    const accountRefs = new Map((await deps.accounts.listProviderAccounts(org, item.id)).map(a => [a.providerAccountId, a.id]))
    const unsupportedAccounts = new Set(pages.flatMap(p => p.accounts).filter(a => a.currency !== 'USD').map(a => a.accountId))
    let skipped = 0, redacted = 0
    const toRows = (list: SyncPage['added']): EvidenceRow[] => {
      const byId = new Map<string, EvidenceRow>()
      for (const t of list) {
        if (unsupportedAccounts.has(t.accountId)) { skipped += 1; continue }
        const out = toTransactionEvidence(t)
        if (out.kind === 'skipped') { skipped += 1; continue }
        const ref = accountRefs.get(out.evidence.providerAccountId)
        if (!ref) throw new SyncFailure('ACCOUNT_UNKNOWN', new BankConnectionError('sync_failed', 409, 'The bank returned a transaction for an account Cash OS does not know yet. Nothing was saved. Use "Refresh accounts", then sync again.'))
        redacted += out.evidence.redactedFields
        byId.set(out.evidence.providerTransactionId, { evidence: out.evidence, providerAccountRef: ref })
      }
      return [...byId.values()]
    }
    const plan = pages.map(p => ({ added: toRows(p.added), modified: toRows(p.modified), removed: p.removed.map(r => r.transactionId) }))

    // Persist in the provider's own order (idempotent upserts), THEN advance the cursor.
    let added = 0, modified = 0, removedMarked = 0, pendingCount = 0
    for (const step of plan) {
      withinBudget() // stopping here leaves valid, idempotent evidence behind but NEVER moves the cursor or stamps a success
      if (step.added.length) { await deps.sync.upsertEvidence(org, item.id, step.added); added += step.added.length; pendingCount += step.added.filter(r => r.evidence.pending).length }
      if (step.modified.length) { await deps.sync.upsertEvidence(org, item.id, step.modified); modified += step.modified.length }
      if (step.removed.length) removedMarked += await deps.sync.markRemoved(org, item.id, step.removed)
    }
    const hadData = plan.some(s => s.added.length + s.modified.length + s.removed.length > 0)
    // Synced/Waiting/Unconfirmed come ONLY from Plaid's documented transactions_update_status (see classifySyncOutcome).
    const outcome = classifySyncOutcome(finalPage.updateStatus, hadData, hadPriorSuccess)
    await deps.sync.finishSync(org, item.id, { cursor: finalCursor, state: outcome })
    await deps.sync.markNudgesProcessed(org, item.id, startedAt)
    note(deps, { event: 'bank.sync.completed', organizationId: org, itemId: item.id, outcome: `a${added}/m${modified}/r${removedMarked}/p${pendingCount}/pg${pages.length}/rs${restarts}/sk${skipped}/rd${redacted}/${outcome}` })
    return { state: outcome, added, modified, removed: removedMarked, pending: pendingCount, pages: pages.length, restarts, skipped }
  }

  try {
    return await run()
  } catch (error) {
    let failure: SyncFailure
    if (error instanceof SyncFailure) failure = error
    else if (error instanceof EvidenceRejected) failure = new SyncFailure(`EVIDENCE_${error.reason.toUpperCase()}`, new BankConnectionError('sync_failed', 502, 'A bank transaction could not be stored safely. Nothing was saved; the issue has been recorded.'))
    else if (error instanceof PlaidApiFailure && error.code === 'ITEM_LOGIN_REQUIRED') {
      try { await deps.sync.markLoginRequired(org, item.id) } catch { /* the failure below is still reported */ }
      failure = new SyncFailure('ITEM_LOGIN_REQUIRED', new BankConnectionError('login_required', 409, 'The bank needs you to sign in again. Use Reconnect.'))
    }
    else if (error instanceof PlaidApiFailure) failure = new SyncFailure(error.code.slice(0, 64), unavailable())
    else if (error instanceof BankConnectionError) failure = new SyncFailure(error.code === 'credential_unreadable' ? 'CREDENTIAL_UNREADABLE' : error.code.toUpperCase(), error)
    else failure = new SyncFailure('SYNC_FAILED', new BankConnectionError('persistence_failed', 503, 'The sync could not be saved. Nothing was changed; please try again.'))
    try { await deps.sync.failSync(org, item.id, failure.code) } catch { /* the lease expires on its own */ }
    note(deps, { event: 'bank.sync.failed', organizationId: org, itemId: item.id, code: failure.code })
    throw failure.publicError
  }
}

/**
 * A verified Plaid webhook, already resolved to an Item. WEBHOOK = NUDGE, SYNC = TRUTH: it records an idempotent event (no payload is
 * stored, no transaction is read from it) which the status endpoint surfaces as "updates available" and the next owner sync consumes.
 * The sync is NOT run inside the webhook request (Plaid expects a reply within 10 seconds; a sync can take longer).
 */
export async function recordVerifiedWebhook(deps: Pick<BankSyncDeps, 'repo' | 'sync' | 'log'>, input: { webhookType: unknown; webhookCode: unknown; plaidItemId: unknown; bodyHash: string }) {
  if (input.webhookType !== 'TRANSACTIONS' || input.webhookCode !== WEBHOOK_CODE || typeof input.plaidItemId !== 'string' || !input.plaidItemId) return { outcome: 'ignored' as const }
  const owner = await deps.repo.findItemOwner('plaid', input.plaidItemId)
  if (!owner) return { outcome: 'ignored' as const } // unknown Item: acknowledge without leaking anything
  const outcome = await deps.sync.recordWebhook({ organizationId: owner.organizationId, itemId: owner.id, eventKey: input.bodyHash, webhookType: 'TRANSACTIONS', webhookCode: WEBHOOK_CODE })
  note(deps as BankSyncDeps, { event: 'bank.webhook.received', organizationId: owner.organizationId, itemId: owner.id, outcome })
  return { outcome }
}
