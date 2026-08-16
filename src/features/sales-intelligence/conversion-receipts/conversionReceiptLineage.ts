/**
 * SALES-CONVERSION-1 / LEAD-SRC-5B — Destination lineage discovery.
 *
 * Projects and Service Calls are not Supabase rows; they live inside the
 * BackupData JSONB document with TEXT ids ('proj…', 'est…'). Two lineage
 * fields already exist in the repo and are written by the destination save
 * paths themselves:
 *
 *   project.convertedFromLeadId   written by V15rProjectsPanel.saveNewProject
 *   serviceEstimate.hunterLeadId  written by V15rFieldLogPanel.saveEstimate
 *
 * This module reads those — and only those — to answer one question: which
 * destination record does this lead provably own? It is used for
 *   (a) the Service Call bridge, because the Service Log save path is owned by
 *       a parallel agent and cannot receive an inline receipt call, and
 *   (b) historical backfill eligibility.
 *
 * A record with no lineage field is NEVER treated as a conversion. A lead
 * being 'won', 'estimated', or archived proves nothing on its own.
 *
 * Converted-value snapshot (domain-specific):
 *   project      → project.contract
 *   service_call → resolveTotalQuoted(destination) when > 0, else null
 * Never promote lead estimated_value into converted_value.
 */

import { resolveTotalQuoted } from '@/features/service-quote/serviceQuoteMath'
import type { ConversionDestinationType } from './conversionReceiptTypes'

/** A destination record whose lineage back to a lead is proven. */
export interface ProvenLineage {
  leadId: string
  destinationType: ConversionDestinationType
  destinationId: string
  destinationLabel: string | null
  /**
   * Canonical converted value snapshot, or null.
   * Project: contract amount. Service: resolveTotalQuoted when > 0.
   */
  convertedValue: number | null
}

function isDeletedRow(row: any): boolean {
  // Matches serviceScopeMerge's lifecycle tombstone convention.
  return Boolean(row?.deletedAt)
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * LEAD-SRC-5B — Service converted_value from the destination's Total Quoted.
 * Positive resolved quotes only; 0 / missing / invalid stay null (no fallback).
 */
export function serviceConvertedValueFromTotalQuoted(destination: unknown): number | null {
  const quoted = resolveTotalQuoted(destination)
  return Number.isFinite(quoted) && quoted > 0 ? quoted : null
}

/**
 * Extracts every proven lead -> destination link from a BackupData document.
 * Returns one entry per destination record, so a lead that legitimately
 * produced both a Project and a Service Call yields two entries.
 */
export function collectProvenLineage(backup: any): ProvenLineage[] {
  const out: ProvenLineage[] = []
  if (!backup) return out

  const projects = Array.isArray(backup.projects) ? backup.projects : []
  for (const project of projects) {
    if (isDeletedRow(project)) continue
    const leadId = nonEmptyString(project?.convertedFromLeadId)
    const destinationId = nonEmptyString(project?.id)
    if (!leadId || !destinationId) continue
    out.push({
      leadId,
      destinationType: 'project',
      destinationId,
      destinationLabel: nonEmptyString(project?.name) ?? nonEmptyString(project?.client),
      convertedValue: toNumberOrNull(project?.contract),
    })
  }

  const estimates = Array.isArray(backup.serviceEstimates) ? backup.serviceEstimates : []
  for (const estimate of estimates) {
    if (isDeletedRow(estimate)) continue
    const leadId = nonEmptyString(estimate?.hunterLeadId)
    const destinationId = nonEmptyString(estimate?.id)
    if (!leadId || !destinationId) continue
    out.push({
      leadId,
      destinationType: 'service_call',
      destinationId,
      destinationLabel:
        nonEmptyString(estimate?.customer) ?? nonEmptyString(estimate?.jobType),
      convertedValue: serviceConvertedValueFromTotalQuoted(estimate),
    })
  }

  return out
}

/** Every proven destination for one lead. */
export function lineageForLead(backup: any, leadId: string): ProvenLineage[] {
  if (!leadId) return []
  return collectProvenLineage(backup).filter((entry) => entry.leadId === leadId)
}

/** Stable idempotency key matching the DB unique constraint. */
export function lineageKey(
  leadId: string,
  destinationType: ConversionDestinationType,
  destinationId: string
): string {
  return `${leadId}:${destinationType}:${destinationId}`
}

/**
 * Historical backfill eligibility.
 *
 * Eligible: proven lineage AND the originating lead still exists (so the
 * snapshot fields are real, not invented) AND no receipt already covers the
 * same idempotency key.
 *
 * Everything else is reported as ineligible with a reason — it is never
 * guessed into a receipt.
 */
export interface BackfillCandidate extends ProvenLineage {
  lead: Record<string, any>
}

export interface BackfillIneligible {
  leadId: string
  destinationType: ConversionDestinationType
  destinationId: string
  reason: 'lead_missing' | 'receipt_exists'
}

export interface BackfillPlan {
  eligible: BackfillCandidate[]
  ineligible: BackfillIneligible[]
}

export function planHistoricalBackfill(params: {
  backup: any
  leads: Array<Record<string, any>>
  existingReceiptKeys: Set<string>
}): BackfillPlan {
  const leadsById = new Map<string, Record<string, any>>()
  for (const lead of params.leads ?? []) {
    if (lead?.id) leadsById.set(String(lead.id), lead)
  }

  const eligible: BackfillCandidate[] = []
  const ineligible: BackfillIneligible[] = []
  const seen = new Set<string>()

  for (const entry of collectProvenLineage(params.backup)) {
    const key = lineageKey(entry.leadId, entry.destinationType, entry.destinationId)
    if (seen.has(key)) continue
    seen.add(key)

    if (params.existingReceiptKeys.has(key)) {
      ineligible.push({ ...entry, reason: 'receipt_exists' })
      continue
    }
    const lead = leadsById.get(entry.leadId)
    if (!lead) {
      // The destination remembers a lead that no longer exists. There is no
      // trustworthy snapshot to write, so this stays unbackfilled.
      ineligible.push({ ...entry, reason: 'lead_missing' })
      continue
    }
    eligible.push({ ...entry, lead })
  }

  return { eligible, ineligible }
}
