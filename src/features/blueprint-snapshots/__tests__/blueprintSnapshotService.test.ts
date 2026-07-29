import { beforeEach, describe, expect, it, vi } from 'vitest'

const supabaseState = vi.hoisted(() => ({
  upload: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
  remove: vi.fn(),
  getPublicUrl: vi.fn(),
}))

vi.mock('@/lib/supabase', () => {
  const storageBucket = {
    upload: supabaseState.upload,
    remove: supabaseState.remove,
    getPublicUrl: supabaseState.getPublicUrl,
  }
  return {
    supabase: {
      storage: {
        from: vi.fn(() => storageBucket),
      },
      from: vi.fn(() => ({
        insert: supabaseState.insert,
      })),
    },
  }
})

import {
  buildBlueprintSnapshotStoragePath,
  encodeSnapshotPathSegment,
  resolveBlueprintSnapshotWorkPackageTag,
  sanitizeSnapshotCaption,
  saveBlueprintSnapshot,
} from '@/features/blueprint-snapshots'

const orgId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const snapshotId = '33333333-3333-4333-8333-333333333333'

function pngBlob(size = 10) {
  return new Blob([new Uint8Array(size)], { type: 'image/png' })
}

function metadata() {
  return {
    schemaVersion: 1 as const,
    captureMode: 'full-page' as const,
    pageNumber: 1,
    rotation: 0,
    targetDpi: 150,
    outputWidth: 100,
    outputHeight: 80,
    sourcePageWidth: 48,
    sourcePageHeight: 38,
    viewMode: 'general' as const,
    scopedWorkPackageIds: [],
    labelsVisible: true,
    circuitLabelsVisible: false,
    annotationCount: 0,
  }
}

function saveInput() {
  return {
    blob: pngBlob(),
    width: 100,
    height: 80,
    pageNumber: 1,
    caption: null,
    orgId,
    projectId: 'project/unsafe',
    projectName: 'Project A',
    blueprintSetId: 'set\\unsafe',
    capturedBy: userId,
    captureMetadata: metadata(),
    workPackageTag: { workPackageId: null, workPackageName: null },
  }
}

describe('blueprint snapshot service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(snapshotId)
    supabaseState.upload.mockResolvedValue({ data: { path: 'ok' }, error: null })
    supabaseState.remove.mockResolvedValue({ data: [], error: null })
    supabaseState.insert.mockReturnValue({ select: supabaseState.select })
    supabaseState.select.mockReturnValue({ single: supabaseState.single })
    supabaseState.single.mockResolvedValue({
      data: {
        id: snapshotId,
        storage_path: `${orgId}/project/set/${snapshotId}.png`,
        width: 100,
        height: 80,
        file_size_bytes: 10,
        page_number: 1,
        caption: null,
        work_package_id: null,
        work_package_name: null,
      },
      error: null,
    })
  })

  it('trims captions and keeps empty captions null', () => {
    expect(sanitizeSnapshotCaption('  panel A  ')).toBe('panel A')
    expect(sanitizeSnapshotCaption('   ')).toBeNull()
    expect(sanitizeSnapshotCaption('x'.repeat(300))).toHaveLength(240)
  })

  it('tags exactly one scoped work package and leaves general or multi scoped untagged', () => {
    expect(resolveBlueprintSnapshotWorkPackageTag({ viewMode: 'scoped', scopedWorkPackages: [{ id: 'wp-1', name: 'Rough In' }] })).toEqual({
      workPackageId: 'wp-1',
      workPackageName: 'Rough In',
    })
    expect(resolveBlueprintSnapshotWorkPackageTag({ viewMode: 'general', scopedWorkPackages: [{ id: 'wp-1', name: 'Rough In' }] })).toEqual({
      workPackageId: null,
      workPackageName: null,
    })
    expect(resolveBlueprintSnapshotWorkPackageTag({ viewMode: 'scoped', scopedWorkPackages: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] })).toEqual({
      workPackageId: null,
      workPackageName: null,
    })
  })

  it('prevents path injection while preserving safe path structure', () => {
    expect(encodeSnapshotPathSegment('safe.project-1')).toBe('safe.project-1')
    expect(encodeSnapshotPathSegment('project/../unsafe')).toMatch(/^b64u_/)
    const path = buildBlueprintSnapshotStoragePath({
      orgId,
      projectId: 'project/../unsafe',
      blueprintSetId: 'set\\unsafe',
      snapshotId,
    })
    expect(path).toMatch(new RegExp(`^${orgId}/b64u_[^/]+/b64u_[^/]+/${snapshotId}\\.png$`))
  })

  it('uploads PNG privately with upsert false, inserts metadata after upload, and never asks for a public URL', async () => {
    await saveBlueprintSnapshot(saveInput())

    expect(supabaseState.upload).toHaveBeenCalledTimes(1)
    expect(supabaseState.upload.mock.calls[0][2]).toMatchObject({ contentType: 'image/png', upsert: false })
    expect(supabaseState.insert).toHaveBeenCalledTimes(1)
    expect(supabaseState.insert.mock.invocationCallOrder[0]).toBeGreaterThan(supabaseState.upload.mock.invocationCallOrder[0])
    expect(supabaseState.getPublicUrl).not.toHaveBeenCalled()
    const insertedRow = supabaseState.insert.mock.calls[0][0]
    expect(insertedRow.public_url).toBeUndefined()
    expect(insertedRow.caption).toBeNull()
    expect(insertedRow.storage_path).not.toContain('caption')
    expect(insertedRow.project_id).toBe('project/unsafe')
    expect(insertedRow.blueprint_set_id).toBe('set\\unsafe')
  })

  it('cleans up uploaded storage object when metadata insert fails', async () => {
    supabaseState.single.mockResolvedValueOnce({ data: null, error: { message: 'relation missing' } })

    await expect(saveBlueprintSnapshot(saveInput())).rejects.toMatchObject({
      code: 'metadata-insert-failed',
      cleanupFailed: false,
    })
    expect(supabaseState.remove).toHaveBeenCalledTimes(1)
  })

  it('reports cleanup failure without hiding the primary insert failure', async () => {
    supabaseState.single.mockResolvedValueOnce({ data: null, error: { message: 'rls denied' } })
    supabaseState.remove.mockResolvedValueOnce({ data: null, error: { message: 'cleanup denied' } })

    await expect(saveBlueprintSnapshot(saveInput())).rejects.toMatchObject({
      code: 'metadata-insert-failed',
      cleanupFailed: true,
    })
  })

  it('fails safely before upload when org context is missing', async () => {
    await expect(saveBlueprintSnapshot({ ...saveInput(), orgId: '' })).rejects.toMatchObject({ code: 'missing-org' })
    expect(supabaseState.upload).not.toHaveBeenCalled()
  })
})
