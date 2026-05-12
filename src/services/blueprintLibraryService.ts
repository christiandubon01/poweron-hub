// @ts-nocheck
import { supabase } from '@/lib/supabase'
import { getPageCount } from '@/services/blueprintExtractor'

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
  type: 'note' | 'highlight' | 'freehand' | 'arrow' | 'cloud' | 'textBox' | 'callout' | 'generate' | 'pen' | 'marker' | 'underline' | 'shape'
  rect?: BlueprintAnnotationRect
  path?: BlueprintAnnotationPoint[]
  text?: string
  color: string
  createdAt: string
  updatedAt: string
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

export function getOperationsBlueprintLibrary(backup: any): BlueprintLibraryItem[] {
  const items = backup?.blueprintSummaries?.operationsBlueprintLibrary
  return Array.isArray(items) ? items : []
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
  backup.blueprintSummaries.operationsBlueprintLibrary = items
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
  const list = getOperationsBlueprintLibrary(backup)
  const nextLibrary = list.filter((x) => x.id !== blueprintSetId)

  if (!backup.blueprintSummaries || typeof backup.blueprintSummaries !== 'object') {
    backup.blueprintSummaries = {}
  }
  backup.blueprintSummaries.operationsBlueprintLibrary = nextLibrary

  const annotations = backup.blueprintSummaries.operationsBlueprintAnnotations
  if (annotations && typeof annotations === 'object' && !Array.isArray(annotations)) {
    delete annotations[blueprintSetId]
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
  if (!['note', 'highlight', 'freehand', 'arrow', 'cloud', 'textBox', 'callout', 'generate', 'pen', 'marker', 'underline', 'shape'].includes(type)) return null
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
  const createdAt = String(raw.createdAt || new Date().toISOString())
  const updatedAt = String(raw.updatedAt || new Date().toISOString())

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

export function getOperationsBlueprintAnnotations(backup: any, blueprintSetId: string): BlueprintAnnotation[] {
  const container = getAnnotationsContainer(backup || {})
  const rawList = container?.[blueprintSetId]
  if (!Array.isArray(rawList)) return []
  return rawList.map(sanitizeAnnotation).filter(Boolean) as BlueprintAnnotation[]
}

export async function saveOperationsBlueprintAnnotations(
  backup: any,
  blueprintSetId: string,
  annotations: BlueprintAnnotation[]
): Promise<void> {
  const container = getAnnotationsContainer(backup)
  container[blueprintSetId] = (Array.isArray(annotations) ? annotations : [])
    .map(sanitizeAnnotation)
    .filter(Boolean) as BlueprintAnnotation[]
  backup._lastSavedAt = new Date().toISOString()
  const { saveBackupDataAndSyncNow } = await import('@/services/backupDataService')
  const result = await saveBackupDataAndSyncNow(backup, 'blueprintSummaries')
  if (!result.success) {
    throw new Error(result.error || 'Failed to sync blueprint annotations.')
  }
  try { window.dispatchEvent(new Event('storage')) } catch { /* ignore */ }
  try { window.dispatchEvent(new Event('poweron-data-saved')) } catch { /* ignore */ }
}

export async function upsertOperationsBlueprintAnnotation(backup: any, annotation: BlueprintAnnotation): Promise<void> {
  const clean = sanitizeAnnotation(annotation)
  if (!clean) return
  const list = getOperationsBlueprintAnnotations(backup, clean.blueprintSetId)
  const idx = list.findIndex(a => a.id === clean.id)
  if (idx >= 0) list[idx] = clean
  else list.push(clean)
  await saveOperationsBlueprintAnnotations(backup, clean.blueprintSetId, list)
}

export async function deleteOperationsBlueprintAnnotation(
  backup: any,
  blueprintSetId: string,
  annotationId: string
): Promise<void> {
  const list = getOperationsBlueprintAnnotations(backup, blueprintSetId)
  const next = list.filter(a => a.id !== annotationId)
  await saveOperationsBlueprintAnnotations(backup, blueprintSetId, next)
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
