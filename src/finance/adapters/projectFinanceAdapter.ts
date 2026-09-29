import {
  isCashHistoryProject,
  num,
  projectLogsFor,
  type BackupData,
  type BackupLog,
} from '@/services/backupDataService'
import {
  dollarsToMinor,
  usd,
  type ActualCashEvent,
  type ActualCostEvent,
  type FinanceAdapterScope,
  type PlannedCostEvent,
} from '../domain'

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
