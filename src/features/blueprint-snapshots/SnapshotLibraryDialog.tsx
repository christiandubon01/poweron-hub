import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Edit3, Image, Loader2, RotateCcw, Save, X } from 'lucide-react'
import {
  clearBlueprintSnapshotPreviewUrlCache,
  getBlueprintSnapshotPreviewUrl,
  listBlueprintSnapshots,
  updateBlueprintSnapshotCaption,
} from './blueprintSnapshotService'
import type {
  BlueprintSnapshotCaptureMode,
  BlueprintSnapshotLibraryItem,
  BlueprintSnapshotListFilters,
} from './types'

const MAX_SELECTED_SNAPSHOTS = 8

interface SnapshotLibraryDialogProps {
  open: boolean
  mode?: 'library' | 'picker'
  title?: string
  initialFilters?: BlueprintSnapshotListFilters
  selectedIds?: string[]
  onSelectedIdsChange?: (ids: string[]) => void
  onClose: () => void
}

export function SnapshotLibraryDialog({
  open,
  mode = 'library',
  title,
  initialFilters,
  selectedIds = [],
  onSelectedIdsChange,
  onClose,
}: SnapshotLibraryDialogProps) {
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
  const requestRef = useRef(0)
  const loadingRef = useRef(false)

  const initialFiltersKey = useMemo(() => JSON.stringify(initialFilters || {}), [initialFilters])
  const normalizedInitialFilters = useMemo(() => initialFilters || {}, [initialFiltersKey])

  useEffect(() => {
    if (!open) {
      requestRef.current += 1
      loadingRef.current = false
      clearBlueprintSnapshotPreviewUrlCache()
      return
    }
    setFilters(normalizedInitialFilters)
  }, [normalizedInitialFilters, open])

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
      setItems((prev) => [...prev, ...res.snapshots])
      setNextCursor(res.nextCursor)
      setStatus('idle')
    } else {
      setStatus(res.status)
      setMessage(res.message)
    }
  }, [filters, nextCursor])

  useEffect(() => {
    if (!open) return
    void loadInitialSnapshots()
  }, [filters, loadInitialSnapshots, open])

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

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100080] flex items-end justify-center bg-black/70 px-3 py-4 sm:items-center" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-gray-700 bg-[#111827] shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-gray-700 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-100">{title || (mode === 'picker' ? 'Attach snapshots' : 'Snapshot Library')}</h2>
            {mode === 'picker' ? <p className="text-xs text-gray-500">{selectedIds.length}/8 selected</p> : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-gray-400 hover:bg-white/5 hover:text-white" aria-label="Close snapshot library">
            <X size={18} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-h-0 overflow-y-auto p-4">
            <FilterBar filters={filters} onChange={(next) => { setFilters(next); setThumbnailUrls({}); setPreviewId(null) }} />
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
                  return (
                    <div key={item.id} className={`overflow-hidden rounded-lg border ${selected ? 'border-cyan-400 bg-cyan-950/20' : 'border-gray-700 bg-[#0d1320]'}`}>
                      <button type="button" onClick={() => setPreviewId(item.id)} className="block aspect-video w-full bg-black/30 text-left">
                        {thumbnailUrls[item.id] ? (
                          <img src={thumbnailUrls[item.id]} alt="" className="h-full w-full object-contain" />
                        ) : (
                          <span className="flex h-full items-center justify-center text-gray-500"><Image size={24} /></span>
                        )}
                      </button>
                      <div className="space-y-2 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-gray-200">{item.projectName || 'Project'}</p>
                            <p className="text-[11px] text-gray-500">Page {item.pageNumber || '-'} · {item.captureMode === 'area' ? 'Capture Area' : 'Full Page'}</p>
                          </div>
                          {mode === 'picker' ? (
                            <button type="button" onClick={() => toggleSelected(item.id)} className={`inline-flex min-h-9 items-center gap-1 rounded-md border px-2 text-xs font-semibold ${selected ? 'border-cyan-400 text-cyan-200' : 'border-gray-600 text-gray-300 hover:text-white'}`}>
                              {selected ? <Check size={13} /> : null}{selected ? 'Selected' : 'Select'}
                            </button>
                          ) : null}
                        </div>
                        <p className="text-[11px] text-gray-400">{item.workPackageName || 'Untagged'}</p>
                        {editingId === item.id ? (
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
                            <button type="button" onClick={() => { setEditingId(item.id); setCaptionDraft(item.caption || ''); setCaptionError('') }} className="rounded-md p-1.5 text-gray-500 hover:bg-white/5 hover:text-gray-200" aria-label="Edit caption">
                              <Edit3 size={13} />
                            </button>
                          </div>
                        )}
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
          </div>

          <aside className="min-h-[260px] border-t border-gray-700 bg-[#0b111d] p-4 lg:border-l lg:border-t-0">
            {previewId ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase text-gray-500">Preview</p>
                  <button type="button" onClick={() => setPreviewId(null)} className="rounded-md p-1.5 text-gray-500 hover:text-white" aria-label="Close preview"><X size={14} /></button>
                </div>
                <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-gray-700 bg-black/30">
                  {previewStatus === 'loading' ? <Loader2 size={20} className="animate-spin text-cyan-300" /> : previewUrl ? <img src={previewUrl} alt="" className="max-h-full max-w-full object-contain" /> : <p className="text-sm text-gray-500">Preview unavailable.</p>}
                </div>
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-gray-500">Select a snapshot to preview.</p>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

function FilterBar({ filters, onChange }: { filters: BlueprintSnapshotListFilters; onChange: (filters: BlueprintSnapshotListFilters) => void }) {
  const update = (patch: BlueprintSnapshotListFilters) => onChange({ ...filters, ...patch, cursor: null })
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-6">
      <TextFilter label="Project" value={filters.projectId || ''} onChange={(projectId) => update({ projectId })} />
      <TextFilter label="Blueprint" value={filters.blueprintSetId || ''} onChange={(blueprintSetId) => update({ blueprintSetId })} />
      <TextFilter label="Page" value={filters.pageNumber ? String(filters.pageNumber) : ''} onChange={(value) => update({ pageNumber: value ? Math.max(1, Math.floor(Number(value) || 1)) : null })} />
      <TextFilter label="Work Package" value={filters.workPackageId || ''} onChange={(workPackageId) => update({ workPackageId })} />
      <label className="block text-[11px] font-semibold uppercase text-gray-500">
        Mode
        <select value={filters.captureMode || ''} onChange={(e) => update({ captureMode: (e.target.value || null) as BlueprintSnapshotCaptureMode | null })} className="mt-1 h-10 w-full rounded-md border border-gray-700 bg-[#0b111d] px-2 text-xs text-gray-100">
          <option value="">Any</option>
          <option value="area">Area</option>
          <option value="full-page">Full page</option>
        </select>
      </label>
      <button type="button" onClick={() => onChange({})} className="mt-5 inline-flex h-10 items-center justify-center gap-1 rounded-md border border-gray-700 px-2 text-xs font-semibold text-gray-300 hover:text-white">
        <RotateCcw size={13} /> Reset
      </button>
    </div>
  )
}

function TextFilter({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-[11px] font-semibold uppercase text-gray-500">
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value.trim())} className="mt-1 h-10 w-full rounded-md border border-gray-700 bg-[#0b111d] px-2 text-xs text-gray-100" />
    </label>
  )
}

function SafeState({ message }: { message: string }) {
  return <div className="rounded-lg border border-gray-700 bg-[#0d1320] px-4 py-8 text-center text-sm text-gray-400">{message}</div>
}

function formatDate(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}
