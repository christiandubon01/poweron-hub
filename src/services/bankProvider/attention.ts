/**
 * src/services/bankProvider/attention.ts
 *
 * PURE (PLAID-2H). One plain list of what needs the owner, built only from sanitized status the browser already receives: failed or paused syncs,
 * connections that need sign-in, updates waiting for review, accounts whose balance is stale or unknown, and transactions waiting for a decision.
 * It invents nothing: every item points at a fact in its input, ordered action > warning > info, and an empty list means nothing needs attention
 * ONLY for the inputs it was given (it never claims the bank itself is healthy).
 */
export interface AttentionSync { connectionId: string; state: string; lastSyncedAt: string | null; updatesAvailable?: boolean; itemNotice?: { code: string } | null; recovery?: string; recoveryText?: string; lastErrorCode?: string | null; blocked?: { reason: string } | null }
export interface AttentionBalance { accountRef: string; connectionId: string; name: string | null; accountClass: string; freshness: 'fresh' | 'aging' | 'stale' | 'unknown' }
export interface AttentionConnection { id: string; institutionName: string | null; status: string }
export interface AttentionReview { needsReview?: number; ambiguousMatches?: number; pendingLinksNeedingReview?: number }
export type AttentionSeverity = 'action' | 'warning' | 'info'
export interface AttentionItem { id: string; severity: AttentionSeverity; message: string; connectionId?: string }

const ORDER: Record<AttentionSeverity, number> = { action: 0, warning: 1, info: 2 }
export const STALE_SYNC_HOURS = 24

export function buildAttention(input: { connections: AttentionConnection[]; syncs: AttentionSync[]; balances?: AttentionBalance[]; review?: AttentionReview; nowMs: number }): AttentionItem[] {
  const out: AttentionItem[] = []
  const name = (id: string) => input.connections.find(c => c.id === id)?.institutionName ?? 'Your bank'
  const live = input.connections.filter(c => c.status !== 'disconnected')
  for (const c of live) {
    const s = input.syncs.find(x => x.connectionId === c.id)
    if (c.status === 'login_required' || s?.state === 'login_required') { out.push({ id: `login:${c.id}`, severity: 'action', connectionId: c.id, message: `${name(c.id)} needs you to sign in again. Use "Sign in to ${name(c.id)} again".` }); continue }
    if (s?.itemNotice) out.push({ id: `signin-soon:${c.id}`, severity: 'warning', connectionId: c.id, message: `${name(c.id)} will need you to sign in again soon (${s.itemNotice.code === 'PENDING_DISCONNECT' ? 'the connection is about to be disconnected' : 'the login is about to expire'}). Use "Sign in to ${name(c.id)} again" now; your history and reviews stay as they are.` })
    if (s?.blocked) out.push({ id: `blocked:${c.id}`, severity: 'action', connectionId: c.id, message: `${name(c.id)}: a bank update is waiting for your review (${s.blocked.reason === 'RUN_TOO_LARGE' ? 'too large to apply in one step' : 'saving it failed repeatedly'}). Nothing from it was saved.` })
    else if (s?.state === 'error') out.push({ id: `sync-error:${c.id}`, severity: 'action', connectionId: c.id, message: `${name(c.id)}: the last sync failed${s.lastErrorCode ? ` (code ${s.lastErrorCode})` : ''}. ${s.recoveryText ?? 'Try syncing again.'}`.trim() })
    else if (s?.state === 'partial') out.push({ id: `partial:${c.id}`, severity: 'info', connectionId: c.id, message: `${name(c.id)}: a sync is paused partway. Press Sync to continue; nothing from it is visible until it finishes.` })
    else if (s?.state === 'unconfirmed' || s?.state === 'waiting') out.push({ id: `unconfirmed:${c.id}`, severity: 'info', connectionId: c.id, message: `${name(c.id)}: the bank has not confirmed your transactions yet. That does not mean there are none.` })
    if (s?.updatesAvailable) out.push({ id: `updates:${c.id}`, severity: 'info', connectionId: c.id, message: `${name(c.id)} has new updates available. Press Sync.` })
    if (s && s.state !== 'error' && s.state !== 'not_synced') {
      const t = s.lastSyncedAt ? Date.parse(s.lastSyncedAt) : NaN
      if (Number.isFinite(t) && input.nowMs - t > STALE_SYNC_HOURS * 3_600_000) out.push({ id: `old-sync:${c.id}`, severity: 'warning', connectionId: c.id, message: `${name(c.id)} was last synced over ${STALE_SYNC_HOURS} hours ago.` })
    }
    if (!s || s.state === 'not_synced') out.push({ id: `never:${c.id}`, severity: 'info', connectionId: c.id, message: `${name(c.id)} has not been synced yet.` })
  }
  const stale = (input.balances ?? []).filter(b => b.freshness === 'stale' && live.some(c => c.id === b.connectionId))
  const unknown = (input.balances ?? []).filter(b => b.freshness === 'unknown' && live.some(c => c.id === b.connectionId))
  if (stale.length) out.push({ id: 'balances-stale', severity: 'warning', message: `${stale.length} account balance${stale.length === 1 ? ' is' : 's are'} stale: ${stale.map(b => b.name ?? 'Account').slice(0, 4).join(', ')}${stale.length > 4 ? '…' : ''}. Refresh balances before relying on them.` })
  if (unknown.length) out.push({ id: 'balances-unknown', severity: 'info', message: `${unknown.length} account${unknown.length === 1 ? ' has' : 's have'} no balance yet.` })
  const r = input.review
  if (r?.ambiguousMatches) out.push({ id: 'ambiguous', severity: 'warning', message: `${r.ambiguousMatches} possible transfer or card-payment match${r.ambiguousMatches === 1 ? '' : 'es'} could fit more than one transaction. Pick the right ones.` })
  if (r?.pendingLinksNeedingReview) out.push({ id: 'pending-links', severity: 'warning', message: `${r.pendingLinksNeedingReview} posted transaction${r.pendingLinksNeedingReview === 1 ? '' : 's'} could not be safely matched to the pending one they replace, so your earlier decision was not carried over.` })
  if (r?.needsReview) out.push({ id: 'needs-review', severity: 'info', message: `${r.needsReview} transaction${r.needsReview === 1 ? ' needs' : 's need'} your review.` })
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.id.localeCompare(b.id))
}
