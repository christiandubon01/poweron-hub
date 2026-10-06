/**
 * CASH-UX-2 — owner-stated project facts (billing type, collection readiness, blocker, time/spend needed).
 *
 * These are facts only the owner knows. They never hold a balance or a receivable: the remaining balance is
 * derived from the project contract and collected payments, and the cash a job needs is the sum of the job's
 * linked required commitments (cash_commitments.project_id), not a number typed here.
 */

export type ProjectBillingType = 'fixed' | 'time_and_material'
export type ProjectReadiness = 'work_required' | 'ready_to_bill'
export type CollectionConfidence = 'high' | 'medium' | 'low'

export interface CashProjectFactsRow {
  id: string
  organization_id: string
  project_id: string
  billing_type: ProjectBillingType | null
  readiness: ProjectReadiness | null
  completion_requirement: string | null
  blocked_reason: string | null
  /** null = not answered, false = no spend needed, true = spend needed */
  needs_spend: boolean | null
  work_hours_remaining: number | null
  expected_collection_date: string | null
  collection_confidence: CollectionConfidence | null
  next_action: string | null
  created_at: string
  updated_at: string
}

export interface CashProjectFactsInput {
  billingType?: ProjectBillingType | null
  readiness?: ProjectReadiness | null
  completionRequirement?: string | null
  blockedReason?: string | null
  needsSpend?: boolean | null
  workHoursRemaining?: number | null
  expectedCollectionDate?: string | null
  collectionConfidence?: CollectionConfidence | null
  nextAction?: string | null
}

const BILLING: readonly string[] = ['fixed', 'time_and_material']
const READINESS: readonly string[] = ['work_required', 'ready_to_bill']
const CONFIDENCE: readonly string[] = ['high', 'medium', 'low']
const MAX_TEXT = 500

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed ? trimmed : null
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** Returns a plain-language problem, or null when the input is acceptable. */
export function validateProjectFactsInput(input: CashProjectFactsInput): string | null {
  if (input.billingType != null && !BILLING.includes(input.billingType)) return 'Choose fixed price or time & material.'
  if (input.readiness != null && !READINESS.includes(input.readiness)) return 'Choose whether the balance can be collected yet.'
  if (input.collectionConfidence != null && !CONFIDENCE.includes(input.collectionConfidence)) return 'Choose how sure you are.'
  for (const [label, text] of [['Requirement', input.completionRequirement], ['Reason', input.blockedReason], ['Next step', input.nextAction]] as const) {
    if (text != null && text.trim().length > MAX_TEXT) return `${label} is too long (max ${MAX_TEXT} characters).`
  }
  if (input.workHoursRemaining != null
    && (!Number.isFinite(input.workHoursRemaining) || input.workHoursRemaining < 0 || input.workHoursRemaining > 99999)) {
    return 'Enter hours as a number of zero or more.'
  }
  if (input.expectedCollectionDate != null && input.expectedCollectionDate !== '' && !validDate(input.expectedCollectionDate)) {
    return 'Enter a valid expected collection date.'
  }
  if (input.readiness === 'ready_to_bill' && blankToNull(input.blockedReason)) {
    return 'A job that is blocked right now cannot also be ready to bill.'
  }
  return null
}

/**
 * Maps only the keys the caller provided to table columns (blank text becomes NULL). Omitted keys are left
 * out so an upsert never overwrites a fact the caller did not touch.
 */
export function projectFactsPayload(input: CashProjectFactsInput): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if ('billingType' in input) out.billing_type = input.billingType ?? null
  if ('readiness' in input) out.readiness = input.readiness ?? null
  if ('completionRequirement' in input) out.completion_requirement = blankToNull(input.completionRequirement)
  if ('blockedReason' in input) out.blocked_reason = blankToNull(input.blockedReason)
  if ('needsSpend' in input) out.needs_spend = input.needsSpend ?? null
  if ('workHoursRemaining' in input) {
    out.work_hours_remaining = input.workHoursRemaining == null ? null : Math.round(input.workHoursRemaining * 10) / 10
  }
  if ('expectedCollectionDate' in input) out.expected_collection_date = input.expectedCollectionDate ? input.expectedCollectionDate : null
  if ('collectionConfidence' in input) out.collection_confidence = input.collectionConfidence ?? null
  if ('nextAction' in input) out.next_action = blankToNull(input.nextAction)
  return out
}

export interface ProjectOption { id: string; name: string }

const INACTIVE_STATUSES = ['canceled', 'cancelled', 'archived', 'deleted', 'lost', 'rejected']

/** Jobs an owner can still attach a required spend or facts to (read-only view of the project list). */
export function projectOptionsFromBackup(backup: { projects?: unknown } | null | undefined): ProjectOption[] {
  const projects = Array.isArray(backup?.projects) ? (backup!.projects as any[]) : []
  return projects
    .filter(p => p && p.id != null && !p.deletedAt && !p.archived && !p.archivedAt
      && !INACTIVE_STATUSES.includes(String(p.status ?? '').toLowerCase().trim())
      && !['canceled', 'cancelled', 'lost'].includes(String(p.outcome ?? '').toLowerCase().trim()))
    .map(p => ({ id: String(p.id), name: String(p.name || p.id) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
