/**
 * src/features/billing-draft/projectBillingAdapter.ts
 *
 * QBO-2D — read-only Project → billing-context adapter (owner-workflow).
 *
 * Billing candidates originate from real PROJECT LOG records — never from
 * phase_timeline / getPhasePaymentSchedule / estimate payment schedule. Those
 * were the source of the bogus $360,000 "Underground" schedule the owner saw
 * at runtime and are REMOVED from this workflow entirely (QBO-2D §2/§21). No
 * phase_timeline-derived value is read, returned, or displayed here.
 *
 * This adapter READS structured PowerOn project truth and produces the work
 * candidates + contract/collected scalars that feed prepareBillingDraft(). It
 * does NOT mutate the project, its logs, or collected cash (RULE 4). It imports
 * ONLY canonical READERS — never a PowerOn mutation authority.
 *
 * Structured sources (all PURE readers):
 *  - project.contract + getProjectCOConfirmedTotal  → Project Value (A)
 *  - projectLogsFor(d, projId)                       → real Project Log candidates (B)
 *                                                   + collected payment truth (D)
 *  - project.finance?.manualPaidAdjustment           → manual paid adjustment (D)
 *
 * INVOICE HISTORY: PowerOn has no canonical persistent invoice ledger, so it is
 * "Not tracked yet" (displayed statically by the UI). No "previously invoiced"
 * or "remaining to invoice" value is produced here.
 *
 * NOTE: getProjectFinancials() is intentionally NOT used — it calls
 * ensureProjectFinanceBucket(p) which mutates `p.finance`. To keep RULE 4 a hard
 * guarantee, this adapter reads the same structured fields directly through
 * pure readers and shallow-clones the project before any external reader sees it.
 */
import { getProjectCOConfirmedTotal, projectLogsFor } from '@/services/backupDataService'
import type { BackupData, BackupLog, BackupProject } from '@/services/backupDataService'
import { isCanonicalCustomerId } from '@/features/quickbooks-customer-mapping/resolvePowerOnCustomerDirectory'

import { makeBillingCandidate } from './billingDraftModel'
import type { BillingCandidate } from './billingDraftTypes'

export interface ProjectBillingSource {
  readonly project: BackupProject
  readonly backup: BackupData
  /**
   * QBO-4A.6 — the authoritative canonical PowerOn customer id set
   * (relationship_accounts.id values for the org). When provided, the project's
   * accountId is accepted as customerId ONLY when it is a canonical id (a real
   * TEXT relationship_accounts.id — NOT validated by UUID format). When absent
   * (loading), no id is accepted yet (null — non-gating; resolves once loaded).
   */
  readonly canonicalIds?: ReadonlySet<string>
}

export interface ProjectBillingRead {
  readonly sourceKind: 'project'
  readonly sourceId: string
  readonly customerReference: string | null
  /**
   * QBO-4A.6 — canonical PowerOn customer identity (relationship_accounts.id, a
   * TEXT PK — NOT a UUID) when project.accountId is a CANONICAL id (present in
   * the org's canonicalIds set); null otherwise. Identity is NEVER validated by
   * UUID format, never inferred from the project name, and never a temporary id
   * absent from relationship_accounts. null is valid.
   */
  readonly customerId: string | null
  /** A. CONTRACT TRUTH — change-order-adjusted Project Value (display context). */
  readonly contractValue: number
  /** D. PAYMENT TRUTH — collected so far (sum of Payment logs + manual adjustment). */
  readonly collectedSoFar: number
  /** B. WORK CONTEXT — real Project Log records (context; no structured amount). */
  readonly candidates: readonly BillingCandidate[]
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

// Stable empty set so the canonical-id guard never allocates when canonicalIds
// is absent (e.g. while the org directory is still loading). Accepts nothing.
const EMPTY_SET: ReadonlySet<string> = new Set<string>()

/** Read a Project Log's collected amount, mirroring getProjectFinancials().paid:
 *  prefer `paymentsCollected` (payment-ledger logs) and fall back to `collected`. */
function logCollected(l: BackupLog): number {
  const pc = (l as BackupLog & { paymentsCollected?: unknown }).paymentsCollected
  return num(pc || l.collected || 0)
}

function projectLogLabel(log: BackupLog): string {
  const date = log.date || 'undated'
  return `Project Log — ${date}`
}

function projectLogDescription(log: BackupLog): string | null {
  const notes = typeof log.notes === 'string' ? log.notes.trim() : ''
  if (notes) return notes
  const phase = typeof log.phase === 'string' ? log.phase.trim() : ''
  if (phase) return phase
  return null
}

/**
 * Read a project's structured billing context into candidates + scalars.
 * Pure: returns new objects and never mutates `project` or `backup`.
 * No phase_timeline / getPhasePaymentSchedule value is read or returned.
 */
export function readProjectBilling(source: ProjectBillingSource): ProjectBillingRead {
  const { backup, canonicalIds } = source
  // Shallow clone so no external reader can mutate the caller's project object.
  const project: BackupProject = { ...source.project }

  const contract = round2(num(project.contract))
  const coConfirmed = round2(num(getProjectCOConfirmedTotal(project)))
  const contractValue = round2(contract + coConfirmed)

  // D. PAYMENT TRUTH: sum of live Payment logs + manual paid adjustment.
  const logs = projectLogsFor(backup, project.id)
  const loggedPaid = logs.reduce((sum, l) => sum + logCollected(l), 0)
  const manualPaidAdjustment = num((project.finance as { manualPaidAdjustment?: unknown } | undefined)?.manualPaidAdjustment)
  const collectedSoFar = Math.max(0, round2(loggedPaid + manualPaidAdjustment))

  // B. WORK CONTEXT: real Project Log records. Each is a selectable context row
  // describing the work being billed. They carry NO structured billing amount and
  // never become an invoice title (QBO-2D §7). Sorted newest-first to match the
  // Project Logs surface the owner already uses.
  const candidates: BillingCandidate[] = logs
    .slice()
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .map((log) =>
      makeBillingCandidate({
        id: `projlog:${project.id}:${log.id}`,
        kind: 'project_log',
        sourceId: log.id,
        label: projectLogLabel(log),
        description: projectLogDescription(log),
        date: log.date || null,
        structuredAmount: null, // Project Logs carry no authoritative billing amount.
        representationMode: null,
        capacityGroup: null,
      }),
    )

  return {
    sourceKind: 'project',
    sourceId: project.id,
    customerReference: project.name || null,
    // Propagate a CANONICAL PowerOn customer id only (relationship_accounts.id,
    // a TEXT PK — never validated by UUID format). The project name and any
    // temporary/local id absent from canonicalIds are rejected. null is valid.
    customerId: isCanonicalCustomerId(project.accountId, canonicalIds ?? EMPTY_SET) ? project.accountId : null,
    contractValue,
    collectedSoFar,
    candidates,
  }
}