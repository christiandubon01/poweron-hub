import { readReportContext } from './reportingRepo'
/**
 * src/services/spending/spendingRepo.ts
 *
 * SERVER-ONLY persistence for BANK-5 over a Supabase SERVICE-ROLE client. Every read is organization-scoped with an explicit column list
 * (never `*`). The ONLY table it writes is financial_provider_interpretations, and every CONFIRMED decision goes through the one atomic database
 * function (financial_provider_replace_interpretation); only rejected suggestions, undo and the audit stamps are plain statements. It never writes the ledger, Cash OS accounts, obligations
 * (no occurrence is materialized), projects, debt, payroll or provider evidence.
 */
import { BankConnectionError } from '../bankConnectionService'
import type { Decision, DebtOption, EvidenceTx, ProjectOption } from './types'
import type { MerchantRule, NewDecision, SpendingContext, SpendingRepo } from './spendingService'
import { loadSpendingHierarchy } from './hierarchy'

type Svc = { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> }
const PAGE = 1000
const MAX_EVIDENCE = 5000

/** Database errors become a generic failure: the raw message may contain row values and is never forwarded. */
function failed(): never { throw new Error('spending persistence failed') }

async function pageAll<T>(build: () => any, max = MAX_EVIDENCE): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) failed()
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return out
}

const DECISION_COLUMNS = 'id, provider_transaction_ref, kind, status, category, project_id, obligation_id, cash_commitment_id, debt_account_id, counterpart_provider_transaction_ref, confidence, source, decided_at'
const DECISION_COLUMNS_PRE_155 = DECISION_COLUMNS.replace('obligation_id, ', '')
const toDecision = (r: any): Decision => ({
  id: r.id, txId: r.provider_transaction_ref, kind: r.kind, status: r.status, category: r.category ?? null, projectId: r.project_id ?? null,
  obligationId: r.obligation_id ?? null, commitmentId: r.cash_commitment_id ?? null, debtAccountId: r.debt_account_id ?? null,
  counterpartTxId: r.counterpart_provider_transaction_ref ?? null, confidence: r.confidence ?? null, source: r.source, decidedAt: r.decided_at ?? null,
})

export function createSpendingRepo(svc: Svc): SpendingRepo {
  const decisions = async (organizationId: string, statuses: string[], txId?: string): Promise<Decision[]> => {
    const run = (columns: string) => {
      let q = svc.from('financial_provider_interpretations').select(columns).eq('organization_id', organizationId).in('status', statuses)
      if (txId) q = q.eq('provider_transaction_ref', txId)
      return q.order('created_at', { ascending: true }).order('id', { ascending: true })
    }
    let columns = DECISION_COLUMNS
    // Probe column availability before complete pagination; never interpret the REST row limit as a complete decision history.
    const probe = await run(columns).range(0,0)
    if (probe.error && (probe.error.code === '42703' || /obligation_id/.test(String(probe.error.message ?? '')))) columns = DECISION_COLUMNS_PRE_155
    else if (probe.error) failed()
    return (await pageAll<any>(() => run(columns),20000)).map(toDecision)
  }
  return {
    loadHierarchy: org => loadSpendingHierarchy(svc, org),
    loadReportContext: (org, sinceDate) => readReportContext(svc, org, sinceDate),
    async loadContext(organizationId, sinceDate): Promise<SpendingContext> {
      const rows = await pageAll<any>(() => svc.from('financial_provider_transactions')
        .select('id, provider_account_ref, transaction_date, name, merchant_name, provider_amount_minor, pending, removed_at, provider_category')
        .eq('organization_id', organizationId).gte('transaction_date', sinceDate).order('transaction_date', { ascending: false }).order('id', { ascending: true }))
      const txs: EvidenceTx[] = rows.map(r => ({
        id: r.id, providerAccountRef: r.provider_account_ref, date: r.transaction_date, name: r.name ?? null, merchantName: r.merchant_name ?? null,
        amountMinor: Number(r.provider_amount_minor), pending: r.pending === true, removed: !!r.removed_at,
        category: r.provider_category && typeof r.provider_category.primary === 'string' ? { primary: r.provider_category.primary, detailed: r.provider_category.detailed ?? null, confidence: r.provider_category.confidence ?? null } : null,
      }))
      const [accts, items, maps, fin, decs] = await Promise.all([
        svc.from('financial_provider_accounts').select('id, name, mask, provider_item_ref').eq('organization_id', organizationId),
        (async () => {
          const read = (columns: string) => svc.from('financial_provider_items').select(columns).eq('organization_id', organizationId)
          const r = await read('id, institution_name, environment')
          // Before migration 156 there is no environment column and every Item is a Sandbox Item.
          return r.error && (r.error.code === '42703' || /environment/.test(String(r.error.message ?? ''))) ? read('id, institution_name') : r
        })(),
        svc.from('financial_provider_account_mappings').select('provider_account_ref, financial_account_id').eq('organization_id', organizationId).eq('status', 'active'),
        svc.from('financial_accounts').select('id, display_name, ownership_context, account_class, account_type, status').eq('organization_id', organizationId),
        decisions(organizationId, ['confirmed', 'rejected']),
      ])
      for (const r of [accts, items, maps, fin]) if (r.error) failed()
      const itemName = new Map<string, string | null>((items.data ?? []).map((i: any) => [i.id, i.institution_name ?? null]))
      const itemEnv = new Map<string, 'sandbox' | 'production'>((items.data ?? []).map((i: any) => [i.id, i.environment === 'production' ? 'production' : 'sandbox']))
      const mapOf = new Map<string, string>((maps.data ?? []).map((m: any) => [m.provider_account_ref, m.financial_account_id]))
      const finById = new Map<string, any>((fin.data ?? []).map((f: any) => [f.id, f]))
      const accounts = (accts.data ?? []).map((a: any) => {
        const f = finById.get(mapOf.get(a.id) ?? '')
        return { providerAccountRef: a.id, label: [itemName.get(a.provider_item_ref), a.name].filter(Boolean).join(' · ') || 'Bank account', mask: a.mask ?? null,
          ownership: f && (f.ownership_context === 'business' || f.ownership_context === 'personal') ? f.ownership_context : null, financialAccountId: f?.id ?? null, financialAccountName: f?.display_name ?? null, environment: itemEnv.get(a.provider_item_ref) ?? 'sandbox' }
      })
      const debts: DebtOption[] = (fin.data ?? []).filter((f: any) => f.account_class === 'liability' && f.status === 'active').map((f: any) => ({ id: f.id, label: f.display_name, accountType: f.account_type }))

      const [obl, occ, com] = await Promise.all([
        svc.from('financial_obligations').select('id, name, amount_minor, amount_type, estimated_min_minor, estimated_max_minor, recurrence_kind, recurrence_interval, anchor_date, start_date, end_date, status, account_id').eq('organization_id', organizationId).eq('status', 'active'),
        svc.from('financial_obligation_occurrences').select('obligation_id, scheduled_date, override_date, override_amount_minor, status, reconciliation_state').eq('organization_id', organizationId),
        svc.from('cash_commitments').select('id, title, expected_date, amount_minor, amount_type, estimated_min_minor, estimated_max_minor, status, reconciliation_state, account_id').eq('organization_id', organizationId).eq('status', 'scheduled'),
      ])
      for (const r of [obl, occ, com]) if (r.error) failed()
      // Projects live in the legacy `projects` table (org_id). They are optional context: if it cannot be read, explorer still works.
      let projects: ProjectOption[] = []
      try {
        const p = await svc.from('projects').select('id, name, status').eq('org_id', organizationId).neq('status', 'canceled').limit(500)
        if (!p.error) projects = (p.data ?? []).filter((x: any) => typeof x.name === 'string' && x.name.trim()).map((x: any) => ({ id: String(x.id), name: x.name }))
      } catch { projects = [] }
      // BANK-6B: remembered merchant rules. Before migration 157 the table does not exist: Smart Review still works, rules are simply unavailable.
      let merchantRules: MerchantRule[] = [], rulesAvailable = true
      {
        const r = await svc.from('financial_provider_merchant_rules').select('id, merchant_key, merchant_label, category, updated_at').eq('organization_id', organizationId).eq('status', 'active').limit(2000)
        if (r.error) {
          if (r.error.code === '42P01' || r.error.code === 'PGRST205' || /financial_provider_merchant_rules/.test(String(r.error.message ?? ''))) rulesAvailable = false
          else failed()
        } else merchantRules = (r.data ?? []).map((m: any) => ({ id: m.id, merchantKey: m.merchant_key, merchantLabel: m.merchant_label ?? null, category: m.category, updatedAt: m.updated_at ?? null }))
      }
      return {
        txs, accounts, decisions: decs, debts, projects, merchantRules, rulesAvailable, hierarchy: await loadSpendingHierarchy(svc, organizationId),
        legacyCoverage: {complete: rows.length < MAX_EVIDENCE && decs.length < 20000 && projects.length < 500 && merchantRules.length < 1000 && [accts,items,maps,fin,obl,occ,com].every(r => (r.data ?? []).length < 1000), reason: 'Legacy review evidence or matching context may be capped. Use a complete report for verified totals.'},
        obligations: (obl.data ?? []).map((o: any) => ({ id: o.id, name: o.name, amountMinor: Number(o.amount_minor), amountType: o.amount_type, estimatedMinMinor: o.estimated_min_minor ?? null, estimatedMaxMinor: o.estimated_max_minor ?? null,
          recurrenceKind: o.recurrence_kind, recurrenceInterval: o.recurrence_interval, anchorDate: o.anchor_date, startDate: o.start_date, endDate: o.end_date ?? null, status: o.status, accountId: o.account_id ?? null })),
        occurrences: (occ.data ?? []).map((o: any) => ({ obligationId: o.obligation_id, scheduledDate: o.scheduled_date, overrideDate: o.override_date ?? null, overrideAmountMinor: o.override_amount_minor ?? null, status: o.status, reconciliationState: o.reconciliation_state })),
        commitments: (com.data ?? []).map((c: any) => ({ id: c.id, title: c.title, expectedDate: c.expected_date, amountMinor: Number(c.amount_minor), amountType: c.amount_type, estimatedMinMinor: c.estimated_min_minor ?? null, estimatedMaxMinor: c.estimated_max_minor ?? null, status: c.status, reconciliationState: c.reconciliation_state, accountId: c.account_id ?? null })),
      }
    },
    async getEvidence(organizationId, id) {
      const { data, error } = await svc.from('financial_provider_transactions').select('id, pending, removed_at, provider_amount_minor').eq('organization_id', organizationId).eq('id', id).maybeSingle()
      if (error) failed()
      return data ? { id: data.id, pending: data.pending === true, removed: !!data.removed_at, amountMinor: Number(data.provider_amount_minor) } : null
    },
    /** Every decision ever made about ONE transaction, newest last: the audit trail. No user ids are returned. */
    async historyFor(organizationId, txId) {
      const { data, error } = await svc.from('financial_provider_interpretations')
        .select('kind, status, category, source, confidence, decided_at, undone_at, undo_reason, created_at')
        .eq('organization_id', organizationId).eq('provider_transaction_ref', txId).order('created_at', { ascending: true }).limit(200)
      if (error) failed()
      return (data ?? []).map((r: any) => ({ kind: r.kind, status: r.status, category: r.category ?? null, source: r.source, confidence: r.confidence ?? null,
        decidedAt: r.decided_at ?? null, undoneAt: r.undone_at ?? null, undoReason: r.undo_reason ?? null, createdAt: r.created_at }))
    },
    confirmedFor: (organizationId, txId) => decisions(organizationId, ['confirmed'], txId),
    async targetExists(organizationId, type, id) {
      const spec = { obligation: ['financial_obligations', 'organization_id', { status: 'active' }], commitment: ['cash_commitments', 'organization_id', { status: 'scheduled' }],
        debt_account: ['financial_accounts', 'organization_id', { account_class: 'liability', status: 'active' }], project: ['projects', 'org_id', {}] } as const
      const [table, orgColumn, filters] = spec[type]
      let q = svc.from(table).select('id').eq(orgColumn, organizationId).eq('id', id)
      for (const [k, v] of Object.entries(filters)) q = q.eq(k, v)
      const { data, error } = await q.maybeSingle()
      if (error) failed()
      return !!data
    },
    async replaceDecision(row: NewDecision) {
      const dimension = row.kind === 'category' ? 'bucket' : row.kind === 'ignored' ? 'ignore' : 'relationship'
      const { data, error } = await svc.rpc('financial_provider_replace_interpretation', {
        p_organization_id: row.organizationId, p_actor: row.actorUserId, p_provider_transaction_ref: row.txId, p_dimension: dimension, p_kind: row.kind,
        p_source: row.source, p_confidence: row.confidence, p_suggestion_basis: row.basis, p_category: row.category, p_project_id: row.projectId,
        p_obligation_id: row.obligationId, p_commitment_id: row.commitmentId, p_debt_account_id: row.debtAccountId, p_counterpart_provider_transaction_ref: row.counterpartTxId,
      })
      if (error) {
        const token = /^INTERPRETATION_[A-Z_]+/.exec(String(error.message ?? ''))?.[0]
        if (token === 'INTERPRETATION_TRANSACTION_NOT_FOUND') throw new BankConnectionError('not_found', 404, 'Transaction not found.')
        if (token === 'INTERPRETATION_TARGET_NOT_FOUND') throw new BankConnectionError('not_found', 404, 'That item was not found.')
        if (token === 'INTERPRETATION_PENDING_RELATIONSHIP') throw new BankConnectionError('conflict', 409, 'A pending transaction can only be categorized or ignored until it posts.')
        if (error.code === '23505') throw new BankConnectionError('conflict', 409, 'That decision changed while you were saving. Refresh and try again.')
        failed()
      }
      const out = Array.isArray(data) ? data[0] : data
      if (!out?.interpretation_id || !['created', 'changed', 'unchanged'].includes(out.outcome)) failed()
      return { outcome: out.outcome as 'created' | 'changed' | 'unchanged', id: out.interpretation_id as string }
    },
    async insertDecision(row: NewDecision) {
      const { data, error } = await svc.from('financial_provider_interpretations').insert({
        organization_id: row.organizationId, provider_transaction_ref: row.txId, kind: row.kind, status: row.status, source: row.source, confidence: row.confidence,
        suggestion_basis: row.basis, category: row.category, project_id: row.projectId, ...(row.obligationId ? { obligation_id: row.obligationId } : {}), cash_commitment_id: row.commitmentId,
        debt_account_id: row.debtAccountId, counterpart_provider_transaction_ref: row.counterpartTxId, created_by: row.actorUserId, decided_by: row.actorUserId,
        ...(row.status === 'confirmed' || row.status === 'rejected' ? { decided_at: new Date().toISOString() } : {}),
      }).select('id').single()
      if (error) {
        if (error.code === '23505') throw new BankConnectionError('conflict', 409, 'That decision already exists. Refresh and try again.')
        if (error.code === '23514' && /pending/i.test(String(error.message ?? ''))) throw new BankConnectionError('conflict', 409, 'A pending transaction can only be categorized or ignored until it posts.')
        failed()
      }
      return { id: data.id }
    },
    /** One active rule per (organization, merchant): saving again replaces its category. The previous row is never deleted (revoked rows stay as history). */
    async upsertMerchantRule(organizationId, actorUserId, rule) {
      const now = new Date().toISOString()
      const fail = (error: any): never => {
        if (error?.code === '42P01' || error?.code === 'PGRST205') throw new BankConnectionError('conflict', 409, 'Remembering a category is not available yet.')
        return failed()
      }
      const upd = await svc.from('financial_provider_merchant_rules').update({ merchant_label: rule.merchantLabel, category: rule.category, status: 'active', revoked_at: null, updated_by: actorUserId, updated_at: now })
        .eq('organization_id', organizationId).eq('merchant_key', rule.merchantKey).select('id')
      if (upd.error) fail(upd.error)
      if ((upd.data ?? []).length) return
      const ins = await svc.from('financial_provider_merchant_rules').insert({ organization_id: organizationId, merchant_key: rule.merchantKey, merchant_label: rule.merchantLabel, category: rule.category, created_by: actorUserId, updated_by: actorUserId })
      if (ins.error) fail(ins.error)
    },
    async revokeMerchantRule(organizationId, actorUserId, merchantKey) {
      const { data, error } = await svc.from('financial_provider_merchant_rules').update({ status: 'revoked', revoked_at: new Date().toISOString(), updated_by: actorUserId, updated_at: new Date().toISOString() })
        .eq('organization_id', organizationId).eq('merchant_key', merchantKey).eq('status', 'active').select('id')
      if (error) failed()
      return (data ?? []).length > 0
    },
    async markUndone(organizationId, decisionId, actorUserId, reason) {
      const { error } = await svc.from('financial_provider_interpretations').update({ status: 'undone', undone_by: actorUserId, undone_at: new Date().toISOString(), undo_reason: reason })
        .eq('organization_id', organizationId).eq('id', decisionId).eq('status', 'confirmed')
      if (error) failed()
    },
  }
}
