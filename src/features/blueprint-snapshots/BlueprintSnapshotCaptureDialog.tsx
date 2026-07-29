import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RotateCcw, X } from 'lucide-react'
import { logBlueprintSnapshotPreviewCanvasResult } from './blueprintSnapshotCapture'
import { BlueprintSnapshotPreviewViewport } from './BlueprintSnapshotPreviewViewport'
import {
  sanitizeSnapshotCaption,
  saveBlueprintSnapshot,
} from './blueprintSnapshotService'
import type {
  BlueprintSnapshotCaptureResult,
  BlueprintSnapshotPreviewState,
  BlueprintSnapshotSavedResult,
  BlueprintSnapshotWorkPackageTag,
} from './types'

export function BlueprintSnapshotCaptureDialog({
  open,
  capture,
  preview,
  orgId,
  userId,
  projectId,
  projectName,
  blueprintSetId,
  workPackageTag,
  onRetake,
  onCancel,
  onSaved,
  onFailure,
}: {
  open: boolean
  capture: BlueprintSnapshotCaptureResult | null
  preview: BlueprintSnapshotPreviewState | null
  orgId: string | null | undefined
  userId: string | null | undefined
  projectId: string | null | undefined
  projectName: string | null | undefined
  blueprintSetId: string | null | undefined
  workPackageTag: BlueprintSnapshotWorkPackageTag
  onRetake: () => void
  onCancel: () => void
  onSaved: (result: BlueprintSnapshotSavedResult) => void
  onFailure: (message: string) => void
}) {
  const [caption, setCaption] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [canvasStatus, setCanvasStatus] = useState<'preparing' | 'ready' | 'failed'>('preparing')
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const saveStartedRef = useRef(false)

  useEffect(() => {
    if (!open || !capture) return
    setCaption('')
    setError(null)
    setSaving(false)
    setCanvasStatus('preparing')
    saveStartedRef.current = false
    setTimeout(() => closeButtonRef.current?.focus(), 0)
  }, [capture, open])

  const safeCaption = useMemo(() => sanitizeSnapshotCaption(caption), [caption])
  const canSave = Boolean(capture && orgId && userId && projectId && projectName && blueprintSetId && !saving)

  const handlePreviewReady = useCallback(() => {
    setCanvasStatus('ready')
    logBlueprintSnapshotPreviewCanvasResult('canvas-ready', preview)
  }, [preview])

  const handlePreviewError = useCallback(() => {
    setCanvasStatus('failed')
    logBlueprintSnapshotPreviewCanvasResult('canvas-error', preview)
  }, [preview])

  if (!open || !capture) return null
  const viewModeLabel = capture.captureMetadata.viewMode === 'scoped' ? 'Scoped View' : 'General View'
  const captureModeLabel = capture.captureMetadata.captureMode === 'area' ? 'Capture Area' : 'Full Page'

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
    <div className="fixed inset-0 z-[100080] flex items-center justify-center overflow-hidden bg-black/70 px-3 py-4 sm:px-4 sm:py-6">
      <div role="dialog" aria-modal="true" aria-labelledby="blueprint-snapshot-title" className="flex max-h-full min-h-0 w-full max-w-6xl flex-col rounded-xl border border-gray-700 bg-[#10131c] shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
          <div className="min-w-0">
            <h2 id="blueprint-snapshot-title" className="text-sm font-semibold text-gray-100">Capture Snapshot</h2>
            <p className="text-xs font-semibold text-cyan-200">{captureModeLabel}</p>
            <p className="text-xs text-gray-400">Page {capture.pageNumber} • {capture.width} x {capture.height} PNG • {capture.annotationCount} annotation{capture.annotationCount === 1 ? '' : 's'}</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onCancel} disabled={saving} className="rounded-md p-1.5 text-gray-400 hover:bg-white/5 hover:text-white disabled:opacity-40" aria-label="Cancel snapshot preview" title="Cancel">
            <X size={18} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 sm:p-4">
          <div className="min-h-[44vh] flex-1">
            {preview?.previewCanvas && canvasStatus !== 'failed' ? (
              <BlueprintSnapshotPreviewViewport
                sourceCanvas={preview.previewCanvas}
                imageWidth={capture.width}
                imageHeight={capture.height}
                accessibleLabel={`Blueprint snapshot preview for page ${capture.pageNumber}`}
                resetKey={preview.generation}
                onReady={handlePreviewReady}
                onError={handlePreviewError}
              />
            ) : (
              <div className="flex min-h-[42vh] items-center justify-center rounded-lg border border-gray-700 bg-white px-4 py-8 text-center text-xs text-red-700">Snapshot was captured, but the preview could not be rendered.</div>
            )}
          </div>
          {canvasStatus === 'failed' && <div className="mt-3 rounded-md border border-red-800/50 bg-red-950/30 px-3 py-2 text-xs text-red-200">Snapshot was captured, but the preview could not be rendered.</div>}
          {canvasStatus === 'preparing' ? <div className="mt-2 text-xs text-gray-500">Preparing preview...</div> : null}
          <div className="mt-3 grid gap-2 text-xs text-gray-300 sm:grid-cols-2 lg:grid-cols-4">
            <div>Mode: <span className="font-semibold text-gray-100">{viewModeLabel}</span></div>
            <div>Rotation: <span className="font-semibold text-gray-100">{capture.rotation} deg</span></div>
            <div>Native: <span className="font-semibold text-gray-100">{capture.width} x {capture.height}</span></div>
            <div>Zoom: <span className="font-semibold text-gray-100">Fit default</span></div>
            {workPackageTag.workPackageName && (
              <div className="sm:col-span-2 lg:col-span-4">Work Package: <span className="font-semibold text-gray-100">{workPackageTag.workPackageName}</span></div>
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
          <button type="button" onClick={onRetake} disabled={saving} className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-white/5 disabled:opacity-40">
            <RotateCcw size={14} />
            Retake
          </button>
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
