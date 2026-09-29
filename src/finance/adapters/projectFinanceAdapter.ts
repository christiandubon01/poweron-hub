import {
  isCashHistoryProject,
  num,
  projectLogsFor,
  type BackupData,
  type BackupLog,
} from '@/services/backupDataService'
import { isSyntheticPaidBackfillLog } from '@/services/collectedRevenueRange'
import { isDeadProjectLog } from '@/services/projectScopeMerge'
import {
  dollarsToMinor,
  usd,
  type ActualCashEvent,
  type ActualCostEvent,
  type FinanceAdapterScope,
  type PlannedCostEvent,
} from '../domain'
import { parseCalendarDate } from '../recurrence'
import type { ClockProject, ProjectCollectionEvidence } from '../projectCollectionClockTypes'

function collectedAmount(log: BackupLog & Record<string, unknown>): number {
  return num((log as any).paymentsCollected ?? (log as any).collected)
}

function dateOf(log: BackupLog & Record<string, unknown>): string | null {
  const raw = String((log as any).date || (log as any).createdAt || '').trim()
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null
}

export function readProjectCollectionEvents(
  scope: FinanceAdapterScope,
  backup: BackupData,
): ActualCashEvent[] {
  const events: ActualCashEvent[] = []
  for (const project of backup.projects || []) {
    if (!isCashHistoryProject(project)) continue
    for (const log of projectLogsFor(backup, project.id)) {
      const amount = collectedAmount(log as any)
      if (amount <= 0) continue
      const date = dateOf(log as any)
      if (!date) continue
      events.push({
        id: `project-collection:${project.id}:${log.id}`,
        organizationId: scope.organizationId,
        date,
        direction: 'inflow',
        amount: usd(dollarsToMinor(amount)),
        meaning: 'actual_cash_inflow',
        attribution: { projectId: project.id, category: 'project_collection' },
        provenance: {
          source: {
            organizationId: scope.organizationId,
            kind: 'project_collection',
            recordId: String(log.id),
            effectiveDate: date,
          },
          freshness: 'current',
          confidence: 'confirmed',
          reconciliationState: 'unreconciled',
        },
      })
    }
  }
  return events
}

export function readProjectActualCostEvents(
  scope: FinanceAdapterScope,
  backup: BackupData,
): ActualCostEvent[] {
  const events: ActualCostEvent[] = []
  for (const project of backup.projects || []) {
    for (const log of projectLogsFor(backup, project.id)) {
      const amount = num((log as any).mat)
      if (amount <= 0) continue
      const date = dateOf(log as any)
      events.push({
        id: `project-cost:${project.id}:${log.id}`,
        organizationId: scope.organizationId,
        date,
        amount: usd(dollarsToMinor(amount)),
        meaning: 'actual_cost',
        attribution: { projectId: project.id, category: 'materials' },
        provenance: {
          source: {
            organizationId: scope.organizationId,
            kind: 'project_actual_cost',
            recordId: String(log.id),
            effectiveDate: date,
          },
          freshness: 'current',
          confidence: 'confirmed',
          reconciliationState: 'unreconciled',
          note: 'Project-log cost truth; not proof of bank settlement.',
        },
      })
    }
  }
  return events
}

export interface PlannedProjectCostLike {
  id: string
  projectId: string
  amount: number
  date?: string | null
  category?: string | null
}

export function readProjectPlannedCostEvents(
  scope: FinanceAdapterScope,
  rows: readonly PlannedProjectCostLike[],
): PlannedCostEvent[] {
  return rows
    .filter((row) => Number.isFinite(row.amount) && row.amount > 0)
    .map((row) => ({
      id: `project-planned-cost:${row.id}`,
      organizationId: scope.organizationId,
      date: row.date ?? null,
      amount: usd(dollarsToMinor(row.amount)),
      meaning: 'planned_cost' as const,
      attribution: { projectId: row.projectId, category: row.category ?? 'planned_cost' },
      provenance: {
        source: {
          organizationId: scope.organizationId,
          kind: 'project_planned_cost' as const,
          recordId: row.id,
          effectiveDate: row.date ?? null,
        },
        freshness: 'current' as const,
        confidence: 'expected' as const,
        reconciliationState: 'unreconciled' as const,
      },
    }))
}

function cashMinor(value: unknown): number {
  const dollars = Number(value ?? 0)
  if (!Number.isFinite(dollars)) throw new Error(`Invalid project cash amount: ${value}`)
  return usd(Math.round(dollars * 100)).minor
}

function compatibilityMinor(value: unknown): number | null {
  if (value == null) return null
  try { return cashMinor(value) } catch { return null }
}

/** CASH-6 collection evidence; unlike dated cash events, includes unknown-date lifetime cash. */
export function readProjectCollectionEvidence(
  scope: FinanceAdapterScope,
  backup: BackupData,
): ProjectCollectionEvidence[] {
  return (backup.projects || []).filter(isCashHistoryProject).map((project) => {
    const adjustmentMinor = cashMinor(project.finance?.manualPaidAdjustment)
    const evidence: ProjectCollectionEvidence = {
      organizationId: scope.organizationId,
      projectId: project.id,
      lifetimeCollectedMinor: adjustmentMinor,
      unknownDateCollectedMinor: adjustmentMinor,
      manualAdjustmentMinor: adjustmentMinor,
      syntheticBackfillMinor: 0,
      unresolvedLogMinor: 0,
      headerPaidMinor: compatibilityMinor(project.paid),
      headerLastCollectedAmountMinor: compatibilityMinor(project.lastCollectedAmount),
      datedCollections: [],
      diagnostics: [],
    }
    for (const log of projectLogsFor(backup, project.id)) {
      if (isDeadProjectLog(log)) continue
      // Match the existing lifetime readers, including their zero-valued compatibility fallback.
      const amountMinor = cashMinor((log as any).paymentsCollected || log.collected || 0)
      evidence.lifetimeCollectedMinor += amountMinor
      if (!Number.isSafeInteger(evidence.lifetimeCollectedMinor)) throw new Error('Project lifetime cash exceeds safe integer cents')
      if (amountMinor === 0) continue
      if (isSyntheticPaidBackfillLog(log)) {
        evidence.syntheticBackfillMinor += amountMinor
        evidence.unknownDateCollectedMinor += amountMinor
        evidence.diagnostics.push(`synthetic_paid_backfill:${log.id}`)
        continue
      }
      try {
        parseCalendarDate(log.date)
      } catch {
        evidence.unresolvedLogMinor += amountMinor
        evidence.unknownDateCollectedMinor += amountMinor
        evidence.diagnostics.push(`invalid_collection_date:${log.id}`)
        continue
      }
      const logId = String(log.id || log.logId || '').trim()
      if (!logId) {
        evidence.unresolvedLogMinor += amountMinor
        evidence.unknownDateCollectedMinor += amountMinor
        evidence.diagnostics.push('missing_collection_source_id')
        continue
      }
      evidence.datedCollections.push({
        sourceKey: `${scope.organizationId}:project_collection:${logId}`,
        date: log.date,
        amountMinor,
      })
    }
    if (!Number.isSafeInteger(evidence.unknownDateCollectedMinor)) throw new Error('Project unknown-date cash exceeds safe integer cents')
    return evidence
  })
}

/** Preserve only stored project fields; timeline defaults are not payment authority. */
export function readClockProjects(scope: FinanceAdapterScope, backup: BackupData): ClockProject[] {
  return (backup.projects || []).map((project) => ({
    organizationId: scope.organizationId,
    projectId: project.id,
    projectName: project.name,
    status: project.status,
    outcome: project.outcome ?? null,
    archived: project.archived === true || Boolean(project.archivedAt) || (project as any).isArchived === true,
    deletedAt: project.deletedAt ?? null,
    contractMinor: cashMinor(project.contract),
    depositPct: project.deposit_pct,
    plannedStart: project.plannedStart ?? null,
    startDate: (project as any).startDate ?? null,
    phaseTimeline: (project.phase_timeline || []).map((phase: any) => ({
      phaseName: String(phase.phase_name || ''),
      paymentTriggerPct: phase.payment_trigger_pct,
      confirmedStartDate: phase.confirmed_start_date ?? null,
      actualStartDate: phase.actual_start_date ?? null,
      actualEndDate: phase.actual_end_date ?? null,
    })),
  }))
}
