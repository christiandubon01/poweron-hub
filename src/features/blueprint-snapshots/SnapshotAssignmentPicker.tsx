import React, { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Image, Paperclip, Trash2 } from 'lucide-react'
import { getBlueprintSnapshotsByIds } from './blueprintSnapshotService'
import { SnapshotLibraryDialog } from './SnapshotLibraryDialog'
import type { BlueprintSnapshotLibraryItem } from './types'

interface SnapshotAssignmentPickerProps {
  projectId: string
  blueprintSetId: string
  workPackageId: string
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

export function SnapshotAssignmentPicker({
  projectId,
  blueprintSetId,
  workPackageId,
  selectedIds,
  onChange,
}: SnapshotAssignmentPickerProps) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<BlueprintSnapshotLibraryItem[]>([])
  const [message, setMessage] = useState('')
  const contextReady = !!projectId && !!blueprintSetId && !!workPackageId

  useEffect(() => {
    if (selectedIds.length === 0) {
      setItems([])
      return
    }
    let cancelled = false
    getBlueprintSnapshotsByIds(selectedIds).then((res) => {
      if (cancelled) return
      if (res.status === 'available') setItems(res.snapshots)
      else setMessage(res.message)
    })
    return () => { cancelled = true }
  }, [selectedIds])

  const move = (index: number, delta: -1 | 1) => {
    const next = [...selectedIds]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    const [id] = next.splice(index, 1)
    next.splice(target, 0, id)
    onChange(next)
  }

  const remove = (id: string) => onChange(selectedIds.filter((x) => x !== id))

  return (
    <div className="rounded-xl border border-gray-700/60 bg-[var(--bg-secondary)] p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-gray-400">Snapshots</p>
          <p className="text-xs text-gray-500">{selectedIds.length}/8 selected</p>
        </div>
        <button
          type="button"
          disabled={!contextReady}
          onClick={() => setOpen(true)}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-gray-600 px-3 text-sm font-semibold text-gray-200 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Paperclip size={15} /> Attach snapshots
        </button>
      </div>

      {!contextReady ? (
        <p className="mt-2 text-xs text-amber-300">Select a project, Blueprint, and Work Package before attaching snapshots.</p>
      ) : null}
      {message ? <p className="mt-2 text-xs text-red-300">{message}</p> : null}

      {selectedIds.length > 0 ? (
        <div className="mt-3 space-y-2">
          {selectedIds.map((id, index) => {
            const item = items.find((row) => row.id === id)
            return (
              <div key={id} className="flex items-center gap-2 rounded-lg border border-gray-700 bg-[#111827] p-2">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-gray-700 bg-black/20 text-gray-500">
                  <Image size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-gray-200">{item?.caption || item?.workPackageName || 'Selected snapshot'}</p>
                  <p className="text-[11px] text-gray-500">Order {index + 1}{item?.pageNumber ? ` · Page ${item.pageNumber}` : ''}</p>
                </div>
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className="rounded-md p-2 text-gray-400 hover:bg-white/5 hover:text-white disabled:opacity-30" aria-label="Move snapshot up">
                  <ArrowUp size={14} />
                </button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === selectedIds.length - 1} className="rounded-md p-2 text-gray-400 hover:bg-white/5 hover:text-white disabled:opacity-30" aria-label="Move snapshot down">
                  <ArrowDown size={14} />
                </button>
                <button type="button" onClick={() => remove(id)} className="rounded-md p-2 text-red-300 hover:bg-red-900/30" aria-label="Remove snapshot">
                  <Trash2 size={14} />
                </button>
              </div>
            )
          })}
        </div>
      ) : null}

      <SnapshotLibraryDialog
        open={open}
        mode="picker"
        selectedIds={selectedIds}
        onSelectedIdsChange={(ids) => {
          setMessage('')
          onChange(ids)
        }}
        initialFilters={{
          projectId,
          blueprintSetId,
          workPackageId,
          workPackageMode: 'untagged-or-matching',
        }}
        onClose={() => setOpen(false)}
      />
    </div>
  )
}
