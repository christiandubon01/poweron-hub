/**
 * src/features/billing-draft/serviceBillingAdapter.ts
 *
 * QBO-2D — read-only Service Call → billing-context adapter (owner-workflow).
 *
 * Billing originates from the actual SERVICE LOG record — never artificial
 * milestones. Structured Service Log financial truth is used WHERE IT EXISTS:
 * total billable (quote + approved income adjustments), itemized materials,
 * and the payment ledger. When no structured billable exists (e.g. a multi-day
 * call with no stored quote), the candidate carries no structured amount and the
 * owner enters "Billing Now" manually.
 *
 * This adapter READS structured PowerOn service financial truth and produces the
 * work candidates + contract/collected scalars that feed prepareBillingDraft(). It
 * does NOT mutate the service log, its payment ledger, or collected cash (RULE 4).
 * It imports ONLY canonical READERS — never a PowerOn mutation authority.
 *
 * Structured sources (all pure readers):
 *  - resolveServiceTotalBillable(row) → Service Value (quoted + approved income adjustments)
 *  - resolveServiceCollected(row)     → payment truth (payments[] ledger, else scalar collected)
 *  - serviceLog.mat                   → structured materials component (legacy single-entry log)
 *  - getServiceCallTotals(call)       → multi-day totals (collected, materials)
 *
 * PATTERN A (service work): a service draft may bill the total quote
 * (`service_total`) OR itemize into a labor line (`service_labor`) plus a
 * separate materials line (`service_material`). The owner selects ONE basis; the
 * model's representation-exclusivity guard flags any double-selection. When no
 * structured quote exists, the total/labor amounts are null (owner-entered) and
 * only materials (when itemized) are structured.
 *
 * `workDescription` is the service's actual work description (notes / job type),
 * used to SEED the invoice Description — never the Product/Service title.
 */
import type { BackupServiceLog } from '@/services/backupDataService'
import { getServiceCallTotals } from '@/services/serviceCallService'
import type { ServiceCallRecord } from '@/services/serviceCallService'
import { resolveServiceCollected, resolveServiceTotalBillable } from '@/features/service-quote/servicePaymentLedger'
import { isCanonicalCustomerId } from '@/features/quickbooks-customer-mapping/resolvePowerOnCustomerDirectory'

import { makeBillingCandidate } from './billingDraftModel'
import type { BillingCandidate } from './billingDraftTypes'

// Stable empty set so the canonical-id guard never allocates when canonicalIds
// is absent (e.g. while the org directory is still loading). Accepts nothing.
const EMPTY_SET: ReadonlySet<string> = new Set<string>()

export interface ServiceBillingRead {
  readonly sourceKind: 'service'
  readonly sourceId: string
  readonly customerReference: string | null
  /**
   * QBO-4A.6 — canonical PowerOn customer identity (relationship_accounts.id, a
   * TEXT PK — NOT a UUID) when the source carries a CANONICAL id (present in the
   * org's canonicalIds set); null otherwise. Service CALLS may carry accountId/
   * customerId; legacy single-entry service logs are name-only → null. Identity
   * is NEVER validated by UUID format and never inferred from the customer name.
   */
  readonly customerId: string | null
  /** A. CONTRACT TRUTH — structured total billable (Service Value); null = no structured cap. */
  readonly contractValue: number | null
  /** D. PAYMENT TRUTH — collected so far (payments[] ledger, else scalar / per-day sum). */
  readonly collectedSoFar: number
  /** B. WORK CONTEXT — service total/labor/material candidates. */
  readonly candidates: readonly BillingCandidate[]
  /** The service's actual work description (notes / job type) — seeds the invoice Description, never the title. */
  readonly workDescription: string
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}
function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * Build service billing candidates for one service call. The total representation
 * and the itemized (labor + material) components share ONE capacity group (the
 * service call's billable value) and are mutually exclusive on one draft.
 *
 * `totalBillable` is the structured quote where one exists; null when none (the
 * owner enters the total/labor amount manually). `materials` is structured
 * materials value; the materials candidate is emitted only when materials > 0.
 */
function buildServiceCandidates(args: {
  sourceId: string
  customer: string | null
  jtype: string | null
  date: string | null
  totalBillable: number | null
  materials: number
}): BillingCandidate[] {
  const { sourceId, customer, jtype, date, totalBillable, materials } = args
  const group = `svc:${sourceId}`
  const description = jtype || customer || null
  const totalStructured = totalBillable != null && totalBillable > 0 ? round2(totalBillable) : null
  const matStructured = materials > 0 ? round2(materials) : null

  const candidates: BillingCandidate[] = [
    makeBillingCandidate({
      id: `svc:${sourceId}:total`,
      kind: 'service_total',
      sourceId,
      label: 'Service Work — Total',
      description,
      date,
      structuredAmount: totalStructured,
      representationMode: 'total',
      capacityGroup: group,
    }),
  ]

  if (matStructured != null) {
    const laborStructured = totalStructured != null ? round2(Math.max(0, totalStructured - matStructured)) : null
    candidates.push(
      makeBillingCandidate({
        id: `svc:${sourceId}:labor`,
        kind: 'service_labor',
        sourceId,
        label: 'Labor / Service',
        description,
        date,
        structuredAmount: laborStructured,
        representationMode: 'component',
        capacityGroup: group,
      }),
      makeBillingCandidate({
        id: `svc:${sourceId}:material`,
        kind: 'service_material',
        sourceId,
        label: 'Materials',
        description: null,
        date,
        structuredAmount: matStructured,
        representationMode: 'component',
        capacityGroup: group,
      }),
    )
  }

  return candidates
}

export interface ServiceBillingSource {
  readonly serviceLog: BackupServiceLog
  /**
   * QBO-4A.6 — authoritative canonical PowerOn customer id set. The service
   * log's accountId is accepted as customerId ONLY when canonical. Absent
   * (loading) → null until the directory loads (non-gating).
   */
  readonly canonicalIds?: ReadonlySet<string>
}

/**
 * Read a legacy single-entry service log's structured billing context.
 * Pure: returns new objects, never mutates `serviceLog`.
 */
export function readServiceBilling(source: ServiceBillingSource): ServiceBillingRead {
  const { serviceLog, canonicalIds } = source
  const totalBillable = round2(resolveServiceTotalBillable(serviceLog))
  const collected = round2(resolveServiceCollected(serviceLog))
  const materials = round2(num(serviceLog.mat))
  const totalStructured = totalBillable > 0 ? totalBillable : null

  // The actual work description is the free-text `notes`; fall back to the job
  // type only when no notes exist. (QBO-2D §18: work description seeds the
  // invoice Description, never the Product/Service title.)
  const notesText = typeof serviceLog.notes === 'string' ? serviceLog.notes.trim() : ''
  const jtypeText = typeof serviceLog.jtype === 'string' ? serviceLog.jtype.trim() : ''
  const workDescription = notesText || jtypeText

  return {
    sourceKind: 'service',
    sourceId: serviceLog.id,
    customerReference: serviceLog.customer || null,
    // QBO-4A.6: propagate a CANONICAL PowerOn customer id (relationship_accounts.id,
    // a TEXT PK) from the legacy log's canonical accountId ONLY — never the customer
    // name, never a temporary/local id absent from canonicalIds. null is valid.
    // Mirrors readServiceCallBilling's canonical guard.
    customerId: isCanonicalCustomerId(serviceLog.accountId, canonicalIds ?? EMPTY_SET) ? serviceLog.accountId : null,
    contractValue: totalStructured,
    collectedSoFar: collected,
    candidates: buildServiceCandidates({
      sourceId: serviceLog.id,
      customer: serviceLog.customer || null,
      jtype: serviceLog.jtype || null,
      date: serviceLog.date || null,
      totalBillable: totalStructured,
      materials,
    }),
    workDescription,
  }
}

export interface ServiceCallBillingSource {
  readonly call: ServiceCallRecord
  /**
   * QBO-4A.6 — authoritative canonical PowerOn customer id set. The call's
   * accountId/customerId is accepted as customerId ONLY when canonical.
   * Absent (loading) → null until the directory loads (non-gating).
   */
  readonly canonicalIds?: ReadonlySet<string>
}

/**
 * Read a multi-day service call's structured billing context. Multi-day calls
 * store no customer-facing quote, so the total/labor amounts are null
 * (owner-entered); only itemized materials (when present) are structured.
 * Collected is the per-day collection sum. Pure: never mutates `call`.
 */
export function readServiceCallBilling(source: ServiceCallBillingSource): ServiceBillingRead {
  const { call, canonicalIds } = source
  const totals = getServiceCallTotals(call)
  const collected = round2(totals.total_collected)
  const materials = round2(totals.total_materials)
  const firstDate = call.days && call.days.length ? call.days[0].date || call.created_at || null : call.created_at || null
  const dayNotes = (call.days || [])
    .map((d) => (typeof d.notes === 'string' ? d.notes.trim() : ''))
    .filter(Boolean)
  // Prefer per-day work notes (the actual work); fall back to the call's job type.
  const jtypeText = typeof call.jtype === 'string' ? call.jtype.trim() : ''
  const workDescription = dayNotes.length > 0 ? dayNotes.join('\n') : jtypeText

  return {
    sourceKind: 'service',
    sourceId: call.service_call_id,
    customerReference: call.customer || null,
    // Propagate a CANONICAL PowerOn customer id from the service call's
    // accountId/customerId only (relationship_accounts.id — a TEXT PK, never
    // validated by UUID format). The customer name and any temporary/local id
    // absent from canonicalIds are rejected. null is valid.
    customerId: isCanonicalCustomerId(call.accountId, canonicalIds ?? EMPTY_SET)
      ? call.accountId
      : isCanonicalCustomerId(call.customerId, canonicalIds ?? EMPTY_SET)
        ? call.customerId
        : null,
    contractValue: null, // no structured quote on a multi-day call → no contract cap
    collectedSoFar: collected,
    candidates: buildServiceCandidates({
      sourceId: call.service_call_id,
      customer: call.customer || null,
      jtype: call.jtype || null,
      date: firstDate,
      totalBillable: null,
      materials,
    }),
    workDescription,
  }
}