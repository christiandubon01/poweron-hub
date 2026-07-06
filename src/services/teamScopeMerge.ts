/**
 * teamScopeMerge.ts — team.members scoped merge helpers (Phase 6S-C).
 *
 * Protects the top-level BackupData.employees[] array from local-only saves,
 * stale-device overwrites, and hard-delete resurrection. Employees affect loaded
 * labor cost, team planning, estimate labor allocations, field/project log
 * dropdowns, and crew/capacity workflows, so a stale broad save must never wipe a
 * newer roster/rates or bring back a deleted employee.
 *
 * This mirrors the project/service scoped-merge pattern (item-level, delete-safe
 * LWW onto a freshly-fetched remote snapshot) but is kept entirely separate from
 * projectScopeMerge.ts / serviceScopeMerge.ts / weeklyDataScopeMerge.ts so those
 * remain untouched. Pure module: no React, localStorage, Supabase client, or side
 * effects.
 *
 * Deletes are TOMBSTONES: name / role / rates are preserved so historical logs and
 * estimate labor rows keep resolving the employee. Active dropdowns filter tombstoned
 * and inactive/closed employees via getLiveEmployees.
 *
 * Phase 6S-C intentionally does NOT touch: logs[] (team.time is protected separately
 * by project.logs), projects[], serviceLogs[], weeklyData[], project.finance, or
 * settings (projectionScenarios / payroll).
 */
import type { BackupData } from './backupDataService'

const EPOCH_FALLBACK_ISO = '1970-01-01T00:00:00.000Z'

function isValidDateString(value: unknown): boolean {
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

function shortStableHash(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 8)
}

/** Recover a 13-digit epoch embedded in an id like `emp1699999999999`. */
function timestampFromEmployeeId(employee: any): string | null {
  const candidates = [employee?.id, employee?.employeeId]
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

/** Deterministic legacy fingerprint used only when id AND employeeId are both missing. */
function employeeFingerprint(employee: any): string {
  const parts = [
    employee?.name,
    employee?.role,
    employee?.billRate,
    employee?.costRate,
  ].map(value => normalizeText(value))
  return `legacy:emp:${shortStableHash(parts.join('|'))}`
}

/**
 * Stable identity for an employee row.
 *  - Prefer an existing id.
 *  - Fall back to employeeId.
 *  - Fall back to a deterministic fingerprint only when both are missing.
 * Never generates random ids.
 */
export function getEmployeeIdentity(employee: any): string {
  const id = normalizeText(employee?.id)
  if (id) return id
  const employeeId = normalizeText(employee?.employeeId)
  if (employeeId) return employeeId
  return employeeFingerprint(employee)
}

function normalizeEmployeeCreatedAt(employee: any): string {
  if (isValidDateString(employee?.createdAt)) return String(employee.createdAt)
  const fromId = timestampFromEmployeeId(employee)
  if (fromId) return fromId
  if (isValidDateString(employee?.hire_date)) return String(employee.hire_date)
  return EPOCH_FALLBACK_ISO
}

function normalizeEmployeeUpdatedAt(employee: any): string {
  let base: string
  if (isValidDateString(employee?.updatedAt)) base = String(employee.updatedAt)
  else if (isValidDateString(employee?.createdAt)) base = String(employee.createdAt)
  else base = timestampFromEmployeeId(employee) || EPOCH_FALLBACK_ISO

  if (isValidDateString(employee?.deletedAt) && parseTimestampMs(employee.deletedAt) > parseTimestampMs(base)) {
    return String(employee.deletedAt)
  }
  return base
}

/**
 * Return a copy of `employee` preserving every existing field (including all rate
 * and type fields) and guaranteeing a stable id + createdAt + updatedAt. Existing
 * id/createdAt are never overwritten. When `timestamp` is supplied it is used as
 * the updatedAt for an explicit edit (and as createdAt when createdAt is missing).
 */
export function ensureEmployeeIdentity(employee: any, timestamp?: string): any {
  if (!employee || typeof employee !== 'object') return employee
  const identity = getEmployeeIdentity(employee)
  const stamp = timestamp && isValidDateString(timestamp) ? timestamp : undefined
  const next: any = { ...employee }
  if (!normalizeText(next.id)) next.id = identity
  if (!isValidDateString(next.createdAt)) next.createdAt = stamp || normalizeEmployeeCreatedAt(employee)
  if (stamp) next.updatedAt = stamp
  else if (!isValidDateString(next.updatedAt)) next.updatedAt = normalizeEmployeeUpdatedAt(employee)
  return next
}

/** True when an employee is soft-deleted (deletedAt tombstone or status 'deleted'). */
export function isDeletedEmployee(employee: any): boolean {
  if (!employee) return true
  if (isValidDateString(employee?.deletedAt)) return true
  return normalizeText(employee?.status).toLowerCase() === 'deleted'
}

/**
 * True when an employee should NOT be offered for new work: deleted, or
 * Inactive / Closed (any case). Historical references still resolve via the raw
 * array; this only gates active dropdowns/rosters.
 */
export function isInactiveEmployee(employee: any): boolean {
  if (isDeletedEmployee(employee)) return true
  const status = normalizeText(employee?.status).toLowerCase()
  return status === 'inactive' || status === 'closed'
}

/** Employees available for new work (not deleted, not inactive/closed). */
export function getLiveEmployees(employees: any[]): any[] {
  return (Array.isArray(employees) ? employees : []).filter(e => e && !isInactiveEmployee(e))
}

/**
 * Return a soft-delete copy of an employee. Every field — especially id / name /
 * role / billRate / costRate / hourly_rate / applyMultiplier / employee_type /
 * classification — is preserved so historical logs and estimate rows keep
 * resolving; only deletedAt / deletedBy / updatedAt / status are set.
 */
export function createEmployeeTombstone(employee: any, deletedBy?: string): any {
  const clean = ensureEmployeeIdentity(employee) || {}
  const now = new Date().toISOString()
  const tombstone: any = {
    ...clean,
    deletedAt: now,
    updatedAt: now,
    status: 'Deleted',
  }
  tombstone.deletedBy = deletedBy || clean?.deletedBy || 'system'
  return tombstone
}

// ── Merge ────────────────────────────────────────────────────────────────────

function isDeletedTombstone(employee: any): boolean {
  return isValidDateString(employee?.deletedAt)
}

/** Count of populated rate fields — used to break timestamp ties. */
function rateCompleteness(employee: any): number {
  let n = 0
  for (const field of ['billRate', 'costRate', 'hourly_rate']) {
    const v = employee?.[field]
    if (v !== undefined && v !== null && normalizeText(v) !== '' && Number(v) > 0) n++
  }
  return n
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || normalizeText(value) === ''
}

/**
 * Coalesce: start from `winner`, then fill any blank/undefined field from `other`
 * so a remote value is never wiped by a local blank. Unknown fields from both
 * sides are preserved.
 */
function coalesceEmployee(winner: any, other: any): any {
  const out: any = { ...other, ...winner }
  for (const key of Object.keys(other || {})) {
    if (isBlank(out[key]) && !isBlank(other[key])) out[key] = other[key]
  }
  return out
}

/**
 * Pick the winning employee row for one identity:
 *  - both deleted → newer deletedAt wins.
 *  - one deleted → tombstone beats an equal-or-older live row (live wins only if
 *    its updatedAt is strictly newer than the tombstone's deletedAt).
 *  - neither deleted → newer updatedAt wins; on a tie prefer more complete rate
 *    data; still tied → remote.
 * The winner's fields are then coalesced with the loser so no remote value is
 * wiped by a local blank/undefined.
 */
function pickEmployeeWinner(remote: any, incoming: any): any {
  const rDel = isDeletedTombstone(remote)
  const iDel = isDeletedTombstone(incoming)

  let winner: any
  let loser: any
  if (rDel && iDel) {
    winner = comparableMs(incoming.deletedAt) > comparableMs(remote.deletedAt) ? incoming : remote
    loser = winner === incoming ? remote : incoming
  } else if (rDel !== iDel) {
    const tombstone = rDel ? remote : incoming
    const live = rDel ? incoming : remote
    winner = comparableMs(live.updatedAt) > comparableMs(tombstone.deletedAt) ? live : tombstone
    loser = winner === tombstone ? live : tombstone
  } else {
    const rMs = comparableMs(remote.updatedAt)
    const iMs = comparableMs(incoming.updatedAt)
    if (iMs > rMs) { winner = incoming; loser = remote }
    else if (rMs > iMs) { winner = remote; loser = incoming }
    else {
      // Tie: prefer more complete rate data, else remote.
      winner = rateCompleteness(incoming) > rateCompleteness(remote) ? incoming : remote
      loser = winner === incoming ? remote : incoming
    }
  }

  return coalesceEmployee(winner, loser)
}

/** Merge two employees[] arrays by stable identity (delete-safe LWW). */
export function mergeEmployeesById(remoteEmployees: any[], incomingEmployees: any[]): any[] {
  const remoteSanitized = (Array.isArray(remoteEmployees) ? remoteEmployees : []).map(e => ensureEmployeeIdentity(e))
  const incomingSanitized = (Array.isArray(incomingEmployees) ? incomingEmployees : []).map(e => ensureEmployeeIdentity(e))

  const remoteById = new Map<string, any>()
  for (const emp of remoteSanitized) remoteById.set(getEmployeeIdentity(emp), emp)

  const result: any[] = []
  const used = new Set<string>()

  // Incoming order first (preserves local ordering), then remote-only rows.
  for (const incoming of incomingSanitized) {
    const id = getEmployeeIdentity(incoming)
    if (used.has(id)) continue
    used.add(id)
    const remote = remoteById.get(id)
    result.push(remote ? pickEmployeeWinner(remote, incoming) : incoming)
  }
  for (const remote of remoteSanitized) {
    const id = getEmployeeIdentity(remote)
    if (used.has(id)) continue
    used.add(id)
    result.push(remote)
  }

  return result
}

/**
 * Merge the top-level employees[] from incomingBackup into a fresh clone of
 * remoteBackup. Only employees[] is reconciled (row-by-row, delete-safe);
 * logs[], projects[], serviceLogs[], weeklyData[], settings, and everything else
 * in BackupData are carried through from the remote snapshot untouched.
 */
export function mergeEmployeesIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
): BackupData {
  const merged = JSON.parse(JSON.stringify(remoteBackup)) as BackupData
  const remoteEmployees = Array.isArray(merged.employees) ? merged.employees : []
  const incomingEmployees = Array.isArray(incomingBackup?.employees) ? incomingBackup.employees : []
  merged.employees = mergeEmployeesById(remoteEmployees, incomingEmployees) as any
  return merged
}

/**
 * Fold newer REMOTE employees[] into a fresh clone of `outgoingBackup` when the
 * outgoing save is NOT an employees/team.members save. Prevents an unrelated broad
 * save from pushing stale local employees[] over newer remote employees. Remote
 * rows win ties (passed as the tie-winning side), while tombstone/updatedAt rules
 * still apply so a genuine local edit is not lost. No other key is touched.
 */
export function mergeRemoteEmployeesIntoOutgoing(
  outgoingBackup: BackupData,
  remoteBackup: BackupData,
): BackupData {
  const merged = JSON.parse(JSON.stringify(outgoingBackup)) as BackupData
  const outgoingEmployees = Array.isArray(merged.employees) ? merged.employees : []
  const remoteEmployees = Array.isArray(remoteBackup?.employees) ? remoteBackup.employees : []
  // Pass remote as `incomingEmployees` so remote wins ties (protect remote roster).
  merged.employees = mergeEmployeesById(outgoingEmployees, remoteEmployees) as any
  return merged
}
