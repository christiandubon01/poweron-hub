/**
 * serviceAssignments.ts — SERVICE-LOG-1 multi-employee assignment model.
 *
 * Replaces the single `technician` / `technicianId` pair on service estimates and
 * service calls with an ordered list of assigned employees.
 *
 * IDENTITY RULE (ROLE-2): a person is identified by
 *   • employee_profiles.id  — the canonical portal identity, and the ONLY id the
 *     Employee Portal ever matches on, and/or
 *   • the BackupData cost-model employee id — the stable local roster id.
 * The two are joined by employee_profiles.backup_employee_id (see
 * features/employee-directory/unifyDirectory.ts). Display names are carried for
 * offline rendering only and are NEVER used to match a person.
 *
 * Pure module: no I/O, no React, no Supabase.
 */

import {
  buildUnifiedDirectory,
  type CostModelEmployeeInput,
  type PortalProfileInput,
} from '@/features/employee-directory/unifyDirectory'

/** Marker used for the owner assigning the job to themselves. */
export const OWNER_ASSIGNEE_ID = '__owner__'
export const OWNER_ASSIGNEE_LABEL = 'Owner / Me'

export interface AssignedEmployee {
  /** BackupData cost-model employee id, or OWNER_ASSIGNEE_ID, else null. */
  employeeId: string | null
  /** Canonical employee_profiles.id. Null when the person has no portal account. */
  profileId: string | null
  /** Display cache only — never an identity. */
  name: string
}

export interface AssignableEmployeeOption {
  /** Stable option key (also the dedupe key of the resulting assignment). */
  key: string
  employeeId: string | null
  profileId: string | null
  name: string
  /** True when this person can actually receive the job in the Employee Portal. */
  portalLinked: boolean
}

/**
 * Dedupe key. Portal identity wins so the same person selected through either
 * roster resolves to one assignment.
 */
export function assignmentKey(a: Pick<AssignedEmployee, 'employeeId' | 'profileId'>): string {
  if (a.profileId) return `profile:${a.profileId}`
  if (a.employeeId) return `employee:${a.employeeId}`
  return ''
}

/** Is this the owner-assigned-to-self entry? */
export function isOwnerAssignment(a: Pick<AssignedEmployee, 'employeeId'>): boolean {
  return a.employeeId === OWNER_ASSIGNEE_ID
}

/**
 * Build the Assigned Employees picker options from the two rosters.
 * Linked people appear once, with their canonical portal profile id attached.
 */
export function buildAssignableEmployeeOptions(
  costModel: CostModelEmployeeInput[],
  portalProfiles: PortalProfileInput[],
  options: { includeOwner?: boolean } = {},
): AssignableEmployeeOption[] {
  const rows = buildUnifiedDirectory(costModel ?? [], portalProfiles ?? [])
  // COST-SOURCE-2B: owner sentinel rows are excluded from the directory portion.
  // When includeOwner is true, the caller adds the explicit '__owner__' entry
  // separately so the owner cannot appear twice (once from the roster, once
  // from the sentinel option).
  const list: AssignableEmployeeOption[] = rows.filter((r) => !r.isOwner).map((row) => {
    const employeeId = row.costModelId
    const profileId = row.portalProfileId
    return {
      key: profileId ? `profile:${profileId}` : `employee:${employeeId ?? ''}`,
      employeeId,
      profileId,
      name: row.displayName,
      portalLinked: Boolean(profileId && row.authLinked),
    }
  }).filter((o) => o.employeeId || o.profileId)

  if (options.includeOwner) {
    list.unshift({
      key: `employee:${OWNER_ASSIGNEE_ID}`,
      employeeId: OWNER_ASSIGNEE_ID,
      profileId: null,
      name: OWNER_ASSIGNEE_LABEL,
      portalLinked: false,
    })
  }
  return list
}

/** Add one employee. Duplicate selections are ignored, order is preserved. */
export function addAssignment(
  current: AssignedEmployee[],
  candidate: AssignedEmployee,
): AssignedEmployee[] {
  const key = assignmentKey(candidate)
  if (!key) return current
  if (current.some((a) => assignmentKey(a) === key)) return current
  return [...current, {
    employeeId: candidate.employeeId ?? null,
    profileId: candidate.profileId ?? null,
    name: candidate.name || '',
  }]
}

/** Remove exactly one employee; every other assignment is untouched. */
export function removeAssignment(current: AssignedEmployee[], key: string): AssignedEmployee[] {
  return current.filter((a) => assignmentKey(a) !== key)
}

/**
 * Read assignments off a stored record.
 *
 * Accepts the new `assignedEmployees[]` and falls back to the legacy single
 * `technicianId` / `technician` pair so estimates saved before this phase still
 * show their technician as an assignment.
 */
export function normalizeAssignments(record: unknown): AssignedEmployee[] {
  const r = (record ?? {}) as Record<string, unknown>
  const raw = r.assignedEmployees

  if (Array.isArray(raw)) {
    const out: AssignedEmployee[] = []
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const a = item as Record<string, unknown>
      const candidate: AssignedEmployee = {
        employeeId: a.employeeId ? String(a.employeeId) : null,
        profileId: a.profileId ? String(a.profileId) : null,
        name: a.name ? String(a.name) : '',
      }
      if (!assignmentKey(candidate)) continue
      const next = addAssignment(out, candidate)
      out.length = 0
      out.push(...next)
    }
    return out
  }

  const legacyId = r.technicianId ? String(r.technicianId) : ''
  const legacyName = r.technician ? String(r.technician) : ''
  if (legacyId) return [{ employeeId: legacyId, profileId: null, name: legacyName || legacyId }]
  return []
}

/**
 * Re-resolve portal identity for assignments captured before the person had a
 * portal account (or saved on a device with a stale roster). Cost-model ids are
 * matched against the linked directory; names are never used.
 */
export function hydrateAssignmentIdentities(
  assignments: AssignedEmployee[],
  options: AssignableEmployeeOption[],
): AssignedEmployee[] {
  const byEmployeeId = new Map<string, AssignableEmployeeOption>()
  const byProfileId = new Map<string, AssignableEmployeeOption>()
  for (const o of options) {
    if (o.employeeId) byEmployeeId.set(o.employeeId, o)
    if (o.profileId) byProfileId.set(o.profileId, o)
  }
  return assignments.map((a) => {
    const match = (a.profileId && byProfileId.get(a.profileId))
      || (a.employeeId && byEmployeeId.get(a.employeeId))
      || null
    if (!match) return a
    return {
      employeeId: a.employeeId ?? match.employeeId,
      profileId: a.profileId ?? match.profileId,
      name: match.name || a.name,
    }
  })
}

/** Canonical portal profile ids for the portal write. Owner/unlinked are dropped. */
export function assignedProfileIds(assignments: AssignedEmployee[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const a of assignments) {
    if (!a.profileId) continue
    if (seen.has(a.profileId)) continue
    seen.add(a.profileId)
    out.push(a.profileId)
  }
  return out
}

/** Short "Alex, Sam +1" style summary for list rows. */
export function summarizeAssignments(assignments: AssignedEmployee[], max = 2): string {
  const names = assignments.map((a) => a.name || 'Unnamed').filter(Boolean)
  if (names.length === 0) return ''
  if (names.length <= max) return names.join(', ')
  return `${names.slice(0, max).join(', ')} +${names.length - max}`
}

// ── Employee-facing projection ───────────────────────────────────────────────

/**
 * The ONLY service-call fields an employee is allowed to receive.
 *
 * Total Quoted, Suggested Quote, profit, margins, internal cost, collected,
 * balance due and every other money field are deliberately absent — this shape
 * is what the assignment write sends, so owner financials cannot leak into the
 * portal even by accident.
 */
export interface ServiceCallPortalPayload {
  serviceCallId: string
  serviceCallKind: 'service_estimate' | 'service_call'
  customerName: string
  address: string
  scheduledDate: string | null
  jobType: string
  workDescription: string
  status: string
}

/** Money-ish keys that must never reach the Employee Portal payload. */
const FINANCIAL_KEYS = [
  'quoted', 'totalQuote', 'totalQuoted', 'suggestedQuote', 'quotedManual',
  'profit', 'margin', 'collected', 'balanceDue', 'payStatus', 'mat',
  'materials', 'estMaterials', 'billRate', 'opCost', 'mileCost', 'adjustments',
] as const

export function buildServiceCallPortalPayload(
  record: unknown,
  kind: ServiceCallPortalPayload['serviceCallKind'],
): ServiceCallPortalPayload {
  const r = (record ?? {}) as Record<string, unknown>
  const str = (v: unknown): string => (v == null ? '' : String(v))
  return {
    serviceCallId: str(r.id),
    serviceCallKind: kind,
    customerName: str(r.customer) || 'Customer',
    address: str(r.address),
    scheduledDate: str(r.date) || null,
    jobType: str(r.jobType) || str(r.jtype),
    workDescription: str(r.notes),
    status: str(r.serviceStatus) || str(r.status) || 'assigned',
  }
}

/** Guard used by tests and by the write path: payload carries no financials. */
export function payloadOmitsFinancials(payload: Record<string, unknown>): boolean {
  return !FINANCIAL_KEYS.some((key) => key in payload)
}
