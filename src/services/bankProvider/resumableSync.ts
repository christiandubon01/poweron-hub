/**
 * src/services/bankProvider/resumableSync.ts
 *
 * SERVER-ONLY (PLAID-1C). Transaction sync that fits short (Netlify Free) function requests: ONE Plaid update is fetched over as many bounded
 * requests as it needs, staged durably, and then applied together with the committed cursor in ONE database transaction.
 *
 *   PLAID TRANSACTION = EVIDENCE, NOT A CASH OS TRANSACTION. Nothing here touches the ledger, interpretations, mappings or reports.
 *
 * Why staging and not "save the cursor after every page": Plaid requires restarting an update from the cursor it STARTED with when
 * TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION occurs, and an update's changes may span pages (a pending row removed on one page, its posted
 * replacement added on another). So:
 *   - the committed cursor (financial_provider_items.sync_cursor) moves ONLY inside financial_provider_sync_apply_run, atomically with the evidence;
 *   - page cursors live only on the staging run, as resume points; a mutation error restarts a NEW generation from the run's start cursor and
 *     discards everything staged before (older generations can never be applied);
 *   - staged rows are invisible to every report; evidence changes all at once or not at all.
 * Concurrency: every request holds the Item's sync lease (compare-and-set, token = its start time); staging is compare-and-set on
 * (generation, page number); apply requires the same lease token AND that the committed cursor still equals the run's start cursor.
 */
import { BankConnectionError, assertAuthority, decryptFor, loadCredential, note, type BankActor } from './bankConnectionService'
import { PlaidApiFailure, ProviderResponseError, type SyncPage } from './plaidPort'
import { EvidenceRejected, toTransactionEvidence } from './transactionEvidence'
import { PersistenceFailure, SYNC_LEASE_MS, SYNC_PAGE_SIZE, classifySyncOutcome, recoveryFor, type BankSyncDeps } from './bankSyncService'
import type { StagedChange, SyncStagingRepo } from './syncStagingRepo'

/** A request starts a new page fetch only before this point, leaving room for one slow Plaid page plus staging inside a 10-second limit. */
export const STEP_BUDGET_MS = 5_000
/** The final apply starts only with at least this much of the request left; otherwise the next request applies first thing. */
export const APPLY_MIN_REMAINING_MS = 4_000
export const MAX_RUN_RESTARTS = 3
/** The strictest synchronous limit any Netlify source cites (10 s); newer documentation cites 30-60 s. Timing assumes the strictest. */
export const REQUEST_LIMIT_MS = 10_000
/** PLAID-1E: the most rows one run may stage (the SQL enforces the same ceiling and refuses to raise it). Larger updates need owner review. */
export const MAX_STAGED_ROWS = 50_000

export interface ResumableSyncDeps extends BankSyncDeps { staging: SyncStagingRepo; /** Lowers (never raises) MAX_STAGED_ROWS; tests only. */ maxStagedRows?: number }

export type StepPhase = 'fetching' | 'ready_to_apply' | 'complete' | 'waiting'
export interface StepResult {
  phase: StepPhase
  /** true = call again to continue; the run is durable, so it can also be continued later (browser closed, network lost). */
  more: boolean
  pagesStaged: number
  restarts: number
  state?: 'synced' | 'waiting' | 'unconfirmed'
  added?: number; modified?: number; removed?: number; pendingLinked?: number
}

const clock = (deps: BankSyncDeps) => (deps.now ? deps.now() : Date.now())
class StepFailure extends Error {
  constructor(readonly code: string, readonly publicError: BankConnectionError, readonly keepRun = true) { super(code); this.name = 'StepFailure' }
}
/** A blocked run (too large, or its final apply failed repeatedly): staged rows are kept, nothing is retried automatically. */
const blocked = (reason: string | null) => reason === 'RUN_TOO_LARGE'
  ? new StepFailure('RUN_TOO_LARGE', new BankConnectionError('sync_failed', 409, 'This bank update is larger than Cash OS syncs automatically. Nothing was saved and the previous position is kept; this needs owner review.'))
  : new StepFailure('APPLY_BLOCKED', new BankConnectionError('sync_failed', 409, 'Saving this bank update failed repeatedly. Nothing was saved and the previous position is kept; this needs owner review before syncing again.'))
const superseded = () => new StepFailure('SUPERSEDED', new BankConnectionError('conflict', 409, 'Another sync request took over this connection. Nothing was lost; press Sync to continue.'))

/** Allowlisted, validated staging rows for one page. Fails closed (nothing staged) on an unknown account or unstorable evidence. */
function toStagedChanges(page: SyncPage, accountRefs: Map<string, string>): { changes: StagedChange[]; skipped: number } {
  const unsupported = new Set(page.accounts.filter(a => a.currency !== 'USD').map(a => a.accountId))
  const changes: StagedChange[] = []
  let skipped = 0
  const push = (kind: 'added' | 'modified', list: SyncPage['added']) => {
    for (const t of list) {
      if (unsupported.has(t.accountId)) { skipped += 1; continue }
      const out = toTransactionEvidence(t)
      if (out.kind === 'skipped') { skipped += 1; continue }
      const ref = accountRefs.get(out.evidence.providerAccountId)
      if (!ref) throw new StepFailure('ACCOUNT_UNKNOWN', new BankConnectionError('sync_failed', 409, 'The bank returned a transaction for an account Cash OS has not saved yet. Nothing from this page was saved. Review or refresh the accounts for this connection, then press Sync to continue.'))
      const e = out.evidence
      changes.push({ change_kind: kind, provider_transaction_id: e.providerTransactionId, provider_account_ref: ref, pending: e.pending,
        pending_provider_transaction_id: e.pendingProviderTransactionId, provider_amount: e.providerAmount, provider_amount_minor: e.providerAmountMinor, currency: 'USD',
        transaction_date: e.transactionDate, authorized_date: e.authorizedDate, name: e.name, merchant_name: e.merchantName, provider_category: e.providerCategory })
    }
  }
  // Provider order within a page: added, then modified, then removed (the synchronous sync applies them in the same order).
  push('added', page.added)
  push('modified', page.modified)
  for (const r of page.removed) {
    if (typeof r.transactionId !== 'string' || !/^[A-Za-z0-9_=+/-]{1,128}$/.test(r.transactionId)) throw new EvidenceRejected('invalid_id')
    changes.push({ change_kind: 'removed', provider_transaction_id: r.transactionId })
  }
  return { changes, skipped }
}

/**
 * ONE bounded request of a resumable owner sync. Safe to call repeatedly, concurrently (the loser gets a 409 and simply retries) and after any
 * interruption: progress is durable after every staged page, and evidence plus cursor change only in the final atomic apply.
 */
export async function resumableSyncStep(deps: ResumableSyncDeps, actor: BankActor, input: { itemId?: unknown }): Promise<StepResult> {
  assertAuthority(actor)
  if (deps.resumableSyncEnabled !== true) throw new BankConnectionError('feature_disabled', 403, 'Resumable sync is not enabled yet.')
  if (deps.backgroundSyncEnabled === true) throw new BankConnectionError('conflict', 409, 'This server is configured for background sync; resumable sync is off.')
  if (!deps.sync.releaseSync) throw new BankConnectionError('sync_failed', 500, 'The sync is not configured safely. Nothing was changed.')
  const org = actor.organizationId
  const { item, envelope } = await loadCredential(deps, actor, input.itemId as string)
  if (item.status === 'disconnected' || !envelope) throw new BankConnectionError('conflict', 409, 'This bank connection is disconnected. Connect it again first.')

  const requestStart = clock(deps)
  const startedAt = new Date(requestStart).toISOString()
  const deadline = requestStart + STEP_BUDGET_MS
  if (!(await deps.sync.claimSync(org, item.id, new Date(clock(deps) - SYNC_LEASE_MS).toISOString(), startedAt))) {
    throw new BankConnectionError('conflict', 409, 'Another sync request for this connection is running. Wait a moment, then continue.')
  }
  let runId: string | null = null
  try {
    const token = decryptFor(deps, actor, item, envelope)
    const state = await deps.sync.getSyncState(org, item.id)
    const hadPriorSuccess = !!state?.lastSuccessfulAt
    let run = await deps.staging.openRun(org, item.id)
    runId = run.runId
    if (run.status === 'blocked') throw blocked(run.blockedReason) // no Plaid call, no apply: owner review first
    const maxRows = Math.min(MAX_STAGED_ROWS, deps.maxStagedRows ?? MAX_STAGED_ROWS)
    let hadData = run.stagedRows > 0
    const accountRefs = new Map((await deps.accounts.listProviderAccounts(org, item.id)).map(a => [a.providerAccountId, a.id]))

    while (run.status === 'fetching' && clock(deps) < deadline) {
      let page: SyncPage
      try {
        page = await deps.plaid.syncTransactions({ accessToken: token, cursor: run.pageCursor, count: SYNC_PAGE_SIZE })
      } catch (error) {
        if (error instanceof PlaidApiFailure && error.code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION') {
          // Plaid's rule: restart the WHOLE update from the cursor it started with. Pages staged so far belong to an older generation now.
          if (run.restarts >= MAX_RUN_RESTARTS) {
            await deps.staging.abandonRun(org, run.runId, 'SYNC_CONFLICT')
            throw new StepFailure('SYNC_CONFLICT', new BankConnectionError('conflict', 409, 'The bank data kept changing during the sync. Nothing was saved; press Sync again shortly to start over.'), false)
          }
          if ((await deps.staging.restartRun(org, run.runId, run.generation)) !== 'restarted') throw superseded()
          note(deps, { event: 'bank.sync.mutation_restart', organizationId: org, itemId: item.id, outcome: String(run.restarts + 1) })
          run = { ...run, generation: run.generation + 1, pageCursor: run.startCursor, pagesStaged: 0, restarts: run.restarts + 1, stagedRows: 0 }
          hadData = false
          continue
        }
        if (error instanceof PlaidApiFailure && error.code === 'PRODUCT_NOT_READY' && run.pagesStaged === 0) {
          // Plaid is still preparing the first data: nothing to stage. The committed cursor stays; the empty run is closed.
          await deps.staging.abandonRun(org, run.runId, 'NOT_READY')
          if ((await deps.sync.finishSync(org, item.id, { cursor: run.startCursor, state: hadPriorSuccess ? 'synced' : 'waiting', startedAt })) === 0) throw superseded()
          return { phase: 'waiting', more: false, pagesStaged: 0, restarts: run.restarts, state: hadPriorSuccess ? 'synced' : 'waiting' }
        }
        throw error
      }
      if (!page.nextCursor) throw new ProviderResponseError()
      const { changes } = toStagedChanges(page, accountRefs)
      const staged = await deps.staging.stagePage(org, { runId: run.runId, generation: run.generation, pageNo: run.pagesStaged, nextCursor: page.nextCursor,
        hasMore: page.hasMore, updateStatus: page.updateStatus, changes, maxRows })
      if (staged === 'blocked') throw blocked('RUN_TOO_LARGE')
      if (staged !== 'staged') throw superseded()
      hadData = hadData || changes.length > 0
      run = { ...run, pagesStaged: run.pagesStaged + 1, pageCursor: page.nextCursor, updateStatus: page.updateStatus ?? run.updateStatus,
        status: page.hasMore ? 'fetching' : 'fetched', stagedRows: run.stagedRows + changes.length }
    }

    if (run.status === 'fetched' && requestStart + REQUEST_LIMIT_MS - clock(deps) >= APPLY_MIN_REMAINING_MS) {
      const outcome = classifySyncOutcome(run.updateStatus, hadData, hadPriorSuccess)
      let applied
      try {
        applied = await deps.staging.applyRun(org, { itemId: item.id, runId: run.runId, generation: run.generation, leaseStartedAt: startedAt, outcome })
      } catch (error) {
        // The apply rolled back (evidence, cursor and staged rows unchanged). Count it; the third failure blocks the run for owner review.
        let verdict: 'retry' | 'blocked' | 'stale' = 'retry'
        try { verdict = await deps.staging.recordApplyFailure(org, { itemId: item.id, runId: run.runId, generation: run.generation, leaseStartedAt: startedAt }) } catch { /* the original failure is reported */ }
        if (verdict === 'blocked') throw blocked('APPLY_FAILED_REPEATEDLY')
        throw error
      }
      if (applied.outcome === 'blocked') throw blocked(null)
      if (applied.outcome === 'lease_lost' || applied.outcome === 'stale') throw superseded()
      await deps.sync.markNudgesProcessed(org, item.id, startedAt)
      note(deps, { event: 'bank.sync.completed', organizationId: org, itemId: item.id, outcome: `a${applied.added}/m${applied.modified}/r${applied.removed}/pl${applied.pendingLinked}/pg${run.pagesStaged}/rs${run.restarts}/${outcome}/resumable` })
      return { phase: 'complete', more: false, pagesStaged: run.pagesStaged, restarts: run.restarts, state: outcome,
        added: applied.added, modified: applied.modified, removed: applied.removed, pendingLinked: applied.pendingLinked }
    }

    // Out of time for this request: progress is durable. Release the lease WITHOUT moving the committed cursor.
    if ((await deps.sync.releaseSync(org, item.id, startedAt)) === 0) throw superseded()
    note(deps, { event: 'bank.sync.step', organizationId: org, itemId: item.id, outcome: `${run.status}/pg${run.pagesStaged}/rs${run.restarts}` })
    return { phase: run.status === 'fetched' ? 'ready_to_apply' : 'fetching', more: true, pagesStaged: run.pagesStaged, restarts: run.restarts }
  } catch (error) {
    let failure: StepFailure
    if (error instanceof StepFailure) failure = error
    else if (error instanceof PlaidApiFailure && error.code === 'ITEM_LOGIN_REQUIRED') {
      try { await deps.sync.markLoginRequired(org, item.id) } catch { /* reported below */ }
      failure = new StepFailure('ITEM_LOGIN_REQUIRED', new BankConnectionError('login_required', 409, 'The bank needs you to sign in again. Use Reconnect, then press Sync to continue where it stopped.'))
    } else if (error instanceof PlaidApiFailure) {
      failure = new StepFailure(error.code.slice(0, 64), new BankConnectionError('plaid_unavailable', 502, 'The bank connection service is unavailable. Progress so far is kept; press Sync to continue.'))
    } else if (error instanceof EvidenceRejected) {
      failure = new StepFailure(`EVIDENCE_${error.reason.toUpperCase()}`, new BankConnectionError('sync_failed', 502, 'A bank transaction could not be stored safely. Nothing from that page was saved; this needs owner review.'))
    } else if (error instanceof ProviderResponseError) {
      failure = new StepFailure('PROVIDER_RESPONSE_UNREADABLE', new BankConnectionError('sync_failed', 502, 'The bank connection service returned data Cash OS could not read. This needs owner review.'))
    } else if (error instanceof PersistenceFailure) {
      failure = new StepFailure(`${error.operation.toUpperCase()}_FAILED`.slice(0, 64), new BankConnectionError('persistence_failed', 503, 'The sync progress could not be saved. Nothing visible changed; press Sync to continue.'))
    } else if (error instanceof BankConnectionError) {
      failure = new StepFailure(error.code === 'credential_unreadable' ? 'CREDENTIAL_UNREADABLE' : error.code.toUpperCase(), error)
    } else {
      failure = new StepFailure('STEP_FAILED', new BankConnectionError('persistence_failed', 503, 'The sync could not continue. Nothing visible changed; press Sync to continue.'))
    }
    if (failure.code !== 'SUPERSEDED') { try { await deps.sync.failSync(org, item.id, failure.code, startedAt) } catch { /* the lease expires on its own */ } }
    note(deps, { event: 'bank.sync.step_failed', organizationId: org, itemId: item.id, code: failure.code, outcome: `${recoveryFor(failure.code)}${runId ? '/run' : ''}` })
    throw failure.publicError
  }
}
