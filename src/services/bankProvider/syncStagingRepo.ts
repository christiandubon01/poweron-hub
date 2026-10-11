/**
 * src/services/bankProvider/syncStagingRepo.ts
 *
 * SERVER-ONLY (PLAID-1C). Persistence for resumable sync over a Supabase SERVICE-ROLE client. Every state change is ONE database function from
 * docs/plaid1c/resumable-sync-proposal.sql (each re-checks the organization and is atomic), so no partial page, cursor or apply can be left behind.
 * The only plain read is progress for the owner's status, and it never selects a cursor. Nothing here exists until that SQL is installed;
 * PLAID_RESUMABLE_SYNC_ENABLED keeps it unused until then.
 */
import { PersistenceFailure } from './bankSyncService'

type Svc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>; from: (table: string) => any }

export interface StagingRunView {
  runId: string
  status: 'fetching' | 'fetched'
  generation: number
  pageCursor: string | null
  pagesStaged: number
  restarts: number
  startCursor: string | null
  updateStatus: string | null
  stagedRows: number
  opened: 'created' | 'resumed'
}
/** One allowlisted change, in the exact shape financial_provider_transactions stores (removed rows carry only the transaction id). */
export interface StagedChange {
  change_kind: 'added' | 'modified' | 'removed'
  provider_transaction_id: string
  provider_account_ref?: string
  pending?: boolean
  pending_provider_transaction_id?: string | null
  provider_amount?: number
  provider_amount_minor?: number
  currency?: 'USD'
  transaction_date?: string
  authorized_date?: string | null
  name?: string | null
  merchant_name?: string | null
  provider_category?: Record<string, unknown> | null
}
export interface ApplyResult { outcome: 'applied' | 'already_applied' | 'stale' | 'lease_lost'; added: number; modified: number; removed: number; pendingLinked: number }
export interface StagingProgress { status: 'fetching' | 'fetched'; pagesStaged: number; restarts: number; startedAt: string; updatedAt: string }

export interface SyncStagingRepo {
  openRun(organizationId: string, itemId: string): Promise<StagingRunView>
  stagePage(organizationId: string, input: { runId: string; generation: number; pageNo: number; nextCursor: string; hasMore: boolean; updateStatus: string | null; changes: StagedChange[] }): Promise<'staged' | 'stale'>
  restartRun(organizationId: string, runId: string, generation: number): Promise<'restarted' | 'stale'>
  abandonRun(organizationId: string, runId: string, reason: string): Promise<void>
  applyRun(organizationId: string, input: { itemId: string; runId: string; generation: number; leaseStartedAt: string; outcome: 'synced' | 'waiting' | 'unconfirmed' }): Promise<ApplyResult>
  getProgress(organizationId: string, itemId: string): Promise<StagingProgress | null>
}

function failed(operation: string, error?: any): never {
  const sqlState = typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : null
  const token = typeof error?.message === 'string' ? /^SYNC_[A-Z_]+/.exec(error.message)?.[0] ?? null : null
  throw new PersistenceFailure(operation, sqlState, token ? token.toLowerCase() : null)
}
const one = (data: any) => (Array.isArray(data) ? data[0] : data)

export function createSyncStagingRepo(svc: Svc): SyncStagingRepo {
  return {
    async openRun(organizationId, itemId) {
      const { data, error } = await svc.rpc('financial_provider_sync_open_run', { p_organization_id: organizationId, p_item_id: itemId })
      if (error) failed('open_run', error)
      const r = one(data)
      if (!r?.run_id) failed('open_run')
      return { runId: r.run_id, status: r.status, generation: Number(r.generation), pageCursor: r.page_cursor ?? null, pagesStaged: Number(r.pages_staged),
        restarts: Number(r.restarts), startCursor: r.start_cursor ?? null, updateStatus: r.update_status ?? null, stagedRows: Number(r.staged_rows) || 0, opened: r.opened }
    },
    async stagePage(organizationId, i) {
      const { data, error } = await svc.rpc('financial_provider_sync_stage_page', { p_organization_id: organizationId, p_run_id: i.runId, p_generation: i.generation,
        p_page_no: i.pageNo, p_next_cursor: i.nextCursor, p_has_more: i.hasMore, p_update_status: i.updateStatus, p_changes: i.changes })
      if (error) failed('stage_page', error)
      const out = one(data)
      const v = typeof out === 'string' ? out : out?.financial_provider_sync_stage_page
      if (v !== 'staged' && v !== 'stale') failed('stage_page')
      return v
    },
    async restartRun(organizationId, runId, generation) {
      const { data, error } = await svc.rpc('financial_provider_sync_restart_run', { p_organization_id: organizationId, p_run_id: runId, p_generation: generation })
      if (error) failed('restart_run', error)
      const out = one(data)
      const v = typeof out === 'string' ? out : out?.financial_provider_sync_restart_run
      if (v !== 'restarted' && v !== 'stale') failed('restart_run')
      return v
    },
    async abandonRun(organizationId, runId, reason) {
      const { error } = await svc.rpc('financial_provider_sync_abandon_run', { p_organization_id: organizationId, p_run_id: runId, p_reason: reason })
      if (error) failed('abandon_run', error)
    },
    async applyRun(organizationId, i) {
      const { data, error } = await svc.rpc('financial_provider_sync_apply_run', { p_organization_id: organizationId, p_item_id: i.itemId, p_run_id: i.runId,
        p_generation: i.generation, p_lease_started_at: i.leaseStartedAt, p_outcome: i.outcome })
      if (error) failed('apply_run', error)
      const r = one(data)
      if (!r || !['applied', 'already_applied', 'stale', 'lease_lost'].includes(r.outcome)) failed('apply_run')
      return { outcome: r.outcome, added: Number(r.added_count) || 0, modified: Number(r.modified_count) || 0, removed: Number(r.removed_count) || 0, pendingLinked: Number(r.pending_linked_count) || 0 }
    },
    async getProgress(organizationId, itemId) {
      const { data, error } = await svc.from('financial_provider_sync_staging_runs').select('status, pages_staged, restarts, created_at, updated_at')
        .eq('organization_id', organizationId).eq('provider_item_ref', itemId).in('status', ['fetching', 'fetched']).maybeSingle()
      if (error) failed('get_progress', error)
      return data ? { status: data.status, pagesStaged: Number(data.pages_staged), restarts: Number(data.restarts), startedAt: data.created_at, updatedAt: data.updated_at } : null
    },
  }
}
