/**
 * src/services/bankProvider/pendingContinuityRepo.ts
 *
 * SERVER-ONLY (PLAID-2A). Pending-to-posted continuity over a Supabase SERVICE-ROLE client. One database function
 * (docs/plaid2/pending-posted-continuity-proposal.sql) does all the work atomically; this file only calls it and shapes the counts.
 * Nothing here exists until that SQL is installed; PLAID_PENDING_CONTINUITY_ENABLED keeps it unused until then.
 */
import { PersistenceFailure } from './bankSyncService'

type Svc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> }

export interface ContinuityResult { linked: number; ambiguous: number; unresolved: number; mismatch: number; inherited: number; skipped: number }
export interface PendingContinuityRepo {
  /** Links posted transactions to the pending row Plaid names and carries confirmed decisions across. Idempotent; each call is bounded (<= 2,000 rows). */
  linkPendingPosted(organizationId: string, itemId: string, limit?: number): Promise<ContinuityResult>
}

export const emptyContinuity = (): ContinuityResult => ({ linked: 0, ambiguous: 0, unresolved: 0, mismatch: 0, inherited: 0, skipped: 0 })

export function createPendingContinuityRepo(svc: Svc): PendingContinuityRepo {
  return {
    async linkPendingPosted(organizationId, itemId, limit) {
      const { data, error } = await svc.rpc('financial_provider_link_pending_posted', { p_organization_id: organizationId, p_item_id: itemId, ...(limit !== undefined ? { p_limit: limit } : {}) })
      if (error) {
        const sqlState = typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : null
        throw new PersistenceFailure('link_pending_posted', sqlState, null)
      }
      const r = Array.isArray(data) ? data[0] : data
      if (!r) throw new PersistenceFailure('link_pending_posted', null, null)
      const n = (v: unknown) => Number(v) || 0
      return { linked: n(r.linked_count), ambiguous: n(r.ambiguous_count), unresolved: n(r.unresolved_count), mismatch: n(r.mismatch_count), inherited: n(r.inherited_count), skipped: n(r.skipped_count) }
    },
  }
}

/**
 * Runs the continuity step until no candidate is left, a call fails, or the time budget ends. NEVER throws: the sync that triggered it has already
 * committed, and continuity is re-runnable at any time, so a failure here only means "try again later".
 */
export async function runPendingContinuity(repo: PendingContinuityRepo, organizationId: string, itemId: string,
  opts: { now: () => number; deadlineMs: number; maxCalls?: number }): Promise<ContinuityResult & { ok: boolean }> {
  const total = emptyContinuity()
  for (let i = 0; i < (opts.maxCalls ?? 4); i++) {
    if (opts.now() >= opts.deadlineMs) return { ...total, ok: false }
    let r: ContinuityResult
    try { r = await repo.linkPendingPosted(organizationId, itemId) } catch { return { ...total, ok: false } }
    for (const k of Object.keys(total) as Array<keyof ContinuityResult>) total[k] += r[k]
    if (r.linked + r.ambiguous + r.unresolved + r.mismatch === 0) return { ...total, ok: true }
  }
  return { ...total, ok: false } // more candidates remain; the next sync (or a manual run) continues
}
