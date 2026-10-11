/** SERVER ONLY: stable, complete, organization-scoped report snapshot reader. */
import type { Decision } from './types'
import type { SpendingContext } from './spendingService'
import { defaultHierarchy, decodeSpendingHierarchy } from './hierarchy'
type Svc = { rpc: (fn:string,args:Record<string,unknown>)=>PromiseLike<{data:any;error:any}>; from?: (table:string)=>any }
const failed=():never=>{throw new Error('Reporting persistence failed.')}
const toDecision = (r: any): Decision => ({
  id: r.id, txId: r.provider_transaction_ref, kind: r.kind, status: r.status, category: r.category ?? null, projectId: r.project_id ?? null,
  obligationId: r.obligation_id ?? null, commitmentId: r.cash_commitment_id ?? null, debtAccountId: r.debt_account_id ?? null,
  counterpartTxId: r.counterpart_provider_transaction_ref ?? null, confidence: r.confidence ?? null, source: r.source, decidedAt: r.decided_at ?? null,
})

export async function readReportContext(svc:Svc,org:string,sinceDate:string,opts: { accountTypes?: boolean } = {}):Promise<SpendingContext> {
      const ctx: SpendingContext = { txs:[],accounts:[],decisions:[],obligations:[],occurrences:[],commitments:[],debts:[],projects:[],hierarchy:defaultHierarchy() }
      const { data, error } = await svc.rpc('bank_spending_report_source', { p_organization_id: org, p_since: sinceDate })
      if (error) {
        if (['42883','PGRST202'].includes(error.code)) return { ...ctx, txs: [], decisions: [], reportCoverage: { complete: false, reason: 'Complete reporting requires the separately approved schema.' } }
        failed()
      }
      const raw = Array.isArray(data) ? data[0]?.bank_spending_report_source ?? data[0] : data
      if (!raw || raw.complete !== true || !Array.isArray(raw.txs) || !Array.isArray(raw.decisions) || !Array.isArray(raw.accounts) || !raw.context || ['obligations','occurrences','commitments','debts','projects','merchantRules'].some(k => !Array.isArray(raw.context[k]))) return { ...ctx, txs: [], decisions: [], reportCoverage: { complete: false, reason: 'Reporting source exceeded its safety limit or could not verify complete coverage.' } }
      const built: SpendingContext = { ...ctx, ...raw.context, rulesAvailable:true, txs: raw.txs.map((r: any) => ({ id: r.id, providerAccountRef: r.provider_account_ref, date: r.transaction_date, name: r.name, merchantName: r.merchant_name, amountMinor: Number(r.provider_amount_minor), pending: r.pending, removed: !!r.removed_at, category: r.provider_category })),
        accounts: raw.accounts, decisions: raw.decisions.map(toDecision), hierarchy: decodeSpendingHierarchy(raw.hierarchy), reportCoverage: { complete: true, reason: null } }
      if (opts.accountTypes && svc.from) built.accounts = await withAccountTypes(svc, org, built.accounts)
      return built
}

/**
 * PLAID-3A: the BANK-6G report source returns accounts without the provider's account type/subtype, which the reconciliation engine needs to tell a card
 * payment from a bank-to-bank transfer. This reads them (existing columns, organization-scoped, at most a few hundred rows) and adds them. It is only
 * called when the reconciliation switch is on. A failure leaves the types unknown, and the engine then treats those accounts conservatively.
 */
async function withAccountTypes(svc: Svc, org: string, accounts: SpendingContext['accounts']): Promise<SpendingContext['accounts']> {
  try {
    const { data, error } = await svc.from!('financial_provider_accounts').select('id, provider_account_type, provider_account_subtype').eq('organization_id', org).limit(1000)
    if (error || !Array.isArray(data)) return accounts
    const byId = new Map<string, { type: string | null; subtype: string | null }>(data.map((r: any) => [r.id, { type: r.provider_account_type ?? null, subtype: r.provider_account_subtype ?? null }]))
    return accounts.map(a => { const t = byId.get(a.providerAccountRef); return t ? { ...a, providerType: t.type, providerSubtype: t.subtype } : a })
  } catch { return accounts }
}
