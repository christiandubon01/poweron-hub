/**
 * src/services/bankProvider/spending/reconciliationImpact.ts
 *
 * PLAID-3A. READ-ONLY impact preview for the reconciliation switch: the same evidence and the same owner decisions are classified twice, once the way Cash OS
 * does today (switch OFF, the legacy behavior) and once with the reconciliation engine (switch ON), and every difference is listed. It is available while
 * the switch is OFF, writes nothing, and is the evidence the owner needs BEFORE turning the switch on: it answers "which of my historical numbers move,
 * between which lines, and by how much".
 *
 * Conservation: both runs see exactly the same transactions, so the total money in and out is identical; only the line a transaction is counted on can move.
 */
import { BankConnectionError, assertAuthority, type BankActor } from '../bankConnectionService'
import { explorerFromContext, loadImpactContext, type SpendingDeps } from './spendingService'
import { activityOf } from './reporting'
import type { ExplorerRow } from './types'

const ISO = /^\d{4}-\d{2}-\d{2}$/
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
export const ACTIVITY_LABELS: Record<string, string> = { ignored: 'Ignored', business: 'Business spending', personal: 'Personal & owner outflows', debt: 'Debt repayments', transfer: 'Transfers', refund: 'Refunds', income: 'Money in', unresolved: 'Unresolved' }
export const MAX_IMPACT_CHANGES = 200

interface Shape { activity: string; relationship: string; bucket: string }
export interface ImpactChange { id: string; date: string; name: string; amountMinor: number; account: string; off: Shape; on: Shape }
export interface ImpactLine { activity: string; label: string; offCount: number; onCount: number; offOutMinor: number; onOutMinor: number; offInMinor: number; onInMinor: number; deltaOutMinor: number; deltaInMinor: number }
export interface ReconciliationImpact {
  available: boolean
  /** The server's CURRENT setting. The preview is the same either way. */
  switch: 'on' | 'off'
  complete: boolean
  reason: string | null
  window: { from: string; to: string }
  summary: { rows: number; changed: number; totalOutMinor: number; totalInMinor: number; conserved: boolean } | null
  lines: ImpactLine[]
  changes: ImpactChange[]
  changesTruncated: boolean
}

const shapeOf = (r: ExplorerRow): Shape => ({
  activity: activityOf(r),
  relationship: r.relationship.state === 'none' ? 'none' : `${r.relationship.kind}/${r.relationship.state}/${r.relationship.confidence ?? '-'}${r.relationship.target?.id ? `->${r.relationship.target.id}` : ''}`,
  bucket: r.bucket.state === 'none' ? 'none' : `${r.bucket.key}/${r.bucket.state}/${r.bucket.confidence ?? '-'}`,
})

export function buildImpact(rowsOff: ExplorerRow[], rowsOn: ExplorerRow[], scope: { from: string; to: string; environment: 'sandbox' | 'production'; accounts: 'mapped' | 'all' }): Pick<ReconciliationImpact, 'summary' | 'lines' | 'changes' | 'changesTruncated'> {
  const on = new Map(rowsOn.map(r => [r.id, r]))
  const inScope = (r: ExplorerRow) => r.date >= scope.from && r.date <= scope.to && r.account.environment === scope.environment && (scope.accounts === 'all' || r.account.mapped)
  const lines = new Map<string, ImpactLine>()
  const line = (activity: string) => { const l = lines.get(activity) ?? { activity, label: ACTIVITY_LABELS[activity] ?? activity, offCount: 0, onCount: 0, offOutMinor: 0, onOutMinor: 0, offInMinor: 0, onInMinor: 0, deltaOutMinor: 0, deltaInMinor: 0 }; lines.set(activity, l); return l }
  const changes: ImpactChange[] = []
  let rows = 0, changed = 0, totalOut = 0, totalIn = 0, onOut = 0, onIn = 0
  for (const a of rowsOff) {
    const b = on.get(a.id)
    if (!b || !inScope(a)) continue
    rows += 1
    const sa = shapeOf(a), sb = shapeOf(b)
    const money = !a.pending && !(a as { removed?: boolean }).removed // pending and removed rows are in no money total, in either mode
    if (money) {
      const out = a.direction === 'money_out' ? a.amountMinor : 0, inn = a.direction === 'money_in' ? Math.abs(a.amountMinor) : 0
      totalOut += out; totalIn += inn
      const la = line(sa.activity), lb = line(sb.activity)
      la.offCount += 1; la.offOutMinor += out; la.offInMinor += inn
      lb.onCount += 1; lb.onOutMinor += out; lb.onInMinor += inn
      onOut += out; onIn += inn
    }
    if (JSON.stringify(sa) !== JSON.stringify(sb)) { changed += 1; changes.push({ id: a.id, date: a.date, name: a.name, amountMinor: a.amountMinor, account: a.account.label, off: sa, on: sb }) }
  }
  for (const l of lines.values()) { l.deltaOutMinor = l.onOutMinor - l.offOutMinor; l.deltaInMinor = l.onInMinor - l.offInMinor }
  changes.sort((x, y) => Math.abs(y.amountMinor) - Math.abs(x.amountMinor) || x.id.localeCompare(y.id))
  return {
    summary: { rows, changed, totalOutMinor: totalOut, totalInMinor: totalIn, conserved: totalOut === onOut && totalIn === onIn },
    lines: [...lines.values()].sort((x, y) => x.activity.localeCompare(y.activity)),
    changes: changes.slice(0, MAX_IMPACT_CHANGES), changesTruncated: changes.length > MAX_IMPACT_CHANGES,
  }
}

export async function reconciliationImpact(deps: SpendingDeps, actor: BankActor, raw: Record<string, unknown>): Promise<ReconciliationImpact> {
  assertAuthority(actor)
  const asOf = new Date((deps.now ?? Date.now)()).toISOString().slice(0, 10)
  const valid = (v: unknown) => typeof v === 'string' && ISO.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v
  const from = raw.from ?? addDays(asOf, -89), to = raw.to ?? asOf
  if (!valid(from) || !valid(to) || String(from) > String(to)) throw new BankConnectionError('invalid_request', 400, 'Choose a valid date range.')
  const scope = { from: from as string, to: to as string, environment: deps.environment ?? 'sandbox', accounts: raw.accounts === 'all' ? 'all' as const : 'mapped' as const }
  const base = { switch: (deps.reconciliationEnabled === true ? 'on' : 'off') as 'on' | 'off', window: { from: scope.from, to: scope.to }, summary: null, lines: [] as ImpactLine[], changes: [] as ImpactChange[], changesTruncated: false }
  const ctx = await loadImpactContext(deps, actor.organizationId, addDays(scope.from, -125))
  if (!ctx) return { ...base, available: false, complete: false, reason: 'The complete reporting source is not installed, so a full comparison is not possible.' }
  if (ctx.reportCoverage?.complete !== true) return { ...base, available: true, complete: false, reason: ctx.reportCoverage?.reason ?? 'Evidence coverage was not verified. No comparison is shown.' }
  const off = explorerFromContext({ ...ctx, reconciliation: false }, asOf, 'all', scope.environment, true).rows
  const on = explorerFromContext({ ...ctx, reconciliation: true }, asOf, 'all', scope.environment, true).rows
  return { ...base, available: true, complete: true, reason: null, ...buildImpact(off, on, scope) }
}
