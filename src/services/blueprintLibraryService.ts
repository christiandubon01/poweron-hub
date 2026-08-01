// @ts-nocheck
import { supabase } from '@/lib/supabase'
import { getPageCount } from '@/services/blueprintExtractor'
import { SCOPE_REGISTRY, type DataScope } from '@/services/scopeRegistry'
import {
  parseBlueprintAnimationScene,
  sanitizeBlueprintAnimationSceneForStorage,
} from '@/features/blueprint-animation/sceneSchema'
import type {
  BlueprintScopeAnimationScene,
  BlueprintScopeAnimationSceneV1,
} from '@/features/blueprint-animation/types'
import {
  archiveWireProfile,
  createWireProfile,
  createWireProfileTombstone,
  duplicateWireProfile,
  resolveWireProfileStatus,
  restoreWireProfile,
  sanitizeWireProfile,
  updateWireProfile,
  type WireProfile,
  type WireProfileResolution,
} from '@/features/blueprint-wire-profiles'
import {
  findQuickAccessWireProfileReferences,
  mergeQuickAccessWireProfileBindingsBySlot,
  sanitizeQuickAccessWireProfileBindings,
  setQuickAccessWireProfileBinding,
  type BlueprintQuickAccessWireProfileBindings,
  type QuickAccessWireProfileBinding,
} from '@/features/blueprint-wire-profiles/profileAwareQuickAccess'
import {
  isValidWorkPackageOrderTimestamp,
  normalizeWorkPackageSortOrder,
  sortWorkPackages,
} from '@/features/blueprint-work-packages'

// Phase 5C: dev-only assertion that the registry descriptors still point at the
// concrete BackupData container keys these save paths write. Metadata sanity check
// only — console.warn, never throws, never blocks a save, no-op in production.
;(function assertBlueprintScopeDescriptors() {
  try {
    if (!import.meta.env.DEV) return
    const ann = SCOPE_REGISTRY['blueprint.annotations']?.dataPath || ''
    const wp = SCOPE_REGISTRY['blueprint.workPackages']?.dataPath || ''
    if (!ann.includes('operationsBlueprintAnnotations')) {
      console.warn('[ScopeRegistry] blueprint.annotations dataPath no longer references operationsBlueprintAnnotations:', ann)
    }
    if (!wp.includes('operationsBlueprintScopeLayers')) {
      console.warn('[ScopeRegistry] blueprint.workPackages dataPath no longer references operationsBlueprintScopeLayers:', wp)
    }
  } catch { /* dev-only diagnostics must never affect runtime */ }
})()

export type BlueprintLibraryType =
  | 'Full Set'
  | 'Electrical Only'
  | 'Plumbing Only'
  | 'Mechanical Only'
  | 'Reference Sheet'
  | 'Other'
export type BlueprintLibraryStatus = 'active' | 'archived'

export interface BlueprintSheetIndexItem {
  pageNumber: number
  sheetLabel?: string
  sheetNumber?: string
  sheetTitle?: string
  discipline?: string
  confidence?: number
  source?: 'manual' | 'auto'
  updatedAt?: string
}

export interface BlueprintLibraryItem {
  id: string
  projectId: string
  projectName: string
  title: string
  type: BlueprintLibraryType
  status: BlueprintLibraryStatus
  source: 'operations_blueprint_ai'
  storagePath: string
  fileName: string
  fileSize: number
  pageCount: number
  pagesWithNotes: number
  sheetIndex: BlueprintSheetIndexItem[]
  annotationsSummary: string
  parentBlueprintSetId?: string
  sourcePageNumbers?: number[]
  derivedFrom?: 'operations_blueprint_ai'
  derivationKind?: 'subset_pages'
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  deletedAt?: string
  deletedBy?: string
}

export interface BlueprintAnnotationPoint {
  x: number
  y: number
}

export interface BlueprintAnnotationRect {
  x: number
  y: number
  w: number
  h: number
}

export interface BlueprintAnnotation {
  id: string
  blueprintSetId: string
  projectId: string
  pageNumber: number
  type: 'note' | 'highlight' | 'textHighlight' | 'freehand' | 'arrow' | 'cloud' | 'textBox' | 'callout' | 'generate' | 'pen' | 'marker' | 'underline' | 'shape' | 'calibrate' | 'measure-distance' | 'measure-area' | 'measure-perimeter'
  rect?: BlueprintAnnotationRect
  path?: BlueprintAnnotationPoint[]
  text?: string
  color: string
  meta?: Record<string, any>
  metadata?: Record<string, any>
  createdAt: string
  updatedAt: string
  // Phase 5E: soft-delete tombstone. Presence of deletedAt marks the item deleted.
  // Tombstones stay in the raw arrays so item-level merge can beat a stale live copy
  // on another tab/device. Public accessors filter these out so the UI never renders them.
  deletedAt?: string
  deletedBy?: string
}

export interface BlueprintScopeItemRef {
  annotationId: string
  pageNumber: number
  label: string
  shapeKind?: string
  category?: string
  countValue?: number
}

export interface BlueprintScopeLayer {
  id: string
  name: string
  description: string
  color: string
  selectedAnnotationIds: string[]
  itemRefs: BlueprintScopeItemRef[]
  pageNumber?: number
  roughInHours: number
  trimHours: number
  testingHours: number
  cleanupHours: number
  crewNotes: string
  proposalSummary: string
  createdAt: string
  updatedAt: string
  sortOrder?: number
  orderTouchedAt?: string
  visible: boolean
  isolated: boolean
  animationScene?: BlueprintScopeAnimationScene
  /** Last explicit scene save revision, retained when the scene is intentionally removed. */
  animationSceneRevision?: number
  // Phase 5E: soft-delete tombstone (see BlueprintAnnotation.deletedAt).
  deletedAt?: string
  deletedBy?: string
}

export const MAX_BLUEPRINT_FILE_SIZE_BYTES = 512 * 1024 * 1024

function toSafeFileName(name: string): string {
  return name.replace(/[^\w.\-() ]+/g, '_')
}

export function validateBlueprintPdf(file: File): { ok: boolean; error?: string } {
  if (!file) return { ok: false, error: 'Please choose a file.' }
  const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf'
  if (!isPdf) return { ok: false, error: 'Only PDF files are accepted.' }
  if (file.size <= 0) {
    return {
      ok: false,
      error: 'The selected PDF is empty.',
    }
  }
  if (file.size > MAX_BLUEPRINT_FILE_SIZE_BYTES) {
    return { ok: false, error: 'File too large. Maximum size is 512 MB. Please compress the PDF and try again.' }
  }
  return { ok: true }
}

export async function uploadBlueprintPdfToStorage(params: {
  file: File
  projectId: string
  orgId?: string | null
}): Promise<{ storagePath: string }> {
  const { file, projectId } = params

  const { data: userData, error: userError } = await supabase.auth.getUser()
  const userId = userData?.user?.id || null

  if (userError || !userId) {
    throw new Error('Could not verify user for blueprint upload.')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('org_id')
    .eq('id', userId)
    .maybeSingle()

  if (profileError || !profile?.org_id) {
    throw new Error('Could not resolve organization for blueprint upload.')
  }

  const orgId = String(profile.org_id)
  const cleanProjectId = String(projectId || '').trim()

  if (!cleanProjectId) {
    throw new Error('Missing project id for blueprint upload.')
  }

  const id = `bp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const storagePath = `${orgId}/${cleanProjectId}/blueprints/${id}_${toSafeFileName(file.name)}`

  console.log('[BlueprintAI] Uploading blueprint to storage path:', storagePath)

  const { error } = await supabase.storage
    .from('blueprints')
    .upload(storagePath, file, {
      contentType: 'application/pdf',
      upsert: false,
    })

  if (error) {
    throw new Error(error.message || 'Supabase Storage upload failed.')
  }

  return { storagePath }
}

export async function cleanupBlueprintStorageObject(storagePath: string): Promise<void> {
  const cleanPath = String(storagePath || '').trim()
  if (!cleanPath) return
  try {
    const { error } = await supabase.storage.from('blueprints').remove([cleanPath])
    if (error) {
      console.warn('[BlueprintAI] Orphan cleanup failed:', error.message || error)
    }
  } catch (err: any) {
    console.warn('[BlueprintAI] Orphan cleanup threw:', err?.message || err)
  }
}

export async function deleteBlueprintStorageObjectStrict(storagePath: string): Promise<void> {
  const cleanPath = String(storagePath || '').trim()
  if (!cleanPath) {
    throw new Error('Missing storagePath for blueprint file deletion.')
  }
  const { error } = await supabase.storage.from('blueprints').remove([cleanPath])
  if (error) {
    throw new Error(error.message || 'Failed to delete blueprint PDF from storage.')
  }
}

export async function createBlueprintLibraryItem(params: {
  file: File
  projectId: string
  projectName: string
  title: string
  type: BlueprintLibraryType
  storagePath: string
}): Promise<BlueprintLibraryItem> {
  const { file, projectId, projectName, title, type, storagePath } = params
  let pageCount = 0
  try {
    pageCount = await getPageCount(file)
  } catch {
    pageCount = 0
  }

  const now = new Date().toISOString()
  return {
    id: `ops_bp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    projectId,
    projectName,
    title: title.trim(),
    type,
    status: 'active',
    source: 'operations_blueprint_ai',
    storagePath,
    fileName: file.name,
    fileSize: file.size,
    pageCount,
    pagesWithNotes: 0,
    sheetIndex: [],
    annotationsSummary: '',
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  }
}

export function getOperationsBlueprintLibraryRaw(backup: any): BlueprintLibraryItem[] {
  const items = backup?.blueprintSummaries?.operationsBlueprintLibrary
  return mergeOperationsBlueprintLibraryById([], Array.isArray(items) ? items : [])
}

export function getOperationsBlueprintLibrary(backup: any): BlueprintLibraryItem[] {
  return getLiveBlueprintSetRecords(getOperationsBlueprintLibraryRaw(backup)) as BlueprintLibraryItem[]
}

export function getBlueprintSheetIndex(blueprint: any): BlueprintSheetIndexItem[] {
  const raw = blueprint?.sheetIndex
  if (!Array.isArray(raw)) return []
  const normalized = raw
    .map((item: any) => ({
      pageNumber: Math.max(1, Math.floor(Number(item?.pageNumber) || 1)),
      sheetLabel: item?.sheetLabel ? String(item.sheetLabel) : undefined,
      sheetNumber: item?.sheetNumber ? String(item.sheetNumber) : (item?.sheetLabel ? String(item.sheetLabel) : undefined),
      sheetTitle: item?.sheetTitle ? String(item.sheetTitle) : undefined,
      discipline: item?.discipline ? String(item.discipline) : undefined,
      confidence: Number.isFinite(Number(item?.confidence)) ? Number(item.confidence) : undefined,
      source: item?.source === 'auto' ? 'auto' : (item?.source === 'manual' ? 'manual' : undefined),
      updatedAt: item?.updatedAt ? String(item.updatedAt) : undefined,
    }))
    .sort((a: any, b: any) => a.pageNumber - b.pageNumber)
  return normalized
}

export function getBlueprintSheetIndexSummary(blueprint: any): {
  total: number
  byDiscipline: Record<string, number>
} {
  const list = getBlueprintSheetIndex(blueprint)
  const byDiscipline: Record<string, number> = {}
  for (const row of list) {
    const key = String(row.discipline || 'Uncategorized')
    byDiscipline[key] = (byDiscipline[key] || 0) + 1
  }
  return { total: list.length, byDiscipline }
}

export async function saveOperationsBlueprintLibrary(backup: any, items: BlueprintLibraryItem[]): Promise<void> {
  if (!backup.blueprintSummaries || typeof backup.blueprintSummaries !== 'object') {
    backup.blueprintSummaries = {}
  }
  const existingRaw = getOperationsBlueprintLibraryRaw(backup)
  backup.blueprintSummaries.operationsBlueprintLibrary = mergeOperationsBlueprintLibraryById(existingRaw, items)
  backup._lastSavedAt = new Date().toISOString()
  const { saveBackupDataAndSyncNow } = await import('@/services/backupDataService')
  const result = await saveBackupDataAndSyncNow(backup, 'blueprintSummaries')
  if (!result.success) {
    throw new Error(result.error || 'Failed to sync blueprint library updates.')
  }
  try { window.dispatchEvent(new Event('storage')) } catch { /* ignore */ }
  try { window.dispatchEvent(new Event('poweron-data-saved')) } catch { /* ignore */ }
}

export async function deleteOperationsBlueprintSet(backup: any, blueprintSetId: string): Promise<void> {
  const list = getOperationsBlueprintLibraryRaw(backup)
  let deletedBy: string | null = null
  try {
    const { data } = await supabase.auth.getUser()
    deletedBy = data?.user?.id || null
  } catch { /* deletedBy is best-effort */ }
  const nextLibrary = list.map((item) => {
    if (item.id !== blueprintSetId) return item
    const tombstone = createBlueprintSetTombstone(item, deletedBy)
    return {
      ...tombstone,
      status: 'archived' as BlueprintLibraryStatus,
      archivedAt: tombstone.deletedAt || tombstone.updatedAt,
    }
  })

  if (!backup.blueprintSummaries || typeof backup.blueprintSummaries !== 'object') {
    backup.blueprintSummaries = {}
  }
  backup.blueprintSummaries.operationsBlueprintLibrary = nextLibrary

  const annotations = backup.blueprintSummaries.operationsBlueprintAnnotations
  if (annotations && typeof annotations === 'object' && !Array.isArray(annotations)) {
    delete annotations[blueprintSetId]
  }

  const scopeLayers = backup.blueprintSummaries.operationsBlueprintScopeLayers
  if (scopeLayers && typeof scopeLayers === 'object' && !Array.isArray(scopeLayers)) {
    delete scopeLayers[blueprintSetId]
  }

  backup._lastSavedAt = new Date().toISOString()
  const { saveBackupDataAndSyncNow } = await import('@/services/backupDataService')
  const result = await saveBackupDataAndSyncNow(backup, 'blueprintSummaries')
  if (!result.success) {
    throw new Error(result.error || 'Failed to sync blueprint delete.')
  }
  try { window.dispatchEvent(new Event('storage')) } catch { /* ignore */ }
  try { window.dispatchEvent(new Event('poweron-data-saved')) } catch { /* ignore */ }
}

export async function upsertBlueprintSheetIndexItem(
  backup: any,
  blueprintSetId: string,
  item: BlueprintSheetIndexItem
): Promise<void> {
  const list = getOperationsBlueprintLibrary(backup)
  const targetIndex = list.findIndex((x) => x.id === blueprintSetId)
  if (targetIndex < 0) {
    throw new Error('Blueprint set not found for sheet index update.')
  }

  const target = list[targetIndex]
  const nextSheetIndex = getBlueprintSheetIndex(target)
  const pageNumber = Math.max(1, Math.floor(Number(item?.pageNumber) || 1))
  const idx = nextSheetIndex.findIndex((x) => x.pageNumber === pageNumber)
  const row: BlueprintSheetIndexItem = {
    pageNumber,
    sheetNumber: item?.sheetNumber ? String(item.sheetNumber).trim() : undefined,
    sheetLabel: item?.sheetNumber ? String(item.sheetNumber).trim() : undefined,
    sheetTitle: item?.sheetTitle ? String(item.sheetTitle).trim() : undefined,
    discipline: item?.discipline ? String(item.discipline).trim() : undefined,
    confidence: Number.isFinite(Number(item?.confidence)) ? Number(item.confidence) : undefined,
    source: item?.source === 'auto' ? 'auto' : 'manual',
    updatedAt: item?.updatedAt || new Date().toISOString(),
  }
  if (idx >= 0) nextSheetIndex[idx] = row
  else nextSheetIndex.push(row)
  nextSheetIndex.sort((a, b) => a.pageNumber - b.pageNumber)

  const nextLibrary = list.map((entry) =>
    entry.id === blueprintSetId
      ? { ...entry, sheetIndex: nextSheetIndex, updatedAt: new Date().toISOString() }
      : entry
  )
  await saveOperationsBlueprintLibrary(backup, nextLibrary as BlueprintLibraryItem[])
}

export async function deleteBlueprintSheetIndexItem(
  backup: any,
  blueprintSetId: string,
  pageNumber: number
): Promise<void> {
  const list = getOperationsBlueprintLibrary(backup)
  const target = list.find((x) => x.id === blueprintSetId)
  if (!target) {
    throw new Error('Blueprint set not found for sheet index delete.')
  }
  const p = Math.max(1, Math.floor(Number(pageNumber) || 1))
  const nextSheetIndex = getBlueprintSheetIndex(target).filter((x) => x.pageNumber !== p)
  const nextLibrary = list.map((entry) =>
    entry.id === blueprintSetId
      ? { ...entry, sheetIndex: nextSheetIndex, updatedAt: new Date().toISOString() }
      : entry
  )
  await saveOperationsBlueprintLibrary(backup, nextLibrary as BlueprintLibraryItem[])
}

export async function mergeDetectedSheetIndexRows(
  backup: any,
  blueprintSetId: string,
  detectedRows: BlueprintSheetIndexItem[],
  mode: 'fill-empty' | 'replace-auto' | 'replace-manual',
  options?: { confirmReplaceManual?: boolean }
): Promise<void> {
  const list = getOperationsBlueprintLibrary(backup)
  const target = list.find((x) => x.id === blueprintSetId)
  if (!target) throw new Error('Blueprint set not found for sheet index merge.')
  if (mode === 'replace-manual' && !options?.confirmReplaceManual) {
    throw new Error('Manual row replacement requires explicit confirmation.')
  }

  const existing = getBlueprintSheetIndex(target)
  const existingByPage = new Map<number, BlueprintSheetIndexItem>()
  for (const row of existing) existingByPage.set(row.pageNumber, row)

  const normalizedDetected = (Array.isArray(detectedRows) ? detectedRows : [])
    .map((r) => ({
      pageNumber: Math.max(1, Math.floor(Number(r?.pageNumber) || 1)),
      sheetNumber: r?.sheetNumber ? String(r.sheetNumber).trim() : undefined,
      sheetLabel: r?.sheetNumber ? String(r.sheetNumber).trim() : (r?.sheetLabel ? String(r.sheetLabel).trim() : undefined),
      sheetTitle: r?.sheetTitle ? String(r.sheetTitle).trim() : undefined,
      discipline: r?.discipline ? String(r.discipline).trim() : undefined,
      confidence: Number.isFinite(Number(r?.confidence)) ? Number(r.confidence) : undefined,
      source: 'auto' as const,
      updatedAt: r?.updatedAt || new Date().toISOString(),
    }))
    .filter((r) => r.sheetNumber || r.sheetTitle || r.discipline)

  for (const incoming of normalizedDetected) {
    const current = existingByPage.get(incoming.pageNumber)
    if (!current) {
      existingByPage.set(incoming.pageNumber, incoming)
      continue
    }

    const currentIsManual = current.source === 'manual'
    const currentHasData = !!(String(current.sheetNumber || current.sheetLabel || '').trim() || String(current.sheetTitle || '').trim())

    if (mode === 'fill-empty') {
      if (currentIsManual) continue
      if (!currentHasData) {
        existingByPage.set(incoming.pageNumber, { ...current, ...incoming, source: 'auto', updatedAt: new Date().toISOString() })
      }
      continue
    }

    if (mode === 'replace-auto') {
      if (currentIsManual) continue
      existingByPage.set(incoming.pageNumber, { ...current, ...incoming, source: 'auto', updatedAt: new Date().toISOString() })
      continue
    }

    if (mode === 'replace-manual') {
      existingByPage.set(incoming.pageNumber, { ...current, ...incoming, source: 'auto', updatedAt: new Date().toISOString() })
    }
  }

  const merged = Array.from(existingByPage.values()).sort((a, b) => a.pageNumber - b.pageNumber)
  const nextLibrary = list.map((entry) =>
    entry.id === blueprintSetId
      ? { ...entry, sheetIndex: merged, updatedAt: new Date().toISOString() }
      : entry
  )
  await saveOperationsBlueprintLibrary(backup, nextLibrary as BlueprintLibraryItem[])
}

export async function getBlueprintSignedUrl(storagePath: string, expiresIn = 900): Promise<string> {
  const cleanPath = String(storagePath || '').trim()
  if (!cleanPath) {
    throw new Error('Missing blueprint storage path.')
  }

  const ttl = Number.isFinite(expiresIn) ? Math.max(60, Math.min(3600, Math.floor(expiresIn))) : 900
  const { data, error } = await supabase.storage
    .from('blueprints')
    .createSignedUrl(cleanPath, ttl)

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'Could not create a signed URL for this blueprint.')
  }

  return data.signedUrl
}

// ── Phase 5E: timestamp normalization + item-level merge (delete-safe) ──────────
// Pure, local to this service. No React, no Supabase, no side effects.

const EPOCH_FALLBACK_ISO = '1970-01-01T00:00:00.000Z'

function isValidDateString(value: any): boolean {
  if (typeof value !== 'string' || !value.trim()) return false
  return Number.isFinite(Date.parse(value))
}

function parseTimestampMs(value: any): number {
  if (typeof value !== 'string') return NaN
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : NaN
}

// Ops blueprint ids embed a 13-digit ms epoch (e.g. ann_1699999999999_ab, scope_1699999999999_ab).
// Recover a stable timestamp from the id so legacy rows don't fall back to a fabricated "now".
function timestampFromId(id: any): string | null {
  if (typeof id !== 'string') return null
  const m = id.match(/(\d{13})/)
  if (!m) return null
  const ms = Number(m[1])
  if (!Number.isFinite(ms) || ms <= 0) return null
  try { return new Date(ms).toISOString() } catch { return null }
}

// createdAt fallback chain: valid createdAt → timestamp parsed from id → stable epoch.
// Deliberately NEVER defaults to now(): new items already carry a real createdAt from the
// UI, and defaulting legacy rows to now() would make them look freshly edited (and beat
// real deletes during merge).
function normalizeCreatedAt(raw: any): string {
  if (isValidDateString(raw?.createdAt)) return String(raw.createdAt)
  const fromId = timestampFromId(raw?.id)
  if (fromId) return fromId
  return EPOCH_FALLBACK_ISO
}

// updatedAt fallback chain: valid updatedAt → normalized createdAt → stable epoch.
// Also NEVER defaults to now(); a tombstone's updatedAt is bumped to at least deletedAt
// so a delete deterministically beats an equal-or-older live edit during merge.
function normalizeUpdatedAt(raw: any, createdAtResolved: string): string {
  let updatedAt = isValidDateString(raw?.updatedAt) ? String(raw.updatedAt) : createdAtResolved
  if (isValidDateString(raw?.deletedAt) && parseTimestampMs(raw.deletedAt) > parseTimestampMs(updatedAt)) {
    updatedAt = String(raw.deletedAt)
  }
  return updatedAt
}

type TombstonedItem = { id: string; updatedAt: string; deletedAt?: string }

// Resolve which of two same-id items wins. Tombstones (deletedAt) beat an equal-or-older
// live edit; a strictly newer live edit (updatedAt > deletedAt) is treated as a genuine
// re-edit/undelete and wins. On exact live-vs-live ties, remote wins (deterministic +
// avoids clock-skew flip-flop). Returns the winning item.
function resolveMergeWinner<T extends TombstonedItem>(remote: T, incoming: T): T {
  const remoteDeleted = isValidDateString(remote.deletedAt)
  const incomingDeleted = isValidDateString(incoming.deletedAt)

  if (remoteDeleted && incomingDeleted) {
    // Both tombstones: keep the newest deletedAt (tie → remote).
    return parseTimestampMs(incoming.deletedAt) > parseTimestampMs(remote.deletedAt) ? incoming : remote
  }
  if (remoteDeleted || incomingDeleted) {
    const tomb = remoteDeleted ? remote : incoming
    const live = remoteDeleted ? incoming : remote
    const liveMs = parseTimestampMs(live.updatedAt)
    const tombMs = parseTimestampMs(tomb.deletedAt)
    // Live wins only if strictly newer than the delete; tie or older → tombstone wins.
    return liveMs > tombMs ? live : tomb
  }
  // Both live: newest updatedAt wins; exact tie → remote (deterministic).
  return parseTimestampMs(incoming.updatedAt) > parseTimestampMs(remote.updatedAt) ? incoming : remote
}

// Generic id-keyed, delete-safe merge preserving tombstones in the raw output.
// Order: incoming order first (so a local reorder survives), then remote-only ids appended
// in remote order. Ordering never affects which version wins — that is decided per id by
// resolveMergeWinner — so delete-safety is independent of order. Items without an id are
// kept (appended, incoming then remote) rather than dropped.
function mergeItemsById<T extends TombstonedItem>(remoteItems: T[], incomingItems: T[]): T[] {
  const remoteById = new Map<string, T>()
  const remoteNoId: T[] = []
  const remoteOrder: string[] = []
  for (const item of Array.isArray(remoteItems) ? remoteItems : []) {
    const id = String((item as any)?.id || '').trim()
    if (!id) { remoteNoId.push(item); continue }
    if (!remoteById.has(id)) remoteOrder.push(id)
    remoteById.set(id, item)
  }

  const out: T[] = []
  const emitted = new Set<string>()
  const incomingNoId: T[] = []
  for (const item of Array.isArray(incomingItems) ? incomingItems : []) {
    const id = String((item as any)?.id || '').trim()
    if (!id) { incomingNoId.push(item); continue }
    if (emitted.has(id)) continue
    const remote = remoteById.get(id)
    out.push(remote ? resolveMergeWinner(remote, item) : item)
    emitted.add(id)
  }
  for (const id of remoteOrder) {
    if (emitted.has(id)) continue
    out.push(remoteById.get(id) as T)
    emitted.add(id)
  }
  return [...out, ...incomingNoId, ...remoteNoId]
}

function sanitizeBlueprintSetRecord(raw: any): TombstonedItem & Record<string, any> | null {
  if (!raw || typeof raw !== 'object') return null
  const id = String(raw.id || '').trim()
  if (!id) return null
  const createdAt = isValidDateString(raw.createdAt)
    ? String(raw.createdAt)
    : (isValidDateString(raw.uploadDate) ? String(raw.uploadDate) : normalizeCreatedAt(raw))
  const updatedAt = normalizeUpdatedAt(raw, createdAt)
  const deletedAt = isValidDateString(raw.deletedAt) ? String(raw.deletedAt) : undefined
  const deletedBy = deletedAt && raw.deletedBy != null ? String(raw.deletedBy) : undefined
  return {
    ...raw,
    id,
    createdAt,
    updatedAt,
    ...(deletedAt ? { deletedAt } : {}),
    ...(deletedBy ? { deletedBy } : {}),
  }
}

/** Shared delete-safe record union for Operations and legacy project blueprint lists. */
export function mergeBlueprintSetRecordsById<T extends Record<string, any>>(
  remoteItems: T[],
  incomingItems: T[],
): T[] {
  const remote = (Array.isArray(remoteItems) ? remoteItems : [])
    .map(sanitizeBlueprintSetRecord)
    .filter(Boolean) as Array<TombstonedItem & T>
  const incoming = (Array.isArray(incomingItems) ? incomingItems : [])
    .map(sanitizeBlueprintSetRecord)
    .filter(Boolean) as Array<TombstonedItem & T>
  return mergeItemsById(remote, incoming) as T[]
}

export function getLiveBlueprintSetRecords<T extends Record<string, any>>(items: T[]): T[] {
  return (Array.isArray(items) ? items : [])
    .map(sanitizeBlueprintSetRecord)
    .filter((item): item is TombstonedItem & T => !!item && !item.deletedAt) as T[]
}

export function createBlueprintSetTombstone<T extends Record<string, any>>(
  existing: T,
  deletedBy?: string | null,
): T {
  const now = new Date().toISOString()
  return {
    ...existing,
    deletedAt: now,
    updatedAt: now,
    ...(deletedBy ? { deletedBy } : {}),
  }
}

export function mergeOperationsBlueprintLibraryById(
  remoteItems: any[],
  incomingItems: any[],
): BlueprintLibraryItem[] {
  return mergeBlueprintSetRecordsById(remoteItems, incomingItems) as BlueprintLibraryItem[]
}

export function mergeBlueprintAnnotationsById(
  remoteItems: any[],
  incomingItems: any[],
): BlueprintAnnotation[] {
  const remote = (Array.isArray(remoteItems) ? remoteItems : []).map(sanitizeAnnotation).filter(Boolean) as BlueprintAnnotation[]
  const incoming = (Array.isArray(incomingItems) ? incomingItems : []).map(sanitizeAnnotation).filter(Boolean) as BlueprintAnnotation[]
  return mergeItemsById(remote as TombstonedItem[], incoming as TombstonedItem[]) as unknown as BlueprintAnnotation[]
}

export function mergeBlueprintWireProfilesById(
  remoteItems: any[],
  incomingItems: any[],
): WireProfile[] {
  const remote = (Array.isArray(remoteItems) ? remoteItems : []).map(sanitizeWireProfile).filter(Boolean) as WireProfile[]
  const incoming = (Array.isArray(incomingItems) ? incomingItems : []).map(sanitizeWireProfile).filter(Boolean) as WireProfile[]
  return mergeItemsById(remote as TombstonedItem[], incoming as TombstonedItem[]) as unknown as WireProfile[]
}

/** Per-slot LWW merge for project-scoped Quick Access Wire Profile bindings. */
export function mergeBlueprintQuickAccessWireProfileBindings(
  remoteRaw: unknown,
  incomingRaw: unknown,
): BlueprintQuickAccessWireProfileBindings {
  return mergeQuickAccessWireProfileBindingsBySlot(remoteRaw, incomingRaw)
}

function stableOrderCandidateSignature(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableOrderCandidateSignature).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableOrderCandidateSignature(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function resolveScopeLayerOrderFields(
  contentWinner: BlueprintScopeLayer,
  remoteLayer?: BlueprintScopeLayer,
  incomingLayer?: BlueprintScopeLayer,
): Pick<BlueprintScopeLayer, 'sortOrder' | 'orderTouchedAt'> {
  const remoteOrder = normalizeWorkPackageSortOrder(remoteLayer?.sortOrder)
  const incomingOrder = normalizeWorkPackageSortOrder(incomingLayer?.sortOrder)
  const remoteTouchedAt = isValidWorkPackageOrderTimestamp(remoteLayer?.orderTouchedAt)
    ? String(remoteLayer?.orderTouchedAt)
    : undefined
  const incomingTouchedAt = isValidWorkPackageOrderTimestamp(incomingLayer?.orderTouchedAt)
    ? String(incomingLayer?.orderTouchedAt)
    : undefined

  if (remoteTouchedAt && incomingTouchedAt) {
    return Date.parse(incomingTouchedAt) > Date.parse(remoteTouchedAt)
      ? { sortOrder: incomingOrder, orderTouchedAt: incomingTouchedAt }
      : { sortOrder: remoteOrder, orderTouchedAt: remoteTouchedAt }
  }
  if (remoteTouchedAt) return { sortOrder: remoteOrder, orderTouchedAt: remoteTouchedAt }
  if (incomingTouchedAt) return { sortOrder: incomingOrder, orderTouchedAt: incomingTouchedAt }
  if (remoteOrder != null && incomingOrder != null) {
    const remoteUpdatedAt = parseTimestampMs(remoteLayer?.updatedAt)
    const incomingUpdatedAt = parseTimestampMs(incomingLayer?.updatedAt)
    if (remoteUpdatedAt !== incomingUpdatedAt) {
      return { sortOrder: incomingUpdatedAt > remoteUpdatedAt ? incomingOrder : remoteOrder }
    }
    const remoteSignature = stableOrderCandidateSignature(remoteLayer)
    const incomingSignature = stableOrderCandidateSignature(incomingLayer)
    if (remoteSignature !== incomingSignature) {
      return { sortOrder: incomingSignature > remoteSignature ? incomingOrder : remoteOrder }
    }
    return { sortOrder: Math.min(remoteOrder, incomingOrder) }
  }
  if (remoteOrder != null) return { sortOrder: remoteOrder }
  if (incomingOrder != null) return { sortOrder: incomingOrder }
  return {}
}

export function mergeBlueprintScopeLayersById(
  remoteItems: any[],
  incomingItems: any[],
): BlueprintScopeLayer[] {
  const remote = (Array.isArray(remoteItems) ? remoteItems : []).map(sanitizeScopeLayer).filter(Boolean) as BlueprintScopeLayer[]
  const incoming = (Array.isArray(incomingItems) ? incomingItems : []).map(sanitizeScopeLayer).filter(Boolean) as BlueprintScopeLayer[]
  const merged = mergeItemsById(remote as TombstonedItem[], incoming as TombstonedItem[]) as unknown as BlueprintScopeLayer[]
  const remoteById = new Map(remote.map((layer) => [layer.id, layer]))
  const incomingById = new Map(incoming.map((layer) => [layer.id, layer]))

  return merged.map((layer) => {
    const remoteLayer = remoteById.get(layer.id)
    const incomingLayer = incomingById.get(layer.id)
    const orderFields = resolveScopeLayerOrderFields(layer, remoteLayer, incomingLayer)
    const remoteScene = remoteLayer?.animationScene
    const incomingScene = incomingLayer?.animationScene
    const remoteRevision = Math.max(
      0,
      Math.floor(Number(remoteLayer?.animationSceneRevision) || 0),
      remoteScene?.schemaVersion === 1 ? Math.floor(Number((remoteScene as BlueprintScopeAnimationSceneV1).revision) || 0) : 0,
    )
    const incomingRevision = Math.max(
      0,
      Math.floor(Number(incomingLayer?.animationSceneRevision) || 0),
      incomingScene?.schemaVersion === 1 ? Math.floor(Number((incomingScene as BlueprintScopeAnimationSceneV1).revision) || 0) : 0,
    )
    let animationScene: BlueprintScopeAnimationScene | undefined

    const remoteUnsupported = !!remoteScene && remoteScene.schemaVersion !== 1
    const incomingUnsupported = !!incomingScene && incomingScene.schemaVersion !== 1
    if (remoteUnsupported || incomingUnsupported) {
      // Unsupported scenes are opaque and read-only. Never let a schema-v1 or absent value
      // downgrade one; if both are future schemas, retain the higher version (remote on ties).
      if (remoteScene && incomingScene) {
        animationScene = Number(incomingScene.schemaVersion) > Number(remoteScene.schemaVersion)
          ? incomingScene
          : remoteScene
      } else {
        animationScene = incomingScene || remoteScene
      }
    } else if (remoteRevision !== incomingRevision) {
      // A newer revision marker with no scene represents an intentional scene removal.
      animationScene = incomingRevision > remoteRevision ? incomingScene : remoteScene
    } else if (remoteScene && incomingScene) {
      const remoteParsed = parseBlueprintAnimationScene(remoteScene)
      const incomingParsed = parseBlueprintAnimationScene(incomingScene)
      if (remoteParsed.status === 'supported' && incomingParsed.status === 'supported') {
        // Scene revisions, not package metadata timestamps, own nested-scene concurrency.
        // Equal revisions prefer remote deterministically because legitimate scene edits increment.
        animationScene = incomingParsed.scene.revision > remoteParsed.scene.revision
          ? incomingScene
          : remoteScene
      } else {
        animationScene = remoteScene
      }
    } else {
      // Equal explicit revisions are concurrent; remote wins deterministically. A metadata-only
      // omission has revision zero and is handled by the unequal-revision branch above.
      animationScene = remoteScene
    }

    const next = { ...layer }
    if (orderFields.sortOrder != null) next.sortOrder = orderFields.sortOrder
    else delete (next as any).sortOrder
    if (orderFields.orderTouchedAt) next.orderTouchedAt = orderFields.orderTouchedAt
    else delete (next as any).orderTouchedAt
    if (layer.deletedAt) return next
    if (animationScene) next.animationScene = animationScene
    else delete (next as any).animationScene
    const latestRevision = Math.max(remoteRevision, incomingRevision)
    if (latestRevision > 0) next.animationSceneRevision = latestRevision
    else delete (next as any).animationSceneRevision
    return next
  })
}

function normalizeRect(rect?: BlueprintAnnotationRect): BlueprintAnnotationRect | undefined {
  if (!rect || typeof rect !== 'object') return undefined
  const x = Number(rect.x)
  const y = Number(rect.y)
  const w = Number(rect.w)
  const h = Number(rect.h)
  if (![x, y, w, h].every(Number.isFinite)) return undefined
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
    w: Math.max(0, Math.min(1, w)),
    h: Math.max(0, Math.min(1, h)),
  }
}

function sanitizeAnnotation(raw: any): BlueprintAnnotation | null {
  if (!raw || typeof raw !== 'object') return null
  const id = String(raw.id || '').trim()
  const blueprintSetId = String(raw.blueprintSetId || '').trim()
  const projectId = String(raw.projectId || '').trim()
  const pageNumber = Number(raw.pageNumber)
  const type = String(raw.type || '') as BlueprintAnnotation['type']
  const color = String(raw.color || '#facc15')
  if (!id || !blueprintSetId || !projectId || !Number.isFinite(pageNumber) || pageNumber < 1) return null
  if (!['note', 'highlight', 'textHighlight', 'freehand', 'arrow', 'cloud', 'textBox', 'callout', 'generate', 'pen', 'marker', 'underline', 'shape', 'calibrate', 'measure-distance', 'measure-area', 'measure-perimeter'].includes(type)) return null
  const rect = normalizeRect(raw.rect)
  const path = Array.isArray(raw.path)
    ? raw.path
      .map((p: any) => ({ x: Number(p?.x), y: Number(p?.y) }))
      .filter((p: any) => Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p: any) => ({
        x: Math.max(0, Math.min(1, p.x)),
        y: Math.max(0, Math.min(1, p.y)),
      }))
    : undefined
  // Phase 5E: stable timestamp fallback (never fabricate now() for legacy rows).
  const createdAt = normalizeCreatedAt(raw)
  const updatedAt = normalizeUpdatedAt(raw, createdAt)
  const deletedAt = isValidDateString(raw.deletedAt) ? String(raw.deletedAt) : undefined
  const deletedBy = deletedAt && raw.deletedBy != null ? String(raw.deletedBy) : undefined

  return {
    id,
    blueprintSetId,
    projectId,
    pageNumber: Math.floor(pageNumber),
    type,
    rect,
    path,
    text: raw.text == null ? undefined : String(raw.text),
    color,
    meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : undefined,
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : undefined,
    createdAt,
    updatedAt,
    // Tombstone fields preserved so item-level merge keeps deletes; UI accessors filter these.
    ...(deletedAt ? { deletedAt } : {}),
    ...(deletedBy ? { deletedBy } : {}),
  }
}

function getAnnotationsContainer(backup: any): Record<string, BlueprintAnnotation[]> {
  if (!backup.blueprintSummaries || typeof backup.blueprintSummaries !== 'object') {
    backup.blueprintSummaries = {}
  }
  const raw = backup.blueprintSummaries.operationsBlueprintAnnotations
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    backup.blueprintSummaries.operationsBlueprintAnnotations = {}
  }
  return backup.blueprintSummaries.operationsBlueprintAnnotations
}

/**
 * Phase 5E: raw accessor — returns sanitized annotations INCLUDING tombstones
 * (deletedAt present). Merge/save code needs to see tombstones; the UI must not.
 */
export function getOperationsBlueprintAnnotationsRaw(backup: any, blueprintSetId: string): BlueprintAnnotation[] {
  const container = getAnnotationsContainer(backup || {})
  const rawList = container?.[blueprintSetId]
  if (!Array.isArray(rawList)) return []
  return rawList.map(sanitizeAnnotation).filter(Boolean) as BlueprintAnnotation[]
}

export function getOperationsBlueprintAnnotations(backup: any, blueprintSetId: string): BlueprintAnnotation[] {
  // Public/UI accessor: hide tombstoned items.
  return getOperationsBlueprintAnnotationsRaw(backup, blueprintSetId).filter((a) => !a.deletedAt)
}

function applyAnnotationsToBackup(
  targetBackup: any,
  blueprintSetId: string,
  annotations: BlueprintAnnotation[],
): any {
  // Phase 5E: item-level, delete-safe merge onto the target's existing (raw) array for
  // this set only. `annotations` (incoming) may include tombstones (from the delete path);
  // any tombstone already on the target survives the union. Other sets and other BackupData
  // branches are untouched. Replaces the previous whole-array overwrite.
  const merged = JSON.parse(JSON.stringify(targetBackup || {}))
  const container = getAnnotationsContainer(merged)
  const existingRaw = Array.isArray(container[blueprintSetId]) ? container[blueprintSetId] : []
  container[blueprintSetId] = mergeBlueprintAnnotationsById(existingRaw, Array.isArray(annotations) ? annotations : [])
  return merged
}

export async function saveOperationsBlueprintAnnotations(
  backup: any,
  blueprintSetId: string,
  annotations: BlueprintAnnotation[],
): Promise<SaveBlueprintAnnotationsResult> {
  // Phase 5C: scope metadata only. Does NOT change merge/save/stale/baseline behavior.
  const SCOPE: DataScope = 'blueprint.annotations'

  const sanitized = (Array.isArray(annotations) ? annotations : [])
    .map(sanitizeAnnotation)
    .filter(Boolean) as BlueprintAnnotation[]

  const {
    getBackupData,
    getActiveTenantUserId,
    isSupabaseConfigured,
    saveBackupData,
    saveBackupDataAndSyncNow,
    saveBackupWithRemoteBaselineSync,
    fetchLatestRemoteBackup,
    isLocalDevOrigin,
  } = await import('@/services/backupDataService')

  const userId = getActiveTenantUserId()
  // Prefer latest local backup so a stale caller snapshot cannot overwrite newer local branches.
  const localBase = getBackupData() || backup
  if (!localBase) {
    return { localSaved: false, cloudSynced: false, error: 'No local backup data available.' }
  }

  const notifyLocalAnnotationsSaved = () => {
    try { window.dispatchEvent(new Event('storage')) } catch { /* ignore */ }
    try { window.dispatchEvent(new Event('poweron-data-saved')) } catch { /* ignore */ }
  }

  const confirmLocalAnnotationIds = (expected: BlueprintAnnotation[]): boolean => {
    const readBack = getBackupData()
    if (!readBack) return false
    const raw = getOperationsBlueprintAnnotationsRaw(readBack, blueprintSetId)
    const byId = new Map(raw.map((a) => [a.id, a]))
    for (const ann of expected) {
      const id = String(ann?.id || '').trim()
      if (!id) continue
      if (!byId.has(id)) return false
    }
    return true
  }

  // LOCAL-FIRST: write annotations to localStorage BEFORE any remote await.
  // Otherwise a live/realtime refresh can apply a stale Android-labeled row while the
  // new annotation exists only in React state — merge cannot preserve what is not in
  // the backup yet, and loadAnnotations() later wipes the optimistic UI.
  const localMerged = applyAnnotationsToBackup(localBase, blueprintSetId, sanitized)
  localMerged._lastSavedAt = new Date().toISOString()
  // Suppress notify until readback confirms the annotation ids landed in the correct set.
  saveBackupData(localMerged, userId || undefined, { notify: false })

  if (!confirmLocalAnnotationIds(sanitized)) {
    return {
      localSaved: false,
      cloudSynced: false,
      error: 'Local annotation save could not be verified in backup.',
    }
  }
  notifyLocalAnnotationsSaved()

  const localOnlyWarning = (detail?: string): SaveBlueprintAnnotationsResult => ({
    localSaved: true,
    cloudSynced: false,
    warning: isLocalDevOrigin()
      ? (detail
        ? `Annotations saved locally. Cloud sync blocked: ${detail}`
        : 'Annotations saved locally. Localhost cloud sync blocked while remote is newer.')
      : (detail
        ? `Annotations saved locally. Cloud sync will retry shortly. (${detail})`
        : 'Annotations saved locally. Cloud sync will retry shortly.'),
  })

  if (!isSupabaseConfigured()) {
    return localOnlyWarning('Supabase not configured')
  }

  const remote = await fetchLatestRemoteBackup(userId || undefined)

  if (remote.error) {
    console.warn('[Annotations] Remote fetch failed — local-only save', remote.error)
    // Local write already confirmed + notified; cloud failure must not force a stale reload.
    return localOnlyWarning(remote.error)
  }

  // Re-read local after the await so concurrent applies/merges are included in the push.
  const latestLocal = getBackupData() || localMerged
  const latestList = getOperationsBlueprintAnnotationsRaw(latestLocal, blueprintSetId)

  if (!remote.hasRemoteRow || !remote.remoteData) {
    const merged = applyAnnotationsToBackup(latestLocal, blueprintSetId, latestList)
    const result = await saveBackupDataAndSyncNow(merged, 'blueprintSummaries', { source: 'annotations-first-sync', _scopes: [SCOPE] })
    if (result.success) {
      notifyLocalAnnotationsSaved()
      return { localSaved: true, cloudSynced: true }
    }
    return {
      localSaved: true,
      cloudSynced: false,
      warning: result.error || 'Annotations saved locally. Cloud sync did not complete.',
      error: result.error,
    }
  }

  const mergedFromRemote = applyAnnotationsToBackup(remote.remoteData, blueprintSetId, latestList)
  const result = await saveBackupWithRemoteBaselineSync(
    mergedFromRemote,
    {
      remoteUpdatedAt: remote.remoteUpdatedAt,
      remoteDataLastSavedAt: remote.remoteDataLastSavedAt,
    },
    { source: 'annotations-remote-merge', _scopes: [SCOPE] },
  )

  if (result.success) {
    notifyLocalAnnotationsSaved()
    return { localSaved: true, cloudSynced: true }
  }

  if (result.blocked || result.conflict) {
    // Local remains valid; do not dispatch a save event that would reload from a
    // remote-newer blocked path's unmerged snapshot.
    try { window.dispatchEvent(new Event('storage')) } catch { /* ignore */ }
    return {
      localSaved: true,
      cloudSynced: false,
      warning: result.error || 'Annotations saved locally. Cloud sync paused because remote is newer.',
    }
  }

  return {
    localSaved: result.localSaved !== false,
    cloudSynced: false,
    warning: result.error || 'Annotations saved locally. Cloud sync did not complete.',
    error: result.error || 'Failed to sync blueprint annotations.',
  }
}

export type SaveBlueprintAnnotationsResult = {
  localSaved: boolean
  cloudSynced: boolean
  warning?: string
  error?: string
}

export async function upsertOperationsBlueprintAnnotation(backup: any, annotation: BlueprintAnnotation): Promise<SaveBlueprintAnnotationsResult> {
  const clean = sanitizeAnnotation(annotation)
  if (!clean) return { localSaved: false, cloudSynced: false, error: 'Invalid annotation.' }
  const list = getOperationsBlueprintAnnotations(backup, clean.blueprintSetId)
  const idx = list.findIndex(a => a.id === clean.id)
  if (idx >= 0) list[idx] = clean
  else list.push(clean)
  return saveOperationsBlueprintAnnotations(backup, clean.blueprintSetId, list)
}

export async function deleteOperationsBlueprintAnnotation(
  backup: any,
  blueprintSetId: string,
  annotationId: string
): Promise<SaveBlueprintAnnotationsResult> {
  // Phase 5E: soft-delete. Instead of dropping the item, mark a tombstone so a stale
  // live copy on another tab/device cannot resurrect it during item-level merge.
  const raw = getOperationsBlueprintAnnotationsRaw(backup, blueprintSetId)
  const now = new Date().toISOString()
  let userId: string | null = null
  try {
    const { getActiveTenantUserId } = await import('@/services/backupDataService')
    userId = getActiveTenantUserId()
  } catch { /* deletedBy is best-effort; never block a delete on it */ }

  const existing = raw.find(a => a.id === annotationId)
  let next: BlueprintAnnotation[]
  if (existing) {
    next = raw.map(a => a.id === annotationId
      ? { ...a, deletedAt: now, updatedAt: now, ...(userId ? { deletedBy: userId } : {}) }
      : a)
  } else {
    // Not found locally — no required fields to synthesize a valid tombstone. Re-save the
    // current raw list (no-op for data) so the caller still gets a normal result shape.
    console.warn('[Annotations] delete: annotation not found; nothing to tombstone', { blueprintSetId, annotationId })
    next = raw
  }
  return saveOperationsBlueprintAnnotations(backup, blueprintSetId, next)
}

export function getOperationsBlueprintAnnotationSummary(backup: any, blueprintSetId: string): {
  total: number
  pagesWithAnnotations: number
  byPage: Record<number, number>
} {
  const list = getOperationsBlueprintAnnotations(backup, blueprintSetId)
  const byPage: Record<number, number> = {}
  for (const a of list) {
    const p = Math.max(1, Math.floor(Number(a.pageNumber) || 1))
    byPage[p] = (byPage[p] || 0) + 1
  }
  return {
    total: list.length,
    pagesWithAnnotations: Object.keys(byPage).length,
    byPage,
  }
}

function getWireProfilesContainer(backup: any): Record<string, WireProfile[]> {
  if (!backup.blueprintSummaries || typeof backup.blueprintSummaries !== 'object') {
    backup.blueprintSummaries = {}
  }
  const raw = backup.blueprintSummaries.operationsBlueprintWireProfiles
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    backup.blueprintSummaries.operationsBlueprintWireProfiles = {}
  }
  return backup.blueprintSummaries.operationsBlueprintWireProfiles
}

export function getOperationsBlueprintWireProfilesRaw(backup: any, projectId: string): WireProfile[] {
  const cleanProjectId = String(projectId || '').trim()
  if (!cleanProjectId) return []
  const container = getWireProfilesContainer(backup || {})
  const rawList = container?.[cleanProjectId]
  if (!Array.isArray(rawList)) return []
  return rawList.map(sanitizeWireProfile).filter(Boolean) as WireProfile[]
}

export function getOperationsBlueprintWireProfiles(backup: any, projectId: string): WireProfile[] {
  return getOperationsBlueprintWireProfilesRaw(backup, projectId).filter((profile) => !profile.deletedAt)
}

export function getOperationsBlueprintWireProfileById(backup: any, projectId: string, profileId: string): WireProfile | undefined {
  const id = String(profileId || '').trim()
  if (!id) return undefined
  return getOperationsBlueprintWireProfilesRaw(backup, projectId).find((profile) => profile.id === id && !profile.deletedAt)
}

export function resolveOperationsBlueprintWireProfile(backup: any, projectId: string, profileId: string | null | undefined): WireProfileResolution {
  return resolveWireProfileStatus(profileId, getOperationsBlueprintWireProfilesRaw(backup, projectId))
}

function applyWireProfilesToBackup(targetBackup: any, projectId: string, profiles: WireProfile[]): any {
  const merged = JSON.parse(JSON.stringify(targetBackup || {}))
  const container = getWireProfilesContainer(merged)
  const existingRaw = Array.isArray(container[projectId]) ? container[projectId] : []
  container[projectId] = mergeBlueprintWireProfilesById(existingRaw, Array.isArray(profiles) ? profiles : [])
  return merged
}

export async function saveOperationsBlueprintWireProfiles(
  backup: any,
  projectId: string,
  profiles: WireProfile[],
): Promise<SaveBlueprintAnnotationsResult> {
  const SCOPE: DataScope = 'blueprint.wireProfiles'
  const cleanProjectId = String(projectId || '').trim()
  if (!cleanProjectId) return { localSaved: false, cloudSynced: false, error: 'Missing project id.' }
  const sanitized = (Array.isArray(profiles) ? profiles : []).map(sanitizeWireProfile).filter(Boolean) as WireProfile[]

  const {
    getBackupData,
    getActiveTenantUserId,
    isSupabaseConfigured,
    saveBackupData,
    saveBackupDataAndSyncNow,
    saveBackupWithRemoteBaselineSync,
    fetchLatestRemoteBackup,
    isLocalDevOrigin,
  } = await import('@/services/backupDataService')

  const userId = getActiveTenantUserId()
  const localBase = getBackupData() || backup
  if (!localBase) return { localSaved: false, cloudSynced: false, error: 'No local backup data available.' }

  const notifyLocalProfilesSaved = () => {
    try { window.dispatchEvent(new Event('storage')) } catch { /* ignore */ }
    try { window.dispatchEvent(new Event('poweron-data-saved')) } catch { /* ignore */ }
  }
  const localMerged = applyWireProfilesToBackup(localBase, cleanProjectId, sanitized)
  localMerged._lastSavedAt = new Date().toISOString()
  saveBackupData(localMerged, userId || undefined, { notify: false })
  notifyLocalProfilesSaved()

  const localOnlyWarning = (detail?: string): SaveBlueprintAnnotationsResult => ({
    localSaved: true,
    cloudSynced: false,
    warning: isLocalDevOrigin()
      ? (detail ? `Wire profiles saved locally. Cloud sync blocked: ${detail}` : 'Wire profiles saved locally. Localhost cloud sync blocked while remote is newer.')
      : (detail ? `Wire profiles saved locally. Cloud sync will retry shortly. (${detail})` : 'Wire profiles saved locally. Cloud sync will retry shortly.'),
  })

  if (!isSupabaseConfigured()) return localOnlyWarning('Supabase not configured')

  const remote = await fetchLatestRemoteBackup(userId || undefined)
  if (remote.error) {
    console.warn('[WireProfiles] Remote fetch failed - local-only save', remote.error)
    return localOnlyWarning(remote.error)
  }

  const latestLocal = getBackupData() || localMerged
  const latestList = getOperationsBlueprintWireProfilesRaw(latestLocal, cleanProjectId)

  if (!remote.hasRemoteRow || !remote.remoteData) {
    const merged = applyWireProfilesToBackup(latestLocal, cleanProjectId, latestList)
    const result = await saveBackupDataAndSyncNow(merged, 'blueprintSummaries', { source: 'wire-profiles-first-sync', _scopes: [SCOPE] })
    return result.success
      ? { localSaved: true, cloudSynced: true }
      : { localSaved: true, cloudSynced: false, warning: result.error || 'Wire profiles saved locally. Cloud sync did not complete.', error: result.error }
  }

  const mergedFromRemote = applyWireProfilesToBackup(remote.remoteData, cleanProjectId, latestList)
  const result = await saveBackupWithRemoteBaselineSync(
    mergedFromRemote,
    {
      remoteUpdatedAt: remote.remoteUpdatedAt,
      remoteDataLastSavedAt: remote.remoteDataLastSavedAt,
    },
    { source: 'wire-profiles-remote-merge', _scopes: [SCOPE] },
  )

  if (result.success) return { localSaved: true, cloudSynced: true }
  return {
    localSaved: result.localSaved !== false,
    cloudSynced: false,
    warning: result.error || 'Wire profiles saved locally. Cloud sync did not complete.',
    error: result.error || 'Failed to sync wire profiles.',
  }
}

export async function createOperationsBlueprintWireProfile(backup: any, input: Parameters<typeof createWireProfile>[0]): Promise<SaveBlueprintAnnotationsResult & { profile?: WireProfile }> {
  const profile = createWireProfile(input)
  const list = getOperationsBlueprintWireProfiles(backup, profile.projectId)
  const result = await saveOperationsBlueprintWireProfiles(backup, profile.projectId, [...list, profile])
  return { ...result, profile }
}

export async function upsertOperationsBlueprintWireProfile(backup: any, profile: WireProfile): Promise<SaveBlueprintAnnotationsResult> {
  const clean = sanitizeWireProfile(profile)
  if (!clean) return { localSaved: false, cloudSynced: false, error: 'Invalid wire profile.' }
  const raw = getOperationsBlueprintWireProfilesRaw(backup, clean.projectId)
  const idx = raw.findIndex((item) => item.id === clean.id)
  const next = idx >= 0
    ? raw.map((item) => item.id === clean.id ? clean : item)
    : [...raw, clean]
  return saveOperationsBlueprintWireProfiles(backup, clean.projectId, next)
}

export async function updateOperationsBlueprintWireProfile(backup: any, projectId: string, profileId: string, patch: Partial<WireProfile>): Promise<SaveBlueprintAnnotationsResult & { profile?: WireProfile }> {
  const existing = getOperationsBlueprintWireProfileById(backup, projectId, profileId)
  if (!existing) return { localSaved: false, cloudSynced: false, error: 'Wire profile not found.' }
  const profile = updateWireProfile(existing, patch)
  const result = await upsertOperationsBlueprintWireProfile(backup, profile)
  return { ...result, profile }
}

export async function duplicateOperationsBlueprintWireProfile(backup: any, projectId: string, profileId: string): Promise<SaveBlueprintAnnotationsResult & { profile?: WireProfile }> {
  const existing = getOperationsBlueprintWireProfileById(backup, projectId, profileId)
  if (!existing) return { localSaved: false, cloudSynced: false, error: 'Wire profile not found.' }
  const profile = duplicateWireProfile(existing)
  const list = getOperationsBlueprintWireProfiles(backup, projectId)
  const result = await saveOperationsBlueprintWireProfiles(backup, projectId, [...list, profile])
  return { ...result, profile }
}

export async function archiveOperationsBlueprintWireProfile(backup: any, projectId: string, profileId: string): Promise<SaveBlueprintAnnotationsResult> {
  const existing = getOperationsBlueprintWireProfileById(backup, projectId, profileId)
  if (!existing) return { localSaved: false, cloudSynced: false, error: 'Wire profile not found.' }
  return upsertOperationsBlueprintWireProfile(backup, archiveWireProfile(existing))
}

export async function restoreOperationsBlueprintWireProfile(backup: any, projectId: string, profileId: string): Promise<SaveBlueprintAnnotationsResult> {
  const existing = getOperationsBlueprintWireProfileById(backup, projectId, profileId)
  if (!existing) return { localSaved: false, cloudSynced: false, error: 'Wire profile not found.' }
  return upsertOperationsBlueprintWireProfile(backup, restoreWireProfile(existing))
}

export function identifyOperationsBlueprintWireProfileReferences(backup: any, projectId: string, profileId: string): BlueprintAnnotation[] {
  const id = String(profileId || '').trim()
  const cleanProjectId = String(projectId || '').trim()
  if (!id || !cleanProjectId) return []
  const annotationMap = backup?.blueprintSummaries?.operationsBlueprintAnnotations
  if (!annotationMap || typeof annotationMap !== 'object' || Array.isArray(annotationMap)) return []
  const refs: BlueprintAnnotation[] = []
  for (const rawList of Object.values(annotationMap)) {
    if (!Array.isArray(rawList)) continue
    for (const annotation of rawList.map(sanitizeAnnotation).filter(Boolean) as BlueprintAnnotation[]) {
      if (annotation.projectId !== cleanProjectId || annotation.deletedAt) continue
      const meta = annotation.meta && typeof annotation.meta === 'object'
        ? annotation.meta
        : annotation.metadata && typeof annotation.metadata === 'object'
          ? annotation.metadata
          : {}
      const defaultId = String(meta.wireProfileId || '').trim()
      const segmentIds = Array.isArray(meta.segmentWireProfileIds)
        ? meta.segmentWireProfileIds.map((entry: any) => String(entry || '').trim())
        : []
      if (defaultId === id || segmentIds.includes(id)) refs.push(annotation)
    }
  }
  return refs
}

function getQuickAccessWireProfileBindingsContainer(backup: any): BlueprintQuickAccessWireProfileBindings {
  if (!backup.blueprintSummaries || typeof backup.blueprintSummaries !== 'object') {
    backup.blueprintSummaries = {}
  }
  const raw = backup.blueprintSummaries.operationsBlueprintQuickAccessWireProfileBindings
  const sanitized = sanitizeQuickAccessWireProfileBindings(raw)
  backup.blueprintSummaries.operationsBlueprintQuickAccessWireProfileBindings = sanitized
  return sanitized
}

/**
 * Project-scoped Quick Access → Wire Profile bindings.
 * Visual Quick Access presets remain device-local (localStorage); only these
 * profile IDs synchronize through BackupData / desktop↔iPad sync.
 */
export function getOperationsBlueprintQuickAccessWireProfileBindings(
  backup: any,
): BlueprintQuickAccessWireProfileBindings {
  return sanitizeQuickAccessWireProfileBindings(
    backup?.blueprintSummaries?.operationsBlueprintQuickAccessWireProfileBindings,
  )
}

export function getOperationsBlueprintQuickAccessWireProfileBindingsForProject(
  backup: any,
  projectId: string,
): Record<string, QuickAccessWireProfileBinding> {
  const cleanProjectId = String(projectId || '').trim()
  if (!cleanProjectId) return {}
  return getOperationsBlueprintQuickAccessWireProfileBindings(backup)[cleanProjectId] || {}
}

export function getOperationsBlueprintQuickAccessWireProfileBinding(
  backup: any,
  projectId: string,
  slotKey: string,
): string | null {
  const entry = getOperationsBlueprintQuickAccessWireProfileBindingsForProject(backup, projectId)[String(slotKey || '').trim()]
  if (!entry) return null
  return entry.wireProfileId == null ? null : String(entry.wireProfileId).trim() || null
}

export function identifyOperationsBlueprintQuickAccessWireProfileReferences(
  backup: any,
  projectId: string,
  profileId: string,
): string[] {
  return findQuickAccessWireProfileReferences(
    getOperationsBlueprintQuickAccessWireProfileBindings(backup),
    projectId,
    profileId,
  )
}

function applyQuickAccessWireProfileBindingsToBackup(
  targetBackup: any,
  bindings: BlueprintQuickAccessWireProfileBindings,
): any {
  const merged = JSON.parse(JSON.stringify(targetBackup || {}))
  if (!merged.blueprintSummaries || typeof merged.blueprintSummaries !== 'object') {
    merged.blueprintSummaries = {}
  }
  const existing = sanitizeQuickAccessWireProfileBindings(
    merged.blueprintSummaries.operationsBlueprintQuickAccessWireProfileBindings,
  )
  merged.blueprintSummaries.operationsBlueprintQuickAccessWireProfileBindings =
    mergeBlueprintQuickAccessWireProfileBindings(existing, bindings)
  return merged
}

export async function saveOperationsBlueprintQuickAccessWireProfileBindings(
  backup: any,
  projectId: string,
  projectBindings: Record<string, QuickAccessWireProfileBinding | string | null>,
): Promise<SaveBlueprintAnnotationsResult> {
  const SCOPE: DataScope = 'blueprint.wireProfiles'
  const cleanProjectId = String(projectId || '').trim()
  if (!cleanProjectId) return { localSaved: false, cloudSynced: false, error: 'Missing project id.' }

  let nextBindings = getOperationsBlueprintQuickAccessWireProfileBindings(backup || {})
  const now = new Date().toISOString()
  for (const [slotKey, value] of Object.entries(projectBindings || {})) {
    const wireProfileId = value && typeof value === 'object'
      ? (value as QuickAccessWireProfileBinding).wireProfileId
      : value as string | null
    const updatedAt = value && typeof value === 'object' && (value as QuickAccessWireProfileBinding).updatedAt
      ? (value as QuickAccessWireProfileBinding).updatedAt
      : now
    nextBindings = setQuickAccessWireProfileBinding(nextBindings, cleanProjectId, slotKey, wireProfileId, updatedAt)
  }

  const {
    getBackupData,
    getActiveTenantUserId,
    isSupabaseConfigured,
    saveBackupData,
    saveBackupDataAndSyncNow,
    saveBackupWithRemoteBaselineSync,
    fetchLatestRemoteBackup,
    isLocalDevOrigin,
  } = await import('@/services/backupDataService')

  const userId = getActiveTenantUserId()
  const localBase = getBackupData() || backup
  if (!localBase) return { localSaved: false, cloudSynced: false, error: 'No local backup data available.' }

  const notifyLocalBindingsSaved = () => {
    try { window.dispatchEvent(new Event('storage')) } catch { /* ignore */ }
    try { window.dispatchEvent(new Event('poweron-data-saved')) } catch { /* ignore */ }
  }

  // Merge only this project's slot map into the latest local container (omit-safe).
  const latestLocalBindings = getOperationsBlueprintQuickAccessWireProfileBindings(localBase)
  const projectOnly: BlueprintQuickAccessWireProfileBindings = {
    [cleanProjectId]: nextBindings[cleanProjectId] || {},
  }
  const localMerged = applyQuickAccessWireProfileBindingsToBackup(localBase, projectOnly)
  // Ensure the saved project map reflects the caller's intended slot set (including clears).
  getQuickAccessWireProfileBindingsContainer(localMerged)
  localMerged.blueprintSummaries.operationsBlueprintQuickAccessWireProfileBindings = mergeBlueprintQuickAccessWireProfileBindings(
    latestLocalBindings,
    projectOnly,
  )
  localMerged._lastSavedAt = new Date().toISOString()
  saveBackupData(localMerged, userId || undefined, { notify: false })
  notifyLocalBindingsSaved()

  const localOnlyWarning = (detail?: string): SaveBlueprintAnnotationsResult => ({
    localSaved: true,
    cloudSynced: false,
    warning: isLocalDevOrigin()
      ? (detail ? `Quick Access wire bindings saved locally. Cloud sync blocked: ${detail}` : 'Quick Access wire bindings saved locally. Localhost cloud sync blocked while remote is newer.')
      : (detail ? `Quick Access wire bindings saved locally. Cloud sync will retry shortly. (${detail})` : 'Quick Access wire bindings saved locally. Cloud sync will retry shortly.'),
  })

  if (!isSupabaseConfigured()) return localOnlyWarning('Supabase not configured')

  const remote = await fetchLatestRemoteBackup(userId || undefined)
  if (remote.error) {
    console.warn('[QuickAccessWireBindings] Remote fetch failed - local-only save', remote.error)
    return localOnlyWarning(remote.error)
  }

  const latestAfterLocal = getBackupData() || localMerged
  const latestBindings = getOperationsBlueprintQuickAccessWireProfileBindings(latestAfterLocal)

  if (!remote.hasRemoteRow || !remote.remoteData) {
    const merged = applyQuickAccessWireProfileBindingsToBackup(latestAfterLocal, latestBindings)
    const result = await saveBackupDataAndSyncNow(merged, 'blueprintSummaries', { source: 'quick-access-wire-bindings-first-sync', _scopes: [SCOPE] })
    return result.success
      ? { localSaved: true, cloudSynced: true }
      : { localSaved: true, cloudSynced: false, warning: result.error || 'Quick Access wire bindings saved locally. Cloud sync did not complete.', error: result.error }
  }

  const mergedFromRemote = applyQuickAccessWireProfileBindingsToBackup(remote.remoteData, latestBindings)
  const result = await saveBackupWithRemoteBaselineSync(
    mergedFromRemote,
    {
      remoteUpdatedAt: remote.remoteUpdatedAt,
      remoteDataLastSavedAt: remote.remoteDataLastSavedAt,
    },
    { source: 'quick-access-wire-bindings-remote-merge', _scopes: [SCOPE] },
  )

  if (result.success) return { localSaved: true, cloudSynced: true }
  return {
    localSaved: result.localSaved !== false,
    cloudSynced: false,
    warning: result.error || 'Quick Access wire bindings saved locally. Cloud sync did not complete.',
    error: result.error || 'Failed to sync Quick Access wire bindings.',
  }
}

export async function saveOperationsBlueprintQuickAccessWireProfileBinding(
  backup: any,
  projectId: string,
  slotKey: string,
  wireProfileId: string | null,
): Promise<SaveBlueprintAnnotationsResult> {
  const now = new Date().toISOString()
  return saveOperationsBlueprintQuickAccessWireProfileBindings(backup, projectId, {
    [slotKey]: { wireProfileId, updatedAt: now },
  })
}

export async function deleteUnreferencedOperationsBlueprintWireProfile(
  backup: any,
  projectId: string,
  profileId: string,
): Promise<SaveBlueprintAnnotationsResult> {
  const existing = getOperationsBlueprintWireProfileById(backup, projectId, profileId)
  if (!existing) return { localSaved: false, cloudSynced: false, error: 'Wire profile not found.' }
  const annotationRefs = identifyOperationsBlueprintWireProfileReferences(backup, projectId, profileId)
  const quickAccessRefs = identifyOperationsBlueprintQuickAccessWireProfileReferences(backup, projectId, profileId)
  if (annotationRefs.length > 0 || quickAccessRefs.length > 0) {
    return { localSaved: false, cloudSynced: false, error: 'Referenced wire profiles cannot be hard-deleted.' }
  }
  return upsertOperationsBlueprintWireProfile(backup, createWireProfileTombstone(existing))
}

function coerceScopeLayerHours(value: any): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function sanitizeScopeItemRef(raw: any): BlueprintScopeItemRef | null {
  if (!raw || typeof raw !== 'object') return null
  const annotationId = String(raw.annotationId || '').trim()
  if (!annotationId) return null
  const pageNumber = Math.max(1, Math.floor(Number(raw.pageNumber) || 1))
  const label = String(raw.label || 'Item').trim() || 'Item'
  const ref: BlueprintScopeItemRef = { annotationId, pageNumber, label }
  if (raw.shapeKind) ref.shapeKind = String(raw.shapeKind)
  if (raw.category) ref.category = String(raw.category)
  if (raw.countValue != null && Number.isFinite(Number(raw.countValue))) {
    ref.countValue = Number(raw.countValue)
  }
  return ref
}

function sanitizeScopeLayer(raw: any): BlueprintScopeLayer | null {
  if (!raw || typeof raw !== 'object') return null
  const id = String(raw.id || '').trim()
  const name = String(raw.name || '').trim()
  if (!id || !name) return null

  const selectedAnnotationIds = Array.isArray(raw.selectedAnnotationIds)
    ? raw.selectedAnnotationIds.map((entry: any) => String(entry || '').trim()).filter(Boolean)
    : []

  const itemRefs = Array.isArray(raw.itemRefs)
    ? (raw.itemRefs.map(sanitizeScopeItemRef).filter(Boolean) as BlueprintScopeItemRef[])
    : []

  let pageNumber: number | undefined
  if (raw.pageNumber != null && Number.isFinite(Number(raw.pageNumber)) && Number(raw.pageNumber) >= 1) {
    pageNumber = Math.floor(Number(raw.pageNumber))
  } else if (itemRefs.length > 0 && Number.isFinite(itemRefs[0].pageNumber) && itemRefs[0].pageNumber >= 1) {
    pageNumber = itemRefs[0].pageNumber
  }

  // Phase 5E: stable timestamp fallback + tombstone preservation (see sanitizeAnnotation).
  const createdAt = normalizeCreatedAt(raw)
  const updatedAt = normalizeUpdatedAt(raw, createdAt)
  const deletedAt = isValidDateString(raw.deletedAt) ? String(raw.deletedAt) : undefined
  const deletedBy = deletedAt && raw.deletedBy != null ? String(raw.deletedBy) : undefined
  const sortOrder = normalizeWorkPackageSortOrder(raw.sortOrder)
  const orderTouchedAt = isValidWorkPackageOrderTimestamp(raw.orderTouchedAt)
    ? String(raw.orderTouchedAt)
    : undefined
  const animationScene = sanitizeBlueprintAnimationSceneForStorage(raw.animationScene)
  const animationSceneRevision = Number.isInteger(Number(raw.animationSceneRevision))
    && Number(raw.animationSceneRevision) > 0
    ? Number(raw.animationSceneRevision)
    : undefined

  return {
    id,
    name,
    description: String(raw.description || ''),
    color: String(raw.color || '#38bdf8'),
    selectedAnnotationIds,
    itemRefs,
    pageNumber,
    roughInHours: coerceScopeLayerHours(raw.roughInHours),
    trimHours: coerceScopeLayerHours(raw.trimHours),
    testingHours: coerceScopeLayerHours(raw.testingHours),
    cleanupHours: coerceScopeLayerHours(raw.cleanupHours),
    crewNotes: String(raw.crewNotes || ''),
    proposalSummary: String(raw.proposalSummary || ''),
    createdAt,
    updatedAt,
    ...(sortOrder != null ? { sortOrder } : {}),
    ...(orderTouchedAt ? { orderTouchedAt } : {}),
    visible: raw.visible === false ? false : true,
    isolated: raw.isolated === true,
    ...(animationScene ? { animationScene } : {}),
    ...(animationSceneRevision ? { animationSceneRevision } : {}),
    ...(deletedAt ? { deletedAt } : {}),
    ...(deletedBy ? { deletedBy } : {}),
  }
}

function getScopeLayersContainer(backup: any): Record<string, BlueprintScopeLayer[]> {
  if (!backup.blueprintSummaries || typeof backup.blueprintSummaries !== 'object') {
    backup.blueprintSummaries = {}
  }
  const raw = backup.blueprintSummaries.operationsBlueprintScopeLayers
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    backup.blueprintSummaries.operationsBlueprintScopeLayers = {}
  }
  return backup.blueprintSummaries.operationsBlueprintScopeLayers
}

/**
 * Phase 5E: raw accessor — returns sanitized scope layers INCLUDING tombstones.
 * Merge/save code needs to see tombstones; the UI must not.
 */
export function getOperationsBlueprintScopeLayersRaw(backup: any, blueprintSetId: string): BlueprintScopeLayer[] {
  const container = getScopeLayersContainer(backup || {})
  const rawList = container?.[blueprintSetId]
  if (!Array.isArray(rawList)) return []
  return rawList.map(sanitizeScopeLayer).filter(Boolean) as BlueprintScopeLayer[]
}

export function getOperationsBlueprintScopeLayers(backup: any, blueprintSetId: string): BlueprintScopeLayer[] {
  // Public/UI accessor: hide tombstoned items.
  return sortWorkPackages(getOperationsBlueprintScopeLayersRaw(backup, blueprintSetId).filter((l) => !l.deletedAt))
}

export const SCOPE_LAYER_CLOUD_SYNC_WARNING_MSG =
  'Work Package saved locally, but cloud sync could not be completed. Reload before continuing.'

export type SaveScopeLayersResult = {
  success: boolean
  localSaved: boolean
  cloudSynced: boolean
  warning?: string
  error?: string
}

function applySanitizedScopeLayersToBackup(
  targetBackup: any,
  blueprintSetId: string,
  sanitizedLayers: BlueprintScopeLayer[],
): any {
  // Phase 5E: item-level, delete-safe merge onto the target's existing (raw) array for this
  // set only. `sanitizedLayers` (incoming) already carries tombstones inferred by the save
  // path; the union with the target keeps any tombstone present on either side. Other sets
  // and other BackupData branches are untouched. Replaces the previous whole-array overwrite.
  const merged = JSON.parse(JSON.stringify(targetBackup || {}))
  const container = getScopeLayersContainer(merged)
  const existingRaw = Array.isArray(container[blueprintSetId]) ? container[blueprintSetId] : []
  container[blueprintSetId] = mergeBlueprintScopeLayersById(existingRaw, sanitizedLayers)
  return merged
}

export async function saveOperationsBlueprintScopeLayers(
  backup: any,
  blueprintSetId: string,
  scopeLayers: BlueprintScopeLayer[],
): Promise<SaveScopeLayersResult> {
  // Phase 5C: scope metadata only. Does NOT change merge/save/stale/baseline behavior.
  const SCOPE: DataScope = 'blueprint.workPackages'

  const incomingLive = (Array.isArray(scopeLayers) ? scopeLayers : [])
    .map(sanitizeScopeLayer)
    .filter(Boolean) as BlueprintScopeLayer[]

  const {
    getBackupData,
    getActiveTenantUserId,
    isSupabaseConfigured,
    saveBackupData,
    saveBackupDataAndSyncNow,
    saveBackupWithRemoteBaselineSync,
    fetchLatestRemoteBackup,
  } = await import('@/services/backupDataService')

  const userId = getActiveTenantUserId()
  const localBase = backup || getBackupData()

  // BP-SYNC-FIX-1 Part A: deletion is NEVER inferred from a package id merely being absent
  // from this payload. A stale/incomplete incoming array — e.g. a single-package edit made
  // against a React snapshot captured before other packages were added — must not tombstone
  // real packages. That delete-by-omission was the production incident (four newly created
  // packages tombstoned together with identical timestamps). Deletes now travel ONLY as
  // explicit tombstones: the incoming array may itself carry a tombstoned layer (see
  // deleteOperationsBlueprintScopeLayer), and any layer already tombstoned in local state but
  // absent from this payload is carried forward so an existing delete still propagates
  // cross-device. Every omitted-but-live id is preserved by the id-merge onto the freshly
  // fetched remote (and by mergeScopedIncomingIntoLocal on the local side).
  const incomingIds = new Set(incomingLive.map((l) => l.id))
  const prevRawLayers = localBase ? getOperationsBlueprintScopeLayersRaw(localBase, blueprintSetId) : []
  const carriedTombstones = prevRawLayers.filter((prev) => prev.deletedAt && !incomingIds.has(prev.id))
  // Incoming order first (preserves UI reorder); previously-tombstoned layers appended.
  const sanitizedLayers = [...incomingLive, ...carriedTombstones]

  const saveLocalOnly = (base: any): SaveScopeLayersResult => {
    const merged = applySanitizedScopeLayersToBackup(base, blueprintSetId, sanitizedLayers)
    merged._lastSavedAt = new Date().toISOString()
    saveBackupData(merged)
    try { window.dispatchEvent(new Event('storage')) } catch { /* ignore */ }
    try { window.dispatchEvent(new Event('poweron-data-saved')) } catch { /* ignore */ }
    return {
      success: false,
      localSaved: true,
      cloudSynced: false,
      warning: SCOPE_LAYER_CLOUD_SYNC_WARNING_MSG,
    }
  }

  if (!isSupabaseConfigured()) {
    if (!localBase) {
      return { success: false, localSaved: false, cloudSynced: false, error: 'No local backup data available.' }
    }
    const merged = applySanitizedScopeLayersToBackup(localBase, blueprintSetId, sanitizedLayers)
    merged._lastSavedAt = new Date().toISOString()
    saveBackupData(merged)
    try { window.dispatchEvent(new Event('storage')) } catch { /* ignore */ }
    try { window.dispatchEvent(new Event('poweron-data-saved')) } catch { /* ignore */ }
    return { success: true, localSaved: true, cloudSynced: false }
  }

  const remote = await fetchLatestRemoteBackup(userId || undefined)

  if (remote.error) {
    console.warn('[ScopeLayers] Remote fetch failed — local-only save', remote.error)
    if (!localBase) {
      return {
        success: false,
        localSaved: false,
        cloudSynced: false,
        error: SCOPE_LAYER_CLOUD_SYNC_WARNING_MSG,
      }
    }
    return saveLocalOnly(localBase)
  }

  if (!remote.hasRemoteRow || !remote.remoteData) {
    if (!localBase) {
      return { success: false, localSaved: false, cloudSynced: false, error: 'No local backup data available.' }
    }
    const merged = applySanitizedScopeLayersToBackup(localBase, blueprintSetId, sanitizedLayers)
    const result = await saveBackupDataAndSyncNow(merged, 'blueprintSummaries', { source: 'scope-layers-first-sync', _scopes: [SCOPE] })
    if (result.success) {
      try { window.dispatchEvent(new Event('storage')) } catch { /* ignore */ }
      try { window.dispatchEvent(new Event('poweron-data-saved')) } catch { /* ignore */ }
      return { success: true, localSaved: true, cloudSynced: true }
    }
    return {
      success: false,
      localSaved: true,
      cloudSynced: false,
      warning: SCOPE_LAYER_CLOUD_SYNC_WARNING_MSG,
      error: result.error,
    }
  }

  const mergedFromRemote = applySanitizedScopeLayersToBackup(remote.remoteData, blueprintSetId, sanitizedLayers)
  const result = await saveBackupWithRemoteBaselineSync(
    mergedFromRemote,
    {
      remoteUpdatedAt: remote.remoteUpdatedAt,
      remoteDataLastSavedAt: remote.remoteDataLastSavedAt,
    },
    { source: 'scope-layers-remote-merge', _scopes: [SCOPE] },
  )

  if (result.success) {
    try { window.dispatchEvent(new Event('storage')) } catch { /* ignore */ }
    try { window.dispatchEvent(new Event('poweron-data-saved')) } catch { /* ignore */ }
    return { success: true, localSaved: true, cloudSynced: true }
  }

  return {
    success: false,
    localSaved: result.localSaved,
    cloudSynced: false,
    warning: SCOPE_LAYER_CLOUD_SYNC_WARNING_MSG,
    error: result.error,
  }
}

/**
 * BP-SYNC-FIX-1 Part A: explicit, single-package soft delete — the ONLY way to delete a work
 * package now that saveOperationsBlueprintScopeLayers no longer infers deletes from omission.
 * Mirrors deleteOperationsBlueprintAnnotation: it tombstones exactly `scopeLayerId` (retaining
 * the full record — itemRefs, animationScene/revision, hours — inside the tombstone) and routes
 * through the same remote-baseline save, so the delete propagates via the established package
 * id-merge and every unrelated package is left untouched. If the target is missing from stale
 * local state it is looked up in the latest remote, so the exact remote id can still be
 * tombstoned safely (a package created on another device that never reached this cache).
 */
export async function deleteOperationsBlueprintScopeLayer(
  backup: any,
  blueprintSetId: string,
  scopeLayerId: string,
): Promise<SaveScopeLayersResult> {
  const now = new Date().toISOString()
  let userId: string | null = null
  try {
    const { getActiveTenantUserId } = await import('@/services/backupDataService')
    userId = getActiveTenantUserId()
  } catch { /* deletedBy is best-effort; never block a delete on it */ }

  const localRaw = getOperationsBlueprintScopeLayersRaw(backup || {}, blueprintSetId)
  let target = localRaw.find((layer) => layer.id === scopeLayerId)

  // Target absent from (stale) local state — consult the latest remote so a package created on
  // another device can still be deleted by its exact id.
  if (!target) {
    try {
      const { isSupabaseConfigured, fetchLatestRemoteBackup } = await import('@/services/backupDataService')
      if (isSupabaseConfigured()) {
        const remote = await fetchLatestRemoteBackup(userId || undefined)
        if (remote.hasRemoteRow && remote.remoteData) {
          target = getOperationsBlueprintScopeLayersRaw(remote.remoteData, blueprintSetId).find((layer) => layer.id === scopeLayerId)
        }
      }
    } catch { /* fall through to the no-op below */ }
  }

  if (!target || target.deletedAt) {
    // Unknown id or already deleted — nothing live to tombstone. Re-save the current live set so
    // the caller still gets the normal result shape; no id is created, revived, or dropped.
    console.warn('[ScopeLayers] delete: package not found live locally or remotely; nothing to tombstone', { blueprintSetId, scopeLayerId })
    return saveOperationsBlueprintScopeLayers(backup, blueprintSetId, localRaw.filter((layer) => !layer.deletedAt))
  }

  const tombstone: BlueprintScopeLayer = {
    ...target,
    deletedAt: now,
    updatedAt: now,
    ...(userId ? { deletedBy: userId } : {}),
  }
  // Pass the current live set with exactly this id replaced by (or, for a remote-only target,
  // appended as) its tombstone. saveOperationsBlueprintScopeLayers merges it onto fresh remote;
  // nothing is deleted by omission, and any other existing tombstone is carried forward there.
  const liveWithoutTarget = localRaw.filter((layer) => !layer.deletedAt && layer.id !== scopeLayerId)
  return saveOperationsBlueprintScopeLayers(backup, blueprintSetId, [...liveWithoutTarget, tombstone])
}

export type BlueprintAnimationSceneUpdater = (
  currentScene: BlueprintScopeAnimationSceneV1 | undefined,
) => BlueprintScopeAnimationSceneV1 | null

export type SaveBlueprintAnimationSceneConflictReason =
  | 'scope-layer-missing'
  | 'scope-layer-deleted'
  | 'unsupported-current-scene'
  | 'invalid-next-scene'
  | 'stale-local-revision'
  | 'stale-remote-revision'
  | 'remote-conflict-unresolved'
  | 'remote-write-failed'
  | 'verification-mismatch'

export type BlueprintAnimationSceneSaveStatus =
  | 'verified'
  | 'local-saved-cloud-pending'
  | 'local-saved-cloud-failed'
  | 'local-saved-revision-conflict'
  | 'local-saved-remote-deleted'
  | 'verification-mismatch'
  | 'local-save-failed'
  | 'revision-conflict'
  | 'stale-local-revision'
  | 'missing-scope-layer'
  | 'invalid-scene'

export type SaveBlueprintAnimationSceneResult =
  | {
      success: true
      conflict: false
      status: BlueprintAnimationSceneSaveStatus
      localSaved: boolean
      cloudSynced: boolean
      scene: BlueprintScopeAnimationSceneV1 | undefined
      scopeLayer: BlueprintScopeLayer
      animationSceneRevision: number
      warning?: string
    }
  | {
      success: false
      conflict: true
      status: BlueprintAnimationSceneSaveStatus
      localSaved: boolean
      cloudSynced: false
      reason: SaveBlueprintAnimationSceneConflictReason
      message: string
      expectedBaseRevision: number
      currentScene: BlueprintScopeAnimationScene | undefined
      callerDraft: BlueprintScopeAnimationSceneV1 | null
      scene?: BlueprintScopeAnimationSceneV1 | undefined
      scopeLayer?: BlueprintScopeLayer
      animationSceneRevision?: number
    }

export interface SaveOperationsBlueprintScopeLayerAnimationSceneInput {
  backup?: any
  blueprintSetId: string
  scopeLayerId: string
  nextScene: BlueprintScopeAnimationSceneV1 | null | BlueprintAnimationSceneUpdater
  expectedBaseRevision: number
  now?: string
}

function getSupportedScene(layer: BlueprintScopeLayer | undefined): BlueprintScopeAnimationSceneV1 | undefined {
  const parsed = parseBlueprintAnimationScene(layer?.animationScene)
  return parsed.status === 'supported' ? parsed.scene : undefined
}

function getSceneRevision(layer: BlueprintScopeLayer | undefined): number {
  const scene = getSupportedScene(layer)
  return Math.max(
    scene ? Math.max(1, Math.floor(Number(scene.revision) || 1)) : 0,
    Math.max(0, Math.floor(Number(layer?.animationSceneRevision) || 0)),
  )
}

function getScopeLayerById(backup: any, blueprintSetId: string, scopeLayerId: string): BlueprintScopeLayer | undefined {
  return getOperationsBlueprintScopeLayersRaw(backup || {}, blueprintSetId)
    .find((layer) => layer.id === scopeLayerId)
}

function cloneScene<T extends BlueprintScopeAnimationSceneV1 | null | undefined>(scene: T): T {
  return scene == null ? scene : JSON.parse(JSON.stringify(scene))
}

function canonicalSceneJson(value: unknown): string {
  const canonicalize = (entry: any): any => {
    if (Array.isArray(entry)) return entry.map(canonicalize)
    if (!entry || typeof entry !== 'object') return entry
    return Object.keys(entry).sort().reduce((out: Record<string, unknown>, key) => {
      out[key] = canonicalize(entry[key])
      return out
    }, {})
  }
  return JSON.stringify(canonicalize(value))
}

export function canonicalizeAnimationSceneForVerification(value: unknown): unknown {
  const canonicalize = (entry: any, path: string[]): any => {
    if (Array.isArray(entry)) {
      const key = path[path.length - 1]
      const normalized = entry.map((item) => canonicalize(item, path))
      if (key === 'nodes' || key === 'edges') {
        return [...normalized].sort((a, b) => String(a?.id || '').localeCompare(String(b?.id || '')))
      }
      if (key === 'branchOrders') {
        return [...normalized].sort((a, b) => String(a?.nodeId || a?.id || '').localeCompare(String(b?.nodeId || b?.id || '')))
      }
      return normalized
    }
    if (!entry || typeof entry !== 'object') return entry
    return Object.keys(entry).sort().reduce((out: Record<string, unknown>, key) => {
      const normalized = canonicalize(entry[key], [...path, key])
      if (normalized == null) return out
      if ((Array.isArray(normalized) && normalized.length === 0) && (key === 'events' || key === 'branchOrders' || key === 'manualTraversal' || key === 'sources')) {
        out[key] = []
        return out
      }
      out[key] = normalized
      return out
    }, {})
  }
  return canonicalize(value, [])
}

export function compareAnimationScenesForVerification(a: unknown, b: unknown): boolean {
  return canonicalSceneJson(canonicalizeAnimationSceneForVerification(a)) === canonicalSceneJson(canonicalizeAnimationSceneForVerification(b))
}

function buildSceneDraft(
  nextScene: BlueprintScopeAnimationSceneV1 | null | BlueprintAnimationSceneUpdater,
  currentScene: BlueprintScopeAnimationSceneV1 | undefined,
): { draft: BlueprintScopeAnimationSceneV1 | null; invalid: boolean } {
  const rawDraft = typeof nextScene === 'function'
    ? nextScene(cloneScene(currentScene))
    : cloneScene(nextScene)
  if (rawDraft == null) return { draft: null, invalid: false }
  const parsed = parseBlueprintAnimationScene(rawDraft)
  return parsed.status === 'supported'
    ? { draft: parsed.scene, invalid: false }
    : { draft: null, invalid: true }
}

function applyAnimationSceneLayerToBackup(
  backup: any,
  blueprintSetId: string,
  updatedLayer: BlueprintScopeLayer,
): any {
  const next = JSON.parse(JSON.stringify(backup || {}))
  const container = getScopeLayersContainer(next)
  const existing = Array.isArray(container[blueprintSetId]) ? container[blueprintSetId] : []
  container[blueprintSetId] = mergeBlueprintScopeLayersById(existing, [updatedLayer])
  const appliedLayer = container[blueprintSetId].find((layer: BlueprintScopeLayer) => layer.id === updatedLayer.id)
  if (appliedLayer) {
    if (updatedLayer.animationScene) appliedLayer.animationScene = cloneScene(updatedLayer.animationScene)
    else delete appliedLayer.animationScene
    if (updatedLayer.animationSceneRevision) appliedLayer.animationSceneRevision = updatedLayer.animationSceneRevision
    else delete appliedLayer.animationSceneRevision
  }
  return next
}

export function readPersistedOperationsBlueprintScopeLayerAnimationScene(input: {
  backup?: any
  blueprintSetId: string
  scopeLayerId: string
  targetRevision: number
  intendedScene: BlueprintScopeAnimationSceneV1 | undefined
}): {
  found: boolean
  scopeLayer?: BlueprintScopeLayer
  scene?: BlueprintScopeAnimationSceneV1
  revision?: number
  semanticallyMatches: boolean
} {
  const backup = input.backup
  const layer = getScopeLayerById(backup, input.blueprintSetId, input.scopeLayerId)
  if (!layer) return { found: false, semanticallyMatches: false }
  const scene = getSupportedScene(layer)
  const revision = getSceneRevision(layer)
  const targetRevision = Math.max(0, Math.floor(Number(input.targetRevision) || 0))
  const revisionMatches = revision === targetRevision
  const semanticallyMatches = input.intendedScene
    ? !!scene && compareAnimationScenesForVerification(scene, input.intendedScene)
    : !scene && revisionMatches
  return {
    found: revisionMatches && semanticallyMatches,
    scopeLayer: layer,
    scene,
    revision,
    semanticallyMatches,
  }
}

function requireLocalSavedSceneResult(
  result: SaveBlueprintAnimationSceneResult,
): SaveBlueprintAnimationSceneResult {
  if (!result.localSaved) return result
  if (result.scopeLayer && result.animationSceneRevision != null && Object.prototype.hasOwnProperty.call(result, 'scene')) {
    return result
  }
  return {
    ...result,
    success: false,
    conflict: true,
    status: 'local-save-failed',
    localSaved: false,
    cloudSynced: false,
    reason: 'remote-write-failed',
    message: 'The animation route could not be confirmed on this device.',
    expectedBaseRevision: (result as any).expectedBaseRevision ?? 0,
    currentScene: (result as any).currentScene,
    callerDraft: (result as any).callerDraft ?? null,
  } as SaveBlueprintAnimationSceneResult
}

function sceneConflict(
  reason: SaveBlueprintAnimationSceneConflictReason,
  message: string,
  expectedBaseRevision: number,
  currentScene: BlueprintScopeAnimationScene | undefined,
  callerDraft: BlueprintScopeAnimationSceneV1 | null,
  localSaved = false,
  options: {
    status?: BlueprintAnimationSceneSaveStatus
    scopeLayer?: BlueprintScopeLayer
    scene?: BlueprintScopeAnimationSceneV1 | undefined
    animationSceneRevision?: number
  } = {},
): SaveBlueprintAnimationSceneResult {
  return requireLocalSavedSceneResult({
    success: false,
    conflict: true,
    status: options.status || statusForSceneConflict(reason, localSaved),
    localSaved,
    cloudSynced: false,
    reason,
    message,
    expectedBaseRevision,
    currentScene: currentScene ? JSON.parse(JSON.stringify(currentScene)) : undefined,
    callerDraft: cloneScene(callerDraft),
    ...(options.scopeLayer ? { scopeLayer: JSON.parse(JSON.stringify(options.scopeLayer)) } : {}),
    ...(Object.prototype.hasOwnProperty.call(options, 'scene') ? { scene: cloneScene(options.scene) } : {}),
    ...(options.animationSceneRevision != null ? { animationSceneRevision: options.animationSceneRevision } : {}),
  })
}

function statusForSceneConflict(reason: SaveBlueprintAnimationSceneConflictReason, localSaved: boolean): BlueprintAnimationSceneSaveStatus {
  if (localSaved) {
    if (reason === 'remote-write-failed') return 'local-saved-cloud-failed'
    if (reason === 'verification-mismatch') return 'verification-mismatch'
    if (reason === 'stale-remote-revision') return 'local-saved-revision-conflict'
    if (reason === 'scope-layer-deleted' || reason === 'scope-layer-missing') return 'local-saved-remote-deleted'
    return 'local-saved-cloud-pending'
  }
  switch (reason) {
    case 'scope-layer-missing':
    case 'scope-layer-deleted':
      return 'missing-scope-layer'
    case 'invalid-next-scene':
    case 'unsupported-current-scene':
      return 'invalid-scene'
    case 'stale-local-revision':
      return 'stale-local-revision'
    case 'stale-remote-revision':
    case 'remote-conflict-unresolved':
    case 'verification-mismatch':
      return 'revision-conflict'
    case 'remote-write-failed':
    default:
      return 'local-save-failed'
  }
}

/** Read-back retry budget, matching saveLiveDataVerified's contract in backupDataService. */
const SCENE_READBACK_MAX_ATTEMPTS = 3
const SCENE_READBACK_RETRY_DELAY_MS = 300

const waitForSceneReadback = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Conflict-aware package animation-scene save. This is deliberately separate from the package
 * editor's whole-array save: it checks scene revision against local and freshly fetched remote
 * state, then writes through the existing remote-baseline guard.
 */
export async function saveOperationsBlueprintScopeLayerAnimationScene(
  input: SaveOperationsBlueprintScopeLayerAnimationSceneInput,
): Promise<SaveBlueprintAnimationSceneResult> {
  const {
    getBackupData,
    getActiveTenantUserId,
    isSupabaseConfigured,
    saveBackupData,
    saveBackupDataAndSyncNow,
    saveBackupWithRemoteBaselineSync,
    fetchLatestRemoteBackup,
  } = await import('@/services/backupDataService')

  const expectedRevision = Math.max(0, Math.floor(Number(input.expectedBaseRevision) || 0))
  const localBase = input.backup || getBackupData()
  const localLayer = getScopeLayerById(localBase, input.blueprintSetId, input.scopeLayerId)
  if (!localLayer) {
    return sceneConflict('scope-layer-missing', 'The work package no longer exists.', expectedRevision, undefined, null)
  }
  if (localLayer.deletedAt) {
    return sceneConflict('scope-layer-deleted', 'The work package was deleted.', expectedRevision, localLayer.animationScene, null)
  }
  const localParse = parseBlueprintAnimationScene(localLayer.animationScene)
  if (localParse.status === 'unsupported-version') {
    return sceneConflict('unsupported-current-scene', 'The work package scene uses an unsupported schema version.', expectedRevision, localParse.scene, null)
  }
  const localScene = localParse.status === 'supported' ? localParse.scene : undefined
  const draftResult = buildSceneDraft(input.nextScene, localScene)
  const callerDraft = draftResult.draft
  if (draftResult.invalid) {
    return sceneConflict('invalid-next-scene', 'The animation scene draft is malformed or unsupported.', expectedRevision, localScene, null)
  }
  const localRevision = getSceneRevision(localLayer)
  if (localRevision > expectedRevision || localRevision < expectedRevision) {
    return sceneConflict('stale-local-revision', `Expected scene revision ${expectedRevision}, but local revision is ${localRevision}.`, expectedRevision, localScene, callerDraft)
  }

  const userId = getActiveTenantUserId()
  let remoteSnapshot: Awaited<ReturnType<typeof fetchLatestRemoteBackup>> | null = null
  let remoteLayer: BlueprintScopeLayer | undefined
  if (isSupabaseConfigured()) {
    remoteSnapshot = await fetchLatestRemoteBackup(userId || undefined)
    if (remoteSnapshot.error) {
      return sceneConflict('remote-conflict-unresolved', `Remote scene revision could not be verified: ${remoteSnapshot.error}`, expectedRevision, localScene, callerDraft)
    }
    if (remoteSnapshot.hasRemoteRow && remoteSnapshot.remoteData) {
      remoteLayer = getScopeLayerById(remoteSnapshot.remoteData, input.blueprintSetId, input.scopeLayerId)
      if (remoteLayer?.deletedAt) {
        return sceneConflict('scope-layer-deleted', 'The work package was deleted remotely.', expectedRevision, remoteLayer.animationScene, callerDraft)
      }
      const remoteParse = parseBlueprintAnimationScene(remoteLayer?.animationScene)
      if (remoteParse.status === 'unsupported-version') {
        return sceneConflict('unsupported-current-scene', 'The remote work package scene uses an unsupported schema version.', expectedRevision, remoteParse.scene, callerDraft)
      }
      const remoteRevision = getSceneRevision(remoteLayer)
      if (remoteRevision > expectedRevision) {
        return sceneConflict('stale-remote-revision', `Expected scene revision ${expectedRevision}, but remote revision is ${remoteRevision}.`, expectedRevision, remoteLayer?.animationScene, callerDraft)
      }
    }
  }

  const baseLayers = remoteSnapshot?.remoteData
    ? mergeBlueprintScopeLayersById(
        getOperationsBlueprintScopeLayersRaw(remoteSnapshot.remoteData, input.blueprintSetId),
        getOperationsBlueprintScopeLayersRaw(localBase, input.blueprintSetId),
      )
    : getOperationsBlueprintScopeLayersRaw(localBase, input.blueprintSetId)
  const baseLayer = baseLayers.find((layer) => layer.id === input.scopeLayerId) || localLayer
  const currentScene = getSupportedScene(baseLayer)
  const now = input.now || new Date().toISOString()
  const savedScene = callerDraft
    ? {
        ...cloneScene(callerDraft),
        schemaVersion: 1 as const,
        revision: expectedRevision + 1,
        createdAt: currentScene?.createdAt || callerDraft.createdAt || now,
        updatedAt: now,
      }
    : undefined
  const updatedLayer: BlueprintScopeLayer = {
    ...baseLayer,
    ...(savedScene ? { animationScene: savedScene } : {}),
    animationSceneRevision: expectedRevision + 1,
    updatedAt: now,
  }
  if (!savedScene) delete (updatedLayer as any).animationScene

  // A single immediate read can return the PRE-write row (read-your-write lag), which would
  // report an already-landed write as a conflict. Retry only the shapes that mean "the row has
  // not caught up yet"; a genuine conflict moves the revision FORWARD or keeps it at target with
  // different content, so it is still decided on the first read.
  const verifyRemoteWrite = async (): Promise<SaveBlueprintAnimationSceneResult> => {
    const targetRevision = expectedRevision + 1
    let lagged: SaveBlueprintAnimationSceneResult | null = null

    for (let attempt = 1; attempt <= SCENE_READBACK_MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) await waitForSceneReadback(SCENE_READBACK_RETRY_DELAY_MS)

      const verification = await fetchLatestRemoteBackup(userId || undefined)
      if (verification.error || !verification.hasRemoteRow || !verification.remoteData) {
        // No usable row this attempt — read-back lag, not proof the write was lost.
        lagged = sceneConflict('remote-conflict-unresolved', verification.error || 'The remote scene write could not be read back.', expectedRevision, currentScene, callerDraft, true, {
          status: 'local-saved-cloud-pending',
          scopeLayer: updatedLayer,
          scene: savedScene,
          animationSceneRevision: targetRevision,
        })
        continue
      }
      const verifiedLayer = getScopeLayerById(verification.remoteData, input.blueprintSetId, input.scopeLayerId)
      if (!verifiedLayer) {
        // A landed write always carries this layer, so absence means the row predates it.
        lagged = sceneConflict('remote-conflict-unresolved', 'The saved work package was missing during remote read-back.', expectedRevision, undefined, callerDraft, true, {
          status: 'local-saved-cloud-pending',
          scopeLayer: updatedLayer,
          scene: savedScene,
          animationSceneRevision: targetRevision,
        })
        continue
      }
      if (verifiedLayer.deletedAt) {
        return sceneConflict('scope-layer-deleted', 'The work package was deleted before the scene save could be verified.', expectedRevision, verifiedLayer.animationScene, callerDraft, true, {
          status: 'local-saved-remote-deleted',
          scopeLayer: updatedLayer,
          scene: savedScene,
          animationSceneRevision: targetRevision,
        })
      }
      const verifiedParse = parseBlueprintAnimationScene(verifiedLayer.animationScene)
      if (verifiedParse.status === 'unsupported-version') {
        return sceneConflict('unsupported-current-scene', 'The saved work package now uses an unsupported scene schema.', expectedRevision, verifiedParse.scene, callerDraft, true, {
          status: 'local-saved-cloud-pending',
          scopeLayer: updatedLayer,
          scene: savedScene,
          animationSceneRevision: targetRevision,
        })
      }
      const verifiedRevision = getSceneRevision(verifiedLayer)
      if (verifiedRevision > targetRevision) {
        return sceneConflict('stale-remote-revision', `The remote scene advanced to revision ${verifiedRevision} before read-back completed.`, expectedRevision, verifiedLayer.animationScene, callerDraft, true, {
          status: 'local-saved-revision-conflict',
          scopeLayer: updatedLayer,
          scene: savedScene,
          animationSceneRevision: targetRevision,
        })
      }
      if (verifiedRevision < targetRevision) {
        // Behind the revision we just wrote. Revisions only advance, so this is lag — never a
        // concurrent write — and must not be reported as a conflict until the budget is spent.
        lagged = sceneConflict('remote-conflict-unresolved', 'The remote scene did not reach the locally saved route revision during read-back verification.', expectedRevision, verifiedLayer.animationScene, callerDraft, true, {
          status: 'local-saved-cloud-pending',
          scopeLayer: updatedLayer,
          scene: savedScene,
          animationSceneRevision: targetRevision,
        })
        continue
      }
      const verifiedScene = verifiedParse.status === 'supported' ? verifiedParse.scene : undefined
      const contentMatches = savedScene
        ? !!verifiedScene && compareAnimationScenesForVerification(verifiedScene, savedScene)
        : !verifiedScene
      if (!contentMatches) {
        // Target revision reached with different content — a concurrent write claimed it.
        return sceneConflict('verification-mismatch', 'The remote scene did not match the locally saved route during read-back verification.', expectedRevision, verifiedLayer.animationScene, callerDraft, true, {
          status: 'verification-mismatch',
          scopeLayer: updatedLayer,
          scene: savedScene,
          animationSceneRevision: targetRevision,
        })
      }
      const successResult: SaveBlueprintAnimationSceneResult = {
        success: true,
        conflict: false,
        status: 'verified',
        localSaved: true,
        cloudSynced: true,
        scene: verifiedScene,
        scopeLayer: verifiedLayer,
        animationSceneRevision: targetRevision,
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('poweron:sync-success', {
          detail: {
            savedBy: (verification.remoteData as any)?._syncMeta?.savedBy,
            savedAt: verification.remoteDataLastSavedAt || verification.remoteUpdatedAt,
            verified: true,
          },
        }))
      }
      return successResult
    }

    return lagged ?? sceneConflict('remote-conflict-unresolved', 'The remote scene write could not be read back.', expectedRevision, currentScene, callerDraft, true, {
      status: 'local-saved-cloud-pending',
      scopeLayer: updatedLayer,
      scene: savedScene,
      animationSceneRevision: targetRevision,
    })
  }

  if (!isSupabaseConfigured()) {
    try {
      const savedBackup = applyAnimationSceneLayerToBackup(localBase, input.blueprintSetId, updatedLayer)
      savedBackup._lastSavedAt = now
      saveBackupData(savedBackup)
      try { window.dispatchEvent(new Event('storage')) } catch { /* ignore */ }
      try { window.dispatchEvent(new Event('poweron-data-saved')) } catch { /* ignore */ }
      return {
        success: true,
        conflict: false,
        status: 'local-saved-cloud-pending',
        localSaved: true,
        cloudSynced: false,
        scene: savedScene,
        scopeLayer: updatedLayer,
        animationSceneRevision: expectedRevision + 1,
        warning: 'Animation route saved on this device. Cloud sync has not been verified yet.',
      }
    } catch (error: any) {
      return sceneConflict('remote-write-failed', error?.message || 'The animation route could not be saved locally.', expectedRevision, currentScene, callerDraft, false, {
        status: 'local-save-failed',
      })
    }
  }

  if (!remoteSnapshot?.hasRemoteRow || !remoteSnapshot.remoteData) {
    const savedBackup = applyAnimationSceneLayerToBackup(localBase, input.blueprintSetId, updatedLayer)
    let result: Awaited<ReturnType<typeof saveBackupDataAndSyncNow>>
    try {
      result = await saveBackupDataAndSyncNow(savedBackup, 'blueprintSummaries', {
        source: 'scope-layer-animation-scene-first-sync',
        _scopes: ['blueprint.workPackages'],
        _suppressSuccessEvent: true,
      })
    } catch (error: any) {
      const persisted = readPersistedOperationsBlueprintScopeLayerAnimationScene({
        backup: getBackupData(),
        blueprintSetId: input.blueprintSetId,
        scopeLayerId: input.scopeLayerId,
        targetRevision: expectedRevision + 1,
        intendedScene: savedScene,
      })
      return sceneConflict('remote-write-failed', error?.message || 'The route was saved locally, but cloud sync failed.', expectedRevision, currentScene, callerDraft, persisted.found, persisted.found
        ? {
            status: 'local-saved-cloud-failed',
            scopeLayer: persisted.scopeLayer,
            scene: persisted.scene,
            animationSceneRevision: persisted.revision,
          }
        : { status: 'local-save-failed' })
    }
    if (result.success) {
      return verifyRemoteWrite()
    }
    return sceneConflict('remote-write-failed', result.error || 'The route was saved locally, but cloud sync failed.', expectedRevision, currentScene, callerDraft, true, {
      status: 'local-saved-cloud-failed',
      scopeLayer: updatedLayer,
      scene: savedScene,
      animationSceneRevision: expectedRevision + 1,
    })
  }

  // Second preflight narrows the non-atomic window: if the row changed after the initial scene
  // revision read, stop before the generic scoped merge can fold a conflicting scene together.
  const preflight = await fetchLatestRemoteBackup(userId || undefined)
  if (preflight.error || !preflight.hasRemoteRow || !preflight.remoteData) {
    return sceneConflict('remote-conflict-unresolved', preflight.error || 'The remote scene baseline could not be re-verified before saving.', expectedRevision, remoteLayer?.animationScene || currentScene, callerDraft)
  }
  if (
    preflight.remoteUpdatedAt !== remoteSnapshot.remoteUpdatedAt
    || preflight.remoteDataLastSavedAt !== remoteSnapshot.remoteDataLastSavedAt
  ) {
    const preflightLayer = getScopeLayerById(preflight.remoteData, input.blueprintSetId, input.scopeLayerId)
    const preflightRevision = getSceneRevision(preflightLayer)
    const reason = preflightRevision > expectedRevision ? 'stale-remote-revision' : 'remote-conflict-unresolved'
    return sceneConflict(
      reason,
      preflightRevision > expectedRevision
        ? `Expected scene revision ${expectedRevision}, but remote revision advanced to ${preflightRevision}.`
        : 'The remote package changed during the scene save preflight.',
      expectedRevision,
      preflightLayer?.animationScene,
      callerDraft,
    )
  }

  const remoteBasedBackup = applyAnimationSceneLayerToBackup(preflight.remoteData, input.blueprintSetId, updatedLayer)
  let result: Awaited<ReturnType<typeof saveBackupWithRemoteBaselineSync>>
  try {
    result = await saveBackupWithRemoteBaselineSync(
      remoteBasedBackup,
      {
        remoteUpdatedAt: preflight.remoteUpdatedAt,
        remoteDataLastSavedAt: preflight.remoteDataLastSavedAt,
      },
      {
        source: 'scope-layer-animation-scene-remote-merge',
        _scopes: ['blueprint.workPackages'],
        _suppressSuccessEvent: true,
      },
    )
  } catch (error: any) {
    const persisted = readPersistedOperationsBlueprintScopeLayerAnimationScene({
      backup: getBackupData(),
      blueprintSetId: input.blueprintSetId,
      scopeLayerId: input.scopeLayerId,
      targetRevision: expectedRevision + 1,
      intendedScene: savedScene,
    })
    return sceneConflict('remote-write-failed', error?.message || 'The route was saved locally, but cloud sync failed.', expectedRevision, remoteLayer?.animationScene || currentScene, callerDraft, persisted.found, persisted.found
      ? {
          status: 'local-saved-cloud-failed',
          scopeLayer: persisted.scopeLayer,
          scene: persisted.scene,
          animationSceneRevision: persisted.revision,
        }
      : { status: 'local-save-failed' })
  }
  if (!result.success) {
    return sceneConflict(
      'remote-write-failed',
      result.error || 'The route was saved locally, but cloud sync failed.',
      expectedRevision,
      remoteLayer?.animationScene || currentScene,
      callerDraft,
      result.localSaved,
      result.localSaved
        ? { status: 'local-saved-cloud-failed', scopeLayer: updatedLayer, scene: savedScene, animationSceneRevision: expectedRevision + 1 }
        : { status: 'local-save-failed' },
    )
  }
  return verifyRemoteWrite()
}
