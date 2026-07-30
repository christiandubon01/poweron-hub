import { beforeEach, describe, expect, it, vi } from 'vitest'

const supabaseState = vi.hoisted(() => ({
  upload: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
  remove: vi.fn(),
  getPublicUrl: vi.fn(),
  createSignedUrl: vi.fn(),
  from: vi.fn(),
  query: {
    select: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    eq: vi.fn(),
    or: vi.fn(),
    in: vi.fn(),
    update: vi.fn(),
    single: vi.fn(),
  },
}))

vi.mock('@/lib/supabase', () => {
  const storageBucket = {
    upload: supabaseState.upload,
    remove: supabaseState.remove,
    getPublicUrl: supabaseState.getPublicUrl,
    createSignedUrl: supabaseState.createSignedUrl,
  }
  return {
    supabase: {
      storage: {
        from: vi.fn(() => storageBucket),
      },
      from: supabaseState.from,
    },
  }
})

import {
  buildBlueprintSnapshotStoragePath,
  clearBlueprintSnapshotPreviewUrlCache,
  deleteBlueprintSnapshot,
  encodeSnapshotPathSegment,
  getBlueprintSnapshotPreviewUrl,
  isMissingSnapshotTableError,
  listBlueprintSnapshots,
  resolveBlueprintSnapshotWorkPackageTag,
  sanitizeSnapshotCaption,
  saveBlueprintSnapshot,
  snapshotMatchesBlueprintSnapshotFilters,
  subscribeBlueprintSnapshotLibraryChanges,
  updateBlueprintSnapshotCaption,
} from '@/features/blueprint-snapshots'

const orgId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const snapshotId = '33333333-3333-4333-8333-333333333333'
const serviceSource = await import('node:fs').then((fs) => fs.readFileSync('src/features/blueprint-snapshots/blueprintSnapshotService.ts', 'utf8'))

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
    clearBlueprintSnapshotPreviewUrlCache()
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(snapshotId)
    supabaseState.upload.mockResolvedValue({ data: { path: 'ok' }, error: null })
    supabaseState.remove.mockResolvedValue({ data: [], error: null })
    supabaseState.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed.example/snapshot.png' }, error: null })
    for (const fn of Object.values(supabaseState.query)) {
      fn.mockReset?.()
    }
    const query = supabaseState.query
    query.select.mockReturnValue(query)
    query.is.mockReturnValue(query)
    query.order.mockReturnValue(query)
    query.limit.mockResolvedValue({ data: [], error: null })
    query.eq.mockReturnValue(query)
    query.or.mockReturnValue(query)
    query.in.mockReturnValue(query)
    query.update.mockReturnValue(query)
    query.single.mockResolvedValue({
      data: {
        id: snapshotId,
        storage_path: `${orgId}/project/set/${snapshotId}.png`,
        project_id: 'project-1',
        project_name: 'Project One',
        blueprint_set_id: 'set-1',
        work_package_id: null,
        work_package_name: null,
        page_number: 1,
        caption: null,
        capture_metadata: metadata(),
        width: 100,
        height: 80,
        file_size_bytes: 10,
        captured_at: '2026-01-01T00:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
      },
      error: null,
    })
    supabaseState.from.mockImplementation(() => ({
      insert: supabaseState.insert,
      select: query.select,
      update: query.update,
    }))
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

  it('owns the single shared page size without assignment or card-count availability caps', () => {
    expect(serviceSource).toContain('export const BLUEPRINT_SNAPSHOT_PAGE_SIZE = 24')
    expect(serviceSource).toContain("{ count: 'exact' }")
    expect(serviceSource).not.toContain('DEFAULT_SNAPSHOT_LIBRARY_LIMIT')
    expect(serviceSource).not.toMatch(/limit\s*=\s*(9|12|15)\b/)
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

  it('saves selected Work Package metadata in the original snapshot insert and keeps Untagged as null', async () => {
    await saveBlueprintSnapshot({
      ...saveInput(),
      workPackageTag: { workPackageId: 'wp-rough', workPackageName: 'Rough In' },
    })
    expect(supabaseState.insert.mock.calls[0][0]).toMatchObject({
      work_package_id: 'wp-rough',
      work_package_name: 'Rough In',
    })

    await saveBlueprintSnapshot(saveInput())
    expect(supabaseState.insert.mock.calls[1][0]).toMatchObject({
      work_package_id: null,
      work_package_name: null,
    })
  })

  it('emits complete upsert and delete events for open Snapshot Library state', async () => {
    const events: unknown[] = []
    const unsubscribe = subscribeBlueprintSnapshotLibraryChanges((event) => events.push(event))

    await saveBlueprintSnapshot({
      ...saveInput(),
      workPackageTag: { workPackageId: 'wp-rough', workPackageName: 'Rough In' },
    })
    expect(events[0]).toMatchObject({
      type: 'upsert',
      source: 'save',
      snapshot: {
        id: snapshotId,
        width: 100,
        height: 80,
        workPackageId: null,
        attachedToIssuedWorkOrder: false,
      },
    })

    const query = supabaseState.query
    query.single
      .mockResolvedValueOnce({
        data: { id: snapshotId, work_package_id: null, assignment_snapshots: [] },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: snapshotId },
        error: null,
      })
    await deleteBlueprintSnapshot(snapshotId)
    expect(events[events.length - 1]).toEqual({ type: 'delete', snapshotId, source: 'delete' })
    unsubscribe()
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

  it('lists live snapshot metadata with filters, default page size, deterministic order, and no storage path', async () => {
    const query = supabaseState.query
    query.limit.mockResolvedValueOnce({
      data: [{
        id: snapshotId,
        project_id: 'project-1',
        project_name: 'Project One',
        blueprint_set_id: 'set-1',
        work_package_id: null,
        work_package_name: null,
        page_number: 2,
        caption: 'Panel',
        capture_metadata: { ...metadata(), captureMode: 'area', annotationCount: 3 },
        width: 100,
        height: 80,
        file_size_bytes: 10,
        captured_at: '2026-01-02T00:00:00.000Z',
        created_at: '2026-01-02T00:00:00.000Z',
        assignment_snapshots: [{ snapshot_id: snapshotId }],
      }],
      error: null,
      count: 16,
    })

    const result = await listBlueprintSnapshots({
      projectId: 'project-1',
      blueprintSetId: 'set-1',
      pageNumber: 2,
      workPackageId: 'wp-1',
      workPackageMode: 'untagged-or-matching',
      captureMode: 'area',
    })

    expect(result.status).toBe('available')
    if (result.status === 'available') {
      expect(result.snapshots[0]).toMatchObject({
        id: snapshotId,
        projectId: 'project-1',
        captureMode: 'area',
        annotationCount: 3,
        attachedToIssuedWorkOrder: true,
      })
      expect(result.totalCount).toBe(16)
      expect(result.hasMore).toBe(false)
      expect(result.snapshots[0]).not.toHaveProperty('storagePath')
      expect(result.snapshots[0]).not.toHaveProperty('signedUrl')
    }
    expect(query.is).toHaveBeenCalledWith('deleted_at', null)
    expect(query.order).toHaveBeenCalledWith('captured_at', { ascending: false })
    expect(query.order).toHaveBeenCalledWith('id', { ascending: false })
    expect(query.limit).toHaveBeenCalledWith(25)
    expect(query.eq).toHaveBeenCalledWith('project_id', 'project-1')
    expect(query.eq).toHaveBeenCalledWith('blueprint_set_id', 'set-1')
    expect(query.eq).toHaveBeenCalledWith('page_number', 2)
    expect(query.eq).toHaveBeenCalledWith('capture_metadata->>captureMode', 'area')
    expect(query.or).toHaveBeenCalledWith(expect.stringContaining('work_package_id.is.null'))
    expect(query.select).toHaveBeenCalledWith(expect.any(String), { count: 'exact' })
  })

  it('keeps complete matching count distinct from loaded pages and preserves it across cursors', async () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      id: `snapshot-${String(index).padStart(2, '0')}`,
      project_id: 'project-1',
      project_name: 'Project One',
      blueprint_set_id: 'set-1',
      work_package_id: 'wp-test',
      work_package_name: 'Test Package',
      page_number: index + 1,
      caption: `Snapshot ${index + 1}`,
      capture_metadata: metadata(),
      width: 100,
      height: 80,
      file_size_bytes: 10,
      captured_at: new Date(Date.UTC(2026, 0, 31 - index)).toISOString(),
      created_at: new Date(Date.UTC(2026, 0, 31 - index)).toISOString(),
      assignment_snapshots: [],
    }))
    supabaseState.query.limit
      .mockResolvedValueOnce({ data: rows, error: null, count: 30 })
      .mockResolvedValueOnce({ data: rows.slice(0, 6), error: null, count: 6 })

    const first = await listBlueprintSnapshots({
      projectId: 'project-1',
      blueprintSetId: 'set-1',
      workPackageId: 'wp-test',
    })
    expect(first.status).toBe('available')
    if (first.status !== 'available') return
    expect(first.snapshots).toHaveLength(24)
    expect(first.totalCount).toBe(30)
    expect(first.hasMore).toBe(true)
    expect(first.nextCursor).toEqual(expect.any(String))

    const second = await listBlueprintSnapshots({
      projectId: 'project-1',
      blueprintSetId: 'set-1',
      workPackageId: 'wp-test',
      cursor: first.nextCursor,
    })
    expect(second.status).toBe('available')
    if (second.status !== 'available') return
    expect(second.snapshots).toHaveLength(6)
    expect(second.totalCount).toBe(30)
    expect(second.hasMore).toBe(false)
  })

  it('uses the same stable-id filter semantics for query results and live upserts', () => {
    const item = {
      id: snapshotId,
      projectId: 'project-1',
      projectName: 'Project One',
      blueprintSetId: 'set-1',
      blueprintTitle: 'Blueprint One',
      workPackageId: 'wp-test',
      workPackageName: 'Test Package',
      pageNumber: 3,
      caption: null,
      captureMode: 'area' as const,
      width: 100,
      height: 80,
      fileSizeBytes: 10,
      annotationCount: 0,
      attachedToIssuedWorkOrder: true,
      capturedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    }

    expect(snapshotMatchesBlueprintSnapshotFilters(item, {
      projectId: 'project-1',
      blueprintSetId: 'set-1',
      workPackageId: 'wp-test',
      pageNumber: 3,
      captureMode: 'area',
    })).toBe(true)
    expect(snapshotMatchesBlueprintSnapshotFilters(item, {
      projectId: 'project-1',
      blueprintSetId: 'set-1',
      workPackageId: 'same-readable-name-different-id',
    })).toBe(false)
    expect(snapshotMatchesBlueprintSnapshotFilters({ ...item, workPackageId: null }, {
      projectId: 'project-1',
      blueprintSetId: 'set-1',
      workPackageId: 'wp-test',
      workPackageMode: 'untagged-or-matching',
    })).toBe(true)
  })

  it('returns unavailable only for narrow missing snapshot-table errors', async () => {
    const query = supabaseState.query
    query.limit.mockResolvedValueOnce({
      data: null,
      error: { code: '42P01', message: 'relation "public.blueprint_snapshots" does not exist' },
    })

    await expect(listBlueprintSnapshots()).resolves.toEqual({
      status: 'unavailable',
      message: 'Snapshot library is not available yet.',
    })
    expect(isMissingSnapshotTableError({ code: '42501', message: 'permission denied for table blueprint_snapshots' })).toBe(false)
    expect(isMissingSnapshotTableError({ message: 'Failed to fetch' })).toBe(false)
  })

  it('loads preview metadata by snapshot ID first and signs the private bucket for 600 seconds', async () => {
    const result = await getBlueprintSnapshotPreviewUrl(snapshotId)

    expect(result.status).toBe('available')
    expect(supabaseState.query.eq).toHaveBeenCalledWith('id', snapshotId)
    expect(supabaseState.query.is).toHaveBeenCalledWith('deleted_at', null)
    expect(supabaseState.createSignedUrl).toHaveBeenCalledWith(`${orgId}/project/set/${snapshotId}.png`, 600)
    expect(supabaseState.getPublicUrl).not.toHaveBeenCalled()
  })

  it('caches signed preview URLs before expiry without local storage', async () => {
    await getBlueprintSnapshotPreviewUrl(snapshotId)
    await getBlueprintSnapshotPreviewUrl(snapshotId)

    expect(supabaseState.createSignedUrl).toHaveBeenCalledTimes(1)
    expect(serviceSource).not.toContain('localStorage')
  })

  it('updates caption by live snapshot id with trimmed max-240 caption and empty as null', async () => {
    const query = supabaseState.query
    query.single.mockResolvedValueOnce({
      data: {
        id: snapshotId,
        project_id: 'project-1',
        project_name: 'Project One',
        blueprint_set_id: 'set-1',
        work_package_id: null,
        work_package_name: null,
        page_number: 1,
        caption: 'Updated',
        capture_metadata: metadata(),
        width: 100,
        height: 80,
        file_size_bytes: 10,
        captured_at: '2026-01-01T00:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
      },
      error: null,
    })

    const result = await updateBlueprintSnapshotCaption(snapshotId, `  ${'Updated'.padEnd(260, 'x')}  `)

    expect(result.status).toBe('available')
    expect(query.update.mock.calls[0][0].caption).toHaveLength(240)
    expect(query.eq).toHaveBeenCalledWith('id', snapshotId)
    expect(query.is).toHaveBeenCalledWith('deleted_at', null)

    await updateBlueprintSnapshotCaption(snapshotId, '   ')
    expect(query.update.mock.calls[1][0]).toEqual({ caption: null })
  })

  it('soft-deletes only untagged and unattached snapshots without removing storage objects', async () => {
    const query = supabaseState.query
    query.single
      .mockResolvedValueOnce({
        data: { id: snapshotId, work_package_id: null, assignment_snapshots: [] },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: snapshotId },
        error: null,
      })

    const result = await deleteBlueprintSnapshot(snapshotId)

    expect(result).toEqual({ status: 'deleted', snapshotId })
    expect(query.update.mock.calls[0][0].deleted_at).toEqual(expect.any(String))
    expect(query.eq).toHaveBeenCalledWith('id', snapshotId)
    expect(query.is).toHaveBeenCalledWith('work_package_id', null)
    expect(supabaseState.remove).not.toHaveBeenCalled()
  })

  it('rejects tagged snapshots before soft-delete', async () => {
    supabaseState.query.single.mockResolvedValueOnce({
      data: { id: snapshotId, work_package_id: 'wp-rough', assignment_snapshots: [] },
      error: null,
    })

    const result = await deleteBlueprintSnapshot(snapshotId)

    expect(result).toEqual({ status: 'rejected', message: 'Return this snapshot to Untagged before deleting it.' })
    expect(supabaseState.query.update).not.toHaveBeenCalled()
  })

  it('rejects attached snapshots even when currently Untagged', async () => {
    supabaseState.query.single.mockResolvedValueOnce({
      data: { id: snapshotId, work_package_id: null, assignment_snapshots: [{ snapshot_id: snapshotId }] },
      error: null,
    })

    const result = await deleteBlueprintSnapshot(snapshotId)

    expect(result).toEqual({ status: 'rejected', message: 'Attached to an issued Work Order.' })
    expect(supabaseState.query.update).not.toHaveBeenCalled()
  })
})
