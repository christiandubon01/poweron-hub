/**
 * ProjectLogFinancialPanel.tsx - PROJECT-LOG-FINAL
 *
 * ONE shared financial breakdown for BOTH the New Project Log and the Edit
 * Project Log modal. Both modals render this exact component, so the two modes
 * cannot drift apart.
 *
 * Pure presentation + pure derivation. Rendering or typing in either modal
 * never persists anything; only the modal's explicit Save/Update button writes.
 *
 * ── COST AUTHORITIES (traced, not assumed) ─────────────────────────────────
 *
 * ACTUALS — identical authority to the Project Logs page
 * (V15rProjectLogsTab -> calculateProjectFinancials + buildProjectLogRollup):
 *   log set        projectLogsFor()  (same filter as getLiveProjectLogs)
 *   labor  actual  SUM hrs x resolveProjectLaborSource(log.empId/log.emp)
 *                       .internalLaborRate   (loaded labor + overhead recovery)
 *   material actual SUM log.mat
 *   mileage actual  SUM log.miles x settings.mileRate (VAN_MILE_RATE default)
 * The panel deliberately reuses those exact rules so the modal can never show a
 * second, competing accumulated total.
 *
 * ESTIMATE COST BUDGETS — denominators are estimate COST, never customer price:
 *   labor    SUM (estimate labor-row allocation hrs) x that worker's
 *            internalLaborRate. Estimate rows store `rate` as the CUSTOMER bill
 *            rate (seeded from settings.billRate, consumed by the Estimate tab
 *            as `quotedRevenue`), so `hrs x rate` is billable revenue and is
 *            NOT used here. Hours are the estimate authority; the cost rate is
 *            the same Project authority the actuals use, which makes budget and
 *            actual directly comparable.
 *   material SUM qty x unit COST x (1 + waste) over live mtoRows - the Estimate
 *            tab's `matC` (raw cost). The marked-up `selling` figure is never
 *            used.
 *   mileage  project.mileRT x project.miDays x settings.mileRate - the Estimate
 *            tab's `mi` mileage cost allowance.
 *
 * Never used as a denominator: contract value, gross quote allocation, profit,
 * margin, settings.billRate, settings.opCost (Legacy Solo Service Cost), or any
 * Service Quote value. When a bucket has no truthful estimate authority the card
 * renders "<bucket> estimate budget unavailable" and still shows the actuals.
 */

import React from 'react'
import { fmt, getProjectFinancials, num, projectLogsFor, type BackupData } from '@/services/backupDataService'
import { getLiveLaborRows, getLiveMaterialRows } from '@/services/projectScopeMerge'
import { VAN_MILE_RATE } from '@/utils/calculateProjectFinancials'
import { resolveProjectLaborSource } from '@/utils/costSourceHelper'
import { getLegacyPhaseNames, getProjectPhaseNames, normalizePhaseName } from '@/utils/v15rProjectPhases'

/**
 * Service-Log metrics deliberately NOT rendered here, and why. Exported so the
 * contract test can assert they stay absent rather than being copied over.
 */
export const SERVICE_ONLY_EXCLUSIONS = [
  'Suggested Quote',
  'Suggested Profit',
  'Total Quoted',
  'Quote Variance',
  'Actual Estimated Profit',
  'Actual Profit Margin',
  'Direct Labor',
  'Overhead Recovery',
  'Billable Labor',
  'Sales Tax',
] as const

/**
 * Locked colour semantics. Identical meaning in all three budget cards.
 *   RED    = actual cost accumulated BEFORE this draft
 *   ORANGE = this current unsaved / edited log
 *   GREEN  = remaining estimate cost budget
 */
export const BUDGET_PREVIOUS_COLOR = '#ef4444'
export const BUDGET_THIS_LOG_COLOR = '#f97316'
export const BUDGET_REMAINING_COLOR = '#22c55e'

/** Raw modal inputs. Strings come straight from the form fields. */
export interface ProjectLogFinancialInputs {
  hrs: string | number
  miles: string | number
  mat: string | number
  collected: string | number
}

export type BudgetCardKey = 'labor' | 'material' | 'mileage'

/**
 * PROJECT-LOG-UI-2B §4 — the owner-facing display basis.
 *
 * The canonical figures carry full precision, so two of them can each round
 * correctly and still make a derived third look wrong on screen: previous
 * $8,108.08 + today $436.14 shows an after of $8,544.22, but subtracting a
 * $3,598.14 budget from the UNROUNDED after yields $4,946.07 — a visible
 * one-cent contradiction against the $4,946.08 the owner can do in their head.
 *
 * Every number the owner can arithmetically derive from other numbers on the
 * card is therefore computed from the cents-rounded display basis, not from the
 * canonical value. Nothing stored, no authority and no canonical field changes;
 * only presentation is reconciled. Guaranteed on screen:
 *
 *   displayed previous + displayed today = displayed after
 *   displayed after − displayed budget  = displayed over budget
 *   displayed budget − displayed after  = displayed remaining
 */
export interface BudgetDisplayFigures {
  budget: number | null
  previousConsumed: number
  thisLogConsumed: number
  totalConsumed: number
  remaining: number | null
  overBudget: number | null
  pctOfBudget: number | null
  isOverBudget: boolean
  visualMax: number
  previousPct: number
  thisLogPct: number
  remainingPct: number
  budgetMarkerPct: number | null
}

/**
 * One PROJECT BUDGET CARD. Every card uses the same information architecture:
 * estimate cost budget, then previous / today / after-today actuals, then the
 * proportional bar and the over-or-remaining verdict.
 */
export interface BudgetProgressSnapshot {
  key: BudgetCardKey
  /** Card title - LABOR / MATERIALS / MILEAGE. */
  label: string
  /** Denominator caption, e.g. "Estimated Labor Cost Budget". */
  budgetLabel: string
  /** Honest empty state used when no estimate authority resolves. */
  unavailableLabel: string
  budgetAvailable: boolean
  /** Estimate COST budget. null when no truthful authority exists. */
  budget: number | null
  /** Actual cost accumulated before this draft. */
  previousConsumed: number
  /** This unsaved / edited log's contribution. */
  thisLogConsumed: number
  /** previousConsumed + thisLogConsumed. */
  totalConsumed: number
  remaining: number | null
  overBudget: number | null
  pctOfBudget: number | null
  isOverBudget: boolean
  /** Bar scale = max(budget, afterToday) so today stays visible over budget. */
  visualMax: number
  previousPct: number
  thisLogPct: number
  remainingPct: number
  /** Position of the BUDGET TARGET marker, null when no budget authority. */
  budgetMarkerPct: number | null
  /** Cents-reconciled values — what the card actually renders. See §4 above. */
  display: BudgetDisplayFigures
}

export interface ProjectLogFinancials {
  laborRate: number
  /** Rate string that reconciles with the labor cost at currency precision. */
  laborRateText: string
  laborRateAvailable: boolean
  loadedLaborRate: number
  overheadRecoveryRate: number
  mileRate: number
  hours: number
  miles: number
  materials: number
  collectedThisLog: number
  entryLaborCost: number | null
  entryMaterialCost: number
  entryMileageCost: number
  entryTotalInternalCost: number | null
  /** §4: the sum of the three DISPLAYED this-log costs, so the tile adds up. */
  entryTotalInternalCostDisplay: number | null
  previousLaborCost: number
  previousMaterialCost: number
  previousMileageCost: number
  afterLaborCost: number
  afterMaterialCost: number
  afterMileageCost: number
  baselineInternalCost: number | null
  cumulativeInternalCost: number | null
  contractValue: number
  projectLifetimeCollected: number
  baselineLifetimeCollected: number
  uncollectedContract: number
  estimatedMarginAtCost: number | null
  estimatedMarginPct: number | null
  costBurnPct: number | null
  laborBudget: BudgetProgressSnapshot
  materialBudget: BudgetProgressSnapshot
  mileageBudget: BudgetProgressSnapshot
}

function toNumber(value: string | number | undefined | null): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const parsed = parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function logCollected(log: any): number {
  return num(log?.paymentsCollected || log?.collected || 0)
}

function toCents(value: number): number {
  return Math.round(value * 100)
}

/** Snap to the currency precision the owner actually reads on screen. */
function round2(value: number): number {
  return toCents(value) / 100
}

/**
 * Render the hourly rate at the smallest precision that still reconciles with
 * the cost shown beneath it.
 *
 * The canonical Project labor rate (loaded labor + overhead recovery) is not
 * guaranteed to land on whole cents - overhead recovery is annualOverhead /
 * billableHrsYear. Multiplying is always done with the ONE canonical rate, so
 * the actuals stay bit-identical to the Project Logs page; only the printed
 * rate widens (2 -> up to 6 dp) on the rare rate that would otherwise appear to
 * contradict its own cost. A rounded rate is never used for the arithmetic.
 */
export function reconcilableRateText(rate: number, hours: number): string {
  if (!Number.isFinite(rate)) return '0.00'
  const target = toCents(rate * hours)
  for (let dp = 2; dp <= 6; dp += 1) {
    if (toCents(Number(rate.toFixed(dp)) * hours) === target) return rate.toFixed(dp)
  }
  return rate.toFixed(6)
}

function clampPct(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(100, value)
}

function buildBudgetProgress(
  key: BudgetCardKey,
  label: string,
  budgetLabel: string,
  unavailableLabel: string,
  budget: number | null | undefined,
  previousConsumed: number,
  thisLogConsumed: number,
): BudgetProgressSnapshot {
  const rawBudget = Number(budget)
  const budgetAvailable = Number.isFinite(rawBudget) && rawBudget > 0
  const safeBudget = budgetAvailable ? rawBudget : null
  const safePrevious = Math.max(0, Number.isFinite(previousConsumed) ? previousConsumed : 0)
  const safeThisLog = Math.max(0, Number.isFinite(thisLogConsumed) ? thisLogConsumed : 0)
  const totalConsumed = safePrevious + safeThisLog

  const isOverBudget = budgetAvailable && toCents(totalConsumed) > toCents(safeBudget as number)

  // Over budget, the track represents max(budget, afterToday) so today's
  // addition keeps a truthful proportional slice instead of being crushed to
  // zero against a budget the project has already blown past.
  const visualMax = Math.max(safeBudget ?? 0, totalConsumed)
  const scale = visualMax > 0 ? visualMax : 1

  const previousPct = clampPct((safePrevious / scale) * 100)
  const thisLogPct = clampPct((safeThisLog / scale) * 100)

  // ── §4 display basis — every derived figure comes from rounded inputs ────
  const dBudget = budgetAvailable ? round2(safeBudget as number) : null
  const dPrevious = round2(safePrevious)
  const dThisLog = round2(safeThisLog)
  const dTotal = round2(dPrevious + dThisLog)
  const dIsOver = dBudget !== null && toCents(dTotal) > toCents(dBudget)
  const dVisualMax = Math.max(dBudget ?? 0, dTotal)
  const dScale = dVisualMax > 0 ? dVisualMax : 1
  const dPreviousPct = clampPct((dPrevious / dScale) * 100)
  const dThisLogPct = clampPct((dThisLog / dScale) * 100)

  const display: BudgetDisplayFigures = {
    budget: dBudget,
    previousConsumed: dPrevious,
    thisLogConsumed: dThisLog,
    totalConsumed: dTotal,
    remaining: dBudget === null ? null : round2(Math.max(0, dBudget - dTotal)),
    overBudget: dBudget === null ? null : round2(Math.max(0, dTotal - dBudget)),
    pctOfBudget: dBudget === null || dBudget === 0 ? null : (dTotal / dBudget) * 100,
    isOverBudget: dIsOver,
    visualMax: dVisualMax,
    previousPct: dPreviousPct,
    thisLogPct: dThisLogPct,
    remainingPct: dBudget !== null && !dIsOver ? Math.max(0, 100 - dPreviousPct - dThisLogPct) : 0,
    budgetMarkerPct: dBudget === null ? null : clampPct((dBudget / dScale) * 100),
  }

  return {
    key,
    label,
    budgetLabel,
    unavailableLabel,
    budgetAvailable,
    budget: safeBudget,
    previousConsumed: safePrevious,
    thisLogConsumed: safeThisLog,
    totalConsumed,
    remaining: budgetAvailable ? Math.max(0, (safeBudget as number) - totalConsumed) : null,
    overBudget: budgetAvailable ? Math.max(0, totalConsumed - (safeBudget as number)) : null,
    pctOfBudget: budgetAvailable ? (totalConsumed / (safeBudget as number)) * 100 : null,
    isOverBudget,
    visualMax,
    previousPct,
    thisLogPct,
    // No green once the budget has been exceeded, and none at all without a
    // budget authority - there is nothing truthful to call "remaining".
    remainingPct:
      budgetAvailable && !isOverBudget ? Math.max(0, 100 - previousPct - thisLogPct) : 0,
    budgetMarkerPct: budgetAvailable ? clampPct(((safeBudget as number) / scale) * 100) : null,
    display,
  }
}

/** Employee ids an estimate labor row is assigned to. Mirrors the Estimate tab. */
function estimateRowEmployeeIds(row: any, employees: any[]): string[] {
  const isValidId = (id: string) =>
    id === 'me' || employees.some((emp: any) => String(emp?.id ?? '') === id)

  const assigned = Array.isArray(row?.employees) ? (row.employees as any[]).map(String) : []
  if (assigned.length > 0) {
    const valid = assigned.filter(isValidId)
    if (valid.length > 0) return valid
  }
  const empId = String(row?.empId ?? '') || 'me'
  return [isValidId(empId) ? empId : 'me']
}

/** Per-worker hour split for one estimate labor row. Mirrors the Estimate tab. */
function estimateRowAllocations(row: any, employees: any[]): Array<{ empId: string; hrs: number }> {
  const ids = estimateRowEmployeeIds(row, employees)
  const totalHrs = num(row?.hrs)
  const stored = Array.isArray(row?.employeeAllocations)
    ? (row.employeeAllocations as Array<{ empId?: string; hrs?: number }>)
    : null
  if (stored && stored.length > 0) {
    return ids.map((id) => {
      const match = stored.find((a) => String(a?.empId ?? '') === id)
      return { empId: id, hrs: match ? num(match.hrs) : totalHrs / ids.length }
    })
  }
  const equalShare = ids.length > 0 ? totalHrs / ids.length : 0
  return ids.map((id) => ({ empId: id, hrs: equalShare }))
}

/**
 * Estimated labor COST budget.
 *
 * Estimate hours (project.laborRows, the estimate authority) costed at the same
 * internal labor rate the Project Log actuals use, per assigned worker. The
 * row's `rate` field is the customer bill rate and is never read here.
 */
function getEstimateLaborCostBudget(
  project: any,
  settings: any,
  employees: any[],
): number | null {
  if (!project) return null
  const laborRows = getLiveLaborRows(project.laborRows || [], project.id)
  if (laborRows.length === 0) return null
  let total = 0
  for (const row of laborRows) {
    for (const alloc of estimateRowAllocations(row, employees)) {
      const isOwnerSlot = !alloc.empId || alloc.empId === 'me'
      const source = resolveProjectLaborSource(
        settings,
        employees,
        isOwnerSlot ? null : alloc.empId,
        isOwnerSlot ? 'Owner / Me' : null,
      )
      total += alloc.hrs * source.internalLaborRate
    }
  }
  return total
}

/**
 * Estimated material COST budget - the Estimate tab's `matC`: quantity x unit
 * COST x (1 + waste). Never the marked-up `selling` price.
 */
function getEstimateMaterialCostBudget(project: any, backup: BackupData | null | undefined): number | null {
  if (!project || !backup) return null
  const phases = getProjectPhaseNames(backup)
  const liveRows = getLiveMaterialRows(project.mtoRows || [], project.id, 'mtoRows')
  if (liveRows.length === 0) return null
  const legacyPhases = getLegacyPhaseNames(liveRows.map((row: any) => row.phase), phases)
  const allPhases = [...phases, ...legacyPhases]
  return liveRows
    .map((row: any) => ({ ...row, phase: normalizePhaseName(row.phase, phases) }))
    .filter((row: any) => allPhases.includes(row.phase))
    .reduce((sum: number, row: any) => {
      const pbItem = ((backup as any)?.priceBook || []).find((item: any) => item.id === row.matId)
      const costUnit = row.unitCost !== undefined && row.unitCost !== null
        ? num(row.unitCost)
        : num(pbItem?.cost || row.costUnit || 0)
      const waste = num(pbItem?.waste || 0)
      return sum + (num(row.qty || 0) * costUnit * (1 + waste))
    }, 0)
}

/**
 * Estimated mileage COST allowance - the Estimate tab's `mi`:
 * round-trip miles x estimated days x the mileage cost rate.
 */
function getEstimateMileageCostBudget(project: any, mileRate: number): number | null {
  if (!project) return null
  if (project.mileRT == null && project.miDays == null) return null
  return num(project.mileRT || 0) * num(project.miDays || 0) * mileRate
}

export function buildProjectLogFinancials(
  backup: BackupData | null | undefined,
  projectId: string,
  editLogId: string | null | undefined,
  inputs: ProjectLogFinancialInputs,
  employeeId?: string | null,
  employeeName?: string | null,
): ProjectLogFinancials {
  const settings: any = (backup as any)?.settings || {}
  const employees = Array.isArray((backup as any)?.employees) ? (backup as any).employees : []
  const selectedLaborSource = resolveProjectLaborSource(settings, employees, employeeId, employeeName)
  const laborRate = selectedLaborSource.internalLaborRate
  const laborRateAvailable = laborRate > 0
  // Same mileage authority (and same default) as the Project Logs page, so the
  // page total and this modal's "previous" can never disagree.
  const mileRate = num(settings.mileRate) || VAN_MILE_RATE

  const hours = toNumber(inputs.hrs)
  const miles = toNumber(inputs.miles)
  const materials = toNumber(inputs.mat)
  const collectedThisLog = toNumber(inputs.collected)

  const project = ((backup as any)?.projects || []).find((p: any) => String(p?.id) === String(projectId)) || null
  const contractValue = project ? num(project.contract) : 0

  const liveLogs = backup && projectId ? projectLogsFor(backup as BackupData, projectId) : []
  // EDIT: the stored version of the row being edited is excluded from every
  // "previous" figure, so the live draft replaces it instead of stacking on it.
  const baselineLogs = editLogId ? liveLogs.filter((l: any) => String(l?.id) !== String(editLogId)) : liveLogs

  let baselineMiles = 0
  let previousMaterialCost = 0
  let previousLaborCost = 0
  for (const log of baselineLogs) {
    const logLaborSource = resolveProjectLaborSource(settings, employees, (log as any).empId, (log as any).emp)
    previousLaborCost += num((log as any).hrs) * logLaborSource.internalLaborRate
    baselineMiles += num((log as any).miles)
    previousMaterialCost += num((log as any).mat)
  }
  const previousMileageCost = baselineMiles * mileRate

  const entryLaborCost = laborRateAvailable ? hours * laborRate : null
  const entryMaterialCost = materials
  const entryMileageCost = miles * mileRate
  const entryTotalInternalCost =
    entryLaborCost === null ? null : entryLaborCost + entryMaterialCost + entryMileageCost
  const entryTotalInternalCostDisplay =
    entryLaborCost === null
      ? null
      : round2(round2(entryLaborCost) + round2(entryMaterialCost) + round2(entryMileageCost))

  const afterLaborCost = previousLaborCost + (entryLaborCost ?? 0)
  const afterMaterialCost = previousMaterialCost + entryMaterialCost
  const afterMileageCost = previousMileageCost + entryMileageCost

  const baselineInternalCost = laborRateAvailable
    ? previousLaborCost + previousMaterialCost + previousMileageCost
    : null
  const cumulativeInternalCost =
    baselineInternalCost === null || entryTotalInternalCost === null
      ? null
      : baselineInternalCost + entryTotalInternalCost

  const canonicalPaid = project ? getProjectFinancials(project, backup as BackupData).paid : 0
  const editedLogCollected = editLogId
    ? liveLogs
        .filter((l: any) => String(l?.id) === String(editLogId))
        .reduce((sum: number, l: any) => sum + logCollected(l), 0)
    : 0
  const baselineLifetimeCollected = Math.max(0, canonicalPaid - editedLogCollected)
  const projectLifetimeCollected = baselineLifetimeCollected + collectedThisLog

  const uncollectedContract = Math.max(0, contractValue - projectLifetimeCollected)
  const estimatedMarginAtCost =
    cumulativeInternalCost === null ? null : contractValue - cumulativeInternalCost
  const estimatedMarginPct =
    estimatedMarginAtCost === null || contractValue <= 0
      ? null
      : (estimatedMarginAtCost / contractValue) * 100
  const costBurnPct =
    cumulativeInternalCost === null || contractValue <= 0
      ? null
      : (cumulativeInternalCost / contractValue) * 100

  const laborBudget = buildBudgetProgress(
    'labor',
    'Labor',
    'Estimated Labor Cost Budget',
    'Labor estimate budget unavailable',
    getEstimateLaborCostBudget(project, settings, employees),
    previousLaborCost,
    entryLaborCost ?? 0,
  )
  const materialBudget = buildBudgetProgress(
    'material',
    'Materials',
    'Estimated Material Cost Budget',
    'Material estimate budget unavailable',
    getEstimateMaterialCostBudget(project, backup),
    previousMaterialCost,
    entryMaterialCost,
  )
  const mileageBudget = buildBudgetProgress(
    'mileage',
    'Mileage',
    'Estimated Mileage Cost Allowance',
    'Mileage estimate budget unavailable',
    getEstimateMileageCostBudget(project, mileRate),
    previousMileageCost,
    entryMileageCost,
  )

  return {
    laborRate,
    laborRateText: reconcilableRateText(laborRate, hours),
    laborRateAvailable,
    loadedLaborRate: selectedLaborSource.loadedLaborRate,
    overheadRecoveryRate: selectedLaborSource.overheadRecoveryRate,
    mileRate,
    hours,
    miles,
    materials,
    collectedThisLog,
    entryLaborCost,
    entryMaterialCost,
    entryMileageCost,
    entryTotalInternalCost,
    entryTotalInternalCostDisplay,
    previousLaborCost,
    previousMaterialCost,
    previousMileageCost,
    afterLaborCost,
    afterMaterialCost,
    afterMileageCost,
    baselineInternalCost,
    cumulativeInternalCost,
    contractValue,
    projectLifetimeCollected,
    baselineLifetimeCollected,
    uncollectedContract,
    estimatedMarginAtCost,
    estimatedMarginPct,
    costBurnPct,
    laborBudget,
    materialBudget,
    mileageBudget,
  }
}

const UNAVAILABLE = 'Rate not set'

function Metric({
  label,
  hint,
  value,
  color,
  testId,
  emphasis = false,
}: {
  label: string
  hint?: string
  value: string
  color: string
  testId?: string
  emphasis?: boolean
}) {
  return (
    <div className="px-3 py-2.5">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-400">
        {label}
        {hint && <span className="opacity-60"> {hint}</span>}
      </div>
      <div
        className={`font-mono font-bold ${emphasis ? 'text-base' : 'text-sm'}`}
        style={{ color }}
        data-testid={testId}
      >
        {value}
      </div>
    </div>
  )
}

function GroupHeading({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-gray-700/50 bg-slate-950/25 px-4 py-1.5">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100/60">{title}</div>
      {note && <div className="text-[10px] text-gray-500">{note}</div>}
    </div>
  )
}

/** One column of the previous / today / after-today number row. */
function BudgetFigure({
  label,
  value,
  color,
  testId,
}: {
  label: string
  value: string
  color: string
  testId: string
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div
        className="mt-0.5 truncate font-mono text-base font-bold leading-tight"
        style={{ color }}
        data-testid={testId}
      >
        {value}
      </div>
    </div>
  )
}

function BudgetCard({ budget }: { budget: BudgetProgressSnapshot }) {
  const id = `project-budget-${budget.key}`
  // §4: render the cents-reconciled basis, never the canonical figures, so the
  // owner can subtract any two numbers on the card and land on the third.
  const d = budget.display
  const segments = [
    { key: 'previous', title: 'Previous actual', value: d.previousConsumed, pct: d.previousPct, color: BUDGET_PREVIOUS_COLOR },
    { key: 'this-log', title: 'This log', value: d.thisLogConsumed, pct: d.thisLogPct, color: BUDGET_THIS_LOG_COLOR },
    { key: 'remaining', title: 'Remaining budget', value: d.remaining ?? 0, pct: d.remainingPct, color: BUDGET_REMAINING_COLOR },
  ]

  return (
    <div
      className="rounded-xl border px-4 py-3.5"
      style={{
        borderColor: d.isOverBudget ? 'rgba(239,68,68,0.35)' : 'rgba(148,163,184,0.22)',
        backgroundColor: 'rgba(2,6,23,0.35)',
      }}
      data-testid={id}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-100">{budget.label}</div>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-wider text-gray-400">{budget.budgetLabel}</span>
          {budget.budgetAvailable ? (
            <span className="font-mono text-sm font-bold text-slate-100" data-testid={`${id}-budget`}>
              {fmt(d.budget as number)}
            </span>
          ) : (
            <span className="text-[11px] font-semibold text-amber-300" data-testid={`${id}-unavailable`}>
              {budget.unavailableLabel}
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-x-3">
        <BudgetFigure
          label="Previous Actual"
          value={fmt(d.previousConsumed)}
          color={BUDGET_PREVIOUS_COLOR}
          testId={`${id}-previous`}
        />
        <BudgetFigure
          label="Today · This Log"
          value={`+${fmt(d.thisLogConsumed)}`}
          color={BUDGET_THIS_LOG_COLOR}
          testId={`${id}-this-log`}
        />
        <BudgetFigure
          label="After This Log"
          value={fmt(d.totalConsumed)}
          color="#e2e8f0"
          testId={`${id}-after`}
        />
      </div>

      <div className="relative mt-3">
        <div className="h-3.5 overflow-hidden rounded-full border border-gray-700/50 bg-slate-900/80">
          <div className="flex h-full w-full">
            {segments.map((segment) =>
              segment.pct <= 0 ? null : (
                <div
                  key={segment.key}
                  title={`${segment.title}: ${fmt(segment.value)}`}
                  data-testid={`${id}-bar-${segment.key}`}
                  style={{ width: `${segment.pct}%`, backgroundColor: segment.color }}
                />
              ),
            )}
          </div>
        </div>
        {d.isOverBudget && d.budgetMarkerPct !== null && (
          <div
            className="pointer-events-none absolute -top-1 bottom-[-4px] w-[2px] bg-slate-100"
            style={{ left: `${d.budgetMarkerPct}%` }}
            title={`Budget target: ${fmt(d.budget as number)}`}
            data-testid={`${id}-budget-marker`}
          />
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {!budget.budgetAvailable ? (
          <div className="text-[11px] text-amber-200/85" data-testid={`${id}-no-denominator`}>
            Actual cost only — no estimate denominator to measure against.
          </div>
        ) : d.isOverBudget ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-red-400">Over Budget</span>
              <span className="font-mono text-sm font-bold text-red-400" data-testid={`${id}-over`}>
                {fmt(d.overBudget as number)}
              </span>
            </div>
            <div className="text-[11px] text-gray-400" data-testid={`${id}-pct`}>
              {(d.pctOfBudget as number).toFixed(1)}% of {budget.budgetLabel.toLowerCase()}
              <span className="ml-2 text-gray-500">· budget target marked on bar</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">Remaining</span>
              <span className="font-mono text-sm font-bold text-emerald-400" data-testid={`${id}-remaining`}>
                {fmt(d.remaining as number)}
              </span>
            </div>
            <div className="text-[11px] text-gray-400" data-testid={`${id}-pct`}>
              {(d.pctOfBudget as number).toFixed(1)}% of {budget.budgetLabel.toLowerCase()}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}

export default function ProjectLogFinancialPanel({
  backup,
  projectId,
  editLogId,
  inputs,
  employeeName,
  employeeId,
  projectName,
}: {
  backup: BackupData | null | undefined
  projectId?: string | null
  editLogId?: string | null
  inputs: ProjectLogFinancialInputs
  employeeName?: string
  employeeId?: string
  projectName?: string
}) {
  if (!projectId) {
    return (
      <div className="space-y-3" data-testid="project-log-financial-panel-empty">
        <div
          className="overflow-hidden rounded-xl border border-gray-700/50"
          style={{ backgroundColor: 'var(--bg-secondary)' }}
        >
          <div className="flex items-center justify-between gap-3 border-b border-gray-700/50 px-4 py-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
              Project Financial Breakdown
            </div>
            <div className="text-[10px] text-cyan-300/80">
              select a project to activate live project financials
            </div>
          </div>
          <div className="px-4 py-5">
            <div
              className="rounded-xl border border-dashed border-cyan-400/20 bg-slate-950/35 px-4 py-5 text-center"
              data-testid="project-log-financial-empty-state"
            >
              <div className="text-sm font-semibold text-slate-200">
                Select a project to view the financial breakdown.
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                Internal cost, collected cash, contract value, and margin preview appear here as
                soon as a project is chosen.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const f = buildProjectLogFinancials(backup, projectId, editLogId, inputs, employeeId, employeeName)
  const laborMissing = !f.laborRateAvailable
  const laborText = f.entryLaborCost === null ? UNAVAILABLE : fmt(f.entryLaborCost)
  const entryTotalText =
    f.entryTotalInternalCostDisplay === null ? UNAVAILABLE : fmt(f.entryTotalInternalCostDisplay)
  const cumulativeText = f.cumulativeInternalCost === null ? UNAVAILABLE : fmt(f.cumulativeInternalCost)
  const marginText = f.estimatedMarginAtCost === null ? UNAVAILABLE : fmt(f.estimatedMarginAtCost)
  const marginPctText = f.estimatedMarginPct === null ? '' : ` (${f.estimatedMarginPct.toFixed(1)}%)`
  const marginColor =
    f.estimatedMarginAtCost === null ? '#f59e0b' : f.estimatedMarginAtCost >= 0 ? '#34d399' : '#ef4444'

  return (
    <div className="space-y-3" data-testid="project-log-financial-panel">
      {/* ── PROJECT BUDGET CARDS — the primary cost-control visualisation ─── */}
      <div
        className="overflow-hidden rounded-xl border border-gray-700/50"
        style={{ backgroundColor: 'var(--bg-secondary)' }}
        data-testid="project-log-budget-progress"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-gray-700/50 px-4 py-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-300">
            Project Budget vs Actual Cost
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[10px] text-gray-400">
            <LegendDot color={BUDGET_PREVIOUS_COLOR} label="Previous actual" />
            <LegendDot color={BUDGET_THIS_LOG_COLOR} label="This log" />
            <LegendDot color={BUDGET_REMAINING_COLOR} label="Remaining budget" />
          </div>
        </div>

        <div className="space-y-3 px-4 py-3">
          <BudgetCard budget={f.laborBudget} />
          <BudgetCard budget={f.materialBudget} />
          <BudgetCard budget={f.mileageBudget} />
        </div>
      </div>

      {/* ── SUPPORTING FINANCIAL TILES ────────────────────────────────────── */}
      <div
        className="overflow-hidden rounded-xl border border-gray-700/50"
        style={{ backgroundColor: 'var(--bg-secondary)' }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-700/50 px-4 py-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
            Project Financial Breakdown
          </div>
          <div className="truncate text-[10px] text-cyan-300/80">
            {projectName ? `${projectName} · ` : ''}
            {laborMissing ? 'internal rate not set' : 'at current settings rates'}
          </div>
        </div>

        <GroupHeading title="This Log" note="current unsaved entry" />
        <div className="grid grid-cols-2 divide-x divide-y divide-gray-700/50 md:grid-cols-4">
          <Metric
            label="Internal Labor Cost"
            hint={laborMissing ? undefined : `@$${f.laborRateText}/hr`}
            value={laborText}
            color={laborMissing ? '#f59e0b' : '#f87171'}
            testId="project-log-labor-cost"
          />
          <Metric
            label="Material Cost"
            value={fmt(f.entryMaterialCost)}
            color="#fb923c"
            testId="project-log-material-cost"
          />
          <Metric
            label="Mileage Cost"
            hint={`@$${f.mileRate.toFixed(2)}/mi`}
            value={fmt(f.entryMileageCost)}
            color="#60a5fa"
            testId="project-log-mileage-cost"
          />
          <Metric
            label="Total Internal Cost"
            hint="this log"
            value={entryTotalText}
            color={laborMissing ? '#f59e0b' : '#e5e7eb'}
            testId="project-log-entry-total-cost"
            emphasis
          />
        </div>

        <GroupHeading title="Project Cash / Totals" note="lifetime, not this log" />
        <div className="grid grid-cols-2 divide-x divide-y divide-gray-700/50 md:grid-cols-3 lg:grid-cols-5">
          <Metric
            label="Collected This Log"
            value={fmt(f.collectedThisLog)}
            color="#34d399"
            testId="project-log-collected-this-log"
          />
          <Metric
            label="Project Lifetime Collected"
            value={fmt(f.projectLifetimeCollected)}
            color="#34d399"
            testId="project-log-lifetime-collected"
          />
          <Metric
            label="Project Contract Value"
            value={fmt(f.contractValue)}
            color="#e5e7eb"
            testId="project-log-contract-value"
          />
          <Metric
            label="Uncollected Contract"
            hint="cash"
            value={fmt(f.uncollectedContract)}
            color="#facc15"
            testId="project-log-uncollected-contract"
          />
          <Metric
            label="Cumulative Project Cost"
            hint="incl. this log"
            value={cumulativeText}
            color={laborMissing ? '#f59e0b' : '#f87171'}
            testId="project-log-cumulative-cost"
          />
        </div>

        <GroupHeading title="Secondary" note="derived, not a budget" />
        <div className="px-4 py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="text-[10px] uppercase tracking-wider text-gray-500">
              Est. Margin at Today's Cost
            </div>
            <div
              className="font-mono text-xs font-semibold"
              style={{ color: marginColor }}
              data-testid="project-log-estimated-margin"
            >
              {marginText}
              {marginPctText}
            </div>
          </div>
        </div>
      </div>

      <div
        className="rounded-xl border border-gray-700/50 px-4 py-2.5"
        style={{ backgroundColor: 'var(--bg-secondary)' }}
        data-testid="project-log-labor-basis"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="text-gray-300">
            {employeeName || 'Me'}
            <span className="ml-1 text-gray-500">· {f.hours.toFixed(1)} hrs</span>
          </div>
          <div className="font-mono text-gray-400">
            {laborMissing ? 'internal cost rate not set' : `current internal labor $${f.laborRateText}/hr`}
          </div>
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
          {laborMissing
            ? 'Project Logs require current Team loaded labor and current Overhead Manager recovery. Historical logs do not contain frozen per-log labor snapshots, so the app will not invent a fallback rate.'
            : `Current internal labor $${f.laborRateText}/hr = ${fmt(f.loadedLaborRate)}/hr loaded labor + ${fmt(f.overheadRecoveryRate)}/hr overhead recovery. Historical Project Logs do not contain frozen per-log rate snapshots, so every figure above is reconstructed on today's Team + Overhead basis.`}
        </p>
      </div>

      {laborMissing && (
        <div
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300"
          data-testid="project-log-rate-missing"
        >
          Current Team loaded labor and/or Overhead Manager recovery is unavailable -
          labor cost, total internal cost and estimated margin are unavailable. The app will
          not substitute legacy service cost, bill rate, or any invented fallback.
        </div>
      )}

      {f.estimatedMarginAtCost !== null && f.contractValue > 0 && f.estimatedMarginAtCost < 0 && (
        <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-xs text-red-400">
          <strong>Over contract</strong> - cumulative internal cost exceeds the contract value
          by {fmt(Math.abs(f.estimatedMarginAtCost))}.
        </div>
      )}
    </div>
  )
}
