/**
 * src/services/bankProvider/bankSyncRepo.ts
 *
 * SERVER-ONLY persistence for BANK-4 over a Supabase SERVICE-ROLE client. Organization-scoped, explicit columns (never `*`).
 * It writes ONLY: provider transaction evidence, the Item's sync cursor/state columns, and webhook idempotency rows.
 * It never touches financial_transactions, financial_accounts, mappings or any balance, and it never writes raw_payload,
 * original_description or any raw provider JSON (those columns keep their empty/null defaults).
 */
import { WAITING_MARKER, type BankSyncRepo, type EvidenceCounts, type EvidenceRow, type SyncState } from './bankSyncService'

type Svc = { from: (table: string) => any }
const STATE_COLUMNS = 'sync_status, sync_cursor, last_sync_started_at, last_sync_completed_at, last_successful_sync_at, last_error_code'
const CHUNK = 200

/** Database errors become a generic failure: the raw message may contain identifiers and is never forwarded. */
function failed(): never { throw new Error('bank sync persistence failed') }
const now = () => new Date().toISOString()
const chunks = <T,>(list: T[]): T[][] => { const out: T[][] = []; for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK)); return out }

export function createBankSyncRepo(svc: Svc): BankSyncRepo {
  const items = () => svc.from('financial_provider_items')
  return {
    async getSyncState(organizationId, itemId) {
      const { data, error } = await items().select(STATE_COLUMNS).eq('organization_id', organizationId).eq('id', itemId).maybeSingle()
      if (error) failed()
      if (!data) return null
      const s: SyncState = { status: data.sync_status, cursor: data.sync_cursor ?? null, startedAt: data.last_sync_started_at ?? null, completedAt: data.last_sync_completed_at ?? null, lastSuccessfulAt: data.last_successful_sync_at ?? null, lastErrorCode: data.last_error_code ?? null }
      return s
    },
    async claimSync(organizationId, itemId, staleBeforeIso) {
      const { data, error } = await items().update({ sync_status: 'syncing', last_sync_started_at: now() })
        .eq('organization_id', organizationId).eq('id', itemId).neq('status', 'disconnected')
        .or(`sync_status.neq.syncing,last_sync_started_at.lt.${staleBeforeIso}`).select('id')
      if (error) failed()
      return Array.isArray(data) && data.length === 1
    },
    async finishSync(organizationId, itemId, input) {
      const t = now()
      // Only `synced` stamps a success. `waiting` is remembered with a marker (so it survives a reload); `unconfirmed` has no marker.
      const patch: Record<string, unknown> = { sync_status: 'idle', sync_cursor: input.cursor, last_sync_completed_at: t, last_error_code: input.state === 'waiting' ? WAITING_MARKER : null, last_error_message: null, last_error_at: null }
      if (input.state === 'synced') patch.last_successful_sync_at = t
      const { error } = await items().update(patch).eq('organization_id', organizationId).eq('id', itemId)
      if (error) failed()
    },
    async failSync(organizationId, itemId, code) {
      const { error } = await items().update({ sync_status: 'failed', last_error_code: code.slice(0, 64), last_error_message: 'Sync failed', last_error_at: now() }).eq('organization_id', organizationId).eq('id', itemId)
      if (error) failed()
    },
    async markLoginRequired(organizationId, itemId) {
      const { error } = await items().update({ status: 'login_required', status_changed_at: now() }).eq('organization_id', organizationId).eq('id', itemId).in('status', ['healthy', 'connecting'])
      if (error) failed()
    },
    async upsertEvidence(organizationId, itemId, rows: EvidenceRow[]) {
      const t = now()
      for (const part of chunks(rows)) {
        const payload = part.map(({ evidence: e, providerAccountRef }) => ({
          organization_id: organizationId, provider_item_ref: itemId, provider_account_ref: providerAccountRef, provider_transaction_id: e.providerTransactionId,
          pending: e.pending, pending_provider_transaction_id: e.pendingProviderTransactionId,
          provider_amount: e.providerAmount, provider_amount_minor: e.providerAmountMinor, currency: e.currency,
          transaction_date: e.transactionDate, authorized_date: e.authorizedDate, name: e.name, merchant_name: e.merchantName,
          provider_category: e.providerCategory, removed_at: null, last_seen_at: t,
        }))
        const { error } = await svc.from('financial_provider_transactions').upsert(payload, { onConflict: 'provider_item_ref,provider_transaction_id' })
        if (error) failed()
      }
    },
    async markRemoved(organizationId, itemId, ids) {
      let marked = 0
      for (const part of chunks(ids)) {
        const { data, error } = await svc.from('financial_provider_transactions').update({ removed_at: now() })
          .eq('organization_id', organizationId).eq('provider_item_ref', itemId).in('provider_transaction_id', part).is('removed_at', null).select('id')
        if (error) failed()
        marked += Array.isArray(data) ? data.length : 0
      }
      return marked
    },
    async countEvidence(organizationId, itemId): Promise<EvidenceCounts> {
      const count = async (apply: (q: any) => any) => {
        const { count: n, error } = await apply(svc.from('financial_provider_transactions').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('provider_item_ref', itemId))
        if (error) failed()
        return n ?? 0
      }
      const [posted, pending, removed] = await Promise.all([
        count(q => q.eq('pending', false).is('removed_at', null)), count(q => q.eq('pending', true).is('removed_at', null)), count(q => q.not('removed_at', 'is', null)),
      ])
      return { posted, pending, removed }
    },
    async recordWebhook({ organizationId, itemId, eventKey, webhookType, webhookCode }) {
      const events = () => svc.from('financial_provider_webhook_events')
      const { data: existing, error } = await events().select('id, delivery_count').eq('organization_id', organizationId).eq('provider', 'plaid').eq('event_key', eventKey).maybeSingle()
      if (error) failed()
      if (existing) {
        // Same signed body again: count it and re-arm the nudge (a nudge is idempotent; it never creates evidence).
        const { error: e2 } = await events().update({ delivery_count: (existing.delivery_count ?? 1) + 1, last_received_at: now(), processing_status: 'received', processed_at: null }).eq('id', existing.id).eq('organization_id', organizationId)
        if (e2) failed()
        return 'duplicate'
      }
      const { error: e3 } = await events().insert({ organization_id: organizationId, provider_item_ref: itemId, provider: 'plaid', event_key: eventKey, webhook_type: webhookType, webhook_code: webhookCode, payload_hash: eventKey, processing_status: 'received' })
      if (e3) {
        if (e3.code === '23505') return 'duplicate' // a concurrent delivery of the same body won the race
        failed()
      }
      return 'recorded'
    },
    async hasPendingNudge(organizationId, itemId) {
      const { count, error } = await svc.from('financial_provider_webhook_events').select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId).eq('provider_item_ref', itemId).eq('processing_status', 'received')
      if (error) failed()
      return (count ?? 0) > 0
    },
    async markNudgesProcessed(organizationId, itemId, receivedBeforeIso) {
      const { error } = await svc.from('financial_provider_webhook_events').update({ processing_status: 'processed', processed_at: now() })
        .eq('organization_id', organizationId).eq('provider_item_ref', itemId).eq('processing_status', 'received').lte('last_received_at', receivedBeforeIso)
      if (error) failed()
    },
  }
}
