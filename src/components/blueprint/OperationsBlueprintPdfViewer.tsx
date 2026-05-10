// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, MousePointer2, RefreshCw, Search, StickyNote, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import {
  deleteOperationsBlueprintAnnotation,
  getBlueprintSignedUrl,
  getOperationsBlueprintAnnotations,
  type BlueprintAnnotation,
  type BlueprintLibraryItem,
  upsertOperationsBlueprintAnnotation,
} from '@/services/blueprintLibraryService'
import { getBackupData } from '@/services/backupDataService'

let _pdfjsLib: typeof import('pdfjs-dist') | null = null
async function getPdfjsLib(): Promise<typeof import('pdfjs-dist')> {
  if (_pdfjsLib) return _pdfjsLib
  const pdfjsLib = await import(/* @vite-ignore */ 'pdfjs-dist')
  if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString()
  }
  _pdfjsLib = pdfjsLib
  return pdfjsLib
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 2
const MAX_RENDER_SCALE = 1.75
const MIN_HIGHLIGHT_NORM = 0.005

type ToolMode = 'select' | 'note' | 'highlight'

interface OperationsBlueprintPdfViewerProps {
  blueprint: BlueprintLibraryItem | null
  onAnnotationsChanged?: () => void
}

function toNorm(x: number, y: number, w: number, h: number) {
  return {
    x: Math.max(0, Math.min(1, x / Math.max(1, w))),
    y: Math.max(0, Math.min(1, y / Math.max(1, h))),
  }
}

function normRectFromDrag(start: { x: number; y: number }, end: { x: number; y: number }, w: number, h: number) {
  const left = Math.min(start.x, end.x)
  const top = Math.min(start.y, end.y)
  const right = Math.max(start.x, end.x)
  const bottom = Math.max(start.y, end.y)
  const nw = Math.max(0, right - left)
  const nh = Math.max(0, bottom - top)
  return {
    x: Math.max(0, Math.min(1, left / Math.max(1, w))),
    y: Math.max(0, Math.min(1, top / Math.max(1, h))),
    w: Math.max(0, Math.min(1, nw / Math.max(1, w))),
    h: Math.max(0, Math.min(1, nh / Math.max(1, h))),
  }
}

export default function OperationsBlueprintPdfViewer({ blueprint, onAnnotationsChanged }: OperationsBlueprintPdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const pdfDocRef = useRef<any>(null)
  const renderTaskRef = useRef<any>(null)

  const [signedUrl, setSignedUrl] = useState('')
  const [pdfDoc, setPdfDoc] = useState<any>(null)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [zoom, setZoom] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [isRendering, setIsRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 })

  const [toolMode, setToolMode] = useState<ToolMode>('select')
  const [allAnnotations, setAllAnnotations] = useState<BlueprintAnnotation[]>([])
  const [draftRect, setDraftRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)

  const hasStoragePath = !!blueprint?.storagePath?.trim()
  const canRender = !!pdfDoc && numPages > 0

  const loadAnnotations = useCallback(() => {
    if (!blueprint?.id) {
      setAllAnnotations([])
      return
    }
    try {
      const backup = getBackupData()
      const items = getOperationsBlueprintAnnotations(backup || {}, blueprint.id)
      setAllAnnotations(Array.isArray(items) ? items : [])
    } catch {
      setAllAnnotations([])
    }
  }, [blueprint?.id])

  const clearDoc = useCallback(async () => {
    try {
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel() } catch {}
        renderTaskRef.current = null
      }
      if (pdfDocRef.current) {
        try { await pdfDocRef.current.destroy() } catch {}
      }
    } finally {
      pdfDocRef.current = null
      setPdfDoc(null)
      setNumPages(0)
      setCurrentPage(1)
      setPageInput('1')
      setSignedUrl('')
      setIsRendering(false)
      setDisplaySize({ w: 0, h: 0 })
      setDraftRect(null)
      setDragStart(null)
    }
  }, [])

  const loadPdf = useCallback(async () => {
    if (!blueprint) return
    if (!hasStoragePath) {
      setError('This blueprint is missing a storage path and cannot be opened.')
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      await clearDoc()
      const url = await getBlueprintSignedUrl(blueprint.storagePath, 900)
      setSignedUrl(url)

      const pdfjsLib = await getPdfjsLib()
      const loadingTask = pdfjsLib.getDocument({ url })
      const doc = await loadingTask.promise
      pdfDocRef.current = doc
      setPdfDoc(doc)
      setNumPages(doc.numPages || 0)
      setCurrentPage(1)
      setPageInput('1')
      setZoom(1)
    } catch (e: any) {
      setError(e?.message || 'Failed to load blueprint PDF.')
    } finally {
      setIsLoading(false)
    }
  }, [blueprint, clearDoc, hasStoragePath])

  useEffect(() => {
    if (!blueprint) {
      clearDoc()
      setError(null)
      setAllAnnotations([])
      return
    }
    loadAnnotations()
    void loadPdf()
    return () => { void clearDoc() }
  }, [blueprint?.id])

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return
    const clampedPage = Math.max(1, Math.min(numPages || 1, currentPage))
    let isDisposed = false

    const run = async () => {
      setIsRendering(true)
      setError(null)
      try {
        if (renderTaskRef.current) {
          try { renderTaskRef.current.cancel() } catch {}
          renderTaskRef.current = null
        }

        const page = await pdfDoc.getPage(clampedPage)
        const safeScale = Math.max(MIN_ZOOM, Math.min(MAX_RENDER_SCALE, zoom))
        const viewport = page.getViewport({ scale: safeScale })
        const canvas = canvasRef.current
        if (!canvas || isDisposed) return
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) throw new Error('Could not get canvas context.')

        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        setDisplaySize({ w: Math.floor(viewport.width), h: Math.floor(viewport.height) })

        const task = page.render({ canvasContext: context, viewport })
        renderTaskRef.current = task
        await task.promise
      } catch (e: any) {
        if (e?.name !== 'RenderingCancelledException') {
          setError(e?.message || 'Failed to render PDF page.')
        }
      } finally {
        if (!isDisposed) setIsRendering(false)
      }
    }

    void run()
    return () => {
      isDisposed = true
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel() } catch {}
      }
    }
  }, [pdfDoc, currentPage, zoom, numPages])

  const pageLabel = useMemo(() => `${Math.max(1, currentPage)} / ${Math.max(1, numPages)}`, [currentPage, numPages])

  useEffect(() => {
    setPageInput(String(currentPage))
  }, [currentPage])

  const pageAnnotations = useMemo(
    () => allAnnotations.filter(a => Number(a.pageNumber) === Number(currentPage)),
    [allAnnotations, currentPage]
  )

  const persistAnnotation = useCallback(async (annotation: BlueprintAnnotation) => {
    try {
      const backup = getBackupData()
      if (!backup) return
      await upsertOperationsBlueprintAnnotation(backup, annotation)
      loadAnnotations()
      onAnnotationsChanged?.()
    } catch (e: any) {
      setError(e?.message || 'Failed to save annotation.')
    }
  }, [loadAnnotations, onAnnotationsChanged])

  const removeAnnotation = useCallback(async (annotationId: string) => {
    if (!blueprint?.id) return
    try {
      const backup = getBackupData()
      if (!backup) return
      await deleteOperationsBlueprintAnnotation(backup, blueprint.id, annotationId)
      loadAnnotations()
      onAnnotationsChanged?.()
    } catch (e: any) {
      setError(e?.message || 'Failed to delete annotation.')
    }
  }, [blueprint?.id, loadAnnotations, onAnnotationsChanged])

  const jumpToPage = useCallback(() => {
    const raw = Number(pageInput)
    if (!Number.isFinite(raw)) return
    const next = Math.max(1, Math.min(numPages || 1, Math.floor(raw)))
    setCurrentPage(next)
    setPageInput(String(next))
  }, [pageInput, numPages])

  const handleOverlayClick = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!blueprint || toolMode !== 'note') return
    if (!overlayRef.current || !displaySize.w || !displaySize.h) return
    const rect = overlayRef.current.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const n = toNorm(px, py, rect.width, rect.height)
    const text = window.prompt('Enter note text:')
    if (!text || !text.trim()) return
    const now = new Date().toISOString()
    const ann: BlueprintAnnotation = {
      id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      blueprintSetId: blueprint.id,
      projectId: blueprint.projectId,
      pageNumber: currentPage,
      type: 'note',
      rect: { x: n.x, y: n.y, w: 0.018, h: 0.018 },
      text: text.trim(),
      color: '#38bdf8',
      createdAt: now,
      updatedAt: now,
    }
    await persistAnnotation(ann)
  }, [toolMode, blueprint, currentPage, persistAnnotation, displaySize])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (toolMode !== 'highlight') return
    if (!overlayRef.current) return
    const rect = overlayRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setDragStart({ x, y })
    setDraftRect({ x, y, w: 0, h: 0 })
  }, [toolMode])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (toolMode !== 'highlight' || !dragStart || !overlayRef.current) return
    const rect = overlayRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const left = Math.min(dragStart.x, x)
    const top = Math.min(dragStart.y, y)
    const w = Math.abs(x - dragStart.x)
    const h = Math.abs(y - dragStart.y)
    setDraftRect({ x: left, y: top, w, h })
  }, [toolMode, dragStart])

  const handlePointerUp = useCallback(async (e: React.PointerEvent<HTMLDivElement>) => {
    if (toolMode !== 'highlight' || !dragStart || !overlayRef.current || !blueprint) return
    const rect = overlayRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const norm = normRectFromDrag(dragStart, { x, y }, rect.width, rect.height)
    setDragStart(null)
    setDraftRect(null)

    if (norm.w < MIN_HIGHLIGHT_NORM || norm.h < MIN_HIGHLIGHT_NORM) return
    const now = new Date().toISOString()
    const ann: BlueprintAnnotation = {
      id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      blueprintSetId: blueprint.id,
      projectId: blueprint.projectId,
      pageNumber: currentPage,
      type: 'highlight',
      rect: norm,
      color: '#facc15',
      createdAt: now,
      updatedAt: now,
    }
    await persistAnnotation(ann)
  }, [toolMode, dragStart, blueprint, currentPage, persistAnnotation])

  if (!blueprint) {
    return (
      <div className="rounded-xl border p-6 text-sm text-gray-500" style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}>
        Select a blueprint set to open the PDF viewer.
      </div>
    )
  }

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}>
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-gray-100 font-semibold truncate">{blueprint.title}</p>
          <p className="text-xs text-gray-500 truncate">{blueprint.projectName} • {blueprint.fileName}</p>
        </div>
        <button
          onClick={() => void loadPdf()}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-700 text-gray-300 hover:text-white"
        >
          <RefreshCw size={12} />
          Refresh Link
        </button>
      </div>

      {!hasStoragePath ? (
        <div className="p-6 text-sm text-amber-300 bg-amber-900/10 border-t border-amber-800/30">
          This blueprint is missing `storagePath`, so the PDF cannot be opened yet.
        </div>
      ) : (
        <>
          <div className="px-4 py-3 border-b border-gray-800 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setToolMode('select')}
              className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${toolMode === 'select' ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300'}`}
            >
              <MousePointer2 size={12} />
              Select / Pan
            </button>
            <button
              onClick={() => setToolMode('note')}
              className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${toolMode === 'note' ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300'}`}
            >
              <StickyNote size={12} />
              Add Note
            </button>
            <button
              onClick={() => setToolMode('highlight')}
              className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${toolMode === 'highlight' ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300'}`}
            >
              Highlight
            </button>
          </div>

          <div className="px-4 py-3 border-b border-gray-800 flex flex-wrap items-center gap-2">
            <button
              disabled={!canRender || currentPage <= 1 || isRendering}
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-700 text-gray-300 disabled:opacity-50"
            >
              <ChevronLeft size={12} />
              Prev
            </button>
            <button
              disabled={!canRender || currentPage >= numPages || isRendering}
              onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-700 text-gray-300 disabled:opacity-50"
            >
              Next
              <ChevronRight size={12} />
            </button>

            <div className="inline-flex items-center gap-1 ml-1">
              <input
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') jumpToPage() }}
                className="w-16 rounded border border-gray-700 bg-gray-900/50 text-gray-100 text-xs px-2 py-1"
              />
              <button
                disabled={!canRender}
                onClick={jumpToPage}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-700 text-gray-300 disabled:opacity-50"
              >
                <Search size={11} />
                Go
              </button>
            </div>

            <span className="text-xs text-gray-400 ml-1">Page {pageLabel}</span>

            <div className="ml-auto inline-flex items-center gap-2">
              <button
                disabled={!canRender || zoom <= MIN_ZOOM}
                onClick={() => setZoom(z => Math.max(MIN_ZOOM, Math.round((z - 0.1) * 10) / 10))}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-700 text-gray-300 disabled:opacity-50"
              >
                <ZoomOut size={12} />
              </button>
              <span className="text-xs text-gray-400 w-12 text-center">{Math.round(zoom * 100)}%</span>
              <button
                disabled={!canRender || zoom >= MAX_ZOOM}
                onClick={() => setZoom(z => Math.min(MAX_ZOOM, Math.round((z + 0.1) * 10) / 10))}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-700 text-gray-300 disabled:opacity-50"
              >
                <ZoomIn size={12} />
              </button>
              <button
                disabled={!canRender}
                onClick={() => setZoom(1)}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-700 text-gray-300 disabled:opacity-50"
              >
                Reset
              </button>
            </div>
          </div>

          {(isLoading || isRendering) && (
            <div className="px-4 py-2 text-xs text-blue-300 flex items-center gap-2">
              <Loader2 size={12} className="animate-spin" />
              {isLoading ? 'Loading PDF...' : 'Rendering page...'}
            </div>
          )}

          {error && (
            <div className="mx-4 mt-3 text-sm text-red-300 bg-red-900/20 border border-red-800/40 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div className="p-4 overflow-auto max-h-[70vh] flex justify-center">
            <div className="relative" style={{ width: displaySize.w || undefined, height: displaySize.h || undefined }}>
              <canvas ref={canvasRef} className="border border-gray-800 bg-white shadow-lg block" />
              <div
                ref={overlayRef}
                className={`absolute inset-0 ${toolMode === 'note' ? 'cursor-crosshair' : toolMode === 'highlight' ? 'cursor-crosshair' : 'cursor-default'}`}
                onClick={handleOverlayClick}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              >
                {pageAnnotations.map((a) => {
                  if (!a?.rect) return null
                  const left = `${(a.rect.x || 0) * 100}%`
                  const top = `${(a.rect.y || 0) * 100}%`
                  const width = `${Math.max(0.01, (a.rect.w || 0)) * 100}%`
                  const height = `${Math.max(0.01, (a.rect.h || 0)) * 100}%`
                  if (a.type === 'highlight') {
                    return (
                      <div key={a.id} className="absolute group" style={{ left, top, width, height }}>
                        <div className="w-full h-full border border-yellow-500/60 bg-yellow-300/30 pointer-events-none" />
                        <button
                          onClick={(e) => { e.stopPropagation(); void removeAnnotation(a.id) }}
                          className="absolute -top-2 -right-2 hidden group-hover:flex items-center justify-center w-5 h-5 rounded-full bg-red-600 text-white"
                          title="Delete annotation"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    )
                  }
                  return (
                    <div key={a.id} className="absolute group" style={{ left, top }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); alert(a.text || 'Note') }}
                        className="w-5 h-5 rounded-full bg-sky-500 border border-white text-white text-[10px] font-bold"
                        title={a.text || 'Note'}
                      >
                        N
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); void removeAnnotation(a.id) }}
                        className="absolute -top-2 -right-2 hidden group-hover:flex items-center justify-center w-5 h-5 rounded-full bg-red-600 text-white"
                        title="Delete note"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  )
                })}

                {draftRect && toolMode === 'highlight' && (
                  <div
                    className="absolute border border-yellow-500 bg-yellow-300/30 pointer-events-none"
                    style={{
                      left: draftRect.x,
                      top: draftRect.y,
                      width: draftRect.w,
                      height: draftRect.h,
                    }}
                  />
                )}
              </div>
            </div>
          </div>

          {signedUrl && (
            <div className="px-4 pb-4 text-[11px] text-gray-500 truncate">
              Signed URL active for this session. {pageAnnotations.length} annotation{pageAnnotations.length !== 1 ? 's' : ''} on this page.
            </div>
          )}
        </>
      )}
    </div>
  )
}
