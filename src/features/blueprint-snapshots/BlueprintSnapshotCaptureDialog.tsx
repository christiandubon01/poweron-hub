import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import {
  sanitizeSnapshotCaption,
  saveBlueprintSnapshot,
} from './blueprintSnapshotService'
import type {
  BlueprintSnapshotCaptureResult,
  BlueprintSnapshotSavedResult,
  BlueprintSnapshotWorkPackageTag,
} from './types'

export function BlueprintSnapshotCaptureDialog({
  open,
  capture,
  orgId,
  userId,
  projectId,
  projectName,
  blueprintSetId,
  workPackageTag,
  onCancel,
  onSaved,
  onFailure,
}: {
  open: boolean
  capture: BlueprintSnapshotCaptureResult | null
  orgId: string | null | undefined
  userId: string | null | undefined
  projectId: string | null | undefined
  projectName: string | null | undefined
  blueprintSetId: string | null | undefined
  workPackageTag: BlueprintSnapshotWorkPackageTag
  onCancel: () => void
  onSaved: (result: BlueprintSnapshotSavedResult) => void
  onFailure: (message: string) => void
}) {
  const [caption, setCaption] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const saveStartedRef = useRef(false)

  useEffect(() => {
    if (!open || !capture) return
    const url = URL.createObjectURL(capture.blob)
    setPreviewUrl(url)
    setCaption('')
    setError(null)
    setSaving(false)
    saveStartedRef.current = false
    setTimeout(() => closeButtonRef.current?.focus(), 0)
    return () => {
      URL.revokeObjectURL(url)
      setPreviewUrl(null)
    }
  }, [capture, open])

  const safeCaption = useMemo(() => sanitizeSnapshotCaption(caption), [caption])
  const canSave = Boolean(capture && orgId && userId && projectId && projectName && blueprintSetId && !saving)

  if (!open || !capture) return null

  const viewModeLabel = capture.captureMetadata.viewMode === 'scoped' ? 'Scoped View' : 'General View'

  const handleSave = async () => {
    if (!capture || saveStartedRef.current) return
    if (!orgId || !userId || !projectId || !projectName || !blueprintSetId) {
      const message = 'Missing organization or blueprint context. The image was not uploaded.'
      setError(message)
      onFailure(message)
      return
    }
    saveStartedRef.current = true
    setSaving(true)
    setError(null)
    try {
      const saved = await saveBlueprintSnapshot({
        blob: capture.blob,
        width: capture.width,
        height: capture.height,
        pageNumber: capture.pageNumber,
        caption: safeCaption,
        orgId,
        projectId,
        projectName,
        blueprintSetId,
        capturedBy: userId,
        captureMetadata: capture.captureMetadata,
        workPackageTag,
      })
      onSaved(saved)
    } catch (error) {
      saveStartedRef.current = false
      const message = error instanceof Error && error.message
        ? error.message
        : 'Snapshot could not be saved. The image was not uploaded.'
      setError(message)
      onFailure(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100080] flex items-center justify-center bg-black/70 px-4 py-6">
      <div role="dialog" aria-modal="true" aria-labelledby="blueprint-snapshot-title" className="flex max-h-full w-full max-w-2xl flex-col rounded-xl border border-gray-700 bg-[#10131c] shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
          <div className="min-w-0">
            <h2 id="blueprint-snapshot-title" className="text-sm font-semibold text-gray-100">Capture Snapshot</h2>
            <p className="text-xs text-gray-400">Page {capture.pageNumber} • {capture.width} x {capture.height} PNG • {capture.annotationCount} annotation{capture.annotationCount === 1 ? '' : 's'}</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onCancel} disabled={saving} className="rounded-md p-1.5 text-gray-400 hover:bg-white/5 hover:text-white disabled:opacity-40" aria-label="Cancel snapshot preview" title="Cancel">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="overflow-hidden rounded-lg border border-gray-700 bg-white">
            {previewUrl && <img src={previewUrl} alt="Blueprint snapshot preview" className="max-h-[52vh] w-full object-contain" />}
          </div>
          <div className="mt-3 grid gap-2 text-xs text-gray-300 sm:grid-cols-2">
            <div>Mode: <span className="font-semibold text-gray-100">{viewModeLabel}</span></div>
            <div>Rotation: <span className="font-semibold text-gray-100">{capture.rotation} deg</span></div>
            {workPackageTag.workPackageName && (
              <div className="sm:col-span-2">Work Package: <span className="font-semibold text-gray-100">{workPackageTag.workPackageName}</span></div>
            )}
          </div>
          <label className="mt-4 block text-xs font-medium text-gray-300" htmlFor="blueprint-snapshot-caption">Caption</label>
          <textarea
            id="blueprint-snapshot-caption"
            value={caption}
            onChange={(event) => setCaption(event.target.value.slice(0, 240))}
            maxLength={240}
            className="mt-1 min-h-20 w-full rounded-lg border border-gray-700 bg-gray-950/70 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500"
          />
          {error && <div className="mt-3 rounded-md border border-red-800/50 bg-red-950/30 px-3 py-2 text-xs text-red-200">{error}</div>}
          {!orgId || !userId ? <div className="mt-3 rounded-md border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">Sign in with an owner/admin organization before saving snapshots.</div> : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-gray-800 px-4 py-3">
          <button type="button" onClick={onCancel} disabled={saving} className="rounded-md border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-white/5 disabled:opacity-40">Cancel</button>
          <button type="button" onClick={handleSave} disabled={!canSave} className="inline-flex items-center gap-2 rounded-md border border-blue-500/70 bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-45">
            {saving && <Loader2 size={14} className="animate-spin" />}
            Save Snapshot
          </button>
        </div>
      </div>
    </div>
  )
}
