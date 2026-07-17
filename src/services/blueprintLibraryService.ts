// @ts-nocheck
import { supabase } from '@/lib/supabase'
import { getPageCount } from '@/services/blueprintExtractor'
import { SCOPE_REGISTRY, type DataScope } from '@/services/scopeRegistry'

// Phase 5C: dev-only assertion that the registry descriptors still point at the
// concrete BackupData container keys these save paths write. Metadata sanity check
// only — console.warn, never throws, never blocks a save, no-op in production.
;(function assertBlueprintScopeDescriptors() {
  try {
    if (!import.meta.env?.DEV) return
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
  visible: boolean
  isolated: boolean
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

export function mergeBlueprintScopeLayersById(
  remoteItems: any[],
  incomingItems: any[],
): BlueprintScopeLayer[] {
  const remote = (Array.isArray(remoteItems) ? remoteItems : []).map(sanitizeScopeLayer).filter(Boolean) as BlueprintScopeLayer[]
  const incoming = (Array.isArray(incomingItems) ? incomingItems : []).map(sanitizeScopeLayer).filter(Boolean) as BlueprintScopeLayer[]
  return mergeItemsById(remote as TombstonedItem[], incoming as TombstonedItem[]) as unknown as BlueprintScopeLayer[]
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
    visible: raw.visible === false ? false : true,
    isolated: raw.isolated === true,
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
  return getOperationsBlueprintScopeLayersRaw(backup, blueprintSetId).filter((l) => !l.deletedAt)
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

  // Phase 5E: infer tombstones for layers the UI dropped. deleteScopeLayer (and any edit)
  // passes the COMPLETE live array for this set (verified in the Phase 5E pre-edit caller
  // check) — it filters rather than tombstoning — so any previously-live id now absent is a
  // delete. Synthesize a tombstone for it; carry forward previously-tombstoned layers so they
  // survive. This keeps the delete durable without editing OperationsBlueprintPdfViewer.tsx.
  const nowIsoTombstone = new Date().toISOString()
  const prevRawLayers = localBase ? getOperationsBlueprintScopeLayersRaw(localBase, blueprintSetId) : []
  const incomingLiveIds = new Set(incomingLive.map((l) => l.id))
  const inferredTombstones: BlueprintScopeLayer[] = []
  const carriedTombstones: BlueprintScopeLayer[] = []
  for (const prev of prevRawLayers) {
    if (prev.deletedAt) { carriedTombstones.push(prev); continue }
    if (!incomingLiveIds.has(prev.id)) {
      inferredTombstones.push({
        ...prev,
        deletedAt: nowIsoTombstone,
        updatedAt: nowIsoTombstone,
        ...(userId ? { deletedBy: userId } : {}),
      })
    }
  }
  // Incoming order first (preserves UI reorder), tombstones appended (hidden from UI anyway).
  const sanitizedLayers = [...incomingLive, ...inferredTombstones, ...carriedTombstones]

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
