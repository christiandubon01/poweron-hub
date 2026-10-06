/**
 * CASH-UX-1 — owner decision layer (READ-ONLY derivation).
 *
 * Turns the canonical Cash OS snapshot into plain owner guidance: what cash is real, what is due soon,
 * what money exists but is not cash yet, what is risky, and what the owner could do next.
 *
 * Hard guarantees (see the locked owner decision contract):
 *  - Pure: no network, no storage, no writes, no mutation of the snapshot. It deliberately does NOT call
 *    `getProjectFinancials` (that helper creates `project.finance` when missing, i.e. it writes); it applies
 *    the same formulas (contract − paid, billed − paid, contract − billed) to Cash OS's read-only evidence.
 *  - Only `available` money is cash. Collectible / unlockable / potential / blocked amounts are reported
 *    separately and are never added to available cash, and never promoted by time passing or a percentage.
 *  - Recommendations carry a reason, a certainty and the list of facts that are missing. Where a fact the
 *    rules need is not stored anywhere (blockers, completion requirements, materials still to buy, billing
 *    type, past-due amounts, operational criticality), the layer says so instead of inventing it.
 *  - Owner-supplied facts are an OPTIONAL input (`OwnerDecisionFacts`). Nothing persists them yet; they are
 *    the extension point for a later phase. Without them the rules that depend on them stay inert.
 */
import { readClockProjects, readProjectCollectionEvidence } from './adapters/projectFinanceAdapter'
import { addCalendarDays } from './recurrence'
import type { CashOsSnapshot } from './cashOsSnapshot'

// ── Owner-supplied facts (extension point; no persistence in this phase) ─────────────────────────────

export interface ProjectDecisionFact {
  billingType?: 'fixed' | 'time_and_material'
  /** Explicit owner statement. 'ready_to_bill' is the only way unbilled money becomes collectible. */
  readiness?: 'ready_to_bill' | 'work_required' | 'blocked'
  blocker?: string
  workRequirement?: string
  nextAction?: string
  /** Cash the owner must spend before the project money can be collected (e.g. materials). */
  cashRequiredMinor?: number
  workHours?: number
  expectedCollectionDate?: string
  collectionConfidence?: 'high' | 'medium' | 'low'
  /** false = not awarded yet (estimate/opportunity). */
  awarded?: boolean
}

export interface ObligationDecisionFact {
  /** Failure would threaten the owner's ability to keep earning (e.g. a work vehicle). */
  operationallyCritical?: boolean
  consequence?: string
  consequenceSeverity?: 'severe' | 'moderate' | 'minor'
}

export interface DebtDecisionFact extends ObligationDecisionFact {
  pastDueMinor?: number
  /** Amount that would bring the account current. */
  catchUpMinor?: number
  /** Smallest payment known to satisfy a stated requirement (minimum due, cure threshold). */
  minimumDueMinor?: number
  /** A fee/penalty a specific payment would avoid. */
  feeAvoidedMinor?: number
  dueDate?: string
}

export interface OpportunityFact {
  id: string
  label: string
  amountMinor: number | null
  status: 'estimate_sent' | 'proposed' | 'verbal' | 'other'
  nextAction?: string
}

export interface OwnerDecisionFacts {
  projects?: Record<string, ProjectDecisionFact>
  /** Keyed by the protected requirement's dedupe key (the canonical source key). */
  obligations?: Record<string, ObligationDecisionFact>
  /** Keyed by the obligation id or commitment id (so a recurring obligation matches all of its occurrences). */
  records?: Record<string, ObligationDecisionFact>
  /** Keyed by liability account id. */
  debts?: Record<string, DebtDecisionFact>
  opportunities?: OpportunityFact[]
}

// ── Output shape ─────────────────────────────────────────────────────────────────────────────────────

export type MoneyState = 'available' | 'collectible' | 'unlockable' | 'potential' | 'blocked'
export type ActionCategory = 'cash_required' | 'owner_work' | 'no_cash' | 'waiting' | 'protection' | 'watch'
export type Certainty = 'recommended' | 'needs_verification' | 'informational'

export interface MoneyItem {
  id: string
  state: Exclude<MoneyState, 'available'>
  label: string
  amountMinor: number | null
  /** Plain-English reason this money is in this state. */
  basis: string
  projectId?: string
  unknowns: string[]
  /** True only when the state came from an explicit owner fact rather than stored project data. */
  ownerConfirmed: boolean
}

export interface NotCountedItem { id: string; label: string; reason: string; projectId?: string }

export interface DecisionRisk {
  id: string
  kind: 'cash_negative' | 'protection_shortfall' | 'projected_shortfall' | 'overdue_item'
    | 'promo_deadline' | 'undated_payroll' | 'incomplete_data'
  severity: 'high' | 'medium' | 'low'
  title: string
  detail: string
  amountMinor: number | null
  date: string | null
  missing: string[]
  related: { projectId?: string; accountId?: string; sourceKey?: string }
}

export interface DecisionAction {
  id: string
  category: ActionCategory
  title: string
  /** Why this matters. Never empty. */
  why: string[]
  resource: { cashMinor: number | null; ownerWork: 'none' | 'required' | 'unknown' }
  amount: { minor: number | null; meaning: 'protects' | 'unlocks' | 'collects' | 'owed' | 'at_risk' | 'none' }
  timing: { date: string | null; basis: string }
  certainty: Certainty
  dataCompleteness: 'complete' | 'partial' | 'unknown'
  /** Facts the recommendation would need that Cash OS does not have. */
  missing: string[]
  related: { projectId?: string; accountId?: string; sourceKey?: string }
  /** Locked owner-contract rules (1–8) this action applies. */
  rules: number[]
  /** Position among actions of the SAME category only. Categories are not mutually exclusive. */
  order: number
}

export interface UpcomingMovement {
  date: string
  label: string
  direction: 'inflow' | 'outflow'
  amountMinor: number
  confidence: string
}

export interface OwnerDecisionView {
  asOfDate: string
  /** 'unavailable' = no usable snapshot; 'withheld' = Cash OS withholds cash totals (partial payroll data). */
  status: 'ready' | 'withheld' | 'unavailable'
  today: {
    availableMinor: number | null
    protectedMinor: number | null
    trulyFreeMinor: number | null
    protectionShortfallMinor: number | null
    operatingFloorMinor: number | null
    notes: string[]
  }
  next7Days: {
    endDate: string
    movements: UpcomingMovement[]
    requiredOutflowMinor: number
    lowestCashMinor: number | null
    lowestCashDate: string | null
    firstShortfallDate: string | null
    undatedPayrollMinor: number
    notes: string[]
  }
  moneyStates: {
    /** The only cash. Future money below is never added to it. */
    availableMinor: number | null
    collectible: MoneyItem[]
    unlockable: MoneyItem[]
    potential: MoneyItem[]
    blocked: MoneyItem[]
    totals: Record<Exclude<MoneyState, 'available'>, { knownMinor: number; unknownCount: number }>
    notCounted: NotCountedItem[]
    settledProjectCount: number
  }
  risks: DecisionRisk[]
  actions: DecisionAction[]
  dataGaps: string[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────────

export function plainMoney(minor: number | null | undefined): string {
  if (minor == null) return 'unknown'
  const abs = Math.abs(minor) / 100
  return `${minor < 0 ? '-' : ''}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000)
}
function daysBetween(from: string, to: string): number { return dayNumber(to) - dayNumber(from) }
function isMinor(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function isDate(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) }
function textOf(value: unknown): string { return String(value ?? '').toLowerCase().trim() }

const POTENTIAL_STATUSES = ['estimate', 'estimated', 'estimating', 'bid', 'bidding', 'lead', 'quote', 'quoted', 'proposal', 'proposed', 'pending', 'coming']
const EXCLUDED_STATUSES = ['canceled', 'cancelled', 'archived', 'deleted', 'lost', 'rejected']

/** How far ahead a promotional deadline is surfaced. A named constant, not an owner-tuned setting. */
export const PROMO_WATCH_DAYS = 180

// ── Canonical owner facts → decision facts (CASH-UX-2) ───────────────────────────────────────────────

function definedOnly<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

/**
 * Reads the owner facts that are now STORED (project facts, debt catch-up, criticality on obligations,
 * commitments and debts) and expresses them as `OwnerDecisionFacts`. Pure. Nothing is inferred: a fact that
 * was not stored stays absent. The cash a job needs is the sum of its linked required commitments, never a
 * separately typed number, so it can never disagree with the commitments themselves.
 */
export function deriveCanonicalDecisionFacts(snapshot: CashOsSnapshot | null | undefined): OwnerDecisionFacts {
  const out: OwnerDecisionFacts = {}
  if (!snapshot) return out
  const s: any = snapshot
  const commitments: any[] = Array.isArray(s.commitments) ? s.commitments : []

  const projectRows: any[] = Array.isArray(s.projectFacts) ? s.projectFacts : []
  if (projectRows.length) {
    out.projects = {}
    for (const row of projectRows) {
      if (!row?.project_id) continue
      const linkedMinor = commitments
        .filter(c => c.projectId === row.project_id && c.status === 'scheduled'
          && c.reconciliationState !== 'reconciled' && c.requirement === 'required')
        .reduce((sum, c) => sum + (c.amount?.minor ?? 0), 0)
      const blocked = typeof row.blocked_reason === 'string' && row.blocked_reason.trim() !== ''
      const hours = row.work_hours_remaining == null ? undefined : Number(row.work_hours_remaining)
      out.projects[row.project_id] = definedOnly<ProjectDecisionFact>({
        billingType: row.billing_type ?? undefined,
        readiness: blocked ? 'blocked' : (row.readiness ?? (row.completion_requirement ? 'work_required' : undefined)),
        blocker: blocked ? row.blocked_reason : undefined,
        workRequirement: row.completion_requirement ?? undefined,
        nextAction: row.next_action ?? undefined,
        cashRequiredMinor: linkedMinor > 0 ? linkedMinor : row.needs_spend === false ? 0 : undefined,
        workHours: hours != null && Number.isFinite(hours) ? hours : undefined,
        expectedCollectionDate: row.expected_collection_date ?? undefined,
        collectionConfidence: row.collection_confidence ?? undefined,
      })
    }
  }

  const records: Record<string, ObligationDecisionFact> = {}
  for (const row of [...(Array.isArray(s.obligations) ? s.obligations : []), ...commitments]) {
    if (row?.operationallyCritical === true) {
      records[row.id] = definedOnly<ObligationDecisionFact>({ operationallyCritical: true, consequence: row.criticalReason ?? undefined })
    }
  }
  if (Object.keys(records).length) out.records = records

  const termRows: any[] = Array.isArray(s.liabilityTerms) ? s.liabilityTerms : []
  const debts: Record<string, DebtDecisionFact> = {}
  for (const row of termRows) {
    const critical = row.operationally_critical === true
    const stated = isMinor(row.past_due_minor) || isMinor(row.catch_up_minor) || row.consequence_note || critical
    if (!row?.account_id || !stated) continue
    const contractual = isMinor(row.scheduled_payment_minor) ? row.scheduled_payment_minor
      : isMinor(row.minimum_payment_minor) ? row.minimum_payment_minor : undefined
    debts[row.account_id] = definedOnly<DebtDecisionFact>({
      pastDueMinor: isMinor(row.past_due_minor) ? row.past_due_minor : undefined,
      catchUpMinor: isMinor(row.catch_up_minor) ? row.catch_up_minor : undefined,
      // The normal required payment, taken from the stored contractual terms. Not the catch-up amount.
      minimumDueMinor: contractual,
      consequence: row.consequence_note ?? (critical ? row.critical_reason : undefined) ?? undefined,
      operationallyCritical: critical ? true : undefined,
      dueDate: isDate(row.next_due_date) ? row.next_due_date : undefined,
    })
  }
  if (Object.keys(debts).length) out.debts = debts
  return out
}

function mergeFacts(base: OwnerDecisionFacts, override: OwnerDecisionFacts | undefined): OwnerDecisionFacts {
  if (!override) return base
  const merge = <T,>(a?: Record<string, T>, b?: Record<string, T>) =>
    (a || b) ? { ...(a ?? {}), ...Object.fromEntries(Object.entries(b ?? {}).map(([k, v]) => [k, { ...(a?.[k] ?? {}), ...v }])) } : undefined
  return definedOnly<OwnerDecisionFacts>({
    projects: merge(base.projects, override.projects),
    obligations: merge(base.obligations, override.obligations),
    records: merge(base.records, override.records),
    debts: merge(base.debts, override.debts),
    opportunities: [...(base.opportunities ?? []), ...(override.opportunities ?? [])].length
      ? [...(base.opportunities ?? []), ...(override.opportunities ?? [])] : undefined,
  })
}

// ── Money states ─────────────────────────────────────────────────────────────────────────────────────

function deriveProjectMoney(snapshot: CashOsSnapshot, facts: OwnerDecisionFacts): {
  items: MoneyItem[]; notCounted: NotCountedItem[]; settled: number
} {
  const items: MoneyItem[] = []
  const notCounted: NotCountedItem[] = []
  let settled = 0
  const backup: any = (snapshot as any).backup
  if (!backup || !Array.isArray(backup.projects)) return { items, notCounted, settled }
  const scope = { organizationId: snapshot.organizationId, asOfDate: snapshot.asOfDate }
  const clockProjects = readClockProjects(scope, backup)
  const evidence = new Map(readProjectCollectionEvidence(scope, backup).map(e => [e.projectId, e]))
  const rawById = new Map<string, any>((backup.projects as any[]).map(p => [String(p.id), p]))

  for (const project of clockProjects) {
    const status = textOf(project.status)
    const outcome = textOf(project.outcome)
    if (project.archived || project.deletedAt || EXCLUDED_STATUSES.includes(status)
      || ['canceled', 'cancelled', 'lost'].includes(outcome)) continue
    const fact = facts.projects?.[project.projectId]
    const name = project.projectName || project.projectId
    const raw = rawById.get(project.projectId)
    const paidMinor = evidence.get(project.projectId)?.lifetimeCollectedMinor ?? 0
    const billedNumber = Number(raw?.billed ?? 0)
    const billedMinor = Number.isFinite(billedNumber) && billedNumber > 0 ? Math.round(billedNumber * 100) : 0
    const contractMinor = project.contractMinor
    const completed = status === 'completed' || outcome === 'completed'
    const common = { projectId: project.projectId, label: name }

    if (fact?.awarded === false || (fact?.awarded !== true && POTENTIAL_STATUSES.includes(status) && outcome !== 'won')) {
      // Estimate / not-yet-awarded work: shown for follow-up, never counted as earned money.
      items.push({ ...common, id: `${project.projectId}:potential`, state: 'potential',
        amountMinor: contractMinor > 0 ? Math.max(0, contractMinor - paidMinor) : null,
        basis: fact?.awarded === false
          ? 'Owner says this is not awarded yet.'
          : `Project is marked "${project.status}", and Cash OS does not record whether it was awarded.`,
        unknowns: ['whether the customer has accepted', ...(contractMinor > 0 ? [] : ['an amount'])],
        ownerConfirmed: fact?.awarded === false })
      continue
    }

    if (fact?.billingType === 'time_and_material' || (contractMinor === 0 && !fact?.billingType)) {
      // Time-and-material (or no fixed amount on record): only an invoice that exists is collectible.
      const arMinor = Math.max(0, billedMinor - paidMinor)
      if (arMinor > 0) {
        items.push({ ...common, id: `${project.projectId}:collectible`, state: 'collectible', amountMinor: arMinor,
          basis: 'Billed on the project and not yet recorded as paid.',
          unknowns: ['expected payment date', 'how likely the customer is to pay on time'], ownerConfirmed: false })
      }
      if (fact?.readiness === 'blocked') {
        items.push({ ...common, id: `${project.projectId}:blocked`, state: 'blocked', amountMinor: null,
          basis: `Work cannot continue${fact.blocker ? `: ${fact.blocker}` : ''}. Nothing is earned until work resumes.`,
          unknowns: [], ownerConfirmed: true })
      } else {
        notCounted.push({ ...common, id: `${project.projectId}:no-fixed-balance`,
          reason: fact?.billingType === 'time_and_material'
            ? 'Time-and-material: money is earned only as work is done and invoiced. Nothing future is counted.'
            : 'No fixed contract amount is recorded, so there is no balance to count. If this is time-and-material, nothing is counted until work is invoiced. Whether it is blocked is not recorded in Cash OS.' })
      }
      continue
    }

    const remainingMinor = Math.max(0, contractMinor - paidMinor)
    if (remainingMinor === 0) { settled += 1; continue }

    // 1) Money tied to a real business event is COLLECTIBLE.
    let collectibleMinor = 0
    let collectibleBasis = ''
    let ownerConfirmed = false
    if (completed) {
      collectibleMinor = remainingMinor
      collectibleBasis = 'Project is marked completed and the balance is not recorded as collected.'
    } else if (billedMinor > paidMinor) {
      collectibleMinor = Math.min(remainingMinor, billedMinor - paidMinor)
      collectibleBasis = 'Billed on the project and not yet recorded as paid.'
    }
    if (fact?.readiness === 'ready_to_bill' && collectibleMinor < remainingMinor) {
      collectibleMinor = remainingMinor
      collectibleBasis = 'Owner confirmed this is ready to bill.'
      ownerConfirmed = true
    }
    if (collectibleMinor > 0) {
      items.push({ ...common, id: `${project.projectId}:collectible`, state: 'collectible', amountMinor: collectibleMinor,
        basis: collectibleBasis, unknowns: ['expected payment date', 'how likely the customer is to pay on time'], ownerConfirmed })
    }

    // 2) The rest of the balance is UNLOCKABLE or BLOCKED. It is not cash.
    const restMinor = remainingMinor - collectibleMinor
    if (restMinor > 0) {
      if (fact?.readiness === 'blocked') {
        items.push({ ...common, id: `${project.projectId}:blocked`, state: 'blocked', amountMinor: restMinor,
          basis: `Cannot advance${fact.blocker ? `: ${fact.blocker}` : ''}.`, unknowns: [], ownerConfirmed: true })
      } else {
        const known = fact?.readiness === 'work_required'
        items.push({ ...common, id: `${project.projectId}:unlockable`, state: 'unlockable', amountMinor: restMinor,
          basis: known
            ? `Balance remains, but ${fact?.workRequirement ?? 'work'} must happen before it can be collected.`
            : 'A balance remains on the contract. Cash OS does not record what must be finished before it can be collected.',
          unknowns: known ? [] : ['what work remains', 'materials still to buy', 'expected collection date'],
          ownerConfirmed: known })
      }
    }
  }

  for (const opp of facts.opportunities ?? []) {
    items.push({ id: `opportunity:${opp.id}`, state: 'potential', label: opp.label, amountMinor: opp.amountMinor,
      basis: 'Estimate or opportunity that is not awarded. Not counted as money you will receive.',
      unknowns: ['whether the customer will accept'], ownerConfirmed: true })
  }
  return { items, notCounted, settled }
}

// ── Debts ────────────────────────────────────────────────────────────────────────────────────────────

function derivePromoRisks(snapshot: CashOsSnapshot): DecisionRisk[] {
  const risks: DecisionRisk[] = []
  const terms = Array.isArray((snapshot as any).liabilityTerms) ? (snapshot as any).liabilityTerms : []
  const balances: Record<string, number> = (snapshot as any).accountBalancesMinor ?? {}
  const accounts: any[] = Array.isArray((snapshot as any).accounts) ? (snapshot as any).accounts : []
  for (const row of terms) {
    const account = accounts.find(a => a.id === row.account_id)
    if (!account || account.account_class !== 'liability' || account.status !== 'active') continue
    if (!isDate(row.promo_expires_on)) continue
    const balance = balances[row.account_id]
    if (typeof balance !== 'number' || balance <= 0) continue
    const daysLeft = daysBetween(snapshot.asOfDate, row.promo_expires_on)
    const label = account.display_name
    const deferred = row.promo_type === 'deferred_interest'
    const standardApr = typeof row.apr_basis_points === 'number' ? `${(row.apr_basis_points / 100).toFixed(2)}%` : null
    const payment = isMinor(row.scheduled_payment_minor) ? row.scheduled_payment_minor
      : isMinor(row.minimum_payment_minor) ? row.minimum_payment_minor : null
    if (daysLeft < 0) {
      risks.push({ id: `promo-passed:${row.account_id}`, kind: 'promo_deadline', severity: 'medium',
        title: `${label}: promotional period ended ${row.promo_expires_on}`,
        detail: `The stored promotional end date has passed with ${plainMoney(balance)} still owed. Cash OS cannot tell whether${deferred ? ' deferred interest was charged' : ' the standard rate now applies'}${standardApr ? ` (standard APR ${standardApr})` : ''}; check the statement.`,
        amountMinor: balance, date: row.promo_expires_on, missing: ['statement confirmation'], related: { accountId: row.account_id } })
      continue
    }
    if (daysLeft > PROMO_WATCH_DAYS) continue
    const monthsLeft = Math.max(daysLeft / 30.4375, 0.0001)
    const neededPerMonth = Math.ceil(balance / Math.max(monthsLeft, 1))
    const clears = payment != null && payment * Math.floor(monthsLeft) >= balance
    const detailParts = [
      `${plainMoney(balance)} is owed and the promotional period ends ${row.promo_expires_on} (${daysLeft} day${daysLeft === 1 ? '' : 's'}).`,
      payment != null
        ? (clears ? `At the stored payment of ${plainMoney(payment)}/month it is on track to clear in time.`
          : `At the stored payment of ${plainMoney(payment)}/month it will not clear by then; clearing it needs roughly ${plainMoney(neededPerMonth)}/month.`)
        : 'No payment amount is stored, so Cash OS cannot tell whether it will clear in time.',
      deferred
        ? `This is stored as deferred interest, so interest may be charged back to the start if it is not cleared${standardApr ? ` (standard APR ${standardApr})` : ''}.`
        : `The rate changes after that date${standardApr ? ` (standard APR ${standardApr})` : ''}.`,
    ]
    risks.push({ id: `promo:${row.account_id}`, kind: 'promo_deadline',
      severity: !clears && (deferred || daysLeft <= 90) ? 'high' : !clears ? 'medium' : 'low',
      title: `${label}: promotional deadline ${row.promo_expires_on}`, detail: detailParts.join(' '),
      amountMinor: balance, date: row.promo_expires_on,
      missing: payment == null ? ['monthly payment'] : [], related: { accountId: row.account_id } })
  }
  return risks
}

// ── Main derivation ──────────────────────────────────────────────────────────────────────────────────

interface ProtectionTarget {
  id: string; label: string; amountMinor: number; dueDate: string | null
  bucket: string; critical: boolean; severity: 'severe' | 'moderate' | 'minor' | 'unknown'
  consequence?: string; sourceKey?: string; accountId?: string
}

/** The obligation id or commitment id behind a protected requirement (occurrences point back to their obligation). */
function plannedRecordId(requirement: any, occurrences: any): string {
  const recordId = String(requirement.sourceRecordId ?? '')
  if (requirement.sourceType === 'cash_commitment') return recordId
  const occurrence = Array.isArray(occurrences) ? occurrences.find((o: any) => o.id === recordId) : undefined
  return occurrence?.obligationId ?? recordId.split(':')[0]
}

function unavailable(asOfDate: string, why: string): OwnerDecisionView {
  return {
    asOfDate, status: 'unavailable',
    today: { availableMinor: null, protectedMinor: null, trulyFreeMinor: null, protectionShortfallMinor: null,
      operatingFloorMinor: null, notes: [why] },
    next7Days: { endDate: asOfDate, movements: [], requiredOutflowMinor: 0, lowestCashMinor: null,
      lowestCashDate: null, firstShortfallDate: null, undatedPayrollMinor: 0, notes: [] },
    moneyStates: { availableMinor: null, collectible: [], unlockable: [], potential: [], blocked: [],
      totals: emptyTotals(), notCounted: [], settledProjectCount: 0 },
    risks: [], actions: [], dataGaps: [why],
  }
}
function emptyTotals(): OwnerDecisionView['moneyStates']['totals'] {
  const zero = () => ({ knownMinor: 0, unknownCount: 0 })
  return { collectible: zero(), unlockable: zero(), potential: zero(), blocked: zero() }
}

export function buildOwnerDecisionView(
  snapshot: CashOsSnapshot | null | undefined,
  options: { partial?: boolean; facts?: OwnerDecisionFacts } = {},
): OwnerDecisionView {
  if (!snapshot || !snapshot.asOfDate) return unavailable('', 'Cash OS has no usable snapshot yet.')
  // Canonical stored owner facts first; an explicit caller override (tests, future tools) wins per key.
  let facts: OwnerDecisionFacts
  try { facts = mergeFacts(deriveCanonicalDecisionFacts(snapshot), options.facts) } catch { facts = options.facts ?? {} }
  const asOf = snapshot.asOfDate
  const allocation: any = (snapshot as any).allocation
  const projection: any = (snapshot as any).projection
  const withheld = options.partial === true
  const hasCash = !!allocation && typeof allocation.totalCashMinor === 'number'

  const view = unavailable(asOf, '')
  view.status = withheld ? 'withheld' : hasCash ? 'ready' : 'unavailable'
  view.dataGaps = []
  view.today.notes = []
  const dataGaps = view.dataGaps
  if ((snapshot as any).projectFactsError) dataGaps.push('Your saved job details could not be loaded, so Cash OS is working without them.')
  const risks = view.risks
  const actions: DecisionAction[] = []
  const counters: Record<ActionCategory, number> = { cash_required: 0, owner_work: 0, no_cash: 0, waiting: 0, protection: 0, watch: 0 }
  const push = (a: Omit<DecisionAction, 'order'>) => { actions.push({ ...a, order: ++counters[a.category] }) }

  // ── TODAY ──
  const floorMinor: number | null = typeof (snapshot as any).setup?.operatingFloorMinor === 'number'
    ? (snapshot as any).setup.operatingFloorMinor : null
  const cashMinor = hasCash ? allocation.totalCashMinor as number : null
  if (withheld) {
    view.today.notes.push('Cash OS is withholding cash totals until payroll inputs are reviewed. See the Payroll tab.')
  } else if (hasCash) {
    view.today = {
      availableMinor: cashMinor, protectedMinor: allocation.protectedCashMinor,
      trulyFreeMinor: allocation.trulyFreeCashMinor, protectionShortfallMinor: allocation.uncoveredProtectionDeficitMinor,
      operatingFloorMinor: floorMinor, notes: [],
    }
    if (cashMinor! < 0) view.today.notes.push('Your included cash accounts add up to less than zero.')
    if (floorMinor === 0) dataGaps.push('The operating survival floor is $0 in your session assumptions, so no cash is held back to keep working.')
  }

  // ── Protection targets (Rule 1: operational consequence, never APR or age) ──
  const requirements: any[] = Array.isArray(allocation?.allocationResult?.requirements) ? allocation.allocationResult.requirements : []
  const datedEvents: any[] = Array.isArray(projection?.datedEvents) ? projection.datedEvents : []
  const datedMarkers: any[] = Array.isArray(projection?.datedMarkers) ? projection.datedMarkers : []
  const undatedMarkers: any[] = Array.isArray(projection?.undatedMarkers) ? projection.undatedMarkers : []
  const targets: ProtectionTarget[] = requirements
    .filter(r => r.sourceType !== 'policy' && typeof r.amountMinor === 'number')
    .map(r => {
      const debtFact = r.attribution?.debtAccountId ? facts.debts?.[r.attribution.debtAccountId] : undefined
      const obFact = facts.obligations?.[r.dedupeKey]
      const recordFact = facts.records?.[plannedRecordId(r, (snapshot as any).occurrences)]
      const merged = { ...debtFact, ...recordFact, ...obFact }
      return {
        id: r.dedupeKey, label: r.label, amountMinor: r.amountMinor,
        dueDate: datedEvents.find(e => e.sourceKey === r.dedupeKey)?.date
          ?? datedMarkers.find(m => m.sourceKey === r.dedupeKey)?.date ?? null,
        bucket: r.bucket, critical: merged.operationallyCritical === true,
        severity: merged.consequenceSeverity ?? 'unknown', consequence: merged.consequence,
        sourceKey: r.dedupeKey, accountId: r.attribution?.debtAccountId ?? undefined,
      } as ProtectionTarget
    })

  // ── NEXT 7 DAYS ──
  const endDate = addCalendarDays(asOf, 7)
  view.next7Days.endDate = endDate
  if (!withheld && projection) {
    view.next7Days.movements = datedEvents.filter(e => e.date <= endDate)
      .sort((a, b) => a.date.localeCompare(b.date) || a.sourceKey.localeCompare(b.sourceKey))
      .map(e => ({ date: e.date, label: e.label, direction: e.direction, amountMinor: e.amountMinor, confidence: e.confidence }))
    view.next7Days.requiredOutflowMinor = view.next7Days.movements
      .filter(m => m.direction === 'outflow').reduce((s, m) => s + m.amountMinor, 0)
    const week = (Array.isArray(projection.days) ? projection.days : []).slice(0, 7)
    const low = week.reduce((best: any, d: any) => (!best || d.closingCashMinor < best.closingCashMinor) ? d : best, null)
    if (low) { view.next7Days.lowestCashMinor = low.closingCashMinor; view.next7Days.lowestCashDate = low.date }
    view.next7Days.firstShortfallDate = week.find((d: any) => d.closingCashMinor < 0 || d.protectionDeficitMinor > 0)?.date ?? null
    view.next7Days.undatedPayrollMinor = undatedMarkers
      .filter(m => m.semanticCode === 'payment_timing_unknown' && typeof m.amountMinor === 'number')
      .reduce((s, m) => s + m.amountMinor, 0)
    view.next7Days.notes.push('Only confirmed money in is included in this forecast. Unconfirmed money is not counted as cash.')
  }

  // ── MONEY STATES (Rule 7) ──
  view.moneyStates.availableMinor = withheld ? null : cashMinor
  try {
    const money = deriveProjectMoney(snapshot, facts)
    view.moneyStates.notCounted = money.notCounted
    view.moneyStates.settledProjectCount = money.settled
    for (const item of money.items) {
      const bucket = view.moneyStates[item.state === 'collectible' ? 'collectible'
        : item.state === 'unlockable' ? 'unlockable' : item.state === 'potential' ? 'potential' : 'blocked']
      bucket.push(item)
      const t = view.moneyStates.totals[item.state]
      if (item.amountMinor == null) t.unknownCount += 1
      else t.knownMinor += item.amountMinor
    }
  } catch {
    dataGaps.push('Project balances could not be read, so project money is not shown.')
  }
  const activeProjectItems = view.moneyStates.unlockable.length + view.moneyStates.collectible.length + view.moneyStates.notCounted.length
  if (activeProjectItems > 0) {
    dataGaps.push('Cash OS does not record project blockers, what work remains, materials still to buy, expected collection dates, or whether a job is fixed-price or time-and-material.')
  }
  dataGaps.push('Estimates and leads are not read by Cash OS, so unawarded work is not counted anywhere here.')

  // ── RISKS ──
  if (!withheld && hasCash) {
    if (cashMinor! < 0) {
      risks.push({ id: 'cash-negative', kind: 'cash_negative', severity: 'high',
        title: `Included cash is ${plainMoney(cashMinor)}`,
        detail: 'Your included cash accounts add up to less than zero today. Money you may collect later is not counted in this number.',
        amountMinor: cashMinor, date: asOf, missing: [], related: {} })
    }
    if (allocation.uncoveredProtectionDeficitMinor > 0) {
      risks.push({ id: 'protection-shortfall', kind: 'protection_shortfall', severity: 'high',
        title: `Cash is ${plainMoney(allocation.uncoveredProtectionDeficitMinor)} short of what you have protected`,
        detail: `${plainMoney(allocation.totalProtectedRequirementMinor)} is protected for required bills, payroll and your operating floor, but only ${plainMoney(cashMinor)} is available.`,
        amountMinor: allocation.uncoveredProtectionDeficitMinor, date: asOf, missing: [], related: {} })
    }
    const low14 = projection?.summary
    if (low14 && low14.fourteenDayLowestTotalCashMinor < 0 && low14.fourteenDayLowestTotalCashMinor < (cashMinor as number)) {
      risks.push({ id: 'projected-shortfall', kind: 'projected_shortfall', severity: 'high',
        title: `Cash is projected to drop to ${plainMoney(low14.fourteenDayLowestTotalCashMinor)} by ${low14.fourteenDayLowestTotalCashDate}`,
        detail: 'Based on dated bills and confirmed money in over the next 14 days. Unconfirmed money is not included.',
        amountMinor: low14.fourteenDayLowestTotalCashMinor, date: low14.fourteenDayLowestTotalCashDate, missing: [], related: {} })
    }
    for (const marker of datedMarkers.filter(m => m.reason === 'overdue_unsettled' && m.category !== 'project_collection')) {
      risks.push({ id: `overdue:${marker.sourceKey}`, kind: 'overdue_item', severity: 'medium',
        title: `${marker.label} was due ${marker.date} and is not marked paid`,
        detail: `A planned payment of ${plainMoney(marker.amountMinor)} is past its date. Cash OS cannot tell whether it was paid outside the app.`,
        amountMinor: marker.amountMinor, date: marker.date, missing: ['whether it was paid'],
        related: { sourceKey: marker.sourceKey, accountId: marker.attribution?.debtAccountId ?? undefined } })
    }
    if (view.next7Days.undatedPayrollMinor > 0) {
      risks.push({ id: 'undated-payroll', kind: 'undated_payroll', severity: 'medium',
        title: `${plainMoney(view.next7Days.undatedPayrollMinor)} of payroll is owed with no pay date`,
        detail: 'Wages earned but not yet paid are protected, but Cash OS has no pay date for them, so they are not on the calendar.',
        amountMinor: view.next7Days.undatedPayrollMinor, date: null, missing: ['payroll pay date'], related: {} })
    }
  }
  if (Array.isArray((snapshot as any).payrollDiagnostics) && (snapshot as any).payrollDiagnostics.length > 0) {
    const kinds = [...new Set((snapshot as any).payrollDiagnostics.map((d: any) => String(d.kind).replace(/_/g, ' ')))]
    risks.push({ id: 'payroll-data', kind: 'incomplete_data', severity: withheld ? 'high' : 'low',
      title: withheld ? 'Payroll inputs need review before cash totals can be shown' : 'Some payroll inputs need review',
      detail: `Cash OS flagged: ${kinds.join(', ')}. This is shown rather than hidden; resolve it on the Payroll tab.`,
      amountMinor: null, date: null, missing: kinds as string[], related: {} })
  }
  try { risks.push(...derivePromoRisks(snapshot)) } catch { /* degrade: no promo risks */ }

  // ── ACTIONS ──
  const spendableAboveFloor = hasCash && !withheld ? Math.max(0, cashMinor! - (floorMinor ?? 0)) : 0

  // Collectible money: collecting is a no-cash action. Timing/confidence are NOT invented.
  for (const item of view.moneyStates.collectible) {
    push({ id: `collect:${item.id}`, category: 'no_cash', title: `Collect ${plainMoney(item.amountMinor)} from ${item.label}`,
      why: [item.basis, 'This is money you have earned but not yet received. It is not part of your available cash until it is recorded as paid.'],
      resource: { cashMinor: 0, ownerWork: 'unknown' }, amount: { minor: item.amountMinor, meaning: 'collects' },
      timing: { date: null, basis: 'No expected payment date is recorded' }, certainty: 'recommended',
      dataCompleteness: 'partial', missing: item.unknowns, related: { projectId: item.projectId }, rules: [2, 7, 8] })
  }
  // Unlockable with unknown prerequisites: verify, never a deterministic recommendation (Rule 7, 8).
  const facted = (id?: string) => (id ? facts.projects?.[id] : undefined)
  const rankable: Array<{ item: MoneyItem; fact: ProjectDecisionFact }> = []
  for (const item of view.moneyStates.unlockable) {
    const fact = facted(item.projectId)
    const missing: string[] = []
    if (!fact || fact.readiness !== 'work_required') missing.push('what must be finished before it can be collected')
    if (!isMinor(fact?.cashRequiredMinor)) missing.push('cash needed first (materials, etc.)')
    if (!(typeof fact?.workHours === 'number' && fact.workHours >= 0)) missing.push('work time required')
    if (!isDate(fact?.expectedCollectionDate)) missing.push('expected collection date')
    if (!fact?.collectionConfidence) missing.push('how confident the collection is')
    if (missing.length === 0 && fact) { rankable.push({ item, fact }); continue }
    const requirementKnown = fact?.readiness === 'work_required' && !!fact.workRequirement
    const cashKnown = isMinor(fact?.cashRequiredMinor)
    if (requirementKnown && fact) {
      // The owner said what must happen first: say so, even though the job cannot be compared yet.
      push({ id: `verify-unlock:${item.id}`,
        category: cashKnown && fact.cashRequiredMinor! > 0 ? 'cash_required' : 'owner_work',
        title: `${item.label}: ${fact.workRequirement} to unlock ${plainMoney(item.amountMinor)}`,
        why: [item.basis,
          cashKnown ? `Spending needed first: ${plainMoney(fact.cashRequiredMinor)}${fact.cashRequiredMinor! > 0 ? ' (from required spend linked to this job)' : ' (you said none)'}.` : 'How much must be spent first is not known.',
          typeof fact.workHours === 'number' ? `About ${fact.workHours} hour${fact.workHours === 1 ? '' : 's'} of work left.` : 'How much work is left is not known.',
          'The balance stays unlockable, not cash, until that is done and you mark it ready. It can be ranked against other jobs once the missing details are filled in.'],
        resource: { cashMinor: cashKnown ? fact.cashRequiredMinor! : null, ownerWork: 'required' },
        amount: { minor: item.amountMinor, meaning: 'unlocks' },
        timing: { date: isDate(fact.expectedCollectionDate) ? fact.expectedCollectionDate! : null,
          basis: isDate(fact.expectedCollectionDate) ? 'Owner-supplied' : 'Unknown' },
        certainty: 'needs_verification', dataCompleteness: 'partial', missing,
        related: { projectId: item.projectId }, rules: [2, 6, 7] })
      continue
    }
    push({ id: `verify-unlock:${item.id}`, category: 'no_cash', title: `Confirm what it takes to collect ${plainMoney(item.amountMinor)} on ${item.label}`,
      why: [item.basis, 'Cash OS cannot compare this job with others until those facts are known, so it makes no recommendation about it.'],
      resource: { cashMinor: null, ownerWork: 'unknown' }, amount: { minor: item.amountMinor, meaning: 'unlocks' },
      timing: { date: null, basis: 'Unknown' }, certainty: 'needs_verification', dataCompleteness: 'unknown',
      missing, related: { projectId: item.projectId }, rules: [2, 7], })
  }
  // Rule 2: attainable cash unlocks. An explainable ordering, not a score and not "largest balance".
  const confRank = { high: 0, medium: 1, low: 2 } as const
  const ranked = [...rankable].sort((a, b) => {
    const aff = (x: typeof a) => (x.fact.cashRequiredMinor! <= spendableAboveFloor ? 0 : 1)
    return aff(a) - aff(b)
      || confRank[a.fact.collectionConfidence!] - confRank[b.fact.collectionConfidence!]
      || a.fact.expectedCollectionDate!.localeCompare(b.fact.expectedCollectionDate!)
      || a.fact.workHours! - b.fact.workHours!
      || a.fact.cashRequiredMinor! - b.fact.cashRequiredMinor!
      || (b.item.amountMinor ?? 0) - (a.item.amountMinor ?? 0)
      || a.item.id.localeCompare(b.item.id)
  })
  ranked.forEach(({ item, fact }, index) => {
    const cash = fact.cashRequiredMinor!
    const affordable = cash <= spendableAboveFloor
    push({ id: `unlock:${item.id}`, category: cash > 0 ? 'cash_required' : 'owner_work',
      title: `${item.label}: finish the work to unlock ${plainMoney(item.amountMinor)}`,
      why: [
        `Needs ${plainMoney(cash)} of cash and about ${fact.workHours} hour${fact.workHours === 1 ? '' : 's'} of work${fact.workRequirement ? ` (${fact.workRequirement})` : ''}.`,
        `Collection expected ${fact.expectedCollectionDate} (${fact.collectionConfidence} confidence). The amount is gross money unlocked, not profit.`,
        affordable ? 'The cash needed is available without dipping into your operating floor.' : 'The cash needed is more than you have above your operating floor.',
        `Ranked #${index + 1} of ${ranked.length} attainable unlocks by: affordable now, then confidence, then timing, then least work.`,
      ],
      resource: { cashMinor: cash, ownerWork: 'required' }, amount: { minor: item.amountMinor, meaning: 'unlocks' },
      timing: { date: fact.expectedCollectionDate!, basis: 'Owner-supplied' },
      certainty: affordable ? 'recommended' : 'needs_verification', dataCompleteness: 'complete',
      missing: affordable ? [] : ['a way to fund the cash needed'], related: { projectId: item.projectId }, rules: [2, 5, 6, 7] })
  })
  for (const item of view.moneyStates.blocked) {
    const fact = facted(item.projectId)
    push({ id: `blocked:${item.id}`, category: 'waiting', title: `Waiting: ${item.label}${fact?.blocker ? ` — ${fact.blocker}` : ''}`,
      why: [item.basis, 'No money is forecast from this job while it is blocked.'],
      resource: { cashMinor: 0, ownerWork: 'none' }, amount: { minor: item.amountMinor, meaning: 'none' },
      timing: { date: null, basis: 'Until the blocker clears' }, certainty: 'informational', dataCompleteness: 'partial',
      missing: [], related: { projectId: item.projectId }, rules: [6, 7] })
  }
  for (const item of view.moneyStates.potential) {
    push({ id: `follow-up:${item.id}`, category: 'no_cash',
      title: item.id.startsWith('opportunity:') ? `Follow up with the customer: ${item.label}` : `Confirm whether ${item.label} is awarded`,
      why: [item.basis, 'It is counted as $0 until it is awarded.'],
      resource: { cashMinor: 0, ownerWork: 'unknown' }, amount: { minor: item.amountMinor, meaning: 'unlocks' },
      timing: { date: null, basis: 'Unknown' }, certainty: item.ownerConfirmed ? 'recommended' : 'needs_verification',
      dataCompleteness: 'partial', missing: item.unknowns, related: { projectId: item.projectId }, rules: [7, 8] })
  }

  // Rule 1: protect the revenue engine, only from an explicit operational-consequence fact.
  const critical = targets.filter(t => t.critical)
  for (const target of critical) {
    push({ id: `protect-first:${target.id}`, category: 'protection', title: `Protect first: ${target.label} (${plainMoney(target.amountMinor)})`,
      why: [`Marked as needed to keep earning${target.consequence ? `: ${target.consequence}` : ''}.`,
        'Prioritized by what losing it would stop (jobs, estimates, materials, collections), not by interest rate or how late it is.'],
      resource: { cashMinor: target.amountMinor, ownerWork: 'none' }, amount: { minor: target.amountMinor, meaning: 'protects' },
      timing: { date: target.dueDate, basis: target.dueDate ? 'Scheduled' : 'No date recorded' }, certainty: 'recommended',
      dataCompleteness: target.dueDate ? 'complete' : 'partial', missing: target.dueDate ? [] : ['due date'],
      related: { sourceKey: target.sourceKey, accountId: target.accountId }, rules: [1, 5, 8] })
  }
  const vehicleHints = targets.filter(t => t.bucket === 'vehicle' && !t.critical)
  if (vehicleHints.length > 0 && !(facts.obligations || facts.debts)) {
    dataGaps.push('Cash OS does not know which payments are critical to keeping you working (for example a work vehicle), so it does not rank bills by consequence.')
  }
  for (const t of vehicleHints) {
    push({ id: `criticality-unknown:${t.id}`, category: 'watch', title: `${t.label}: is this needed to keep working?`,
      why: ['It is categorized as a vehicle payment. Cash OS does not know whether losing it would stop you from reaching jobs or collecting money, so it does not rank it above other bills.'],
      resource: { cashMinor: null, ownerWork: 'none' }, amount: { minor: t.amountMinor, meaning: 'protects' },
      timing: { date: t.dueDate, basis: t.dueDate ? 'Scheduled' : 'No date recorded' }, certainty: 'needs_verification',
      dataCompleteness: 'partial', missing: ['operational criticality'], related: { sourceKey: t.sourceKey, accountId: t.accountId }, rules: [1] })
  }

  // Rule 3: scarce cash into a credible near-term unlock to fund a critical obligation.
  if (hasCash && !withheld) {
    for (const target of critical.filter(t => t.amountMinor > cashMinor!)) {
      const credible = ranked.filter(({ fact, item }) =>
        fact.collectionConfidence === 'high'
        && target.dueDate != null && fact.expectedCollectionDate! <= target.dueDate
        && fact.cashRequiredMinor! <= spendableAboveFloor
        && cashMinor! - fact.cashRequiredMinor! + (item.amountMinor ?? 0) >= target.amountMinor)
      const best = credible[0]
      if (best) {
        push({ id: `fund-via-unlock:${target.id}:${best.item.id}`, category: 'cash_required',
          title: `Use ${plainMoney(best.fact.cashRequiredMinor)} to finish ${best.item.label}, then fund ${target.label}`,
          why: [`${target.label} (${plainMoney(target.amountMinor)}, due ${target.dueDate}) is more than your ${plainMoney(cashMinor)} in cash.`,
            `Finishing ${best.item.label} is expected to collect ${plainMoney(best.item.amountMinor)} by ${best.fact.expectedCollectionDate}, before that date, with high confidence.`,
            'Holding the cash instead would not reach the amount needed. This is a recommendation only; nothing is spent or reserved for you.'],
          resource: { cashMinor: best.fact.cashRequiredMinor!, ownerWork: 'required' }, amount: { minor: target.amountMinor, meaning: 'protects' },
          timing: { date: best.fact.expectedCollectionDate!, basis: 'Owner-supplied' }, certainty: 'recommended',
          dataCompleteness: 'complete', missing: [], related: { projectId: best.item.projectId, sourceKey: target.sourceKey }, rules: [1, 2, 3, 5, 8] })
      } else if (rankable.length === 0 && view.moneyStates.unlockable.length > 0) {
        push({ id: `fund-unverified:${target.id}`, category: 'no_cash', title: `Could a job fund ${target.label}? Cash OS can't tell yet`,
          why: [`${target.label} (${plainMoney(target.amountMinor)}) is more than your ${plainMoney(cashMinor)} in cash.`,
            'There is unlockable project money, but the cash needed, work time, expected date and confidence are not recorded, so no plan is recommended.'],
          resource: { cashMinor: null, ownerWork: 'unknown' }, amount: { minor: target.amountMinor, meaning: 'protects' },
          timing: { date: target.dueDate, basis: 'Obligation date' }, certainty: 'needs_verification', dataCompleteness: 'unknown',
          missing: ['cash needed first', 'work time', 'expected collection date', 'collection confidence'],
          related: { sourceKey: target.sourceKey }, rules: [3], })
      }
    }
  }

  // Rule 4: partial payments need a known purpose. Rule 5: stay above the floor unless the owner flags severe.
  for (const [accountId, fact] of Object.entries(facts.debts ?? {})) {
    if (!isMinor(fact.catchUpMinor) || fact.catchUpMinor <= 0 || !hasCash || withheld) continue
    const account = (Array.isArray((snapshot as any).accounts) ? (snapshot as any).accounts : []).find((a: any) => a.id === accountId)
    const label = account?.display_name ?? 'this account'
    const free = allocation.trulyFreeCashMinor as number
    if (free >= fact.catchUpMinor) {
      push({ id: `cure:${accountId}`, category: 'protection', title: `Bring ${label} current: ${plainMoney(fact.catchUpMinor)}`,
        why: ['Paying the full catch-up cures the delinquency.', `You have ${plainMoney(free)} free after protected bills and your floor.`],
        resource: { cashMinor: fact.catchUpMinor, ownerWork: 'none' }, amount: { minor: fact.catchUpMinor, meaning: 'owed' },
        timing: { date: fact.dueDate ?? null, basis: fact.dueDate ? 'Owner-supplied' : 'No date recorded' },
        certainty: 'recommended', dataCompleteness: 'partial', missing: [], related: { accountId }, rules: [4, 5] })
      continue
    }
    const minimumDue = isMinor(fact.minimumDueMinor) ? fact.minimumDueMinor : null
    const meaningful = minimumDue !== null && free >= minimumDue
      && (fact.consequence != null || isMinor(fact.feeAvoidedMinor))
    if (meaningful && minimumDue !== null) {
      push({ id: `partial:${accountId}`, category: 'protection', title: `Pay ${plainMoney(minimumDue)} on ${label}`,
        why: [`That amount meets the stated requirement${fact.consequence ? ` and addresses: ${fact.consequence}` : ''}${isMinor(fact.feeAvoidedMinor) ? `; it avoids a ${plainMoney(fact.feeAvoidedMinor)} fee` : ''}.`,
          `The full catch-up is ${plainMoney(fact.catchUpMinor)}, which you cannot cover yet.`],
        resource: { cashMinor: minimumDue, ownerWork: 'none' }, amount: { minor: minimumDue, meaning: 'owed' },
        timing: { date: fact.dueDate ?? null, basis: fact.dueDate ? 'Owner-supplied' : 'No date recorded' },
        certainty: 'recommended', dataCompleteness: 'partial', missing: [], related: { accountId }, rules: [4, 5] })
    } else {
      push({ id: `hold:${accountId}`, category: 'protection', title: `Don't send a partial payment to ${label} yet`,
        why: [`The catch-up is ${plainMoney(fact.catchUpMinor)} and you have ${plainMoney(free)} free. No recorded consequence says a smaller payment would cure it, meet a minimum, or avoid a penalty.`,
          'Keeping the cash for a more useful action may be better. Confirm with the lender what a partial payment would do.'],
        resource: { cashMinor: 0, ownerWork: 'none' }, amount: { minor: fact.catchUpMinor, meaning: 'owed' },
        timing: { date: fact.dueDate ?? null, basis: 'Owner-supplied' }, certainty: 'needs_verification',
        dataCompleteness: 'partial', missing: ["what a partial payment would accomplish"], related: { accountId }, rules: [4] })
    }
  }

  // Protection shortfall (informational, Rule 5/6): the required items, chronologically, no ranking claim.
  if (hasCash && !withheld && allocation.uncoveredProtectionDeficitMinor > 0) {
    const listed = [...targets].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || b.amountMinor - a.amountMinor).slice(0, 5)
    push({ id: 'cover-protected', category: 'protection', title: `Cash is ${plainMoney(allocation.uncoveredProtectionDeficitMinor)} short of what is protected`,
      why: [`${plainMoney(allocation.totalProtectedRequirementMinor)} is protected and ${plainMoney(cashMinor)} is available (the operating floor is included).`,
        listed.length ? `Largest-and-soonest items: ${listed.map(t => `${t.label} ${plainMoney(t.amountMinor)}${t.dueDate ? ` (${t.dueDate})` : ''}`).join('; ')}.` : 'No individual items are listed.',
        critical.length ? 'Items marked as needed to keep earning are protected first.' : 'Cash OS has no recorded fact about which of these matter most for earning, so it lists them in date order and does not rank them.'],
      resource: { cashMinor: allocation.uncoveredProtectionDeficitMinor, ownerWork: 'none' }, amount: { minor: allocation.uncoveredProtectionDeficitMinor, meaning: 'at_risk' },
      timing: { date: view.next7Days.firstShortfallDate, basis: 'Projection' }, certainty: 'informational', dataCompleteness: 'partial',
      missing: critical.length ? [] : ['which bills are critical to keeping you working'], related: {}, rules: [1, 5, 6] })
  }

  // Watch: promo deadlines and overdue items become non-spending actions.
  for (const risk of risks.filter(r => r.kind === 'promo_deadline')) {
    push({ id: `watch:${risk.id}`, category: 'watch', title: risk.title, why: [risk.detail],
      resource: { cashMinor: null, ownerWork: 'none' }, amount: { minor: risk.amountMinor, meaning: 'at_risk' },
      timing: { date: risk.date, basis: 'Stored promotional end date' }, certainty: 'informational',
      dataCompleteness: risk.missing.length ? 'partial' : 'complete', missing: [...risk.missing, 'past-due amount (not stored)'],
      related: risk.related, rules: [4, 6] })
  }
  for (const risk of risks.filter(r => r.kind === 'overdue_item')) {
    push({ id: `verify:${risk.id}`, category: 'no_cash', title: `Check whether ${risk.title.split(' was due')[0]} was paid`, why: [risk.detail],
      resource: { cashMinor: 0, ownerWork: 'none' }, amount: { minor: risk.amountMinor, meaning: 'owed' },
      timing: { date: risk.date, basis: 'Scheduled date has passed' }, certainty: 'needs_verification',
      dataCompleteness: 'partial', missing: risk.missing, related: risk.related, rules: [4, 8] })
  }

  // Debt gap, stated once and only when a debt exists whose past-due state we cannot know.
  const liabilityIds = (Array.isArray((snapshot as any).accounts) ? (snapshot as any).accounts : [])
    .filter((a: any) => a.account_class === 'liability' && a.status === 'active'
      && typeof (snapshot as any).accountBalancesMinor?.[a.id] === 'number' && (snapshot as any).accountBalancesMinor[a.id] > 0)
    .map((a: any) => a.id)
  if (liabilityIds.some((id: string) => facts.debts?.[id]?.catchUpMinor == null)) {
    dataGaps.push('Past-due and catch-up amounts are not stored for debts, so delinquency cannot be assessed. Overdue is shown only for planned payments you entered that passed their date.')
  }

  view.actions = actions
  return view
}

export const ACTION_CATEGORY_LABELS: Record<ActionCategory, string> = {
  no_cash: 'Do now — no cash needed',
  owner_work: 'Work to do',
  cash_required: 'Needs cash',
  waiting: 'Waiting / blocked',
  protection: 'Protect',
  watch: 'Keep an eye on',
}
