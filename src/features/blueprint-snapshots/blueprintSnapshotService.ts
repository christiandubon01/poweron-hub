import { supabase } from '@/lib/supabase'
import {
  BLUEPRINT_SNAPSHOT_BUCKET,
  BLUEPRINT_SNAPSHOT_MAX_EDGE,
  BLUEPRINT_SNAPSHOT_MAX_FILE_SIZE_BYTES,
  type BlueprintSnapshotCaptionUpdateResult,
  type BlueprintSnapshotDeleteResult,
  type BlueprintSnapshotLibraryItem,
  type BlueprintSnapshotLibraryChangeEvent,
  type BlueprintSnapshotListFilters,
  type BlueprintSnapshotListResult,
  type BlueprintSnapshotPreviewResult,
  type BlueprintSnapshotSaveInput,
  type BlueprintSnapshotSavedResult,
  type BlueprintSnapshotWorkPackageUpdateResult,
  type BlueprintSnapshotWorkPackageTag,
} from './types'

const SNAPSHOT_LIBRARY_UNAVAILABLE = 'Snapshot library is not available yet.'
const SNAPSHOT_PREVIEW_UNAVAILABLE = 'Preview unavailable.'
const SNAPSHOT_CAPTION_FAILURE = 'Could not update caption.'
const SNAPSHOT_NETWORK_FAILURE = 'Network error. Try again.'
const SNAPSHOT_DELETE_REJECTED = 'Snapshot can no longer be deleted. Untag it first and make sure it is not attached to an issued Work Order.'
const SNAPSHOT_PREVIEW_TTL_SECONDS = 600
const SNAPSHOT_PREVIEW_CACHE_SAFETY_MS = 30_000
const DEFAULT_SNAPSHOT_LIBRARY_LIMIT = 24
const MAX_SNAPSHOT_LIBRARY_LIMIT = 48

const previewUrlCache = new Map<string, { signedUrl: string; expiresAt: number }>()
const libraryChangeListeners = new Set<(event: BlueprintSnapshotLibraryChangeEvent) => void>()

export class BlueprintSnapshotSaveError extends Error {
  code: string
  cleanupFailed: boolean

  constructor(code: string, message: string, options?: { cleanupFailed?: boolean }) {
    super(message)
    this.name = 'BlueprintSnapshotSaveError'
    this.code = code
    this.cleanupFailed = Boolean(options?.cleanupFailed)
  }
}

export function sanitizeSnapshotCaption(value: string): string | null {
  const trimmed = value.trim().slice(0, 240)
  return trimmed ? trimmed : null
}

export function resolveBlueprintSnapshotWorkPackageTag(input: {
  viewMode: 'general' | 'scoped'
  scopedWorkPackages: Array<{ id: string; name: string }>
}): BlueprintSnapshotWorkPackageTag {
  if (input.viewMode !== 'scoped' || input.scopedWorkPackages.length !== 1) {
    return { workPackageId: null, workPackageName: null }
  }
  const only = input.scopedWorkPackages[0]
  return {
    workPackageId: only.id || null,
    workPackageName: only.name || null,
  }
}

export function encodeSnapshotPathSegment(raw: string): string {
  const value = String(raw || '').trim()
  if (!value) throw new BlueprintSnapshotSaveError('invalid-path-segment', 'Snapshot storage path is missing required context.')
  const safe = /^[A-Za-z0-9._-]+$/.test(value) && value !== '.' && value !== '..'
  if (safe && !/[\\/]/.test(value)) return value
  return `b64u_${base64UrlEncode(value)}`
}

export function buildBlueprintSnapshotStoragePath(input: {
  orgId: string
  projectId: string
  blueprintSetId: string
  snapshotId: string
}): string {
  const orgId = String(input.orgId || '').trim()
  if (!isUuid(orgId) || !isUuid(input.snapshotId)) {
    throw new BlueprintSnapshotSaveError('invalid-storage-identity', 'Snapshot storage path is missing required context.')
  }
  return [
    orgId,
    encodeSnapshotPathSegment(input.projectId),
    encodeSnapshotPathSegment(input.blueprintSetId),
    `${input.snapshotId}.png`,
  ].join('/')
}

export function validateBlueprintSnapshotSaveInput(input: BlueprintSnapshotSaveInput): void {
  if (input.blob.type !== 'image/png') throw new BlueprintSnapshotSaveError('invalid-blob-type', 'Snapshot must be a PNG image.')
  if (input.blob.size <= 0) throw new BlueprintSnapshotSaveError('empty-blob', 'Snapshot image is empty.')
  if (input.blob.size > BLUEPRINT_SNAPSHOT_MAX_FILE_SIZE_BYTES) throw new BlueprintSnapshotSaveError('blob-too-large', 'Snapshot image is larger than 10 MB.')
  if (!Number.isInteger(input.width) || input.width < 1 || input.width > BLUEPRINT_SNAPSHOT_MAX_EDGE) throw new BlueprintSnapshotSaveError('invalid-width', 'Snapshot width is invalid.')
  if (!Number.isInteger(input.height) || input.height < 1 || input.height > BLUEPRINT_SNAPSHOT_MAX_EDGE) throw new BlueprintSnapshotSaveError('invalid-height', 'Snapshot height is invalid.')
  if (!isUuid(input.orgId)) throw new BlueprintSnapshotSaveError('missing-org', 'Missing organization context.')
  if (!isUuid(input.capturedBy)) throw new BlueprintSnapshotSaveError('missing-user', 'Missing authenticated user.')
  if (!String(input.projectId || '').trim() || !String(input.projectName || '').trim() || !String(input.blueprintSetId || '').trim()) {
    throw new BlueprintSnapshotSaveError('missing-blueprint-context', 'Missing project or blueprint context.')
  }
}

export async function saveBlueprintSnapshot(input: BlueprintSnapshotSaveInput): Promise<BlueprintSnapshotSavedResult> {
  validateBlueprintSnapshotSaveInput(input)
  const snapshotId = crypto.randomUUID()
  const storagePath = buildBlueprintSnapshotStoragePath({
    orgId: input.orgId,
    projectId: input.projectId,
    blueprintSetId: input.blueprintSetId,
    snapshotId,
  })

  const uploadResult = await supabase.storage
    .from(BLUEPRINT_SNAPSHOT_BUCKET)
    .upload(storagePath, input.blob, {
      contentType: 'image/png',
      upsert: false,
    })

  if (uploadResult.error) {
    throw new BlueprintSnapshotSaveError('storage-unavailable', 'Snapshot storage is not available yet. The image was not uploaded.')
  }

  const row = {
    id: snapshotId,
    org_id: input.orgId,
    project_id: input.projectId,
    project_name: input.projectName,
    blueprint_set_id: input.blueprintSetId,
    work_package_id: input.workPackageTag.workPackageId,
    work_package_name: input.workPackageTag.workPackageName,
    storage_path: storagePath,
    caption: input.caption,
    captured_by: input.capturedBy,
    width: input.width,
    height: input.height,
    file_size_bytes: input.blob.size,
    mime_type: 'image/png',
    page_number: input.pageNumber,
    capture_metadata: input.captureMetadata,
  }

  const insertResult = await (supabase as any)
    .from('blueprint_snapshots')
    .insert(row)
    .select([
      'id',
      'project_id',
      'project_name',
      'blueprint_set_id',
      'work_package_id',
      'work_package_name',
      'storage_path',
      'page_number',
      'caption',
      'capture_metadata',
      'width',
      'height',
      'file_size_bytes',
      'captured_at',
      'created_at',
    ].join(', '))
    .single()

  if (insertResult.error) {
    let cleanupFailed = false
    try {
      const cleanup = await supabase.storage.from(BLUEPRINT_SNAPSHOT_BUCKET).remove([storagePath])
      cleanupFailed = Boolean(cleanup.error)
    } catch {
      cleanupFailed = true
    }
    throw new BlueprintSnapshotSaveError(
      'metadata-insert-failed',
      cleanupFailed
        ? 'Snapshot metadata could not be saved. The uploaded image cleanup also needs attention.'
        : 'Snapshot metadata could not be saved. The uploaded image was cleaned up.',
      { cleanupFailed },
    )
  }

  const saved = insertResult.data || row
  const snapshot = mapSnapshotLibraryRow(saved)
  notifyBlueprintSnapshotLibraryChanged({ type: 'upsert', snapshot, source: 'save' })
  return {
    ...snapshot,
    storagePath: String(saved.storage_path),
    width: Number(saved.width),
    height: Number(saved.height),
    fileSizeBytes: Number(saved.file_size_bytes),
    pageNumber: Number(saved.page_number),
  }
}

export async function listBlueprintSnapshots(
  filters: BlueprintSnapshotListFilters = {},
): Promise<BlueprintSnapshotListResult> {
  try {
    const limit = normalizeLimit(filters.limit)
    let query = (supabase as any)
      .from('blueprint_snapshots')
      .select([
        'id',
        'project_id',
        'project_name',
        'blueprint_set_id',
        'work_package_id',
        'work_package_name',
        'page_number',
        'caption',
        'capture_metadata',
        'width',
        'height',
        'file_size_bytes',
        'captured_at',
        'created_at',
        'assignment_snapshots(snapshot_id)',
      ].join(', '))
      .is('deleted_at', null)
      .order('captured_at', { ascending: false })
      .order('id', { ascending: false })

    if (filters.projectId) query = query.eq('project_id', filters.projectId)
    if (filters.blueprintSetId) query = query.eq('blueprint_set_id', filters.blueprintSetId)
    if (filters.pageNumber) query = query.eq('page_number', filters.pageNumber)
    if (filters.captureMode) query = query.eq('capture_metadata->>captureMode', filters.captureMode)
    if (filters.workPackageMode === 'untagged-or-matching' && filters.workPackageId) {
      query = query.or(`work_package_id.is.null,work_package_id.eq.${escapePostgrestValue(filters.workPackageId)}`)
    } else if (filters.workPackageMode === 'untagged') {
      query = query.is('work_package_id', null)
    } else if (filters.workPackageId) {
      query = query.eq('work_package_id', filters.workPackageId)
    }
    if (filters.cursor) {
      const cursor = decodeSnapshotCursor(filters.cursor)
      if (cursor) {
        query = query.or(`captured_at.lt.${escapePostgrestValue(cursor.capturedAt)},and(captured_at.eq.${escapePostgrestValue(cursor.capturedAt)},id.lt.${escapePostgrestValue(cursor.id)})`)
      }
    }

    const { data, error } = await query.limit(limit + 1)
    if (error) return classifySnapshotServiceError(error, SNAPSHOT_LIBRARY_UNAVAILABLE)

    const rows = Array.isArray(data) ? data : []
    const page = rows.slice(0, limit).map(mapSnapshotLibraryRow)
    const extra = rows.length > limit ? rows[limit - 1] : null
    return {
      status: 'available',
      snapshots: page,
      nextCursor: extra ? encodeSnapshotCursor(extra) : null,
    }
  } catch (err: unknown) {
    console.error('[blueprintSnapshotService.listBlueprintSnapshots]', err)
    return { status: 'error', message: SNAPSHOT_NETWORK_FAILURE }
  }
}

export async function getBlueprintSnapshotsByIds(snapshotIds: string[]): Promise<BlueprintSnapshotListResult> {
  const ids = uniqueSnapshotIds(snapshotIds)
  if (ids.length === 0) return { status: 'available', snapshots: [], nextCursor: null }
  try {
    const { data, error } = await (supabase as any)
      .from('blueprint_snapshots')
      .select([
        'id',
        'project_id',
        'project_name',
        'blueprint_set_id',
        'work_package_id',
        'work_package_name',
        'page_number',
        'caption',
        'capture_metadata',
        'width',
        'height',
        'file_size_bytes',
        'captured_at',
        'created_at',
        'assignment_snapshots(snapshot_id)',
      ].join(', '))
      .in('id', ids)
      .is('deleted_at', null)

    if (error) return classifySnapshotServiceError(error, SNAPSHOT_LIBRARY_UNAVAILABLE)
    const byId = new Map((data || []).map((row: any) => [String(row.id), mapSnapshotLibraryRow(row)]))
    return {
      status: 'available',
      snapshots: ids.map((id) => byId.get(id)).filter(Boolean) as BlueprintSnapshotLibraryItem[],
      nextCursor: null,
    }
  } catch (err: unknown) {
    console.error('[blueprintSnapshotService.getBlueprintSnapshotsByIds]', err)
    return { status: 'error', message: SNAPSHOT_NETWORK_FAILURE }
  }
}

export async function getBlueprintSnapshotPreviewUrl(snapshotId: string, options?: { forceRefresh?: boolean }): Promise<BlueprintSnapshotPreviewResult> {
  const cleanId = String(snapshotId || '').trim()
  if (!cleanId) return { status: 'error', message: SNAPSHOT_PREVIEW_UNAVAILABLE }

  const cached = previewUrlCache.get(cleanId)
  if (!options?.forceRefresh && cached && cached.expiresAt - SNAPSHOT_PREVIEW_CACHE_SAFETY_MS > Date.now()) {
    return { status: 'available', snapshotId: cleanId, signedUrl: cached.signedUrl, expiresAt: cached.expiresAt }
  }

  try {
    const { data, error } = await (supabase as any)
      .from('blueprint_snapshots')
      .select('id, storage_path')
      .eq('id', cleanId)
      .is('deleted_at', null)
      .single()

    if (error) return classifySnapshotServiceError(error, SNAPSHOT_LIBRARY_UNAVAILABLE, SNAPSHOT_PREVIEW_UNAVAILABLE)
    const storagePath = String(data?.storage_path || '').trim()
    if (!storagePath) return { status: 'error', message: SNAPSHOT_PREVIEW_UNAVAILABLE }

    const signed = await supabase.storage
      .from(BLUEPRINT_SNAPSHOT_BUCKET)
      .createSignedUrl(storagePath, SNAPSHOT_PREVIEW_TTL_SECONDS)

    if (signed.error || !signed.data?.signedUrl) {
      return { status: 'error', message: SNAPSHOT_PREVIEW_UNAVAILABLE }
    }

    const expiresAt = Date.now() + SNAPSHOT_PREVIEW_TTL_SECONDS * 1000
    previewUrlCache.set(cleanId, { signedUrl: signed.data.signedUrl, expiresAt })
    prunePreviewUrlCache()
    return { status: 'available', snapshotId: cleanId, signedUrl: signed.data.signedUrl, expiresAt }
  } catch (err: unknown) {
    console.error('[blueprintSnapshotService.getBlueprintSnapshotPreviewUrl]', err)
    return { status: 'error', message: SNAPSHOT_NETWORK_FAILURE }
  }
}

export async function updateBlueprintSnapshotCaption(
  snapshotId: string,
  caption: string,
): Promise<BlueprintSnapshotCaptionUpdateResult> {
  try {
    const cleanCaption = sanitizeSnapshotCaption(caption)
    const { data, error } = await (supabase as any)
      .from('blueprint_snapshots')
      .update({ caption: cleanCaption })
      .eq('id', snapshotId)
      .is('deleted_at', null)
      .select([
        'id',
        'project_id',
        'project_name',
        'blueprint_set_id',
        'work_package_id',
        'work_package_name',
        'page_number',
        'caption',
        'capture_metadata',
        'width',
        'height',
        'file_size_bytes',
        'captured_at',
        'created_at',
        'assignment_snapshots(snapshot_id)',
      ].join(', '))
      .single()

    if (error) return classifySnapshotServiceError(error, SNAPSHOT_LIBRARY_UNAVAILABLE, SNAPSHOT_CAPTION_FAILURE)
    const snapshot = mapSnapshotLibraryRow(data)
    notifyBlueprintSnapshotLibraryChanged({ type: 'upsert', snapshot, source: 'caption' })
    return { status: 'available', snapshot }
  } catch (err: unknown) {
    console.error('[blueprintSnapshotService.updateBlueprintSnapshotCaption]', err)
    return { status: 'error', message: SNAPSHOT_NETWORK_FAILURE }
  }
}

export async function updateBlueprintSnapshotWorkPackage(
  snapshotId: string,
  workPackage: BlueprintSnapshotWorkPackageTag,
): Promise<BlueprintSnapshotWorkPackageUpdateResult> {
  try {
    const cleanWorkPackageId = String(workPackage.workPackageId || '').trim() || null
    const cleanWorkPackageName = cleanWorkPackageId ? (String(workPackage.workPackageName || '').trim() || null) : null
    const { data, error } = await (supabase as any)
      .from('blueprint_snapshots')
      .update({
        work_package_id: cleanWorkPackageId,
        work_package_name: cleanWorkPackageName,
      })
      .eq('id', snapshotId)
      .is('deleted_at', null)
      .select([
        'id',
        'project_id',
        'project_name',
        'blueprint_set_id',
        'work_package_id',
        'work_package_name',
        'page_number',
        'caption',
        'capture_metadata',
        'width',
        'height',
        'file_size_bytes',
        'captured_at',
        'created_at',
        'assignment_snapshots(snapshot_id)',
      ].join(', '))
      .single()

    if (error) return classifySnapshotServiceError(error, SNAPSHOT_LIBRARY_UNAVAILABLE, 'Could not update Work Package.')
    const snapshot = mapSnapshotLibraryRow(data)
    notifyBlueprintSnapshotLibraryChanged({ type: 'upsert', snapshot, source: 'work-package' })
    return { status: 'available', snapshot }
  } catch (err: unknown) {
    console.error('[blueprintSnapshotService.updateBlueprintSnapshotWorkPackage]', err)
    return { status: 'error', message: SNAPSHOT_NETWORK_FAILURE }
  }
}

export async function deleteBlueprintSnapshot(snapshotId: string): Promise<BlueprintSnapshotDeleteResult> {
  const cleanId = String(snapshotId || '').trim()
  if (!cleanId) return { status: 'error', message: SNAPSHOT_DELETE_REJECTED }

  try {
    const { data: current, error: currentError } = await (supabase as any)
      .from('blueprint_snapshots')
      .select('id, work_package_id, assignment_snapshots(snapshot_id)')
      .eq('id', cleanId)
      .is('deleted_at', null)
      .single()

    if (currentError) return classifySnapshotServiceError(currentError, SNAPSHOT_LIBRARY_UNAVAILABLE, SNAPSHOT_DELETE_REJECTED)
    if (current?.work_package_id) {
      return { status: 'rejected', message: 'Return this snapshot to Untagged before deleting it.' }
    }
    if (hasAssignmentSnapshotAttachment(current)) {
      return { status: 'rejected', message: 'Attached to an issued Work Order.' }
    }

    const { data, error } = await (supabase as any)
      .from('blueprint_snapshots')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', cleanId)
      .is('deleted_at', null)
      .is('work_package_id', null)
      .select('id')
      .single()

    if (error) {
      return classifySnapshotServiceError(error, SNAPSHOT_LIBRARY_UNAVAILABLE, SNAPSHOT_DELETE_REJECTED)
    }
    if (!data?.id) {
      return { status: 'rejected', message: SNAPSHOT_DELETE_REJECTED }
    }

    clearBlueprintSnapshotPreviewUrlCache(cleanId)
    notifyBlueprintSnapshotLibraryChanged({ type: 'delete', snapshotId: cleanId, source: 'delete' })
    return { status: 'deleted', snapshotId: cleanId }
  } catch (err: unknown) {
    console.error('[blueprintSnapshotService.deleteBlueprintSnapshot]', err)
    return { status: 'error', message: SNAPSHOT_NETWORK_FAILURE }
  }
}

export function clearBlueprintSnapshotPreviewUrlCache(snapshotId?: string): void {
  if (snapshotId) previewUrlCache.delete(snapshotId)
  else previewUrlCache.clear()
}

export function subscribeBlueprintSnapshotLibraryChanges(listener: (event: BlueprintSnapshotLibraryChangeEvent) => void): () => void {
  libraryChangeListeners.add(listener)
  return () => {
    libraryChangeListeners.delete(listener)
  }
}

export function notifyBlueprintSnapshotLibraryChanged(event: BlueprintSnapshotLibraryChangeEvent = { type: 'refresh' }): void {
  libraryChangeListeners.forEach((listener) => listener(event))
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim())
}

function normalizeLimit(limit: number | null | undefined): number {
  const n = Math.floor(Number(limit) || DEFAULT_SNAPSHOT_LIBRARY_LIMIT)
  return Math.max(1, Math.min(MAX_SNAPSHOT_LIBRARY_LIMIT, n))
}

function mapSnapshotLibraryRow(row: any): BlueprintSnapshotLibraryItem {
  const metadata = row?.capture_metadata && typeof row.capture_metadata === 'object' ? row.capture_metadata : {}
  return {
    id: String(row.id),
    projectId: String(row.project_id || ''),
    projectName: String(row.project_name || ''),
    blueprintSetId: String(row.blueprint_set_id || ''),
    blueprintTitle: typeof metadata.blueprintTitle === 'string' ? metadata.blueprintTitle : null,
    workPackageId: row.work_package_id ?? null,
    workPackageName: row.work_package_name ?? null,
    pageNumber: row.page_number == null ? null : Number(row.page_number),
    caption: row.caption ?? null,
    captureMode: metadata.captureMode === 'area' || metadata.captureMode === 'full-page' ? metadata.captureMode : null,
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    fileSizeBytes: row.file_size_bytes == null ? null : Number(row.file_size_bytes),
    annotationCount: metadata.annotationCount == null ? null : Number(metadata.annotationCount),
    attachedToIssuedWorkOrder: hasAssignmentSnapshotAttachment(row),
    capturedAt: row.captured_at ?? null,
    createdAt: row.created_at ?? null,
  }
}

function hasAssignmentSnapshotAttachment(row: any): boolean {
  const attached = row?.assignment_snapshots
  if (Array.isArray(attached)) return attached.length > 0
  return Boolean(attached)
}

function classifySnapshotServiceError(
  error: unknown,
  unavailableMessage: string,
  fallbackMessage = SNAPSHOT_NETWORK_FAILURE,
): { status: 'unavailable'; message: string } | { status: 'error'; message: string } {
  if (isMissingSnapshotTableError(error)) return { status: 'unavailable', message: unavailableMessage }
  if (isNetworkLikeError(error)) return { status: 'error', message: SNAPSHOT_NETWORK_FAILURE }
  return { status: 'error', message: fallbackMessage }
}

export function isMissingSnapshotTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as { code?: string | number; message?: string; details?: string }
  const code = String(err.code ?? '')
  const haystack = `${err.message ?? ''}\n${err.details ?? ''}`.toLowerCase()
  if (code === '42P01' && haystack.includes('blueprint_snapshots')) return true
  if (code === 'PGRST205' && haystack.includes('blueprint_snapshots')) return true
  if (/relation ["']?public\.blueprint_snapshots["']? does not exist/i.test(haystack)) return true
  return false
}

function isNetworkLikeError(error: unknown): boolean {
  const haystack = error instanceof Error
    ? error.message
    : typeof error === 'object' && error
      ? `${(error as any).message ?? ''}\n${(error as any).details ?? ''}`
      : String(error || '')
  return /failed to fetch|networkerror|network request failed|timeout|econnrefused|enotfound/i.test(haystack)
}

function uniqueSnapshotIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))]
}

function encodeSnapshotCursor(row: any): string | null {
  const capturedAt = String(row?.captured_at || '')
  const id = String(row?.id || '')
  if (!capturedAt || !id) return null
  return btoa(JSON.stringify({ capturedAt, id }))
}

function decodeSnapshotCursor(cursor: string): { capturedAt: string; id: string } | null {
  try {
    const parsed = JSON.parse(atob(cursor))
    if (!parsed?.capturedAt || !parsed?.id) return null
    return { capturedAt: String(parsed.capturedAt), id: String(parsed.id) }
  } catch {
    return null
  }
}

function escapePostgrestValue(value: string): string {
  return `"${String(value).replace(/"/g, '\\"')}"`
}

function prunePreviewUrlCache(): void {
  const now = Date.now()
  for (const [id, cached] of previewUrlCache) {
    if (cached.expiresAt - SNAPSHOT_PREVIEW_CACHE_SAFETY_MS <= now || previewUrlCache.size > 64) {
      previewUrlCache.delete(id)
    }
  }
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
