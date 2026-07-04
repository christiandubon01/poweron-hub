/**
 * Project inner-scope merge helpers.
 *
 * Phase 6B implements delete-safe, item-level scoped merge for
 * project.changeOrders only. This module is intentionally pure: no React,
 * localStorage, Supabase client, or side effects.
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
