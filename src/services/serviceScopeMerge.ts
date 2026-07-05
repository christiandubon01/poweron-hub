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

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 6R-B — serviceEstimates[] + activeServiceCalls[] lifecycle scoped merge
// ───────────────────────────────────────────────────────────────────────────────
// These two pipeline arrays share the same lifecycle shape (stable identity,
// createdAt/updatedAt, deletedAt/deletedBy tombstone, delete-safe LWW merge, and —
// unlike serviceLogs — NO embedded payment ledgers). A single generic implementation
// backs both; the named exports below are thin wrappers over it. Kept entirely
// separate from the Phase 6R-A serviceLogs helpers above, which are untouched.
// ═══════════════════════════════════════════════════════════════════════════════

interface LifecycleConfig {
  /** Canonical internal identity field, e.g. 'serviceEstimateId'. */
  idField: string
  /** Prefix for the deterministic legacy fingerprint. */
  fingerprintPrefix: string
  /** Fields folded into the fingerprint when idField AND id are both missing. */
  fingerprintParts: (row: any) => unknown[]
}

/** Recover a 13-digit epoch embedded in any of the row's id-ish fields. */
function timestampFromRowIdFields(row: any, idFields: string[]): string | null {
  for (const field of idFields) {
    const text = normalizeText(row?.[field])
    const match = text.match(/(\d{13})/)
    if (!match) continue
    const ms = Number(match[1])
    if (!Number.isFinite(ms)) continue
    const date = new Date(ms)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return null
}

function lifecycleFingerprint(row: any, cfg: LifecycleConfig): string {
  const parts = cfg.fingerprintParts(row).map(value => normalizeText(value))
  return `${cfg.fingerprintPrefix}:${shortStableHash(parts.join('|'))}`
}

function getLifecycleIdentity(row: any, cfg: LifecycleConfig): string {
  const primary = normalizeText(row?.[cfg.idField])
  if (primary) return primary
  const id = normalizeText(row?.id)
  if (id) return id
  return lifecycleFingerprint(row, cfg)
}

function normalizeLifecycleCreatedAt(row: any, cfg: LifecycleConfig): string {
  if (isValidDateString(row?.createdAt)) return String(row.createdAt)
  const fromId = timestampFromRowIdFields(row, [cfg.idField, 'id'])
  if (fromId) return fromId
  if (isValidDateString(row?.date)) return String(row.date)
  if (isValidDateString(row?.movedAt)) return String(row.movedAt)
  return EPOCH_FALLBACK_ISO
}

function normalizeLifecycleUpdatedAt(row: any, cfg: LifecycleConfig): string {
  let base: string
  if (isValidDateString(row?.updatedAt)) base = String(row.updatedAt)
  else if (isValidDateString(row?.createdAt)) base = String(row.createdAt)
  else base = timestampFromRowIdFields(row, [cfg.idField, 'id']) || (isValidDateString(row?.date) ? String(row.date) : EPOCH_FALLBACK_ISO)

  // Treat any lifecycle activity marker as an update if it is newer than base.
  for (const field of ['movedAt', 'lostAt', 'archivedAt']) {
    if (isValidDateString(row?.[field]) && parseTimestampMs(row[field]) > parseTimestampMs(base)) {
      base = String(row[field])
    }
  }
  if (isValidDateString(row?.deletedAt) && parseTimestampMs(row.deletedAt) > parseTimestampMs(base)) {
    return String(row.deletedAt)
  }
  return base
}

/** Guarantee stable identity + timestamps without overwriting existing ids/times. */
function ensureLifecycleIdentity(row: any, cfg: LifecycleConfig): any {
  if (!row || typeof row !== 'object') return row
  const identity = getLifecycleIdentity(row, cfg)
  const next: any = { ...row }
  if (!normalizeText(next[cfg.idField])) next[cfg.idField] = identity
  if (!normalizeText(next.id)) next.id = next[cfg.idField]
  if (!isValidDateString(next.createdAt)) next.createdAt = normalizeLifecycleCreatedAt(row, cfg)
  if (!isValidDateString(next.updatedAt)) next.updatedAt = normalizeLifecycleUpdatedAt(row, cfg)
  return next
}

function createLifecycleTombstone(row: any, cfg: LifecycleConfig, deletedBy?: string): any {
  const clean = ensureLifecycleIdentity(row, cfg) || {}
  const now = new Date().toISOString()
  const tombstone: any = {
    ...clean,
    deletedAt: now,
    updatedAt: now,
  }
  tombstone.deletedBy = deletedBy || clean?.deletedBy || 'system'
  return tombstone
}

function isDeletedLifecycleRow(row: any): boolean {
  return isValidDateString(row?.deletedAt)
}

function pickLifecycleWinner(remote: any, incoming: any): any {
  const remoteDeleted = isDeletedLifecycleRow(remote)
  const incomingDeleted = isDeletedLifecycleRow(incoming)

  if (remoteDeleted && incomingDeleted) {
    return comparableMs(incoming.deletedAt) > comparableMs(remote.deletedAt) ? incoming : remote
  }
  if (remoteDeleted !== incomingDeleted) {
    const tombstone = remoteDeleted ? remote : incoming
    const live = remoteDeleted ? incoming : remote
    return comparableMs(live.updatedAt) > comparableMs(tombstone.deletedAt) ? live : tombstone
  }
  return comparableMs(incoming.updatedAt) > comparableMs(remote.updatedAt) ? incoming : remote
}

function mergeLifecycleById(remoteRows: any[], incomingRows: any[], cfg: LifecycleConfig): any[] {
  const remoteSanitized = (Array.isArray(remoteRows) ? remoteRows : []).map(row => ensureLifecycleIdentity(row, cfg))
  const incomingSanitized = (Array.isArray(incomingRows) ? incomingRows : []).map(row => ensureLifecycleIdentity(row, cfg))

  const remoteById = new Map<string, any>()
  for (const row of remoteSanitized) remoteById.set(getLifecycleIdentity(row, cfg), row)

  const result: any[] = []
  const used = new Set<string>()

  // Incoming order first (preserves local ordering), then remote-only rows.
  for (const incoming of incomingSanitized) {
    const id = getLifecycleIdentity(incoming, cfg)
    if (used.has(id)) continue
    used.add(id)
    const remote = remoteById.get(id)
    result.push(remote ? pickLifecycleWinner(remote, incoming) : incoming)
  }
  for (const remote of remoteSanitized) {
    const id = getLifecycleIdentity(remote, cfg)
    if (used.has(id)) continue
    used.add(id)
    result.push(remote)
  }
  return result
}

// ── serviceEstimates[] ─────────────────────────────────────────────────────────

const SERVICE_ESTIMATE_CFG: LifecycleConfig = {
  idField: 'serviceEstimateId',
  fingerprintPrefix: 'legacy:svcEst',
  fingerprintParts: row => [
    row?.customer,
    row?.accountId,
    row?.address,
    row?.date,
    row?.quoted,
    row?.internalCost,
    row?.status,
    row?.estimateStatus,
  ],
}

export function getServiceEstimateIdentity(row: any): string {
  return getLifecycleIdentity(row, SERVICE_ESTIMATE_CFG)
}

export function ensureServiceEstimateIdentity(row: any): any {
  return ensureLifecycleIdentity(row, SERVICE_ESTIMATE_CFG)
}

export function createServiceEstimateTombstone(row: any, deletedBy?: string): any {
  return createLifecycleTombstone(row, SERVICE_ESTIMATE_CFG, deletedBy)
}

export function mergeServiceEstimatesById(remoteRows: any[], incomingRows: any[]): any[] {
  return mergeLifecycleById(remoteRows, incomingRows, SERVICE_ESTIMATE_CFG)
}

export function mergeServiceEstimatesIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
): BackupData {
  const merged = JSON.parse(JSON.stringify(remoteBackup)) as BackupData
  const remoteRows = Array.isArray((merged as any).serviceEstimates) ? (merged as any).serviceEstimates : []
  const incomingRows = Array.isArray((incomingBackup as any)?.serviceEstimates) ? (incomingBackup as any).serviceEstimates : []
  ;(merged as any).serviceEstimates = mergeServiceEstimatesById(remoteRows, incomingRows)
  return merged
}

// ── activeServiceCalls[] ─────────────────────────────────────────────────────────

const ACTIVE_SERVICE_CALL_CFG: LifecycleConfig = {
  idField: 'activeServiceCallId',
  fingerprintPrefix: 'legacy:svcActive',
  fingerprintParts: row => [
    row?.customer,
    row?.accountId,
    row?.address,
    row?.fromEstimateId,
    row?.quoted,
    row?.internalCost,
    row?.status,
    row?.serviceStatus,
  ],
}

export function getActiveServiceCallIdentity(row: any): string {
  return getLifecycleIdentity(row, ACTIVE_SERVICE_CALL_CFG)
}

export function ensureActiveServiceCallIdentity(row: any): any {
  return ensureLifecycleIdentity(row, ACTIVE_SERVICE_CALL_CFG)
}

export function createActiveServiceCallTombstone(row: any, deletedBy?: string): any {
  return createLifecycleTombstone(row, ACTIVE_SERVICE_CALL_CFG, deletedBy)
}

export function mergeActiveServiceCallsById(remoteRows: any[], incomingRows: any[]): any[] {
  return mergeLifecycleById(remoteRows, incomingRows, ACTIVE_SERVICE_CALL_CFG)
}

export function mergeActiveServiceCallsIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
): BackupData {
  const merged = JSON.parse(JSON.stringify(remoteBackup)) as BackupData
  const remoteRows = Array.isArray((merged as any).activeServiceCalls) ? (merged as any).activeServiceCalls : []
  const incomingRows = Array.isArray((incomingBackup as any)?.activeServiceCalls) ? (incomingBackup as any).activeServiceCalls : []
  ;(merged as any).activeServiceCalls = mergeActiveServiceCallsById(remoteRows, incomingRows)
  return merged
}

// ── Combined service.calls scope merge (all three arrays in one clone) ───────────

/**
 * Merge every service.calls array from incomingBackup into ONE fresh clone of
 * remoteBackup: serviceLogs[] via the Phase 6R-A row merge (tombstone + ledger
 * union), serviceEstimates[] and activeServiceCalls[] via the 6R-B lifecycle
 * merge. Used by the mixed workflows (estimate → active call → service log) so a
 * single remote-baseline save carries all sides atomically. Nothing else in
 * BackupData is touched (logs[], projects[], multiDayServiceCalls, etc. are
 * carried through from remote unchanged).
 */
export function mergeServiceCallsScopeIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
): BackupData {
  const merged = JSON.parse(JSON.stringify(remoteBackup)) as BackupData

  const remoteLogs = Array.isArray(merged.serviceLogs) ? merged.serviceLogs : []
  const incomingLogs = Array.isArray(incomingBackup?.serviceLogs) ? incomingBackup.serviceLogs : []
  merged.serviceLogs = mergeServiceLogsById(remoteLogs, incomingLogs) as any

  const remoteEstimates = Array.isArray((merged as any).serviceEstimates) ? (merged as any).serviceEstimates : []
  const incomingEstimates = Array.isArray((incomingBackup as any)?.serviceEstimates) ? (incomingBackup as any).serviceEstimates : []
  ;(merged as any).serviceEstimates = mergeServiceEstimatesById(remoteEstimates, incomingEstimates)

  const remoteCalls = Array.isArray((merged as any).activeServiceCalls) ? (merged as any).activeServiceCalls : []
  const incomingCalls = Array.isArray((incomingBackup as any)?.activeServiceCalls) ? (incomingBackup as any).activeServiceCalls : []
  ;(merged as any).activeServiceCalls = mergeActiveServiceCallsById(remoteCalls, incomingCalls)

  return merged
}
