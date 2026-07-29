import { supabase } from '@/lib/supabase'
import {
  BLUEPRINT_SNAPSHOT_BUCKET,
  BLUEPRINT_SNAPSHOT_MAX_EDGE,
  BLUEPRINT_SNAPSHOT_MAX_FILE_SIZE_BYTES,
  type BlueprintSnapshotSaveInput,
  type BlueprintSnapshotSavedResult,
  type BlueprintSnapshotWorkPackageTag,
} from './types'

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
    .select('id, storage_path, width, height, file_size_bytes, page_number, caption, work_package_id, work_package_name')
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
  return {
    id: String(saved.id),
    storagePath: String(saved.storage_path),
    width: Number(saved.width),
    height: Number(saved.height),
    fileSizeBytes: Number(saved.file_size_bytes),
    pageNumber: Number(saved.page_number),
    caption: saved.caption ?? null,
    workPackageId: saved.work_package_id ?? null,
    workPackageName: saved.work_package_name ?? null,
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim())
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
