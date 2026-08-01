/**
 * Assigned-hours helpers for employee Work Order assignments.
 *
 * Canonical storage remains payload.labor.totalHours on
 * assignment_work_order_versions (projected as assigned_hours).
 * Actual hours remain employee_task_assignments.hours_spent.
 */

export type AssignedHoursParseResult =
  | { ok: true; value: number | null }
  | { ok: false; error: string }

export type HoursVariancePresentation = {
  assignedLabel: string
  actualLabel: string
  varianceLabel: string
  varianceTone: 'under' | 'over' | 'on_target' | 'pending'
}

/** Parse an optional Assigned Hours form value. Empty means use the payload default. */
export function parseAssignedHoursInput(raw: string | null | undefined): AssignedHoursParseResult {
  const trimmed = String(raw ?? '').trim()
  if (trimmed === '') return { ok: true, value: null }

  // Reject scientific notation, signs, whitespace mid-value, and non-numeric junk.
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return { ok: false, error: 'Assigned Hours must be a non-negative number.' }
  }

  const value = Number(trimmed)
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, error: 'Assigned Hours must be a non-negative number.' }
  }

  return { ok: true, value }
}

/** Apply an owner override onto a Work Order labor block without altering actual hours. */
export function applyAssignedHoursOverride<T extends { labor: { totalHours: number } }>(
  draft: T,
  assignedHours: number,
): T {
  if (!Number.isFinite(assignedHours) || assignedHours < 0) {
    throw new Error('Assigned Hours must be a non-negative number.')
  }
  return {
    ...draft,
    labor: {
      ...draft.labor,
      totalHours: assignedHours,
    },
  }
}

export function formatWorkOrderHours(value: number | null | undefined): string {
  const next = Number(value)
  if (!Number.isFinite(next)) return '0h'
  return `${Number.isInteger(next) ? next : Math.round(next * 100) / 100}h`
}

/**
 * Owner-facing Assigned vs Actual comparison.
 * Actual source is employee_task_assignments.hours_spent (completion recorded hours).
 * Incomplete work with a null actual must not display as 0h.
 */
export function presentAssignedActualVariance(input: {
  assignedHours: number | null | undefined
  actualHours: number | null | undefined
  completed?: boolean
}): HoursVariancePresentation {
  const assignedFinite = Number.isFinite(Number(input.assignedHours))
  const assignedLabel = assignedFinite ? formatWorkOrderHours(Number(input.assignedHours)) : '—'

  const actualRaw = input.actualHours
  const actualFinite = actualRaw != null && Number.isFinite(Number(actualRaw))
  if (!actualFinite) {
    return {
      assignedLabel,
      actualLabel: 'Not recorded',
      varianceLabel: 'Pending completion',
      varianceTone: 'pending',
    }
  }

  const assigned = assignedFinite ? Number(input.assignedHours) : 0
  const actual = Number(actualRaw)
  const delta = Math.round((actual - assigned) * 100) / 100
  const actualLabel = formatWorkOrderHours(actual)

  if (delta === 0) {
    return {
      assignedLabel,
      actualLabel,
      varianceLabel: 'On target',
      varianceTone: 'on_target',
    }
  }
  if (delta < 0) {
    return {
      assignedLabel,
      actualLabel,
      varianceLabel: `${formatWorkOrderHours(Math.abs(delta))} under`,
      varianceTone: 'under',
    }
  }
  return {
    assignedLabel,
    actualLabel,
    varianceLabel: `${formatWorkOrderHours(delta)} over`,
    varianceTone: 'over',
  }
}

export function isArchivedAssignment(assignment: { archived_at?: string | null } | null | undefined): boolean {
  return !!assignment?.archived_at
}
