/** SERVER ONLY: stable, complete, organization-scoped report snapshot reader. */
import type { Decision } from './types'
import type { SpendingContext } from './spendingService'
import { defaultHierarchy, decodeSpendingHierarchy } from './hierarchy'
type Svc = { rpc: (fn:string,args:Record<string,unknown>)=>PromiseLike<{data:any;error:any}> }
const failed=():never=>{throw new Error('Reporting persistence failed.')}
const toDecision = (r: any): Decision => ({
  id: r.id, txId: r.provider_transaction_ref, kind: r.kind, status: r.status, category: r.category ?? null, projectId: r.project_id ?? null,
  obligationId: r.obligation_id ?? null, commitmentId: r.cash_commitment_id ?? null, debtAccountId: r.debt_account_id ?? null,
  counterpartTxId: r.counterpart_provider_transaction_ref ?? null, confidence: r.confidence ?? null, source: r.source, decidedAt: r.decided_at ?? null,
})

export async function readReportContext(svc:Svc,org:string,sinceDate:string):Promise<SpendingContext> {
      const ctx: SpendingContext = { txs:[],accounts:[],decisions:[],obligations:[],occurrences:[],commitments:[],debts:[],projects:[],hierarchy:defaultHierarchy() }
      const { data, error } = await svc.rpc('bank_spending_report_source', { p_organization_id: org, p_since: sinceDate })
      if (error) {
        if (['42883','PGRST202'].includes(error.code)) return { ...ctx, txs: [], decisions: [], reportCoverage: { complete: false, reason: 'Complete reporting requires the separately approved schema.' } }
        failed()
      }
      const raw = Array.isArray(data) ? data[0]?.bank_spending_report_source ?? data[0] : data
      if (!raw || raw.complete !== true || !Array.isArray(raw.txs) || !Array.isArray(raw.decisions) || !Array.isArray(raw.accounts) || !raw.context || ['obligations','occurrences','commitments','debts','projects','merchantRules'].some(k => !Array.isArray(raw.context[k]))) return { ...ctx, txs: [], decisions: [], reportCoverage: { complete: false, reason: 'Reporting source exceeded its safety limit or could not verify complete coverage.' } }
      return { ...ctx, ...raw.context, rulesAvailable:true, txs: raw.txs.map((r: any) => ({ id: r.id, providerAccountRef: r.provider_account_ref, date: r.transaction_date, name: r.name, merchantName: r.merchant_name, amountMinor: Number(r.provider_amount_minor), pending: r.pending, removed: !!r.removed_at, category: r.provider_category })),
        accounts: raw.accounts, decisions: raw.decisions.map(toDecision), hierarchy: decodeSpendingHierarchy(raw.hierarchy), reportCoverage: { complete: true, reason: null } }
}
