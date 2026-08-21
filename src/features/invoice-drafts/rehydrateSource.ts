/**
 * src/features/invoice-drafts/rehydrateSource.ts
 *
 * QBO-2F — Resolve a Prepare Invoice source from a persisted draft so the
 * existing modal can reopen in EDIT mode.
 *
 * Behavior (QBO-2F rehydration rules):
 *  - If the live source still exists, use it normally and restore saved
 *    selections by id (the modal matches candidate ids).
 *  - If some historical source/log data is unavailable, do NOT destroy the
 *    saved draft. Build a minimal SYNTHETIC source from the saved snapshot so
 *    the modal can still render the saved invoice content (amount, title,
 *    description, separate charges) and the owner can understand the basis.
 *    The caller is told `live=false` so it can show a "source no longer live"
 *    notice. This is intentionally minimal — no archival tooling is built here.
 *
 * Pure w.r.t. mutation: never writes backup data or payment/KPI truth.
 */
import { getBackupData } from '@/services/backupDataService'
import type { BackupData, BackupProject, BackupServiceLog } from '@/services/backupDataService'
import { loadServiceCallRecords } from '@/services/serviceCallService'
import type { ServiceCallRecord } from '@/services/serviceCallService'
import { getLiveMultiDayServiceCalls } from '@/services/serviceScopeMerge'

import type { PrepareInvoiceSource } from '@/features/billing-draft/components/PrepareInvoiceModal'
import type { HydratedDraft } from './invoiceDraftTypes'

export interface RehydratedSource {
  readonly source: PrepareInvoiceSource
  /** true when the live source was found; false when a synthetic fallback was built. */
  readonly live: boolean
}

/**
 * Resolve the Prepare Invoice source for a persisted draft. Returns a source
 * (live or synthetic) plus a `live` flag.
 */
export function rehydrateSource(draft: HydratedDraft): RehydratedSource {
  if (draft.sourceKind === 'project') return resolveProject(draft)
  if (draft.sourceKind === 'serviceLog') return resolveServiceLog(draft)
  return resolveServiceCall(draft)
}

function emptyBackup(): BackupData {
  return { logs: [], projects: [], serviceLogs: [] } as unknown as BackupData
}

function resolveProject(draft: HydratedDraft): RehydratedSource {
  const backup = getBackupData()
  if (backup) {
    const project = backup.projects.find((p) => p.id === draft.sourceId)
    if (project) return { source: { kind: 'project', project, backup }, live: true }
  }
  // Synthetic: minimal project so readProjectBilling runs with empty logs.
  const snapshot = draft.sourceSnapshot
  const project = {
    id: draft.sourceId,
    name: draft.customerReference ?? snapshot.customerReference ?? '—',
    contract: 0,
    billed: 0,
    paid: 0,
    mileRT: 0,
    phases: {},
    logs: [],
    finance: {},
    changeOrders: [],
  } as unknown as BackupProject
  return { source: { kind: 'project', project, backup: emptyBackup() }, live: false }
}

function resolveServiceLog(draft: HydratedDraft): RehydratedSource {
  const backup = getBackupData()
  if (backup) {
    const serviceLog = (backup.serviceLogs ?? []).find((l) => l.id === draft.sourceId)
    if (serviceLog) return { source: { kind: 'service', serviceLog }, live: true }
  }
  const snapshot = draft.sourceSnapshot
  const serviceLog = {
    id: draft.sourceId,
    hrs: 0,
    mat: 0,
    date: '',
    jtype: '',
    miles: 0,
    notes: '',
    store: '',
    opCost: 0,
    profit: 0,
    quoted: 0,
    customer: draft.customerReference ?? snapshot.customerReference ?? '—',
    collected: 0,
    payStatus: 'N',
    balanceDue: 0,
  } as BackupServiceLog
  return { source: { kind: 'service', serviceLog }, live: false }
}

function resolveServiceCall(draft: HydratedDraft): RehydratedSource {
  const backup = getBackupData()
  if (backup) {
    const records = getLiveMultiDayServiceCalls(loadServiceCallRecords(backup)) as ServiceCallRecord[]
    const call = records.find((c) => c.service_call_id === draft.sourceId)
    if (call) return { source: { kind: 'serviceCall', call }, live: true }
  }
  const snapshot = draft.sourceSnapshot
  const call = {
    service_call_id: draft.sourceId,
    customer: draft.customerReference ?? snapshot.customerReference ?? '—',
    address: '',
    jtype: '',
    days: [],
    created_at: '',
  } as ServiceCallRecord
  return { source: { kind: 'serviceCall', call }, live: false }
}