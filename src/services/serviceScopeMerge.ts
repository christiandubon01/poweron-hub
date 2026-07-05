/**
 * serviceScopeMerge.ts — Service-side scoped merge helpers (Phase 6R-A).
 *
 * Protects the top-level BackupData.serviceLogs[] array (and the service payments
 * embedded on each row — collected / payStatus / balanceDue / adjustments[] /
 * statusEvents[]) from broad-save overwrite and hard-delete resurrection.
 *
 * This mirrors the project.logs Phase 6N pattern (item-level, delete-safe id-merge
 * onto a freshly-fetched remote snapshot) but is kept entirely separate from
 * projectScopeMerge.ts so project logic is untouched. Pure module: no React,
 * localStorage, Supabase client, or side effects.
 *
 * A service "payment" is NOT a separate entity — it is a set of FIELDS on a
 * serviceLogs[] row. The merge unit is therefore the whole row, so collected /
 * payStatus / balanceDue always travel with the winning row. The append-only
 * adjustments[] and statusEvents[] ledgers are unioned across both sides so
 * payment/collection history is never dropped by a concurrent edit.
 *
 * Phase 6R-A intentionally does NOT touch: logs[], projects[], activeServiceCalls[],
 * serviceEstimates[], or multiDayServiceCalls (deferred to 6R-B / later).
 */
import type { BackupData } from './backupDataService'

const EPOCH_FALLBACK_ISO = '1970-01-01T00:00:00.000Z'

export function isValidDateString(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  return !Number.isNaN(Date.parse(trimmed))
}

function parseTimestampMs(value: unknown): number {
  if (typeof value !== 'string') return Number.NaN
  const trimmed = value.trim()
  if (!trimmed) return Number.NaN
  const ms = Date.parse(trimmed)
  return Number.isNaN(ms) ? Number.NaN : ms
}

function comparableMs(value: unknown): number {
  const ms = parseTimestampMs(value)
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

/** Recover a 13-digit epoch embedded in an id like `svc1699999999999`. */
function timestampFromServiceLogId(log: any): string | null {
  const candidates = [log?.id, log?.serviceLogId]
  for (const candidate of candidates) {
    const text = normalizeText(candidate)
    const match = text.match(/(\d{13})/)
    if (!match) continue
    const ms = Number(match[1])
    if (!Number.isFinite(ms)) continue
    const date = new Date(ms)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return null
}

function shortStableHash(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 8)
}

/** Deterministic legacy fingerprint used only when serviceLogId AND id are both missing. */
function serviceLogFingerprint(log: any): string {
  const parts = [
    log?.customer,
    log?.accountId,
    log?.customerId,
    log?.address,
    log?.date,
    log?.jtype,
    log?.serviceType,
    log?.description,
    log?.notes,
    log?.quoted,
    log?.collected,
  ].map(value => normalizeText(value))
  return `legacy:svcLog:${shortStableHash(parts.join('|'))}`
}

/**
 * Stable identity for a service log row.
 *  - Prefer an existing serviceLogId.
 *  - Fall back to the existing id (legacy rows).
 *  - Fall back to a deterministic fingerprint only when both are missing.
 */
export function getServiceLogIdentity(log: any): string {
  const serviceLogId = normalizeText(log?.serviceLogId)
  if (serviceLogId) return serviceLogId
  const id = normalizeText(log?.id)
  if (id) return id
  return serviceLogFingerprint(log)
}

function normalizeServiceLogCreatedAt(log: any): string {
  if (isValidDateString(log?.createdAt)) return String(log.createdAt)
  const fromId = timestampFromServiceLogId(log)
  if (fromId) return fromId
  if (isValidDateString(log?.date)) return String(log.date)
  return EPOCH_FALLBACK_ISO
}

function normalizeServiceLogUpdatedAt(log: any): string {
  let base: string
  if (isValidDateString(log?.updatedAt)) base = String(log.updatedAt)
  else if (isValidDateString(log?.createdAt)) base = String(log.createdAt)
  else base = timestampFromServiceLogId(log) || (isValidDateString(log?.date) ? String(log.date) : EPOCH_FALLBACK_ISO)

  if (isValidDateString(log?.deletedAt) && parseTimestampMs(log.deletedAt) > parseTimestampMs(base)) {
    return String(log.deletedAt)
  }
  return base
}

/**
 * Return a copy of `log` that preserves every existing field (including all
 * payment fields) and guarantees a stable serviceLogId, an id, and createdAt /
 * updatedAt timestamps. Existing ids/timestamps are never overwritten; payment
 * fields are never touched.
 */
export function ensureServiceLogIdentity(log: any): any {
  if (!log || typeof log !== 'object') return log
  const identity = getServiceLogIdentity(log)
  const next: any = { ...log }
  if (!normalizeText(next.serviceLogId)) next.serviceLogId = identity
  if (!normalizeText(next.id)) next.id = next.serviceLogId
  if (!isValidDateString(next.createdAt)) next.createdAt = normalizeServiceLogCreatedAt(log)
  if (!isValidDateString(next.updatedAt)) next.updatedAt = normalizeServiceLogUpdatedAt(log)
  return next
}

/**
 * True when a service log is deleted, archived, or in a terminal non-active
 * status. Used by the merge (tombstone winner logic) and by reader/total filters
 * so archived/deleted rows never inflate collected / outstanding / exposure.
 */
export function isDeletedOrArchivedServiceLog(log: any): boolean {
  if (!log) return true
  if (isValidDateString(log?.deletedAt)) return true
  if (isValidDateString(log?.archivedAt)) return true
  if (log?.archived === true || log?.isArchived === true || log?.deleted === true || log?.isDeleted === true) return true
  const status = normalizeText(log?.serviceStatus || log?.status || log?.estimateStatus).toLowerCase()
  return ['deleted', 'lost', 'cancelled', 'canceled', 'rejected', 'void'].includes(status)
}

/** Tombstone marker for merge winner logic (needs a deletedAt timestamp). */
function isDeletedServiceLog(log: any): boolean {
  return isValidDateString(log?.deletedAt)
}

/**
 * Return a soft-delete copy of a service log. Every field — including the
 * embedded payment fields collected / payStatus / balanceDue / adjustments[] /
 * statusEvents[] — is preserved; only deletedAt / deletedBy / updatedAt are added.
 */
export function createServiceLogTombstone(log: any, deletedBy?: string): any {
  const clean = ensureServiceLogIdentity(log) || {}
  const now = new Date().toISOString()
  const tombstone: any = {
    ...clean,
    deletedAt: now,
    updatedAt: now,
  }
  tombstone.deletedBy = deletedBy || clean?.deletedBy || 'system'
  return tombstone
}

// ── Ledger union helpers (never drop payment/collection history) ───────────────

function adjustmentFingerprint(adj: any): string {
  const parts = [
    adj?.type,
    adj?.category,
    adj?.amount,
    adj?.desc,
    adj?.date,
  ].map(value => normalizeText(value))
  return shortStableHash(parts.join('|'))
}

/** Union two adjustments[] arrays, de-duping by id (or fingerprint when id-less). */
function unionAdjustments(a: any[], b: any[]): any[] {
  const out: any[] = []
  const seen = new Set<string>()
  for (const list of [a, b]) {
    for (const adj of Array.isArray(list) ? list : []) {
      const key = normalizeText(adj?.id) || `fp:${adjustmentFingerprint(adj)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(adj)
    }
  }
  return out
}

function statusEventFingerprint(ev: any): string {
  const parts = [
    ev?.date,
    ev?.status,
    ev?.collected,
    ev?.invoiced,
  ].map(value => normalizeText(value))
  return shortStableHash(parts.join('|'))
}

/** Union two statusEvents[] arrays, de-duping by id then by fingerprint. */
function unionStatusEvents(a: any[], b: any[]): any[] {
  const out: any[] = []
  const seen = new Set<string>()
  for (const list of [a, b]) {
    for (const ev of Array.isArray(list) ? list : []) {
      const key = normalizeText(ev?.id) || `fp:${statusEventFingerprint(ev)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(ev)
    }
  }
  return out
}

/**
 * Pick the winning row for one identity, then fold both sides' append-only
 * ledgers into it so no adjustment or statusEvent is lost.
 */
function pickServiceLogWinner(remote: any, incoming: any): any {
  const remoteDeleted = isDeletedServiceLog(remote)
  const incomingDeleted = isDeletedServiceLog(incoming)

  let winner: any
  if (remoteDeleted && incomingDeleted) {
    winner = comparableMs(incoming.deletedAt) > comparableMs(remote.deletedAt) ? incoming : remote
  } else if (remoteDeleted !== incomingDeleted) {
    const tombstone = remoteDeleted ? remote : incoming
    const live = remoteDeleted ? incoming : remote
    winner = comparableMs(live.updatedAt) > comparableMs(tombstone.deletedAt) ? live : tombstone
  } else {
    winner = comparableMs(incoming.updatedAt) > comparableMs(remote.updatedAt) ? incoming : remote
  }

  // Preserve the full payment/collection history from BOTH sides regardless of
  // which row won on updatedAt — the ledgers are append-only.
  const mergedAdjustments = unionAdjustments(remote.adjustments, incoming.adjustments)
  const mergedStatusEvents = unionStatusEvents(remote.statusEvents, incoming.statusEvents)
  const result: any = { ...winner }
  if (mergedAdjustments.length) result.adjustments = mergedAdjustments
  if (mergedStatusEvents.length) result.statusEvents = mergedStatusEvents
  return result
}

/** Merge two serviceLogs[] arrays by stable identity (delete-safe LWW). */
export function mergeServiceLogsById(remoteLogs: any[], incomingLogs: any[]): any[] {
  const remoteSanitized = (Array.isArray(remoteLogs) ? remoteLogs : []).map(ensureServiceLogIdentity)
  const incomingSanitized = (Array.isArray(incomingLogs) ? incomingLogs : []).map(ensureServiceLogIdentity)

  const remoteById = new Map<string, any>()
  for (const log of remoteSanitized) remoteById.set(getServiceLogIdentity(log), log)

  const result: any[] = []
  const used = new Set<string>()

  // Incoming order first (preserves local ordering), then remote-only rows.
  for (const incoming of incomingSanitized) {
    const id = getServiceLogIdentity(incoming)
    if (used.has(id)) continue
    used.add(id)
    const remote = remoteById.get(id)
    result.push(remote ? pickServiceLogWinner(remote, incoming) : incoming)
  }
  for (const remote of remoteSanitized) {
    const id = getServiceLogIdentity(remote)
    if (used.has(id)) continue
    used.add(id)
    result.push(remote)
  }

  return result
}

/**
 * Merge the top-level serviceLogs[] from incomingBackup into a fresh clone of
 * remoteBackup. Only serviceLogs[] is reconciled (row-by-row, delete-safe);
 * logs[], projects[], activeServiceCalls[], serviceEstimates[], and everything
 * else in BackupData are carried through from the remote snapshot untouched.
 */
export function mergeServiceLogsIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
): BackupData {
  const merged = JSON.parse(JSON.stringify(remoteBackup)) as BackupData
  const remoteLogs = Array.isArray(merged.serviceLogs) ? merged.serviceLogs : []
  const incomingLogs = Array.isArray(incomingBackup?.serviceLogs) ? incomingBackup.serviceLogs : []
  merged.serviceLogs = mergeServiceLogsById(remoteLogs, incomingLogs) as any
  return merged
}
