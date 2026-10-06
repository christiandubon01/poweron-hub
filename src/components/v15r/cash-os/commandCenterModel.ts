import type { CashOsSnapshot } from '@/finance/cashOsSnapshot'
import type { DecisionAction, DecisionRisk, MoneyItem, NotCountedItem, OwnerDecisionView } from '@/finance/decisionLayer'
import { cashDate, money } from './cashOsUi'

/**
 * Presentation model for the Outlook command center. Everything here is a re-shaping of values the
 * decision layer and projection already produced. No financial rule, ranking or amount is computed.
 */

export type DetailTab = 'Calendar' | 'Projects' | 'Payroll' | 'Transactions' | 'Obligations' | 'Debt Plan'

/** Stable pointers kept on every row so a later slice can link graph events and rows without copying records. */
export interface RowRefs { sourceKey?: string; projectId?: string; accountId?: string; date?: string | null }

export function shortDate(value: string | null | undefined, asOfDate?: string): string | null {
  if (!value) return null
  if (asOfDate && value === asOfDate) return 'Today'
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(Date.UTC(year, month - 1, day, 12)))
}

// ── TODAY ────────────────────────────────────────────────────────────────────────────────────────────

export interface TodayItem { id: string; label: string; amountMinor: number | null; state: string; kind: 'bill' | 'collection'; refs: RowRefs; detail: string }
export interface TodayReceived { id: string; label: string; amountMinor: number }
export interface TodayModel { asOfDate: string; due: TodayItem[]; received: TodayReceived[]; receivedTotalMinor: number }

const DUE_TODAY_REASONS = new Set(['overdue_unsettled', 'collection_linkage_unknown', 'unknown_amount'])

/**
 * Items dated today are projection MARKERS (not events), so Today reads the existing anchor markers.
 * Nothing is assumed paid. "Received" is posted ledger income dated today on cash-counted accounts.
 */
export function buildTodayModel(snapshot: CashOsSnapshot): TodayModel {
  const asOf = snapshot.asOfDate
  const anchor: any = snapshot.projection?.anchor
  const markers: any[] = Array.isArray(anchor?.markers) ? anchor.markers : []
  const due: TodayItem[] = markers
    .filter(m => m.date === asOf && DUE_TODAY_REASONS.has(m.reason))
    .map(m => {
      const collection = m.category === 'project_collection'
      const unknownAmount = m.reason === 'unknown_amount' || m.amountMinor == null
      return {
        id: `today:${m.sourceKey}:${m.reason}`, label: m.label, amountMinor: m.amountMinor ?? null, kind: collection ? 'collection' as const : 'bill' as const,
        state: collection ? 'Expected today · not recorded as received' : unknownAmount ? 'Due today · amount unknown' : 'Due today · not marked paid',
        refs: { sourceKey: m.sourceKey, projectId: m.attribution?.projectId ?? undefined, accountId: m.attribution?.debtAccountId ?? undefined, date: m.date },
        detail: collection
          ? 'A collection was expected today and has not been recorded as paid. Cash OS cannot tell whether the money arrived outside the app.'
          : 'This was planned for today and is not marked paid. Cash OS cannot tell whether it was paid outside the app, so it is not assumed paid.',
      }
    })
  const cashAccounts = new Set((snapshot.accounts ?? []).filter(a => a.status === 'active' && a.account_class === 'asset' && a.include_in_cash).map(a => a.id))
  const received: TodayReceived[] = (snapshot.transactions ?? [])
    .filter(t => t.status === 'posted' && t.transaction_date === asOf && t.transaction_kind === 'income' && t.amount_minor > 0 && cashAccounts.has(t.account_id))
    .map(t => ({ id: t.id, label: t.counterparty || t.description || 'Income', amountMinor: t.amount_minor }))
  return { asOfDate: asOf, due, received, receivedTotalMinor: received.reduce((sum, row) => sum + row.amountMinor, 0) }
}

// ── NEEDS ATTENTION ──────────────────────────────────────────────────────────────────────────────────

export const SEVERITY_LABEL: Record<DecisionRisk['severity'], string> = { high: 'HIGH', medium: 'CHECK', low: 'NOTE' }
const SEVERITY_RANK: Record<DecisionRisk['severity'], number> = { high: 0, medium: 1, low: 2 }

export interface AttentionRow { id: string; risk: DecisionRisk; severity: DecisionRisk['severity']; label: string; title: string
  amountMinor: number | null; dateLabel: string | null; refs: RowRefs; detailsTab?: DetailTab }

const RISK_TAB: Partial<Record<DecisionRisk['kind'], DetailTab>> = {
  overdue_item: 'Obligations', undated_payroll: 'Payroll', incomplete_data: 'Payroll', promo_deadline: 'Debt Plan',
}

/** Severity is the decision layer's own; this only orders it (stable within a severity). */
export function buildAttentionRows(view: OwnerDecisionView): AttentionRow[] {
  return view.risks.map((risk, index) => ({ risk, index }))
    .sort((a, b) => SEVERITY_RANK[a.risk.severity] - SEVERITY_RANK[b.risk.severity] || a.index - b.index)
    .map(({ risk }) => ({
      id: risk.id, risk, severity: risk.severity, label: SEVERITY_LABEL[risk.severity], title: risk.title, amountMinor: risk.amountMinor,
      dateLabel: shortDate(risk.date, view.asOfDate),
      refs: { sourceKey: risk.related.sourceKey, projectId: risk.related.projectId, accountId: risk.related.accountId, date: risk.date },
      detailsTab: RISK_TAB[risk.kind],
    }))
}

// ── MONEY ────────────────────────────────────────────────────────────────────────────────────────────

export type MoneyRowState = 'collectible' | 'unlockable' | 'potential' | 'blocked' | 'not_counted'
export const MONEY_STATE_LABEL: Record<MoneyRowState, string> = {
  collectible: 'COLLECTIBLE', unlockable: 'UNLOCKABLE', potential: 'POTENTIAL', blocked: 'BLOCKED', not_counted: 'NOT COUNTED',
}
export const MONEY_STATE_PHRASE: Record<MoneyRowState, string> = {
  collectible: 'Earned, not yet paid', unlockable: 'Needs work first', potential: 'Not awarded', blocked: 'Blocked', not_counted: 'Not counted',
}
export const MONEY_STATE_EXPLAIN: Record<MoneyRowState, string> = {
  collectible: 'Earned and billed (or completed), not yet recorded as paid. It is not in your cash until it is recorded as paid.',
  unlockable: 'A balance exists, but something must happen first. It is not in your cash.',
  potential: 'An estimate or unconfirmed work. Counted as $0 until it is awarded.',
  blocked: 'Cannot move forward right now. No money is forecast from it.',
  not_counted: 'Cash OS has not counted this as money.',
}

export interface MoneyRow { id: string; state: MoneyRowState; label: string; amountMinor: number | null; basis: string; unknowns: string[]
  refs: RowRefs; requiresMinor: number | null; item?: MoneyItem; notCounted?: NotCountedItem }

/** Cash needed first is a CONSTRAINT on the money row, taken from an existing action for the same project. */
export function cashRequirementFor(projectId: string | undefined, actions: readonly DecisionAction[]): number | null {
  if (!projectId) return null
  const match = actions.filter(a => a.related.projectId === projectId && typeof a.resource.cashMinor === 'number' && a.resource.cashMinor > 0)
    .sort((a, b) => a.order - b.order)[0]
  return match ? match.resource.cashMinor : null
}

export function buildMoneyRows(view: OwnerDecisionView): MoneyRow[] {
  const states = view.moneyStates
  const rows: MoneyRow[] = []
  const add = (state: Exclude<MoneyRowState, 'not_counted'>, items: MoneyItem[]) => {
    for (const item of items) {
      rows.push({ id: `money:${item.id}`, state, label: item.label, amountMinor: item.amountMinor, basis: item.basis, unknowns: item.unknowns,
        refs: { projectId: item.projectId }, requiresMinor: cashRequirementFor(item.projectId, view.actions), item })
    }
  }
  add('collectible', states.collectible)
  add('unlockable', states.unlockable)
  add('potential', states.potential)
  add('blocked', states.blocked)
  for (const item of states.notCounted) {
    rows.push({ id: `money:${item.id}`, state: 'not_counted', label: item.label, amountMinor: null, basis: item.reason, unknowns: [],
      refs: { projectId: item.projectId }, requiresMinor: null, notCounted: item })
  }
  return rows
}

// ── NEXT ─────────────────────────────────────────────────────────────────────────────────────────────

export type NextGroup = 'no_cash' | 'work' | 'protect' | 'waiting' | 'watch'
export const NEXT_GROUP_LABEL: Record<NextGroup, string> = {
  no_cash: 'NO CASH NEEDED', work: 'WORK', protect: 'PROTECT', waiting: 'WAITING', watch: 'WATCH',
}
/** Existing decision-layer category order. `cash_required` is a constraint on WORK, never its own module. */
const CATEGORY_ORDER: DecisionAction['category'][] = ['no_cash', 'owner_work', 'cash_required', 'protection', 'waiting', 'watch']
const GROUP_OF: Record<DecisionAction['category'], NextGroup> = {
  no_cash: 'no_cash', owner_work: 'work', cash_required: 'work', protection: 'protect', waiting: 'waiting', watch: 'watch',
}

export interface NextRow { id: string; group: NextGroup; label: string; title: string; requiresMinor: number | null; amountPhrase: string | null
  checkFirst: boolean; action: DecisionAction; refs: RowRefs }

function amountPhrase(action: DecisionAction): string | null {
  const minor = action.amount.minor
  if (minor == null) return null
  switch (action.amount.meaning) {
    case 'unlocks': return `Could unlock ${money(minor)}`
    case 'collects': return `Collect ${money(minor)}`
    case 'protects': return `Protects ${money(minor)}`
    case 'owed': return `Owed ${money(minor)}`
    case 'at_risk': return `At risk ${money(minor)}`
    default: return null
  }
}

/** Orders by the existing category order then the existing within-category `order`. No cross-category scoring. */
export function buildNextRows(view: OwnerDecisionView): { top: NextRow[]; rest: NextRow[] } {
  const sorted = [...view.actions].sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.order - b.order)
  const rows: NextRow[] = sorted.map(action => ({
    id: `next:${action.id}`, group: GROUP_OF[action.category], label: NEXT_GROUP_LABEL[GROUP_OF[action.category]], title: action.title,
    requiresMinor: typeof action.resource.cashMinor === 'number' && action.resource.cashMinor > 0 ? action.resource.cashMinor : null,
    amountPhrase: amountPhrase(action), checkFirst: action.certainty === 'needs_verification', action,
    refs: { sourceKey: action.related.sourceKey, projectId: action.related.projectId, accountId: action.related.accountId, date: action.timing.date },
  }))
  const seen = new Set<NextGroup>()
  const top: NextRow[] = []
  const rest: NextRow[] = []
  for (const row of rows) {
    if (seen.has(row.group)) rest.push(row)
    else { seen.add(row.group); top.push(row) }
  }
  return { top, rest }
}

export { cashDate }
