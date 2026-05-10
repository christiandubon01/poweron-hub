// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Search, ZoomIn, ZoomOut } from 'lucide-react'
import { getBlueprintSignedUrl, type BlueprintLibraryItem } from '@/services/blueprintLibraryService'

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

interface OperationsBlueprintPdfViewerProps {
  blueprint: BlueprintLibraryItem | null
}

export default function OperationsBlueprintPdfViewer({ blueprint }: OperationsBlueprintPdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
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

  const hasStoragePath = !!blueprint?.storagePath?.trim()
  const canRender = !!pdfDoc && numPages > 0

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
      return
    }
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

  const jumpToPage = useCallback(() => {
    const raw = Number(pageInput)
    if (!Number.isFinite(raw)) return
    const next = Math.max(1, Math.min(numPages || 1, Math.floor(raw)))
    setCurrentPage(next)
    setPageInput(String(next))
  }, [pageInput, numPages])

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
            <canvas ref={canvasRef} className="border border-gray-800 bg-white shadow-lg" />
          </div>

          {signedUrl && (
            <div className="px-4 pb-4 text-[11px] text-gray-500 truncate">
              Signed URL active for this session.
            </div>
          )}
        </>
      )}
    </div>
  )
}
