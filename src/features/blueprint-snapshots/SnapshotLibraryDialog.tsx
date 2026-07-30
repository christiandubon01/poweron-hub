import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, Edit3, Image, Loader2, RotateCcw, Save, Trash2, X } from 'lucide-react'
import { BlueprintSnapshotPreviewViewport } from './BlueprintSnapshotPreviewViewport'
import {
  clearBlueprintSnapshotPreviewUrlCache,
  deleteBlueprintSnapshot,
  getBlueprintSnapshotPreviewUrl,
  listBlueprintSnapshots,
  subscribeBlueprintSnapshotLibraryChanges,
  updateBlueprintSnapshotCaption,
  updateBlueprintSnapshotWorkPackage,
} from './blueprintSnapshotService'
import type {
  BlueprintSnapshotCaptureMode,
  BlueprintSnapshotLibraryChangeEvent,
  BlueprintSnapshotLibraryItem,
  BlueprintSnapshotListFilters,
} from './types'

const MAX_SELECTED_SNAPSHOTS = 8
type SnapshotBrowserMode = 'manage' | 'select'

export interface SnapshotFilterOption {
  id: string
  label: string
}

interface SnapshotLibraryDialogProps {
  open: boolean
  mode?: SnapshotBrowserMode | 'library' | 'picker'
  title?: string
  initialFilters?: BlueprintSnapshotListFilters
  projectOptions?: SnapshotFilterOption[]
  blueprintOptions?: SnapshotFilterOption[]
  workPackageOptions?: SnapshotFilterOption[]
  selectedIds?: string[]
  onSelectedIdsChange?: (ids: string[]) => void
  onClose: () => void
}

interface WorkPackageSnapshotSectionProps {
  projectId: string | null | undefined
  blueprintSetId: string | null | undefined
  projectName?: string | null
  blueprintName?: string | null
  workPackageId: string | null | undefined
  workPackageName: string | null | undefined
  workPackageOptions?: SnapshotFilterOption[]
}

export function WorkPackageSnapshotSection({
  projectId,
  blueprintSetId,
  projectName,
  blueprintName,
  workPackageId,
  workPackageName,
  workPackageOptions = [],
}: WorkPackageSnapshotSectionProps) {
  const [items, setItems] = useState<BlueprintSnapshotLibraryItem[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'unavailable' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({})
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const contextReady = Boolean(projectId && blueprintSetId && workPackageId)

  const load = useCallback(async () => {
    if (!contextReady) {
      setItems([])
      return
    }
    setStatus('loading')
    const res = await listBlueprintSnapshots({ projectId, blueprintSetId, workPackageId, limit: 12 })
    if (res.status === 'available') {
      setItems(res.snapshots)
      setStatus('idle')
      setMessage('')
    } else {
      setItems([])
      setStatus(res.status)
      setMessage(res.message)
    }
  }, [blueprintSetId, contextReady, projectId, workPackageId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    return subscribeBlueprintSnapshotLibraryChanges((event) => {
      if (event.type === 'delete') {
        setItems((prev) => prev.filter((row) => row.id !== event.snapshotId))
        setThumbnailUrls((prev) => {
          const next = { ...prev }
          delete next[event.snapshotId]
          return next
        })
        return
      }
      if (event.type === 'upsert') {
        setItems((prev) => {
          const matches = contextReady
            && event.snapshot.projectId === projectId
            && event.snapshot.blueprintSetId === blueprintSetId
            && event.snapshot.workPackageId === workPackageId
          const without = prev.filter((row) => row.id !== event.snapshot.id)
          return matches ? [event.snapshot, ...without] : without
        })
        return
      }
      setThumbnailUrls({})
      void load()
    })
  }, [blueprintSetId, contextReady, load, projectId, workPackageId])

  useEffect(() => {
    const missing = items.filter((item) => !thumbnailUrls[item.id])
    if (missing.length === 0) return
    let cancelled = false
    missing.forEach((item) => {
      getBlueprintSnapshotPreviewUrl(item.id).then((res) => {
        if (!cancelled && res.status === 'available') setThumbnailUrls((prev) => ({ ...prev, [item.id]: res.signedUrl }))
      })
    })
    return () => { cancelled = true }
  }, [items, thumbnailUrls])

  const removeFromWorkPackage = async (item: BlueprintSnapshotLibraryItem) => {
    const res = await updateBlueprintSnapshotWorkPackage(item.id, { workPackageId: null, workPackageName: null })
    if (res.status !== 'available') setMessage(res.message || 'Could not update Work Package.')
    else setItems((prev) => prev.filter((row) => row.id !== item.id))
  }

  return (
    <div className="mt-3 rounded-lg border border-gray-800 bg-gray-950/30 p-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold text-gray-300">Snapshots</div>
          <div className="mt-0.5 text-[10px] text-gray-500">{workPackageName || 'Work Package'} snapshot organization</div>
        </div>
        <button type="button" onClick={() => setLibraryOpen(true)} disabled={!contextReady} className="rounded border border-gray-700 px-2 py-1 text-[10px] font-semibold text-gray-300 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50">
          Manage
        </button>
      </div>
      {status === 'loading' ? <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-500"><Loader2 size={12} className="animate-spin" /> Loading snapshots...</div> : null}
      {status === 'unavailable' ? <div className="mt-2 text-[10px] text-gray-500">Snapshot library is not available yet.</div> : null}
      {status === 'error' && message ? <div className="mt-2 text-[10px] text-red-300">{message}</div> : null}
      {status === 'idle' && items.length === 0 ? <div className="mt-2 text-[10px] italic text-gray-600">No snapshots tagged to this Work Package.</div> : null}
      {items.length > 0 ? (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {items.map((item) => (
            <div key={item.id} className="overflow-hidden rounded border border-gray-800 bg-[#0d1320]">
              <button type="button" onClick={() => setPreviewId(item.id)} className="block aspect-video w-full bg-black/30">
                <SnapshotImage snapshotId={item.id} url={thumbnailUrls[item.id] || null} alt="" compact onFreshUrl={(signedUrl) => setThumbnailUrls((prev) => ({ ...prev, [item.id]: signedUrl }))} />
              </button>
              <div className="flex items-center gap-2 p-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[10px] font-semibold text-gray-300">{item.caption || 'No caption'}</div>
                  <div className="text-[9px] text-gray-500">Page {item.pageNumber || '-'}</div>
                </div>
                <button type="button" onClick={() => void removeFromWorkPackage(item)} className="rounded px-1.5 py-1 text-[10px] text-red-300 hover:bg-red-950/30">Remove</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <SnapshotLibraryDialog
        open={libraryOpen}
        mode="manage"
        title="Snapshot Library"
        initialFilters={{ projectId, blueprintSetId, workPackageId }}
        projectOptions={projectId ? [{ id: projectId, label: projectName || 'Project' }] : []}
        blueprintOptions={blueprintSetId ? [{ id: blueprintSetId, label: blueprintName || 'Blueprint' }] : []}
        workPackageOptions={workPackageOptions}
        onClose={() => setLibraryOpen(false)}
      />
      {previewId ? (
        <SnapshotLibraryDialog
          open={Boolean(previewId)}
          mode="manage"
          title="Snapshot Preview"
          initialFilters={{ projectId, blueprintSetId, workPackageId }}
          projectOptions={projectId ? [{ id: projectId, label: projectName || 'Project' }] : []}
          blueprintOptions={blueprintSetId ? [{ id: blueprintSetId, label: blueprintName || 'Blueprint' }] : []}
          workPackageOptions={workPackageOptions}
          onClose={() => setPreviewId(null)}
        />
      ) : null}
    </div>
  )
}

export function SnapshotLibraryDialog({
  open,
  mode = 'manage',
  title,
  initialFilters,
  projectOptions = [],
  blueprintOptions = [],
  workPackageOptions = [],
  selectedIds = [],
  onSelectedIdsChange,
  onClose,
}: SnapshotLibraryDialogProps) {
  const browserMode: SnapshotBrowserMode = mode === 'picker' ? 'select' : mode === 'library' ? 'manage' : mode
  const [filters, setFilters] = useState<BlueprintSnapshotListFilters>(initialFilters || {})
  const [items, setItems] = useState<BlueprintSnapshotLibraryItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'loading-more' | 'unavailable' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewStatus, setPreviewStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [captionDraft, setCaptionDraft] = useState('')
  const [captionError, setCaptionError] = useState('')
  const [workPackageError, setWorkPackageError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<BlueprintSnapshotLibraryItem | null>(null)
  const [deleteStatus, setDeleteStatus] = useState<'idle' | 'deleting'>('idle')
  const [deleteMessage, setDeleteMessage] = useState('')
  const requestRef = useRef(0)
  const loadingRef = useRef(false)
  const filtersRef = useRef<BlueprintSnapshotListFilters>(filters)

  const initialFiltersKey = useMemo(() => JSON.stringify(initialFilters || {}), [initialFilters])
  const normalizedInitialFilters = useMemo(() => initialFilters || {}, [initialFiltersKey])

  useEffect(() => {
    if (!open) {
      requestRef.current += 1
      loadingRef.current = false
      clearBlueprintSnapshotPreviewUrlCache()
      setPreviewId(null)
      setPreviewUrl(null)
      setPreviewStatus('idle')
      setDeleteTarget(null)
      setDeleteStatus('idle')
      setDeleteMessage('')
      return
    }
    setFilters(normalizedInitialFilters)
  }, [normalizedInitialFilters, open])

  useEffect(() => {
    filtersRef.current = filters
  }, [filters])

  const loadInitialSnapshots = useCallback(async () => {
    if (loadingRef.current) return
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    loadingRef.current = true
    setStatus('loading')
    setMessage('')
    const res = await listBlueprintSnapshots({
      ...filters,
      cursor: null,
      limit: 24,
    })
    if (requestRef.current !== requestId) return
    loadingRef.current = false
    if (res.status === 'available') {
      setItems(res.snapshots)
      setNextCursor(res.nextCursor)
      setStatus('idle')
    } else {
      setItems([])
      setNextCursor(null)
      setStatus(res.status)
      setMessage(res.message)
    }
  }, [filters])

  const loadMoreSnapshots = useCallback(async () => {
    if (!nextCursor || loadingRef.current) return
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    loadingRef.current = true
    setStatus('loading-more')
    setMessage('')
    const res = await listBlueprintSnapshots({
      ...filters,
      cursor: nextCursor,
      limit: 24,
    })
    if (requestRef.current !== requestId) return
    loadingRef.current = false
    if (res.status === 'available') {
      setItems((prev) => dedupeSnapshotItems([...prev, ...res.snapshots]))
      setNextCursor(res.nextCursor)
      setStatus('idle')
    } else {
      setStatus(res.status)
      setMessage(res.message)
    }
  }, [filters, nextCursor])

  const applyLibraryChange = useCallback((event: BlueprintSnapshotLibraryChangeEvent) => {
    if (event.type === 'delete') {
      clearBlueprintSnapshotPreviewUrlCache(event.snapshotId)
      setItems((prev) => prev.filter((row) => row.id !== event.snapshotId))
      setThumbnailUrls((prev) => {
        const next = { ...prev }
        delete next[event.snapshotId]
        return next
      })
      setPreviewId((current) => {
        if (current !== event.snapshotId) return current
        setPreviewUrl(null)
        setPreviewStatus('idle')
        return null
      })
      setDeleteTarget((current) => current?.id === event.snapshotId ? null : current)
      return
    }
    if (event.type === 'upsert') {
      const matches = snapshotMatchesFilters(event.snapshot, filtersRef.current)
      setItems((prev) => {
        const without = prev.filter((row) => row.id !== event.snapshot.id)
        return matches ? [event.snapshot, ...without] : without
      })
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void loadInitialSnapshots()
  }, [filters, loadInitialSnapshots, open])

  useEffect(() => {
    if (!open) return
    return subscribeBlueprintSnapshotLibraryChanges((event) => {
      if (event.type === 'refresh') {
        setThumbnailUrls({})
        void loadInitialSnapshots()
        return
      }
      applyLibraryChange(event)
    })
  }, [applyLibraryChange, loadInitialSnapshots, open])

  useEffect(() => {
    if (!open) return
    const visible = items.slice(0, 12).filter((item) => !thumbnailUrls[item.id])
    if (visible.length === 0) return
    let cancelled = false
    visible.forEach((item) => {
      getBlueprintSnapshotPreviewUrl(item.id).then((res) => {
        if (cancelled || res.status !== 'available') return
        setThumbnailUrls((prev) => ({ ...prev, [item.id]: res.signedUrl }))
      })
    })
    return () => { cancelled = true }
  }, [items, open, thumbnailUrls])

  useEffect(() => {
    if (!open || !previewId) {
      setPreviewUrl(null)
      setPreviewStatus('idle')
      return
    }
    let cancelled = false
    setPreviewStatus('loading')
    getBlueprintSnapshotPreviewUrl(previewId).then((res) => {
      if (cancelled) return
      if (res.status === 'available') {
        setPreviewUrl(res.signedUrl)
        setPreviewStatus('idle')
      } else {
        setPreviewUrl(null)
        setPreviewStatus('error')
      }
    })
    return () => { cancelled = true }
  }, [open, previewId])

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  const toggleSelected = (id: string) => {
    if (!onSelectedIdsChange) return
    if (selectedSet.has(id)) {
      onSelectedIdsChange(selectedIds.filter((x) => x !== id))
      return
    }
    if (selectedIds.length >= MAX_SELECTED_SNAPSHOTS) {
      setMessage('Maximum of 8 snapshots.')
      return
    }
    onSelectedIdsChange([...selectedIds, id])
  }

  const saveCaption = async (item: BlueprintSnapshotLibraryItem) => {
    setCaptionError('')
    const res = await updateBlueprintSnapshotCaption(item.id, captionDraft)
    if (res.status !== 'available') {
      setCaptionError('Could not update caption.')
      return
    }
    setItems((prev) => prev.map((row) => row.id === item.id ? res.snapshot : row))
    setEditingId(null)
  }

  const assignWorkPackage = async (item: BlueprintSnapshotLibraryItem, workPackageId: string) => {
    setWorkPackageError('')
    const option = workPackageOptions.find((entry) => entry.id === workPackageId)
    const res = await updateBlueprintSnapshotWorkPackage(item.id, {
      workPackageId: option?.id || null,
      workPackageName: option?.label || null,
    })
    if (res.status !== 'available') {
      setWorkPackageError(res.message || 'Could not update Work Package.')
      return
    }
    setItems((prev) => prev.map((row) => row.id === item.id ? res.snapshot : row))
  }

  const requestDelete = (item: BlueprintSnapshotLibraryItem) => {
    setDeleteMessage('')
    if (item.attachedToIssuedWorkOrder) {
      setDeleteMessage('Attached to an issued Work Order.')
      return
    }
    if (item.workPackageId) {
      setDeleteMessage('Return this snapshot to Untagged before deleting it.')
      return
    }
    setDeleteTarget(item)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleteStatus('deleting')
    setDeleteMessage('')
    const res = await deleteBlueprintSnapshot(deleteTarget.id)
    setDeleteStatus('idle')
    if (res.status === 'deleted') {
      setDeleteTarget(null)
      setMessage('')
      return
    }
    setDeleteTarget(null)
    setDeleteMessage(res.message || 'Snapshot can no longer be deleted.')
  }

  const projectFilterOptions = useMemo(
    () => mergeFilterOptions(projectOptions, items.map((item) => ({ id: item.projectId, label: item.projectName || 'Project' }))),
    [items, projectOptions],
  )
  const blueprintFilterOptions = useMemo(
    () => mergeFilterOptions(blueprintOptions, items.map((item) => ({ id: item.blueprintSetId, label: item.blueprintTitle || 'Blueprint' }))),
    [blueprintOptions, items],
  )
  const previewItem = useMemo(
    () => items.find((item) => item.id === previewId) || null,
    [items, previewId],
  )

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100080] flex items-end justify-center bg-black/70 px-3 py-4 sm:items-center" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-gray-700 bg-[#111827] shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-gray-700 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-100">{title || (browserMode === 'select' ? 'Attach snapshots' : 'Snapshot Library')}</h2>
            {browserMode === 'select' ? <p className="text-xs text-gray-500">{selectedIds.length}/8 selected</p> : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-gray-400 hover:bg-white/5 hover:text-white" aria-label="Close snapshot library">
            <X size={18} />
          </button>
        </div>

        <FilterBar
          filters={filters}
          projectOptions={projectFilterOptions}
          blueprintOptions={blueprintFilterOptions}
          workPackageOptions={workPackageOptions}
          onChange={(next) => { setFilters(next); setThumbnailUrls({}); setPreviewId(null) }}
        />

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-h-0 overflow-y-auto p-4">
            {status === 'loading' ? (
              <div className="flex items-center gap-2 py-10 text-sm text-gray-400"><Loader2 size={16} className="animate-spin text-cyan-300" /> Loading snapshots...</div>
            ) : status === 'unavailable' ? (
              <SafeState message="Snapshot library is not available yet." />
            ) : status === 'error' ? (
              <SafeState message={message || 'Network error. Try again.'} />
            ) : items.length === 0 ? (
              <SafeState message="No snapshots found." />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((item) => {
                  const selected = selectedSet.has(item.id)
                  const deleteBlockedReason = item.attachedToIssuedWorkOrder
                    ? 'Attached to an issued Work Order.'
                    : item.workPackageId
                      ? 'Return to Untagged before deleting.'
                      : ''
                  return (
                    <div key={item.id} className={`overflow-hidden rounded-lg border ${selected ? 'border-cyan-400 bg-cyan-950/20' : 'border-gray-700 bg-[#0d1320]'}`}>
                      <button type="button" onClick={() => setPreviewId(item.id)} className="block aspect-video w-full bg-black/30 text-left">
                        <SnapshotImage
                          snapshotId={item.id}
                          url={thumbnailUrls[item.id] || null}
                          alt=""
                          compact
                          onFreshUrl={(signedUrl) => setThumbnailUrls((prev) => ({ ...prev, [item.id]: signedUrl }))}
                        />
                      </button>
                      <div className="space-y-2 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-gray-200">{item.projectName || 'Project'}</p>
                            <p className="truncate text-[11px] text-gray-500">{item.blueprintTitle || 'Blueprint'} · Page {item.pageNumber || '-'} · {item.captureMode === 'area' ? 'Capture Area' : 'Full Page'}</p>
                          </div>
                          {browserMode === 'select' ? (
                            <button type="button" onClick={() => toggleSelected(item.id)} className={`inline-flex min-h-9 items-center gap-1 rounded-md border px-2 text-xs font-semibold ${selected ? 'border-cyan-400 text-cyan-200' : 'border-gray-600 text-gray-300 hover:text-white'}`}>
                              {selected ? <Check size={13} /> : null}{selected ? 'Selected' : 'Select'}
                            </button>
                          ) : null}
                        </div>
                        {browserMode === 'manage' ? (
                          <label className="block text-[11px] font-semibold uppercase text-gray-500">
                            Work Package
                            <select
                              value={item.workPackageId || ''}
                              onChange={(e) => void assignWorkPackage(item, e.target.value)}
                              className="mt-1 h-9 w-full rounded-md border border-gray-700 bg-[#111827] px-2 text-xs text-gray-100"
                            >
                              <option value="">Untagged</option>
                              {workPackageOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                            </select>
                          </label>
                        ) : (
                          <p className="text-[11px] text-gray-400">{item.workPackageName || 'Untagged'}</p>
                        )}
                        {editingId === item.id && browserMode === 'manage' ? (
                          <div className="space-y-2">
                            <textarea value={captionDraft} onChange={(e) => setCaptionDraft(e.target.value.slice(0, 240))} rows={2} className="w-full resize-none rounded-md border border-gray-600 bg-[#111827] px-2 py-1.5 text-xs text-gray-100" />
                            {captionError ? <p className="text-[11px] text-red-300">{captionError}</p> : null}
                            <div className="flex gap-2">
                              <button type="button" onClick={() => void saveCaption(item)} className="inline-flex min-h-8 items-center gap-1 rounded-md bg-cyan-600 px-2 text-xs font-semibold text-white"><Save size={12} /> Save</button>
                              <button type="button" onClick={() => setEditingId(null)} className="min-h-8 rounded-md px-2 text-xs text-gray-400 hover:text-white">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between gap-2">
                            <p className="min-h-5 flex-1 text-xs text-gray-300">{item.caption || 'No caption'}</p>
                            {browserMode === 'manage' ? (
                              <button type="button" onClick={() => { setEditingId(item.id); setCaptionDraft(item.caption || ''); setCaptionError('') }} className="rounded-md p-1.5 text-gray-500 hover:bg-white/5 hover:text-gray-200" aria-label="Edit caption">
                                <Edit3 size={13} />
                              </button>
                            ) : null}
                          </div>
                        )}
                        {browserMode === 'manage' ? (
                          <div className="flex items-center justify-between gap-2 border-t border-gray-800 pt-2">
                            {deleteBlockedReason ? (
                              <span className="inline-flex min-h-8 items-center gap-1 text-[11px] text-gray-500">
                                <AlertTriangle size={12} />
                                {deleteBlockedReason}
                              </span>
                            ) : <span className="text-[11px] text-gray-600">Untagged</span>}
                            <button
                              type="button"
                              onClick={() => requestDelete(item)}
                              disabled={Boolean(deleteBlockedReason)}
                              className="inline-flex min-h-8 items-center gap-1 rounded-md border border-red-800/60 px-2 text-xs font-semibold text-red-300 hover:bg-red-950/30 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
                            >
                              <Trash2 size={12} />
                              Delete
                            </button>
                          </div>
                        ) : null}
                        <p className="text-[11px] text-gray-600">{formatDate(item.createdAt || item.capturedAt)}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {nextCursor ? (
              <button type="button" onClick={() => void loadMoreSnapshots()} disabled={status === 'loading' || status === 'loading-more'} className="mt-4 min-h-10 rounded-md border border-gray-600 px-3 text-sm text-gray-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-50">Load more</button>
            ) : null}
            {status === 'loading-more' ? <p className="mt-4 text-sm text-gray-500">Loading more...</p> : null}
            {workPackageError ? <p className="mt-3 text-xs text-red-300">{workPackageError}</p> : null}
            {deleteMessage ? <p className="mt-3 text-xs text-red-300">{deleteMessage}</p> : null}
          </div>

          <aside className="min-h-[260px] border-t border-gray-700 bg-[#0b111d] p-4 lg:border-l lg:border-t-0">
            {previewId ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase text-gray-500">Preview</p>
                  <button type="button" onClick={() => setPreviewId(null)} className="rounded-md p-1.5 text-gray-500 hover:text-white" aria-label="Close preview"><X size={14} /></button>
                </div>
                <div className="flex h-[min(56vh,520px)] min-h-[320px] items-center justify-center overflow-hidden">
                  {previewStatus === 'loading' ? (
                    <div className="flex h-full w-full items-center justify-center rounded-lg border border-gray-700 bg-black/30">
                      <Loader2 size={20} className="animate-spin text-cyan-300" />
                    </div>
                  ) : previewUrl && previewItem ? (
                    <BlueprintSnapshotPreviewViewport
                      imageUrl={previewUrl}
                      imageWidth={Math.max(1, previewItem.width || 1)}
                      imageHeight={Math.max(1, previewItem.height || 1)}
                      accessibleLabel="Snapshot preview"
                      resetKey={previewId}
                      onError={() => {
                        setPreviewUrl(null)
                        setPreviewStatus('error')
                      }}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center rounded-lg border border-gray-700 bg-black/30">
                      <SnapshotImage snapshotId={previewId} url={previewUrl} alt="Snapshot preview" onFreshUrl={setPreviewUrl} />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="py-10 text-center text-sm text-gray-500">
                <Image size={22} className="mx-auto mb-2 text-gray-600" />
                Select a snapshot to preview.
              </div>
            )}
          </aside>
        </div>
        {deleteTarget ? (
          <div className="fixed inset-0 z-[100081] flex items-center justify-center bg-black/70 px-4" onClick={(e) => { if (e.target === e.currentTarget && deleteStatus !== 'deleting') setDeleteTarget(null) }}>
            <div role="alertdialog" aria-modal="true" aria-labelledby="delete-snapshot-title" className="w-full max-w-md rounded-lg border border-gray-700 bg-[#111827] p-4 shadow-2xl">
              <div className="flex items-start gap-3">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-300" />
                <div>
                  <h3 id="delete-snapshot-title" className="text-sm font-semibold text-gray-100">Delete saved snapshot?</h3>
                  <p className="mt-2 text-sm text-gray-300">
                    Delete {deleteTarget.caption ? `"${deleteTarget.caption}"` : `Page ${deleteTarget.pageNumber || '-'}`} from the saved Snapshot Library. This removes the saved snapshot only; Blueprint annotations stay unchanged.
                  </p>
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setDeleteTarget(null)} disabled={deleteStatus === 'deleting'} className="rounded-md border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-white/5 disabled:opacity-40">Cancel</button>
                <button type="button" onClick={() => void confirmDelete()} disabled={deleteStatus === 'deleting'} className="inline-flex items-center gap-2 rounded-md border border-red-700 bg-red-700 px-3 py-2 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-40">
                  {deleteStatus === 'deleting' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Delete
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function FilterBar({
  filters,
  projectOptions,
  blueprintOptions,
  workPackageOptions,
  onChange,
}: {
  filters: BlueprintSnapshotListFilters
  projectOptions: SnapshotFilterOption[]
  blueprintOptions: SnapshotFilterOption[]
  workPackageOptions: SnapshotFilterOption[]
  onChange: (filters: BlueprintSnapshotListFilters) => void
}) {
  const update = (patch: BlueprintSnapshotListFilters) => onChange({ ...filters, ...patch, cursor: null })
  return (
    <div data-snapshot-filter-toolbar="shared" className="border-b border-gray-700 px-4 py-3">
      <div className="grid w-full grid-cols-2 items-end gap-x-3 gap-y-3 md:grid-cols-3 xl:grid-cols-6">
      <SelectFilter label="Project" value={filters.projectId || ''} options={projectOptions} fallbackLabel="Current project" onChange={(projectId) => update({ projectId })} />
      <SelectFilter label="Blueprint" value={filters.blueprintSetId || ''} options={blueprintOptions} fallbackLabel="Current Blueprint" onChange={(blueprintSetId) => update({ blueprintSetId })} />
      <TextFilter label="Page" value={filters.pageNumber ? String(filters.pageNumber) : ''} onChange={(value) => update({ pageNumber: value ? Math.max(1, Math.floor(Number(value) || 1)) : null })} />
      <label className="flex min-w-0 flex-col justify-end text-[11px] font-semibold uppercase text-gray-500">
        <span className="mb-1 h-4 whitespace-nowrap leading-4">Work Package</span>
        <select
          value={filters.workPackageMode === 'untagged' ? '__untagged__' : filters.workPackageId || ''}
          onChange={(e) => {
            if (e.target.value === '__untagged__') update({ workPackageId: null, workPackageMode: 'untagged' })
            else update({ workPackageId: e.target.value || null, workPackageMode: 'any' })
          }}
          className="h-10 w-full min-w-0 truncate rounded-md border border-gray-700 bg-[#0b111d] px-2 text-xs text-gray-100"
        >
          <option value="">Any</option>
          <option value="__untagged__">Untagged</option>
          {workPackageOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
      <label className="flex min-w-0 flex-col justify-end text-[11px] font-semibold uppercase text-gray-500">
        <span className="mb-1 h-4 whitespace-nowrap leading-4">Mode</span>
        <select value={filters.captureMode || ''} onChange={(e) => update({ captureMode: (e.target.value || null) as BlueprintSnapshotCaptureMode | null })} className="h-10 w-full min-w-0 truncate rounded-md border border-gray-700 bg-[#0b111d] px-2 text-xs text-gray-100">
          <option value="">Any</option>
          <option value="area">Capture Area</option>
          <option value="full-page">Full Page</option>
        </select>
      </label>
      <div className="flex min-w-0 flex-col justify-end">
        <span aria-hidden="true" className="mb-1 h-4 leading-4" />
        <button type="button" onClick={() => onChange({})} className="inline-flex h-10 w-full min-w-0 items-center justify-center gap-1 rounded-md border border-gray-700 px-2 text-xs font-semibold text-gray-300 hover:text-white">
          <RotateCcw size={13} /> Reset
        </button>
      </div>
      </div>
    </div>
  )
}

function SelectFilter({ label, value, options, fallbackLabel, onChange }: { label: string; value: string; options: SnapshotFilterOption[]; fallbackLabel: string; onChange: (value: string) => void }) {
  const hasValue = value && !options.some((option) => option.id === value)
  return (
    <label className="flex min-w-0 flex-col justify-end text-[11px] font-semibold uppercase text-gray-500">
      <span className="mb-1 h-4 whitespace-nowrap leading-4">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-10 w-full min-w-0 truncate rounded-md border border-gray-700 bg-[#0b111d] px-2 text-xs text-gray-100">
        <option value="">Any</option>
        {hasValue ? <option value={value}>{fallbackLabel}</option> : null}
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  )
}

function TextFilter({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex min-w-0 flex-col justify-end text-[11px] font-semibold uppercase text-gray-500">
      <span className="mb-1 h-4 whitespace-nowrap leading-4">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value.trim())} className="h-10 w-full min-w-0 rounded-md border border-gray-700 bg-[#0b111d] px-2 text-xs text-gray-100" />
    </label>
  )
}

function SnapshotImage({ snapshotId, url, alt, compact = false, onFreshUrl }: { snapshotId: string; url: string | null; alt: string; compact?: boolean; onFreshUrl: (url: string) => void }) {
  const [status, setStatus] = useState<'idle' | 'refreshing' | 'failed'>('idle')
  const [attempts, setAttempts] = useState(0)

  useEffect(() => {
    setStatus('idle')
    setAttempts(0)
  }, [snapshotId, url])

  const refresh = useCallback(async () => {
    setStatus('refreshing')
    clearBlueprintSnapshotPreviewUrlCache(snapshotId)
    const res = await getBlueprintSnapshotPreviewUrl(snapshotId, { forceRefresh: true })
    if (res.status === 'available') {
      setAttempts((prev) => prev + 1)
      onFreshUrl(res.signedUrl)
      setStatus('idle')
    } else {
      setStatus('failed')
    }
  }, [onFreshUrl, snapshotId])

  if (!url || status === 'refreshing') {
    return <span className="flex h-full w-full items-center justify-center text-gray-500">{status === 'refreshing' ? <Loader2 size={compact ? 18 : 22} className="animate-spin text-cyan-300" /> : <Image size={compact ? 24 : 28} />}</span>
  }

  if (status === 'failed') {
    return (
      <span className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center text-xs text-gray-500">
        Preview unavailable.
        <button type="button" onClick={(e) => { e.stopPropagation(); void refresh() }} className="rounded-md border border-gray-600 px-2 py-1 text-xs font-semibold text-gray-300 hover:text-white">Retry</button>
      </span>
    )
  }

  return (
    <img
      key={url}
      src={url}
      alt={alt}
      className="h-full w-full object-contain"
      onError={(e) => {
        e.currentTarget.style.display = 'none'
        if (attempts >= 1) setStatus('failed')
        else void refresh()
      }}
    />
  )
}

function SafeState({ message }: { message: string }) {
  return <div className="rounded-lg border border-gray-700 bg-[#0d1320] px-4 py-8 text-center text-sm text-gray-400">{message}</div>
}

function mergeFilterOptions(...groups: SnapshotFilterOption[][]): SnapshotFilterOption[] {
  const seen = new Set<string>()
  const merged: SnapshotFilterOption[] = []
  for (const group of groups) {
    group.forEach((option) => {
      if (!option.id || seen.has(option.id)) return
      seen.add(option.id)
      merged.push(option)
    })
  }
  return merged
}

function dedupeSnapshotItems(items: BlueprintSnapshotLibraryItem[]): BlueprintSnapshotLibraryItem[] {
  const seen = new Set<string>()
  const deduped: BlueprintSnapshotLibraryItem[] = []
  items.forEach((item) => {
    if (!item.id || seen.has(item.id)) return
    seen.add(item.id)
    deduped.push(item)
  })
  return deduped
}

function snapshotMatchesFilters(item: BlueprintSnapshotLibraryItem, filters: BlueprintSnapshotListFilters): boolean {
  if (filters.projectId && item.projectId !== filters.projectId) return false
  if (filters.blueprintSetId && item.blueprintSetId !== filters.blueprintSetId) return false
  if (filters.pageNumber && item.pageNumber !== filters.pageNumber) return false
  if (filters.captureMode && item.captureMode !== filters.captureMode) return false
  if (filters.workPackageMode === 'untagged') return item.workPackageId == null
  if (filters.workPackageMode === 'untagged-or-matching' && filters.workPackageId) {
    return item.workPackageId == null || item.workPackageId === filters.workPackageId
  }
  if (filters.workPackageId) return item.workPackageId === filters.workPackageId
  return true
}

function formatDate(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}
