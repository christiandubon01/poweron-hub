/**
 * Project inner-scope merge helpers.
 *
 * Phase 6B implements delete-safe, item-level scoped merge for
 * project.changeOrders. Phase 6F adds the same scoped tombstone merge pattern
 * for project.rfis. This module is intentionally pure: no React, localStorage,
 * Supabase client, or side effects.
 */
import type { BackupData, ChangeOrder } from './backupDataService'

const EPOCH_FALLBACK_ISO = '1970-01-01T00:00:00.000Z'

export function isValidDateString(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  return !Number.isNaN(Date.parse(trimmed))
}

export function parseTimestampMs(value: unknown): number {
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

export function normalizeChangeOrderCreatedAt(co: any): string {
  if (isValidDateString(co?.createdAt)) return String(co.createdAt)
  if (isValidDateString(co?.approvalAt)) return String(co.approvalAt)
  return EPOCH_FALLBACK_ISO
}

export function normalizeChangeOrderUpdatedAt(co: any): string {
  let base: string
  if (isValidDateString(co?.updatedAt)) base = String(co.updatedAt)
  else if (isValidDateString(co?.approvalAt)) base = String(co.approvalAt)
  else if (isValidDateString(co?.createdAt)) base = String(co.createdAt)
  else base = EPOCH_FALLBACK_ISO

  if (isValidDateString(co?.deletedAt) && parseTimestampMs(co.deletedAt) > parseTimestampMs(base)) {
    return String(co.deletedAt)
  }

  return base
}

export type MergeableChangeOrder = ChangeOrder & {
  updatedAt: string
  deletedAt?: string
  deletedBy?: string
}

export function sanitizeChangeOrderForMerge(co: any): MergeableChangeOrder | null {
  const id = String(co?.id || '').trim()
  if (!id) return null
  return {
    ...co,
    id,
    createdAt: normalizeChangeOrderCreatedAt(co),
    updatedAt: normalizeChangeOrderUpdatedAt(co),
  } as MergeableChangeOrder
}

export function isDeletedChangeOrder(co: any): boolean {
  return isValidDateString(co?.deletedAt)
}

export function getLiveChangeOrders(changeOrders: any[]): ChangeOrder[] {
  const out: ChangeOrder[] = []
  for (const co of Array.isArray(changeOrders) ? changeOrders : []) {
    const clean = sanitizeChangeOrderForMerge(co)
    if (!clean || isDeletedChangeOrder(clean)) continue
    out.push(clean)
  }
  return out
}

export function createChangeOrderTombstone(existingCO: any, deletedBy?: string): ChangeOrder {
  const now = new Date().toISOString()
  const tombstone: any = {
    ...existingCO,
    deletedAt: now,
    updatedAt: now,
  }
  if (deletedBy) tombstone.deletedBy = deletedBy
  else if (existingCO?.deletedBy) tombstone.deletedBy = existingCO.deletedBy
  return tombstone
}

function pickChangeOrderWinner(
  remote: MergeableChangeOrder,
  incoming: MergeableChangeOrder,
): ChangeOrder {
  const remoteDeleted = isDeletedChangeOrder(remote)
  const incomingDeleted = isDeletedChangeOrder(incoming)

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

export function mergeChangeOrdersById(remoteItems: any[], incomingItems: any[]): ChangeOrder[] {
  const remoteSanitized = (Array.isArray(remoteItems) ? remoteItems : [])
    .map(sanitizeChangeOrderForMerge)
    .filter((co): co is MergeableChangeOrder => co != null)
  const incomingSanitized = (Array.isArray(incomingItems) ? incomingItems : [])
    .map(sanitizeChangeOrderForMerge)
    .filter((co): co is MergeableChangeOrder => co != null)

  const remoteById = new Map<string, MergeableChangeOrder>()
  for (const co of remoteSanitized) remoteById.set(String(co.id), co)

  const result: ChangeOrder[] = []
  const used = new Set<string>()

  for (const incoming of incomingSanitized) {
    const id = String(incoming.id)
    if (used.has(id)) continue
    used.add(id)
    const remote = remoteById.get(id)
    result.push(remote ? pickChangeOrderWinner(remote, incoming) : incoming)
  }

  for (const remote of remoteSanitized) {
    const id = String(remote.id)
    if (used.has(id)) continue
    used.add(id)
    result.push(remote)
  }

  return result
}

export function mergeProjectChangeOrdersIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
  projectId: string,
): BackupData {
  const merged = JSON.parse(JSON.stringify(remoteBackup)) as BackupData
  const targetId = String(projectId || '').trim()
  if (!targetId) return merged

  const remoteProjects = Array.isArray(merged.projects) ? merged.projects : []
  const remoteIndex = remoteProjects.findIndex((p: any) => String(p?.id || '') === targetId)
  if (remoteIndex === -1) return merged

  const incomingProjects = Array.isArray(incomingBackup?.projects) ? incomingBackup.projects : []
  const incomingProject: any = incomingProjects.find((p: any) => String(p?.id || '') === targetId)
  if (!incomingProject) return merged

  const remoteProject: any = remoteProjects[remoteIndex]
  const remoteCOs = Array.isArray(remoteProject.changeOrders) ? remoteProject.changeOrders : []
  const incomingCOs = Array.isArray(incomingProject.changeOrders) ? incomingProject.changeOrders : []

  remoteProject.changeOrders = mergeChangeOrdersById(remoteCOs, incomingCOs)
  return merged
}

export interface ProjectRFI {
  rfiId?: string
  rfiNumber?: string
  id?: string
  question?: string
  directedTo?: string
  submitted?: string
  createdAt?: string
  created_at?: string
  created?: string
  questionAt?: string
  response?: string
  answer?: string
  status?: string
  label?: string
  critical?: boolean
  updatedAt?: string
  deletedAt?: string
  deletedBy?: string
  [key: string]: any
}

export type RFIIdentityContext = {
  duplicateLegacyKeys: ReadonlySet<string>
}

export type MergeableProjectRFI = ProjectRFI & {
  rfiId: string
  updatedAt: string
}

function normalizeProjectId(projectId?: string): string {
  return String(projectId || '').trim() || 'unknown-project'
}

function normalizeRFIText(value: unknown): string {
  return String(value ?? '').trim()
}

function legacyRFIIdentityBase(rfi: any, projectId?: string): string {
  const legacyId = normalizeRFIText(rfi?.id || rfi?.rfiNumber || 'missing')
  return `legacy:${normalizeProjectId(projectId)}:${legacyId || 'missing'}`
}

function shortStableHash(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 8)
}

function stableRFIFingerprint(rfi: any): string {
  const parts = [
    rfi?.id,
    rfi?.rfiNumber,
    rfi?.question,
    rfi?.submitted,
    rfi?.createdAt,
    rfi?.created_at,
    rfi?.created,
    rfi?.questionAt,
    rfi?.response,
    rfi?.answer,
    rfi?.status,
    rfi?.label,
    rfi?.stageRecorded,
    rfi?.stageApplies,
    rfi?.directedTo,
  ].map(value => normalizeRFIText(value))
  return shortStableHash(parts.join('|'))
}

export function createRFIIdentityContext(rfis: any[], projectId?: string): RFIIdentityContext {
  const counts = new Map<string, number>()
  for (const rfi of Array.isArray(rfis) ? rfis : []) {
    if (normalizeRFIText(rfi?.rfiId)) continue
    const base = legacyRFIIdentityBase(rfi, projectId)
    counts.set(base, (counts.get(base) || 0) + 1)
  }

  const duplicateLegacyKeys = new Set<string>()
  for (const [base, count] of counts) {
    if (count > 1) duplicateLegacyKeys.add(base)
  }
  return { duplicateLegacyKeys }
}

export function getRFIStableId(
  rfi: any,
  projectId?: string,
  duplicateContext?: RFIIdentityContext,
): string {
  const existing = normalizeRFIText(rfi?.rfiId)
  if (existing) return existing

  const base = legacyRFIIdentityBase(rfi, projectId)
  if (duplicateContext?.duplicateLegacyKeys?.has(base)) {
    return `${base}:${stableRFIFingerprint(rfi)}`
  }
  return base
}

export function getRFIDisplayNumber(rfi: any): string {
  return normalizeRFIText(rfi?.rfiNumber || rfi?.id || 'RFI') || 'RFI'
}

export function normalizeRFIUpdatedAt(rfi: any): string {
  let base: string
  if (isValidDateString(rfi?.updatedAt)) base = String(rfi.updatedAt)
  else if (isValidDateString(rfi?.submitted)) base = String(rfi.submitted)
  else if (isValidDateString(rfi?.createdAt)) base = String(rfi.createdAt)
  else if (isValidDateString(rfi?.created_at)) base = String(rfi.created_at)
  else if (isValidDateString(rfi?.created)) base = String(rfi.created)
  else if (isValidDateString(rfi?.questionAt)) base = String(rfi.questionAt)
  else base = EPOCH_FALLBACK_ISO

  if (isValidDateString(rfi?.deletedAt) && parseTimestampMs(rfi.deletedAt) > parseTimestampMs(base)) {
    return String(rfi.deletedAt)
  }

  return base
}

export function sanitizeRFIForMerge(
  rfi: any,
  projectId?: string,
  duplicateContext?: RFIIdentityContext,
): MergeableProjectRFI | null {
  if (!rfi || typeof rfi !== 'object') return null
  const rfiId = getRFIStableId(rfi, projectId, duplicateContext)
  if (!rfiId) return null
  return {
    ...rfi,
    rfiId,
    rfiNumber: normalizeRFIText(rfi.rfiNumber || rfi.id) || undefined,
    updatedAt: normalizeRFIUpdatedAt(rfi),
  } as MergeableProjectRFI
}

export function isDeletedRFI(rfi: any): boolean {
  return isValidDateString(rfi?.deletedAt)
}

export function getLiveRFIs(rfis: any[], projectId?: string): ProjectRFI[] {
  const context = createRFIIdentityContext(rfis, projectId)
  const out: ProjectRFI[] = []
  for (const rfi of Array.isArray(rfis) ? rfis : []) {
    const clean = sanitizeRFIForMerge(rfi, projectId, context)
    if (!clean || isDeletedRFI(clean)) continue
    out.push(clean)
  }
  return out
}

export function createRFITombstone(
  existingRFI: any,
  projectId?: string,
  deletedBy?: string,
  duplicateContext?: RFIIdentityContext,
): ProjectRFI {
  const context = duplicateContext || createRFIIdentityContext([existingRFI], projectId)
  const clean = sanitizeRFIForMerge(existingRFI, projectId, context) || existingRFI || {}
  const now = new Date().toISOString()
  const tombstone: ProjectRFI = {
    ...clean,
    rfiId: getRFIStableId(clean, projectId, context),
    rfiNumber: normalizeRFIText(clean?.rfiNumber || clean?.id) || undefined,
    deletedAt: now,
    updatedAt: now,
  }
  if (deletedBy) tombstone.deletedBy = deletedBy
  else if (clean?.deletedBy) tombstone.deletedBy = clean.deletedBy
  return tombstone
}

function pickRFIWinner(
  remote: MergeableProjectRFI,
  incoming: MergeableProjectRFI,
): ProjectRFI {
  const remoteDeleted = isDeletedRFI(remote)
  const incomingDeleted = isDeletedRFI(incoming)

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

export function mergeRFIsByStableId(
  remoteItems: any[],
  incomingItems: any[],
  projectId?: string,
): ProjectRFI[] {
  const combinedContext = createRFIIdentityContext(
    [
      ...(Array.isArray(remoteItems) ? remoteItems : []),
      ...(Array.isArray(incomingItems) ? incomingItems : []),
    ],
    projectId,
  )
  const remoteSanitized = (Array.isArray(remoteItems) ? remoteItems : [])
    .map(rfi => sanitizeRFIForMerge(rfi, projectId, combinedContext))
    .filter((rfi): rfi is MergeableProjectRFI => rfi != null)
  const incomingSanitized = (Array.isArray(incomingItems) ? incomingItems : [])
    .map(rfi => sanitizeRFIForMerge(rfi, projectId, combinedContext))
    .filter((rfi): rfi is MergeableProjectRFI => rfi != null)

  const remoteById = new Map<string, MergeableProjectRFI>()
  for (const rfi of remoteSanitized) remoteById.set(String(rfi.rfiId), rfi)

  const result: ProjectRFI[] = []
  const used = new Set<string>()

  for (const incoming of incomingSanitized) {
    const id = String(incoming.rfiId)
    if (used.has(id)) continue
    used.add(id)
    const remote = remoteById.get(id)
    result.push(remote ? pickRFIWinner(remote, incoming) : incoming)
  }

  for (const remote of remoteSanitized) {
    const id = String(remote.rfiId)
    if (used.has(id)) continue
    used.add(id)
    result.push(remote)
  }

  return result
}

export function mergeProjectRFIsIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
  projectId: string,
): BackupData {
  const merged = JSON.parse(JSON.stringify(remoteBackup)) as BackupData
  const targetId = String(projectId || '').trim()
  if (!targetId) return merged

  const remoteProjects = Array.isArray(merged.projects) ? merged.projects : []
  const remoteIndex = remoteProjects.findIndex((p: any) => String(p?.id || '') === targetId)
  if (remoteIndex === -1) return merged

  const incomingProjects = Array.isArray(incomingBackup?.projects) ? incomingBackup.projects : []
  const incomingProject: any = incomingProjects.find((p: any) => String(p?.id || '') === targetId)
  if (!incomingProject) return merged

  const remoteProject: any = remoteProjects[remoteIndex]
  const remoteRFIs = Array.isArray(remoteProject.rfis) ? remoteProject.rfis : []
  const incomingRFIs = Array.isArray(incomingProject.rfis) ? incomingProject.rfis : []

  remoteProject.rfis = mergeRFIsByStableId(remoteRFIs, incomingRFIs, targetId)
  return merged
}
