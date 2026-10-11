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
import { createHash, randomUUID } from 'node:crypto'
import { BankConnectionError, assertAuthority, decryptFor, loadCredential, note, type BankActor } from './bankConnectionService'
import type { BankAccountDeps } from './bankAccountService'
import { PlaidApiFailure, ProviderResponseError, type SyncPage } from './plaidPort'
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
/**
 * PLAID-1B background execution (Netlify background functions run up to 15 minutes). The run stops itself cleanly at 12 minutes, and its lease
 * (16 minutes) outlives the platform's hard limit, so a run killed by the platform can never overlap the run that later re-claims the Item.
 */
export const BACKGROUND_SYNC_BUDGET_MS = 12 * 60 * 1000
export const BACKGROUND_SYNC_LEASE_MS = 16 * 60 * 1000
export type SyncTrigger = 'owner' | 'owner_background'
export interface SyncRunOptions { budgetMs?: number; leaseMs?: number; trigger?: SyncTrigger }
const WEBHOOK_CODE = 'SYNC_UPDATES_AVAILABLE'

/** A database failure reduced to what is safe to log: the operation, the SQLSTATE and a schema constraint name. No message, row or value. */
export class PersistenceFailure extends Error {
  readonly operation: string
  readonly sqlState: string | null
  readonly constraint: string | null
  constructor(operation: string, sqlState: string | null, constraint: string | null) { super('bank sync persistence failed'); this.name = 'PersistenceFailure'; this.operation = operation; this.sqlState = sqlState; this.constraint = constraint }
}

/** Where in the flow a failure happened. Fixed vocabulary, safe to log. */
export type SyncStage = 'credential' | 'provider_request' | 'provider_response' | 'transform' | 'account_resolution' | 'evidence_persistence' | 'cursor_finalize'

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
  /**
   * Atomic compare-and-set to `syncing`; false when another sync holds a fresh lease. `startedAtIso` is stamped as the run's lease token
   * (PLAID-1B): finishing and failing only apply while the Item still carries this exact token.
   */
  claimSync(organizationId: string, itemId: string, staleBeforeIso: string, startedAtIso?: string): Promise<boolean>
  /**
   * Sets the cursor and releases the lease. Only `synced` stamps last_successful_sync_at; `waiting`/`unconfirmed` are remembered as a non-success reason.
   * With `startedAt` (PLAID-1B fencing) it applies only if this run still holds the lease and returns the number of rows changed (0 = superseded).
   */
  finishSync(organizationId: string, itemId: string, input: { cursor: string | null; state: SyncOutcome; startedAt?: string }): Promise<void | number>
  failSync(organizationId: string, itemId: string, code: string, startedAt?: string): Promise<void | number>
  /** PLAID-1C: release the lease after one bounded request, without touching the cursor or success stamps. Returns rows changed (0 = superseded). */
  releaseSync?(organizationId: string, itemId: string, startedAt: string): Promise<number>
  /** PLAID-1B append-only run audit (requires the separately approved table; a no-op until enabled). Never carries a cursor, token or transaction text. */
  recordRunEvent?(event: SyncRunEvent): Promise<void>
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
export interface BankSyncDeps extends BankAccountDeps {
  sync: BankSyncRepo
  now?: () => number
  /** PLAID-1B: the lease used to read and claim `syncing` (BACKGROUND_SYNC_LEASE_MS when background sync is enabled). Defaults to SYNC_LEASE_MS. */
  syncLeaseMs?: number
  /** PLAID-1B server switch (PLAID_BACKGROUND_SYNC_ENABLED === 'true'). Off by default. */
  backgroundSyncEnabled?: boolean
  /** PLAID-1C server switch (PLAID_RESUMABLE_SYNC_ENABLED === 'true'); requires the PLAID-1C SQL. Off by default. */
  resumableSyncEnabled?: boolean
  /** PLAID-1C: progress of an open resumable run (never a cursor). Only read while resumable sync is enabled. */
  staging?: {
    getProgress(organizationId: string, itemId: string): Promise<{ status: 'fetching' | 'fetched'; pagesStaged: number; restarts: number; startedAt: string; updatedAt: string } | null>
    /** PLAID-2H */
    getBlockedRun?(organizationId: string, itemId: string): Promise<{ runId: string; reason: 'RUN_TOO_LARGE' | 'APPLY_FAILED_REPEATEDLY'; stagedRows: number; pagesStaged: number; restarts: number; applyFailures: number; startedAt: string } | null>
  }
}

/** PLAID-1B: one append-only audit event of a sync run. Cursor progress is a one-way 16-hex fingerprint, never the cursor itself. */
export interface SyncRunEvent {
  organizationId: string
  itemId: string
  runId: string
  event: 'started' | 'completed' | 'failed' | 'superseded'
  trigger: SyncTrigger
  outcome?: SyncOutcome | null
  added?: number; modified?: number; removed?: number; pending?: number; pendingLinked?: number; pages?: number; restarts?: number; skipped?: number
  startCursorFingerprint?: string | null
  endCursorFingerprint?: string | null
  cursorAdvanced?: boolean
  errorCode?: string | null
  errorStage?: SyncStage | null
  recovery?: SyncRecovery | null
}
export type SyncRecovery = 'retry' | 'reconnect' | 'refresh_accounts' | 'owner_review' | 'none'
export const cursorFingerprint = (cursor: string | null): string | null => cursor ? createHash('sha256').update(cursor).digest('hex').slice(0, 16) : null

/** What the owner should do after a failure, from the sanitized failure code alone. */
export function recoveryFor(code: string | null | undefined): SyncRecovery {
  if (!code || code === WAITING_MARKER) return 'none'
  if (code === 'ITEM_LOGIN_REQUIRED') return 'reconnect'
  if (code === 'ACCOUNT_UNKNOWN') return 'refresh_accounts'
  if (code === 'RUN_TOO_LARGE' || code === 'APPLY_BLOCKED') return 'owner_review' // PLAID-1E: a blocked resumable run is never retried automatically
  if (code === 'CREDENTIAL_UNREADABLE' || code.startsWith('EVIDENCE_') || code === 'PROVIDER_RESPONSE_UNREADABLE' || code === 'SUPERSEDED') return code === 'SUPERSEDED' ? 'retry' : 'owner_review'
  return 'retry'
}
export const RECOVERY_TEXT: Record<SyncRecovery, string> = {
  none: '',
  retry: 'Nothing was marked as synced and the previous position is kept. Sync again; repeating it is safe.',
  reconnect: 'The bank needs you to sign in again. Use Reconnect, then sync.',
  refresh_accounts: 'The bank shared an account Cash OS has not saved yet. Review or refresh the accounts for this connection, then sync again.',
  owner_review: 'This needs owner review before syncing again. Nothing was saved and the previous position is kept.',
}
const clock = (deps: BankSyncDeps) => (deps.now ? deps.now() : Date.now())

export type SyncOutcome = 'synced' | 'waiting' | 'unconfirmed'
export type SyncUiState = SyncOutcome | 'not_synced' | 'syncing' | 'error' | 'login_required' | 'partial'
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
    const derived = deriveSyncState(item, state, deps.syncLeaseMs ?? SYNC_LEASE_MS, clock(deps))
    // PLAID-1C: an unfinished resumable update is shown as such; nothing from it is visible in evidence or reports until it completes.
    const progress = deps.resumableSyncEnabled === true && deps.staging ? await deps.staging.getProgress(actor.organizationId, item.id) : null
    const ui: SyncUiState = progress && derived !== 'syncing' && derived !== 'login_required' && derived !== 'error' ? 'partial' : derived
    // PLAID-2H: a run waiting for owner review is shown with what it holds (counts only) so the owner can decide; never a cursor.
    const blockedRun = deps.resumableSyncEnabled === true && deps.staging?.getBlockedRun ? await deps.staging.getBlockedRun(actor.organizationId, item.id) : null
    const lastErrorCode = ui === 'error' ? (state?.lastErrorCode ?? null) : null
    const recovery = ui === 'error' ? recoveryFor(lastErrorCode) : ui === 'login_required' ? 'reconnect' : 'none'
    out.push({ connectionId: item.id, state: ui, lastSyncedAt: state?.lastSuccessfulAt ?? null, lastAttemptAt: state?.completedAt ?? state?.startedAt ?? null, counts, updatesAvailable,
      lastErrorCode, recovery, recoveryText: RECOVERY_TEXT[recovery],
      blocked: blockedRun ? { runId: blockedRun.runId, reason: blockedRun.reason, stagedRows: blockedRun.stagedRows, pagesStaged: blockedRun.pagesStaged, restarts: blockedRun.restarts, applyFailures: blockedRun.applyFailures, startedAt: blockedRun.startedAt } : null,
      progress: progress ? { phase: progress.status === 'fetched' ? 'ready_to_apply' : 'fetching', pagesStaged: progress.pagesStaged, restarts: progress.restarts, startedAt: progress.startedAt, updatedAt: progress.updatedAt } : null })
  }
  return { syncs: out, backgroundSyncEnabled: deps.backgroundSyncEnabled === true, resumableSyncEnabled: deps.resumableSyncEnabled === true }
}

const unavailable = () => new BankConnectionError('plaid_unavailable', 502, 'The bank connection service is unavailable. Try again shortly.')

/** Internal: this run no longer holds the Item's lease (PLAID-1B fencing). */
class Superseded extends Error { constructor() { super('superseded'); this.name = 'Superseded' } }

/** Internal: a failure that has a sanitized code for the Item's error state and a safe message for the owner. */
class SyncFailure extends Error {
  readonly code: string
  readonly publicError: BankConnectionError
  readonly stage: SyncStage | null
  constructor(code: string, publicError: BankConnectionError, stage: SyncStage | null = null) { super(code); this.name = 'SyncFailure'; this.code = code; this.publicError = publicError; this.stage = stage }
}
/**
 * One full owner-requested sync of a connected Item. Never automatic. Safe to retry at any point.
 */
export async function syncTransactions(deps: BankSyncDeps, actor: BankActor, input: { itemId?: unknown }, options: SyncRunOptions = {}) {
  assertAuthority(actor)
  const org = actor.organizationId
  const budgetMs = options.budgetMs ?? SYNC_TIME_BUDGET_MS
  const leaseMs = options.leaseMs ?? deps.syncLeaseMs ?? SYNC_LEASE_MS
  const trigger: SyncTrigger = options.trigger ?? 'owner'
  // The lease must outlive the run's own budget, or a still-running sync could be overlapped by a re-claim.
  if (leaseMs <= budgetMs) throw new BankConnectionError('sync_failed', 500, 'The sync is not configured safely. Nothing was changed.')
  const { item, envelope } = await loadCredential(deps, actor, input.itemId as string)
  if (item.status === 'disconnected' || !envelope) throw new BankConnectionError('conflict', 409, 'This bank connection is disconnected. Connect it again first.')
  // The claim stamps THIS run's start time as its lease token. Finishing/failing below only apply while the Item still carries it, so a run whose
  // lease expired (killed, frozen, duplicate invocation) can never overwrite the cursor or state of the run that re-claimed the Item.
  const startedAt = new Date(clock(deps)).toISOString()
  const claimed = await deps.sync.claimSync(org, item.id, new Date(clock(deps) - leaseMs).toISOString(), startedAt)
  if (!claimed) throw new BankConnectionError('conflict', 409, 'A sync is already running. Try again in a moment.')
  const runId = randomUUID()
  note(deps, { event: 'bank.sync.started', organizationId: org, itemId: item.id, outcome: trigger })
  const audit = async (event: Omit<SyncRunEvent, 'organizationId' | 'itemId' | 'runId' | 'trigger'>) => {
    try { await deps.sync.recordRunEvent?.({ organizationId: org, itemId: item.id, runId, trigger, ...event }) } catch { /* the audit never changes a sync outcome */ }
  }

  let stage: SyncStage = 'credential'
  let startFingerprint: string | null = null
  const run = async () => {
    const token = decryptFor(deps, actor, item, envelope)
    const state = await deps.sync.getSyncState(org, item.id)
    const startCursor = state?.cursor ? state.cursor : null // the ORIGINAL cursor of this update; replaced only after a complete success
    const hadPriorSuccess = !!state?.lastSuccessfulAt
    startFingerprint = cursorFingerprint(startCursor)
    await audit({ event: 'started', startCursorFingerprint: startFingerprint })

    stage = 'provider_request'
    // Account discovery belongs to BANK-3: this sync does NOT call /accounts/get. Every transaction must resolve to a provider account of
    // THIS Item and organization that discovery already stored; anything else fails closed (below) and asks the owner to refresh accounts.
    const deadline = clock(deps) + budgetMs
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
          if ((await deps.sync.finishSync(org, item.id, { cursor: startCursor, state: hadPriorSuccess ? 'synced' : 'waiting', startedAt })) === 0) throw new Superseded()
          note(deps, { event: 'bank.sync.waiting', organizationId: org, itemId: item.id, code: 'PRODUCT_NOT_READY' })
          await audit({ event: 'completed', outcome: hadPriorSuccess ? 'synced' : 'waiting', pages: 0, restarts, startCursorFingerprint: startFingerprint, endCursorFingerprint: startFingerprint, cursorAdvanced: false })
          return { state: hadPriorSuccess ? 'synced' as const : 'waiting' as const, added: 0, modified: 0, removed: 0, pending: 0, pages: 0, restarts, skipped: 0 }
        }
        throw error
      }
    }
    stage = 'transform'
    const finalPage = pages[pages.length - 1]
    const finalCursor = finalPage.nextCursor || null

    // Resolve + transform EVERYTHING before writing anything: a rejected row fails the whole sync with the cursor untouched.
    stage = 'account_resolution'
    const accountRefs = new Map((await deps.accounts.listProviderAccounts(org, item.id)).map(a => [a.providerAccountId, a.id]))
    const unsupportedAccounts = new Set(pages.flatMap(p => p.accounts).filter(a => a.currency !== 'USD').map(a => a.accountId))
    let skipped = 0, redacted = 0
    stage = 'transform'
    const toRows = (list: SyncPage['added']): EvidenceRow[] => {
      const byId = new Map<string, EvidenceRow>()
      for (const t of list) {
        if (unsupportedAccounts.has(t.accountId)) { skipped += 1; continue }
        const out = toTransactionEvidence(t)
        if (out.kind === 'skipped') { skipped += 1; continue }
        const ref = accountRefs.get(out.evidence.providerAccountId)
        if (!ref) throw new SyncFailure('ACCOUNT_UNKNOWN', new BankConnectionError('sync_failed', 409, 'The bank returned a transaction for an account Cash OS does not know yet. Nothing was saved. Use "Refresh accounts", then sync again.'), 'account_resolution')
        redacted += out.evidence.redactedFields
        byId.set(out.evidence.providerTransactionId, { evidence: out.evidence, providerAccountRef: ref })
      }
      return [...byId.values()]
    }
    const plan = pages.map(p => ({ added: toRows(p.added), modified: toRows(p.modified), removed: p.removed.map(r => r.transactionId) }))

    // Persist in the provider's own order (idempotent upserts), THEN advance the cursor.
    stage = 'evidence_persistence'
    let added = 0, modified = 0, removedMarked = 0, pendingCount = 0
    // Pending-to-posted continuity that Plaid itself reported: posted rows in this update that name the pending row they replace.
    const pendingLinked = plan.reduce((n, step) => n + [...step.added, ...step.modified].filter(r => r.evidence.pendingProviderTransactionId !== null).length, 0)
    for (const step of plan) {
      withinBudget() // stopping here leaves valid, idempotent evidence behind but NEVER moves the cursor or stamps a success
      if (step.added.length) { await deps.sync.upsertEvidence(org, item.id, step.added); added += step.added.length; pendingCount += step.added.filter(r => r.evidence.pending).length }
      if (step.modified.length) { await deps.sync.upsertEvidence(org, item.id, step.modified); modified += step.modified.length }
      if (step.removed.length) removedMarked += await deps.sync.markRemoved(org, item.id, step.removed)
    }
    const hadData = plan.some(s => s.added.length + s.modified.length + s.removed.length > 0)
    // Synced/Waiting/Unconfirmed come ONLY from Plaid's documented transactions_update_status (see classifySyncOutcome).
    stage = 'cursor_finalize'
    const outcome = classifySyncOutcome(finalPage.updateStatus, hadData, hadPriorSuccess)
    // The committed cursor moves ONLY here, after every page was durably applied, and only while this run still holds its lease.
    if ((await deps.sync.finishSync(org, item.id, { cursor: finalCursor, state: outcome, startedAt })) === 0) throw new Superseded()
    await deps.sync.markNudgesProcessed(org, item.id, startedAt)
    note(deps, { event: 'bank.sync.completed', organizationId: org, itemId: item.id, outcome: `a${added}/m${modified}/r${removedMarked}/p${pendingCount}/pl${pendingLinked}/pg${pages.length}/rs${restarts}/sk${skipped}/rd${redacted}/${outcome}` })
    await audit({ event: 'completed', outcome, added, modified, removed: removedMarked, pending: pendingCount, pendingLinked, pages: pages.length, restarts, skipped,
      startCursorFingerprint: startFingerprint, endCursorFingerprint: cursorFingerprint(finalCursor), cursorAdvanced: finalCursor !== startCursor })
    return { state: outcome, added, modified, removed: removedMarked, pending: pendingCount, pendingLinked, pages: pages.length, restarts, skipped }
  }

  try {
    return await run()
  } catch (error) {
    // Classify by what actually failed AND where. Owner messages stay generic and safe; the failure code and the log line carry the
    // stage plus a sanitized class, so a provider-integration problem is diagnosable without exposing any provider data.
    let failure: SyncFailure
    let errorClass = 'none'
    let detail: string | undefined
    const at = stage
    if (error instanceof Superseded) {
      // Another run re-claimed this Item after our lease expired. Its state stands; ours changes nothing (evidence writes are idempotent upserts).
      note(deps, { event: 'bank.sync.superseded', organizationId: org, itemId: item.id, code: 'SUPERSEDED', stage: at })
      await audit({ event: 'superseded', errorCode: 'SUPERSEDED', errorStage: at, recovery: 'retry', startCursorFingerprint: startFingerprint, cursorAdvanced: false })
      throw new BankConnectionError('conflict', 409, 'A newer sync took over this connection. Nothing from this run changed the saved position. Check the status, then sync again if needed.')
    }
    if (error instanceof SyncFailure) { failure = error; errorClass = 'SyncFailure' }
    else if (error instanceof EvidenceRejected) {
      errorClass = 'EvidenceRejected'
      failure = new SyncFailure(`EVIDENCE_${error.reason.toUpperCase()}`, new BankConnectionError('sync_failed', 502, 'A bank transaction could not be stored safely. Nothing was saved; the issue has been recorded.'), 'transform')
    }
    else if (error instanceof PlaidApiFailure && error.code === 'ITEM_LOGIN_REQUIRED') {
      try { await deps.sync.markLoginRequired(org, item.id) } catch { /* the failure below is still reported */ }
      errorClass = 'PlaidApiFailure'; detail = `plaid=${error.type}/${error.code}`
      failure = new SyncFailure('ITEM_LOGIN_REQUIRED', new BankConnectionError('login_required', 409, 'The bank needs you to sign in again. Use Reconnect.'), 'provider_request')
    }
    else if (error instanceof PlaidApiFailure) {
      errorClass = 'PlaidApiFailure'; detail = `plaid=${error.type}/${error.code};http=${error.httpStatus ?? 'none'}`
      failure = new SyncFailure(error.code.slice(0, 64), unavailable(), 'provider_request')
    }
    else if (error instanceof ProviderResponseError) {
      errorClass = 'ProviderResponseError'
      failure = new SyncFailure('PROVIDER_RESPONSE_UNREADABLE', new BankConnectionError('sync_failed', 502, 'The bank connection service returned data Cash OS could not read. Nothing was saved; the issue has been recorded.'), 'provider_response')
    }
    else if (error instanceof PersistenceFailure) {
      errorClass = 'PersistenceFailure'; detail = `op=${error.operation};sqlstate=${error.sqlState ?? 'none'};constraint=${error.constraint ?? 'none'}`
      failure = new SyncFailure(`${at.toUpperCase()}_FAILED`, new BankConnectionError('persistence_failed', 503, 'The sync could not be saved. Nothing was changed; please try again.'), at)
    }
    else if (error instanceof BankConnectionError) { errorClass = 'BankConnectionError'; failure = new SyncFailure(error.code === 'credential_unreadable' ? 'CREDENTIAL_UNREADABLE' : error.code.toUpperCase(), error, at) }
    else {
      // An unexpected exception: record ONLY its constructor name and the stage, never its message, stack or any property.
      errorClass = error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(error.name) ? error.name : 'UnknownThrown'
      failure = new SyncFailure(`${at.toUpperCase()}_FAILED`, new BankConnectionError('persistence_failed', 503, 'The sync could not be saved. Nothing was changed; please try again.'), at)
    }
    try { await deps.sync.failSync(org, item.id, failure.code, startedAt) } catch { /* the lease expires on its own */ }
    note(deps, { event: 'bank.sync.failed', organizationId: org, itemId: item.id, code: failure.code, stage: failure.stage ?? at, errorClass, detail })
    await audit({ event: 'failed', errorCode: failure.code.slice(0, 64), errorStage: failure.stage ?? at, recovery: recoveryFor(failure.code), startCursorFingerprint: startFingerprint, cursorAdvanced: false })
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
