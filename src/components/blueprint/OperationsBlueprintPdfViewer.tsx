// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize2,
  Minimize2,
  MousePointer2,
  RefreshCw,
  Search,
  StickyNote,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
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

const MIN_RELATIVE_ZOOM = 1
const MAX_RELATIVE_ZOOM = 4
const MAX_RENDER_SCALE = 2.5
const PINCH_SENSITIVITY = 0.55
const PINCH_DEADZONE_PX = 2
const MIN_HIGHLIGHT_NORM = 0.005
const NOTE_MARKER_SIZE_NORM = 0.018
const ANNOTATION_COLORS = ['#facc15', '#38bdf8', '#f97316', '#22c55e', '#a78bfa', '#ef4444']

type ToolMode = 'select' | 'note' | 'highlight'

interface OperationsBlueprintPdfViewerProps {
  blueprint: BlueprintLibraryItem | null
  onAnnotationsChanged?: () => void
  selectedPageNumbers?: number[]
  onSelectedPagesChange?: (pages: number[]) => void
  externalPage?: number | null
  onPageChange?: (page: number) => void
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

function shortText(v?: string, max = 40) {
  const s = String(v || '').trim()
  if (!s) return '(empty note)'
  return s.length > max ? `${s.slice(0, max)}…` : s
}

function clampRelativeZoom(v: number) {
  return Math.max(MIN_RELATIVE_ZOOM, Math.min(MAX_RELATIVE_ZOOM, v))
}

export default function OperationsBlueprintPdfViewer({
  blueprint,
  onAnnotationsChanged,
  selectedPageNumbers = [],
  onSelectedPagesChange,
  externalPage = null,
  onPageChange,
}: OperationsBlueprintPdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const pdfDocRef = useRef<any>(null)
  const renderTaskRef = useRef<any>(null)
  const noteEditorRef = useRef<HTMLTextAreaElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const pageFrameRef = useRef<HTMLDivElement>(null)
  const pendingScrollResetRef = useRef(false)
  const relativeZoomRef = useRef(1)
  const pinchPreviewZoomRef = useRef<number | null>(null)
  const displaySizeRef = useRef({ w: 0, h: 0 })
  const suppressAnnotationUntilRef = useRef(0)
  const activeTouchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchStateRef = useRef<{
    active: boolean
    startDistance: number
    startZoom: number
    lastDistance: number
    lastCenter: { x: number; y: number } | null
    finalZoom: number
  }>({
    active: false,
    startDistance: 0,
    startZoom: 1,
    lastDistance: 0,
    lastCenter: null,
    finalZoom: 1,
  })
  const pinchZoomRafRef = useRef<number | null>(null)
  const pinchQueuedZoomRef = useRef<number | null>(null)
  const pendingPinchAnchorRef = useRef<{
    ratioX: number
    ratioY: number
    centerInScrollX: number
    centerInScrollY: number
  } | null>(null)
  const touchPanRef = useRef<{
    active: boolean
    pointerId: number | null
    lastX: number
    lastY: number
    moved: boolean
  }>({ active: false, pointerId: null, lastX: 0, lastY: 0, moved: false })
  const mousePanRef = useRef<{
    active: boolean
    pointerId: number | null
    lastX: number
    lastY: number
    moved: boolean
  }>({ active: false, pointerId: null, lastX: 0, lastY: 0, moved: false })

  const [signedUrl, setSignedUrl] = useState('')
  const [pdfDoc, setPdfDoc] = useState<any>(null)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [relativeZoom, setRelativeZoom] = useState(1)
  const [pinchPreviewZoom, setPinchPreviewZoom] = useState<number | null>(null)
  const [lockView, setLockView] = useState(false)
  const [mousePanActive, setMousePanActive] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isRendering, setIsRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 })
  const [viewportWidth, setViewportWidth] = useState(0)

  const [isFullScreenView, setIsFullScreenView] = useState(false)

  const [toolMode, setToolMode] = useState<ToolMode>('select')
  const [activeColor, setActiveColor] = useState('#facc15')
  const [allAnnotations, setAllAnnotations] = useState<BlueprintAnnotation[]>([])
  const [focusedAnnotationId, setFocusedAnnotationId] = useState<string | null>(null)

  const [draftRect, setDraftRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)

  const [noteEditor, setNoteEditor] = useState<{
    mode: 'create' | 'edit'
    annotationId?: string
    x: number
    y: number
    text: string
    color: string
  } | null>(null)

  const hasStoragePath = !!blueprint?.storagePath?.trim()
  const canRender = !!pdfDoc && numPages > 0
  const isEditorOpen = !!noteEditor
  const effectiveTool = isEditorOpen ? 'select' : toolMode

  useEffect(() => {
  relativeZoomRef.current = relativeZoom
  }, [relativeZoom])

  useEffect(() => {
    pinchPreviewZoomRef.current = pinchPreviewZoom
  }, [pinchPreviewZoom])

  useEffect(() => {
    displaySizeRef.current = displaySize
  }, [displaySize])

  const clampScroll = useCallback((scroll: HTMLDivElement, left: number, top: number) => {
    const maxLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth)
    const maxTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
    scroll.scrollLeft = Math.max(0, Math.min(maxLeft, left))
    scroll.scrollTop = Math.max(0, Math.min(maxTop, top))
  }, [])

  const getPinchAnchorFromMidpoint = useCallback((
    midpointClientX: number,
    midpointClientY: number,
    visualPageWidth: number,
    visualPageHeight: number
  ): {
    ratioX: number
    ratioY: number
    centerInScrollX: number
    centerInScrollY: number
    pageOffsetX: number
    pageOffsetY: number
  } | null => {
    const scroll = scrollAreaRef.current
    const page = pageFrameRef.current
    if (!scroll || !page || visualPageWidth <= 0 || visualPageHeight <= 0) return null
    const scrollRect = scroll.getBoundingClientRect()
    const pageRect = page.getBoundingClientRect()

    const centerInScrollX = midpointClientX - scrollRect.left
    const centerInScrollY = midpointClientY - scrollRect.top
    const pageOffsetX = (pageRect.left - scrollRect.left) + scroll.scrollLeft
    const pageOffsetY = (pageRect.top - scrollRect.top) + scroll.scrollTop
    const centerInPageX = (scroll.scrollLeft + centerInScrollX) - pageOffsetX
    const centerInPageY = (scroll.scrollTop + centerInScrollY) - pageOffsetY

    const ratioX = Math.max(0, Math.min(1, centerInPageX / Math.max(1, visualPageWidth)))
    const ratioY = Math.max(0, Math.min(1, centerInPageY / Math.max(1, visualPageHeight)))

    return { ratioX, ratioY, centerInScrollX, centerInScrollY, pageOffsetX, pageOffsetY }
  }, [])

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
      if (pinchZoomRafRef.current != null) {
        try { cancelAnimationFrame(pinchZoomRafRef.current) } catch {}
      }
    } finally {
      pdfDocRef.current = null
      pinchZoomRafRef.current = null
      pinchQueuedZoomRef.current = null
      pendingPinchAnchorRef.current = null
      setPdfDoc(null)
      setNumPages(0)
      setCurrentPage(1)
      setPageInput('1')
      setSignedUrl('')
      setIsRendering(false)
      setDisplaySize({ w: 0, h: 0 })
      setDraftRect(null)
      setDragStart(null)
      setNoteEditor(null)
      setFocusedAnnotationId(null)
      setRelativeZoom(1)
      setPinchPreviewZoom(null)
      relativeZoomRef.current = 1
      pinchPreviewZoomRef.current = null
      displaySizeRef.current = { w: 0, h: 0 }
      suppressAnnotationUntilRef.current = 0
      activeTouchPointersRef.current.clear()
      touchPanRef.current = { active: false, pointerId: null, lastX: 0, lastY: 0, moved: false }
      mousePanRef.current = { active: false, pointerId: null, lastX: 0, lastY: 0, moved: false }
      setMousePanActive(false)
      pinchStateRef.current = {
        active: false,
        startDistance: 0,
        startZoom: 1,
        lastDistance: 0,
        lastCenter: null,
        finalZoom: 1,
      }
      pendingPinchAnchorRef.current = null
      pendingScrollResetRef.current = true
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
      setRelativeZoom(1)
      pendingScrollResetRef.current = true
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
    const el = scrollAreaRef.current
    if (!el) return
    const obs = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      setViewportWidth(Math.floor(rect.width))
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [scrollAreaRef.current])

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
        const baseViewport = page.getViewport({ scale: 1 })
        const measuredWidth = viewportWidth || scrollAreaRef.current?.clientWidth || 0
        const availableWidth = Math.max(120, measuredWidth - 26)
        const fitWidthScale = Math.max(0.01, availableWidth / Math.max(1, baseViewport.width))
        const actualRenderScale = Math.max(
          0.01,
          Math.min(MAX_RENDER_SCALE, fitWidthScale * clampRelativeZoom(relativeZoom))
        )
        const viewport = page.getViewport({ scale: actualRenderScale })
        const canvas = canvasRef.current
        if (!canvas || isDisposed) return
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = Math.floor(viewport.width)
        tempCanvas.height = Math.floor(viewport.height)
        const tempContext = tempCanvas.getContext('2d', { alpha: false })
        if (!tempContext) throw new Error('Could not get canvas context.')

        const task = page.render({ canvasContext: tempContext, viewport })
        renderTaskRef.current = task
        await task.promise

        if (isDisposed) return
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) throw new Error('Could not get canvas context.')
        canvas.width = tempCanvas.width
        canvas.height = tempCanvas.height
        canvas.style.width = `${tempCanvas.width}px`
        canvas.style.height = `${tempCanvas.height}px`
        context.drawImage(tempCanvas, 0, 0)
        setDisplaySize({ w: tempCanvas.width, h: tempCanvas.height })

        const pendingAnchor = pendingPinchAnchorRef.current
        if (pendingAnchor && scrollAreaRef.current && pageFrameRef.current && !lockView) {
          const scroll = scrollAreaRef.current
          const scrollRect = scroll.getBoundingClientRect()
          const pageRect = pageFrameRef.current.getBoundingClientRect()
          const pageOffsetX = (pageRect.left - scrollRect.left) + scroll.scrollLeft
          const pageOffsetY = (pageRect.top - scrollRect.top) + scroll.scrollTop
          const targetLeft = pageOffsetX + (pendingAnchor.ratioX * tempCanvas.width) - pendingAnchor.centerInScrollX
          const targetTop = pageOffsetY + (pendingAnchor.ratioY * tempCanvas.height) - pendingAnchor.centerInScrollY
          clampScroll(scroll, targetLeft, targetTop)
          pendingPinchAnchorRef.current = null
        }

        if (pendingScrollResetRef.current && scrollAreaRef.current) {
          scrollAreaRef.current.scrollTop = 0
          scrollAreaRef.current.scrollLeft = 0
          pendingScrollResetRef.current = false
        }
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
  }, [pdfDoc, currentPage, numPages, viewportWidth, relativeZoom, lockView, clampScroll])

  useEffect(() => {
    if (!isEditorOpen) return
    setTimeout(() => noteEditorRef.current?.focus(), 20)
  }, [isEditorOpen])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      const hasOpenState = !!(noteEditor || draftRect || dragStart || focusedAnnotationId)
      if (hasOpenState) {
        setDraftRect(null)
        setDragStart(null)
        setNoteEditor(null)
        setFocusedAnnotationId(null)
      } else if (isFullScreenView) {
        setIsFullScreenView(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isFullScreenView, noteEditor, draftRect, dragStart, focusedAnnotationId])

  useEffect(() => {
    pendingScrollResetRef.current = true
    setRelativeZoom(1)
  }, [currentPage, blueprint?.id])

  useEffect(() => {
    if (!Number.isFinite(Number(externalPage))) return
    const next = Math.max(1, Math.min(numPages || 1, Math.floor(Number(externalPage))))
    if (next === currentPage) return
    pendingScrollResetRef.current = true
    setCurrentPage(next)
    setPageInput(String(next))
  }, [externalPage, numPages, currentPage])

  useEffect(() => {
    onPageChange?.(currentPage)
  }, [currentPage, onPageChange])

  const applyRelativeZoomDelta = useCallback((delta: number) => {
    setRelativeZoom((z) => clampRelativeZoom(z + delta))
  }, [])

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (lockView) {
      e.preventDefault()
      return
    }
    e.preventDefault()
    const currentZoom = clampRelativeZoom(relativeZoomRef.current)
    const delta = e.deltaY < 0 ? 0.1 : -0.1
    const nextZoom = clampRelativeZoom(currentZoom + delta)
    if (Math.abs(nextZoom - currentZoom) < 0.001) return

    const baseCommittedZoom = Math.max(0.001, clampRelativeZoom(relativeZoomRef.current))
    const currentVisualScale = Math.max(1, currentZoom / baseCommittedZoom)
    const nextVisualScale = Math.max(1, nextZoom / baseCommittedZoom)
    const currentVisualW = displaySizeRef.current.w * currentVisualScale
    const currentVisualH = displaySizeRef.current.h * currentVisualScale
    const nextVisualW = displaySizeRef.current.w * nextVisualScale
    const nextVisualH = displaySizeRef.current.h * nextVisualScale
    const anchor = getPinchAnchorFromMidpoint(e.clientX, e.clientY, currentVisualW, currentVisualH)
    if (anchor) {
      pendingPinchAnchorRef.current = {
        ratioX: anchor.ratioX,
        ratioY: anchor.ratioY,
        centerInScrollX: anchor.centerInScrollX,
        centerInScrollY: anchor.centerInScrollY,
      }
      const scroll = scrollAreaRef.current
      if (scroll) {
        const targetLeft = anchor.pageOffsetX + (anchor.ratioX * nextVisualW) - anchor.centerInScrollX
        const targetTop = anchor.pageOffsetY + (anchor.ratioY * nextVisualH) - anchor.centerInScrollY
        clampScroll(scroll, targetLeft, targetTop)
      }
    }
    setRelativeZoom(nextZoom)
  }, [lockView, clampScroll, getPinchAnchorFromMidpoint])

  const pageLabel = useMemo(() => `${Math.max(1, currentPage)} / ${Math.max(1, numPages)}`, [currentPage, numPages])
  useEffect(() => setPageInput(String(currentPage)), [currentPage])
  const isCurrentPageSelected = useMemo(
    () => selectedPageNumbers.includes(currentPage),
    [selectedPageNumbers, currentPage]
  )

  const pageAnnotations = useMemo(
    () => allAnnotations.filter(a => Number(a.pageNumber) === Number(currentPage)),
    [allAnnotations, currentPage]
  )

  const toggleCurrentPageSelection = useCallback(() => {
    if (!onSelectedPagesChange) return
    const current = Math.max(1, Math.floor(currentPage))
    if (selectedPageNumbers.includes(current)) {
      onSelectedPagesChange(selectedPageNumbers.filter((p) => p !== current))
      return
    }
    onSelectedPagesChange([...selectedPageNumbers, current])
  }, [onSelectedPagesChange, selectedPageNumbers, currentPage])

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
      setFocusedAnnotationId((prev) => (prev === annotationId ? null : prev))
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
    setFocusedAnnotationId(null)
    setNoteEditor(null)
    setDraftRect(null)
    setDragStart(null)
  }, [pageInput, numPages])

  const openCreateNoteEditorAt = useCallback((normX: number, normY: number) => {
    setFocusedAnnotationId(null)
    setNoteEditor({
      mode: 'create',
      x: normX,
      y: normY,
      text: '',
      color: activeColor,
    })
  }, [activeColor])

  const openEditNoteEditor = useCallback((annotation: BlueprintAnnotation) => {
    const rect = annotation.rect || { x: 0, y: 0 }
    setFocusedAnnotationId(annotation.id)
    setNoteEditor({
      mode: 'edit',
      annotationId: annotation.id,
      x: rect.x || 0,
      y: rect.y || 0,
      text: annotation.text || '',
      color: annotation.color || activeColor,
    })
  }, [activeColor])

  const saveNoteEditor = useCallback(async () => {
    if (!blueprint || !noteEditor) return
    const now = new Date().toISOString()
    if (noteEditor.mode === 'create') {
      const trimmed = (noteEditor.text || '').trim()
      if (!trimmed) {
        setNoteEditor(null)
        return
      }
      const ann: BlueprintAnnotation = {
        id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        blueprintSetId: blueprint.id,
        projectId: blueprint.projectId,
        pageNumber: currentPage,
        type: 'note',
        rect: { x: noteEditor.x, y: noteEditor.y, w: NOTE_MARKER_SIZE_NORM, h: NOTE_MARKER_SIZE_NORM },
        text: trimmed,
        color: noteEditor.color || activeColor,
        createdAt: now,
        updatedAt: now,
      }
      await persistAnnotation(ann)
      setFocusedAnnotationId(ann.id)
      setNoteEditor(null)
      return
    }

    const existing = allAnnotations.find(a => a.id === noteEditor.annotationId)
    if (!existing) {
      setNoteEditor(null)
      return
    }
    const updated: BlueprintAnnotation = {
      ...existing,
      text: (noteEditor.text || '').trim(),
      color: noteEditor.color || activeColor,
      updatedAt: now,
    }
    await persistAnnotation(updated)
    setFocusedAnnotationId(updated.id)
    setNoteEditor(null)
  }, [blueprint, noteEditor, activeColor, currentPage, persistAnnotation, allAnnotations])

  const handleOverlayClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (Date.now() < suppressAnnotationUntilRef.current) return
    if (!blueprint || effectiveTool !== 'note' || isEditorOpen) return
    if (!overlayRef.current || !displaySize.w || !displaySize.h) return
    const rect = overlayRef.current.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const n = toNorm(px, py, rect.width, rect.height)
    openCreateNoteEditorAt(n.x, n.y)
  }, [effectiveTool, isEditorOpen, blueprint, displaySize, openCreateNoteEditorAt])

  const getTouchPoints = useCallback(() => {
    const points = Array.from(activeTouchPointersRef.current.values())
    if (points.length < 2) return null
    return [points[0], points[1]] as const
  }, [])

  const handleTwoFingerGesture = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (lockView) return
    if (e.pointerType !== 'touch') return

    const pts = getTouchPoints()
    if (!pts) return

    const [p1, p2] = pts
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const distance = Math.hypot(dx, dy)
    const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
    const scrollRect = scrollAreaRef.current?.getBoundingClientRect()
    const midpointClientX = (scrollRect?.left || 0) + center.x
    const midpointClientY = (scrollRect?.top || 0) + center.y
    const state = pinchStateRef.current
    const scroll = scrollAreaRef.current

    if (!state.active) {
      const startZoom = pinchPreviewZoomRef.current ?? relativeZoomRef.current
      state.active = true
      state.startDistance = distance
      state.startZoom = startZoom
      state.lastDistance = distance
      state.lastCenter = center
      state.finalZoom = startZoom
      return
    }

    if (!state.lastCenter) state.lastCenter = center

    // Two-finger gesture is zoom-only for mobile MVP.

    const distDelta = distance - state.lastDistance
    const totalDistDelta = distance - state.startDistance

    if (Math.abs(distDelta) >= PINCH_DEADZONE_PX || Math.abs(totalDistDelta) >= PINCH_DEADZONE_PX) {
      const rawRatio = distance / Math.max(1, state.startDistance)
      const nextZoom = clampRelativeZoom(state.startZoom * Math.pow(rawRatio, PINCH_SENSITIVITY))
      const currentPreviewZoom = pinchPreviewZoomRef.current ?? state.finalZoom ?? state.startZoom

      if (Math.abs(nextZoom - currentPreviewZoom) >= 0.005) {
        // Keep the pinch center anchored in scroll-container coordinates.
        if (scroll && displaySizeRef.current.w > 0 && displaySizeRef.current.h > 0) {
          const baseCommittedZoom = Math.max(0.001, clampRelativeZoom(relativeZoomRef.current))
          const currentVisualScale = Math.max(1, currentPreviewZoom / baseCommittedZoom)
          const nextVisualScale = Math.max(1, nextZoom / baseCommittedZoom)
          const currentVisualW = displaySizeRef.current.w * currentVisualScale
          const currentVisualH = displaySizeRef.current.h * currentVisualScale
          const nextVisualW = displaySizeRef.current.w * nextVisualScale
          const nextVisualH = displaySizeRef.current.h * nextVisualScale
          const anchor = getPinchAnchorFromMidpoint(midpointClientX, midpointClientY, currentVisualW, currentVisualH)
          if (anchor) {
            const targetLeft = anchor.pageOffsetX + (anchor.ratioX * nextVisualW) - anchor.centerInScrollX
            const targetTop = anchor.pageOffsetY + (anchor.ratioY * nextVisualH) - anchor.centerInScrollY
            clampScroll(scroll, targetLeft, targetTop)
          }
        }

        state.finalZoom = nextZoom
        pinchQueuedZoomRef.current = nextZoom

        if (pinchZoomRafRef.current == null) {
          pinchZoomRafRef.current = requestAnimationFrame(() => {
            pinchZoomRafRef.current = null
            const queuedZoom = pinchQueuedZoomRef.current
            pinchQueuedZoomRef.current = null
            if (!Number.isFinite(Number(queuedZoom))) return

            const safeZoom = clampRelativeZoom(Number(queuedZoom))
            pinchPreviewZoomRef.current = safeZoom
            setPinchPreviewZoom(safeZoom)
          })
        }
      }
    }

    state.lastDistance = distance
    state.lastCenter = center
    suppressAnnotationUntilRef.current = Date.now() + 320
    e.preventDefault()
  }, [getTouchPoints, lockView, clampScroll, getPinchAnchorFromMidpoint])

  const endTouchPointer = useCallback((pointerId: number) => {
    activeTouchPointersRef.current.delete(pointerId)

    if (activeTouchPointersRef.current.size < 2 && pinchStateRef.current.active) {
      const state = pinchStateRef.current
      const finalZoom = clampRelativeZoom(
        Number(pinchPreviewZoomRef.current ?? state.finalZoom ?? relativeZoomRef.current)
      )

      const scroll = scrollAreaRef.current
      const center = state.lastCenter
      const currentZoom = Math.max(0.001, relativeZoomRef.current)
      const previewScale = finalZoom / currentZoom

      if (scroll && center && displaySizeRef.current.w > 0 && displaySizeRef.current.h > 0) {
        const previewWidth = displaySizeRef.current.w * previewScale
        const previewHeight = displaySizeRef.current.h * previewScale

        const scrollRect = scroll.getBoundingClientRect()
        const midpointClientX = scrollRect.left + center.x
        const midpointClientY = scrollRect.top + center.y
        const anchor = getPinchAnchorFromMidpoint(midpointClientX, midpointClientY, previewWidth, previewHeight)
        if (anchor) {
          pendingPinchAnchorRef.current = {
            ratioX: anchor.ratioX,
            ratioY: anchor.ratioY,
            centerInScrollX: anchor.centerInScrollX,
            centerInScrollY: anchor.centerInScrollY,
          }
        }
      }

      pinchStateRef.current = {
        active: false,
        startDistance: 0,
        startZoom: finalZoom,
        lastDistance: 0,
        lastCenter: null,
        finalZoom,
      }

      suppressAnnotationUntilRef.current = Date.now() + 320
      setRelativeZoom(finalZoom)
      setPinchPreviewZoom(null)
      pinchPreviewZoomRef.current = null
    }
  }, [getPinchAnchorFromMidpoint])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (
      e.pointerType === 'mouse' &&
      e.button === 0 &&
      effectiveTool === 'select' &&
      !isEditorOpen &&
      !lockView
    ) {
      const targetEl = e.target as HTMLElement | null
      if (targetEl?.closest('button, textarea, input, select, a')) {
        return
      }
      mousePanRef.current = {
        active: true,
        pointerId: e.pointerId,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
      }
      setMousePanActive(true)
      try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId) } catch {}
      e.preventDefault()
      return
    }

    if (e.pointerType === 'touch') {
      if (lockView) {
        e.preventDefault()
        return
      }
      const rect = scrollAreaRef.current?.getBoundingClientRect()
      if (rect) {
        activeTouchPointersRef.current.set(e.pointerId, {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        })
      }
      if (activeTouchPointersRef.current.size >= 2) {
        suppressAnnotationUntilRef.current = Date.now() + 280
        touchPanRef.current = { active: false, pointerId: null, lastX: 0, lastY: 0, moved: false }
        setDragStart(null)
        setDraftRect(null)
        handleTwoFingerGesture(e)
        e.preventDefault()
        return
      }

      // One-finger pan only in Select/Pan mode.
      if (activeTouchPointersRef.current.size === 1 && effectiveTool === 'select' && !isEditorOpen && !lockView) {
        touchPanRef.current = {
          active: true,
          pointerId: e.pointerId,
          lastX: e.clientX,
          lastY: e.clientY,
          moved: false,
        }
        return
      }
    }
    if (Date.now() < suppressAnnotationUntilRef.current) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (effectiveTool !== 'highlight' || isEditorOpen) return
    if (!overlayRef.current) return
    const rect = overlayRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setDragStart({ x, y })
    setDraftRect({ x, y, w: 0, h: 0 })
  }, [effectiveTool, isEditorOpen, handleTwoFingerGesture, lockView])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const mousePan = mousePanRef.current
    if (
      e.pointerType === 'mouse' &&
      mousePan.active &&
      mousePan.pointerId === e.pointerId &&
      !lockView
    ) {
      const scroll = scrollAreaRef.current
      if (scroll) {
        const dx = e.clientX - mousePan.lastX
        const dy = e.clientY - mousePan.lastY
        scroll.scrollLeft -= dx
        scroll.scrollTop -= dy
        if (!mousePan.moved && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
          mousePan.moved = true
        }
        mousePan.lastX = e.clientX
        mousePan.lastY = e.clientY
        e.preventDefault()
        return
      }
    }

    if (e.pointerType === 'touch') {
      const rect = scrollAreaRef.current?.getBoundingClientRect()
        if (rect) {
          activeTouchPointersRef.current.set(e.pointerId, {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
          })
        }
      if (activeTouchPointersRef.current.size >= 2 || pinchStateRef.current.active) {
        setDragStart(null)
        setDraftRect(null)
        handleTwoFingerGesture(e)
        e.preventDefault()
        return
      }

      const pan = touchPanRef.current
      if (
        pan.active &&
        pan.pointerId === e.pointerId &&
        activeTouchPointersRef.current.size === 1 &&
        effectiveTool === 'select' &&
        !isEditorOpen &&
        !lockView
      ) {
        const scroll = scrollAreaRef.current
        if (scroll) {
          const dx = e.clientX - pan.lastX
          const dy = e.clientY - pan.lastY
          scroll.scrollLeft -= dx
          scroll.scrollTop -= dy
          if (!pan.moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
            pan.moved = true
          }
          pan.lastX = e.clientX
          pan.lastY = e.clientY
          e.preventDefault()
          return
        }
      }
    }
    if (Date.now() < suppressAnnotationUntilRef.current) return
    if (effectiveTool !== 'highlight' || !dragStart || !overlayRef.current || isEditorOpen) return
    const rect = overlayRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const left = Math.min(dragStart.x, x)
    const top = Math.min(dragStart.y, y)
    const w = Math.abs(x - dragStart.x)
    const h = Math.abs(y - dragStart.y)
    setDraftRect({ x: left, y: top, w, h })
  }, [effectiveTool, dragStart, isEditorOpen, handleTwoFingerGesture, lockView])

  const handlePointerUp = useCallback(async (e: React.PointerEvent<HTMLDivElement>) => {
    const mousePan = mousePanRef.current
    if (e.pointerType === 'mouse' && mousePan.active && mousePan.pointerId === e.pointerId) {
      const moved = mousePan.moved
      mousePanRef.current = { active: false, pointerId: null, lastX: 0, lastY: 0, moved: false }
      setMousePanActive(false)
      if (moved) {
        const until = Date.now() + 300
        suppressAnnotationUntilRef.current = until
      }
      e.preventDefault()
      return
    }

    if (e.pointerType === 'touch') {
      const pan = touchPanRef.current
      if (pan.active && pan.pointerId === e.pointerId) {
        const moved = pan.moved
        touchPanRef.current = { active: false, pointerId: null, lastX: 0, lastY: 0, moved: false }
        endTouchPointer(e.pointerId)
        if (moved) {
          suppressAnnotationUntilRef.current = Date.now() + 300
        }
        return
      }
      endTouchPointer(e.pointerId)
      if (pinchStateRef.current.active || Date.now() < suppressAnnotationUntilRef.current) {
        return
      }
    }
    if (Date.now() < suppressAnnotationUntilRef.current) return
    if (effectiveTool !== 'highlight' || !dragStart || !overlayRef.current || !blueprint || isEditorOpen) return
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
      color: activeColor,
      createdAt: now,
      updatedAt: now,
    }
    await persistAnnotation(ann)
    setFocusedAnnotationId(ann.id)
  }, [effectiveTool, dragStart, blueprint, currentPage, persistAnnotation, activeColor, isEditorOpen, endTouchPointer])

  const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const mousePan = mousePanRef.current
    if (e.pointerType === 'mouse' && mousePan.active && mousePan.pointerId === e.pointerId) {
      const moved = mousePan.moved
      mousePanRef.current = { active: false, pointerId: null, lastX: 0, lastY: 0, moved: false }
      setMousePanActive(false)
      if (moved) {
        suppressAnnotationUntilRef.current = Date.now() + 300
      }
    }
    if (e.pointerType === 'touch') {
      const pan = touchPanRef.current
      if (pan.active && pan.pointerId === e.pointerId) {
        const moved = pan.moved
        touchPanRef.current = { active: false, pointerId: null, lastX: 0, lastY: 0, moved: false }
        if (moved) {
          suppressAnnotationUntilRef.current = Date.now() + 300
        }
      }
      endTouchPointer(e.pointerId)
      setDragStart(null)
      setDraftRect(null)
    }
  }, [endTouchPointer])

  if (!blueprint) {
    return (
      <div className="rounded-xl border p-6 text-sm text-gray-500" style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}>
        Select a blueprint set to open the PDF viewer.
      </div>
    )
  }

  const cursorClass =
    mousePanActive
      ? 'cursor-grabbing'
      : effectiveTool === 'note'
      ? 'cursor-crosshair'
      : effectiveTool === 'highlight'
        ? 'cursor-crosshair'
        : 'cursor-grab'

  const livePinchZoom = pinchPreviewZoom ?? relativeZoom
  const visualScale = Math.max(1, livePinchZoom / Math.max(0.001, clampRelativeZoom(relativeZoom)))
  const visualDisplayWidth = displaySize.w ? Math.ceil(displaySize.w * visualScale) : 0
  const visualDisplayHeight = displaySize.h ? Math.ceil(displaySize.h * visualScale) : 0

  return (
    <div
      className={isFullScreenView
        ? 'fixed inset-0 z-[9999] bg-[#0d0e14] flex flex-col overflow-hidden'
        : 'rounded-xl border overflow-hidden w-full'
      }
      style={isFullScreenView ? {} : { borderColor: '#1e2128', backgroundColor: '#0d0e14' }}
    >
      <style>{`
        .operations-pdf-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(148,163,184,0.45) rgba(15,23,42,0.35);
          touch-action: none;
          overscroll-behavior: contain;
        }
        .operations-pdf-scroll::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .operations-pdf-scroll::-webkit-scrollbar-track {
          background: rgba(15,23,42,0.35);
          border-radius: 8px;
        }
        .operations-pdf-scroll::-webkit-scrollbar-thumb {
          background: rgba(148,163,184,0.45);
          border-radius: 8px;
          border: 2px solid rgba(15,23,42,0.35);
        }
        .operations-pdf-scroll:hover::-webkit-scrollbar {
          width: 16px;
          height: 16px;
        }
        .operations-pdf-scroll:hover::-webkit-scrollbar-thumb {
          background: rgba(148,163,184,0.75);
          border: 2px solid rgba(15,23,42,0.35);
        }
      `}</style>

      {!isFullScreenView && (
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
      )}

      {!hasStoragePath ? (
        <div className="p-6 text-sm text-amber-300 bg-amber-900/10 border-t border-amber-800/30">
          This blueprint is missing `storagePath`, so the PDF cannot be opened yet.
        </div>
      ) : (
        <>
          {isFullScreenView && (
            <div className="px-4 py-2 border-b border-gray-800 flex items-center justify-between gap-3 bg-[#0d0e14] flex-shrink-0">
              <div className="min-w-0 flex items-center gap-3">
                <p className="text-sm text-gray-100 font-semibold truncate">{blueprint.title}</p>
                <p className="text-xs text-gray-500 truncate hidden xl:block">{blueprint.projectName} • {blueprint.fileName}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => void loadPdf()}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-700 text-gray-300 hover:text-white"
                >
                  <RefreshCw size={12} />
                  Refresh Link
                </button>
                <button
                  onClick={() => setIsFullScreenView(false)}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-600 text-gray-200 hover:text-white bg-gray-800/40"
                >
                  <Minimize2 size={12} />
                  Exit Full Screen
                </button>
              </div>
            </div>
          )}

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
            <span className="text-xs text-gray-400 ml-2">
              Active Tool: {toolMode === 'select' ? 'Select' : toolMode === 'note' ? 'Add Note' : 'Highlight'}
              {isEditorOpen ? ' (editing note)' : ''}
            </span>
          </div>

          <div className="px-4 py-2 border-b border-gray-800 flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-400">Color:</span>
            {ANNOTATION_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setActiveColor(c)
                  setNoteEditor((prev) => (prev ? { ...prev, color: c } : prev))
                }}
                className={`w-5 h-5 rounded-full border ${activeColor === c ? 'border-white' : 'border-gray-700'}`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
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
                disabled={!canRender}
                onClick={toggleCurrentPageSelection}
                className={`text-xs px-2 py-1 rounded-md border ${isCurrentPageSelected ? 'border-amber-500 text-amber-300 bg-amber-900/20' : 'border-gray-700 text-gray-300'}`}
              >
                {isCurrentPageSelected ? 'Remove Current Page' : 'Add Current Page'}
              </button>
              <span className="text-xs text-gray-400">Selected: {selectedPageNumbers.length}</span>
              <button
                onClick={() => setLockView((v) => !v)}
                className={`text-xs px-2 py-1 rounded-md border ${lockView ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300'}`}
              >
                Lock View
              </button>
              <button
                onClick={() => {
                  pendingScrollResetRef.current = true
                  setRelativeZoom(1)
                }}
                className="text-xs px-2 py-1 rounded-md border border-blue-500 text-blue-300 bg-blue-900/20"
              >
                Fit Width
              </button>
              <button
                onClick={() => setIsFullScreenView((v) => !v)}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-700 text-gray-300 hover:text-white"
              >
                {isFullScreenView ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                {isFullScreenView ? 'Exit Full Screen' : 'Full Size Screen'}
              </button>
              <button
                disabled={!canRender || relativeZoom <= MIN_RELATIVE_ZOOM}
                onClick={() => applyRelativeZoomDelta(-0.1)}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-700 text-gray-300 disabled:opacity-50"
              >
                <ZoomOut size={12} />
              </button>
              <span className="text-xs text-gray-400 w-12 text-center">{Math.round(clampRelativeZoom(relativeZoom) * 100)}%</span>
              <button
                disabled={!canRender || relativeZoom >= MAX_RELATIVE_ZOOM}
                onClick={() => applyRelativeZoomDelta(0.1)}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-700 text-gray-300 disabled:opacity-50"
              >
                <ZoomIn size={12} />
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

          <div className={isFullScreenView ? 'flex-1 min-h-0 overflow-hidden p-4' : 'p-4'}>
            <div className={isFullScreenView ? 'grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-4 h-full' : 'grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-4'}>
              <div
                ref={scrollAreaRef}
                className={`operations-pdf-scroll ${lockView ? 'overflow-hidden' : 'overflow-auto'} ${isFullScreenView ? 'h-full max-h-none min-h-0' : 'max-h-[72vh]'} rounded border border-gray-800`}
                onWheel={handleWheel}
              >
                <div
                  className="relative p-3"
                  style={{
                    width: visualDisplayWidth ? Math.max(visualDisplayWidth + 24, viewportWidth || 0) : '100%',
                    minHeight: visualDisplayHeight ? visualDisplayHeight + 24 : '100%',
                  }}
                >
                  <div
                    ref={pageFrameRef}
                    className="relative"
                    style={{
                      width: displaySize.w || undefined,
                      height: displaySize.h || undefined,
                      transform: visualScale !== 1 ? `scale(${visualScale})` : undefined,
                      transformOrigin: 'top left',
                      willChange: visualScale !== 1 ? 'transform' : undefined,
                    }}
                  >
                    <canvas ref={canvasRef} className="border border-gray-800 bg-white shadow-lg block" />
                    <div
                      ref={overlayRef}
                      className={`absolute inset-0 ${cursorClass}`}
                      onClick={handleOverlayClick}
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={handlePointerCancel}
                    >
                      {pageAnnotations.map((a) => {
                        if (!a?.rect) return null
                        const left = `${(a.rect.x || 0) * 100}%`
                        const top = `${(a.rect.y || 0) * 100}%`
                        const width = `${Math.max(0.01, (a.rect.w || 0)) * 100}%`
                        const height = `${Math.max(0.01, (a.rect.h || 0)) * 100}%`
                        const isFocused = focusedAnnotationId === a.id
                        if (a.type === 'highlight') {
                          return (
                            <div
                              key={a.id}
                              className="absolute group"
                              style={{ left, top, width, height }}
                              onClick={(e) => { e.stopPropagation(); setFocusedAnnotationId(a.id) }}
                            >
                              <div
                                className={`w-full h-full pointer-events-none ${isFocused ? 'ring-2 ring-white/80' : ''}`}
                                style={{ border: `1px solid ${a.color || '#facc15'}`, backgroundColor: `${a.color || '#facc15'}55` }}
                              />
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
                              onClick={(e) => { e.stopPropagation(); openEditNoteEditor(a) }}
                              className={`w-5 h-5 rounded-full border text-white text-[10px] font-bold ${isFocused ? 'ring-2 ring-white/80' : ''}`}
                              style={{ backgroundColor: a.color || '#38bdf8' }}
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

                      {draftRect && effectiveTool === 'highlight' && (
                        <div
                          className="absolute border pointer-events-none"
                          style={{
                            left: draftRect.x,
                            top: draftRect.y,
                            width: draftRect.w,
                            height: draftRect.h,
                            borderColor: activeColor,
                            backgroundColor: `${activeColor}55`,
                          }}
                        />
                      )}

                      {noteEditor && (
                        <div
                          className="absolute z-20 w-56 rounded-md border border-gray-700 bg-[#121521] p-2 shadow-xl"
                          style={{
                            left: `${Math.min(0.85, Math.max(0.02, noteEditor.x)) * 100}%`,
                            top: `${Math.min(0.85, Math.max(0.02, noteEditor.y)) * 100}%`,
                            transform: 'translate(8px, 8px)',
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <textarea
                            ref={noteEditorRef}
                            value={noteEditor.text}
                            onChange={(e) => setNoteEditor((prev) => (prev ? { ...prev, text: e.target.value } : prev))}
                            className="w-full h-20 resize-none rounded border border-gray-700 bg-gray-900/60 text-gray-100 text-xs p-2"
                            placeholder="Enter note..."
                          />
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1">
                              {ANNOTATION_COLORS.map((c) => (
                                <button
                                  key={c}
                                  onClick={() => setNoteEditor((prev) => (prev ? { ...prev, color: c } : prev))}
                                  className={`w-4 h-4 rounded-full border ${(noteEditor.color || activeColor) === c ? 'border-white' : 'border-gray-600'}`}
                                  style={{ backgroundColor: c }}
                                />
                              ))}
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => setNoteEditor(null)}
                                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-gray-700 text-gray-300"
                              >
                                <X size={10} />
                                Cancel
                              </button>
                              <button
                                onClick={() => void saveNoteEditor()}
                                className="text-[11px] px-2 py-1 rounded bg-blue-600 text-white"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className={`border border-gray-800 rounded-md bg-[#10131c] overflow-auto ${isFullScreenView ? 'h-full max-h-none min-h-0' : 'max-h-[72vh]'}`}>
                <div className="px-3 py-2 border-b border-gray-800 text-xs font-semibold text-gray-300">
                  Current Page Annotations ({pageAnnotations.length})
                </div>
                {pageAnnotations.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-gray-500">No annotations on this page.</div>
                ) : (
                  <div className="divide-y divide-gray-800">
                    {pageAnnotations.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => {
                          setFocusedAnnotationId(a.id)
                          if (a.type === 'note') openEditNoteEditor(a)
                        }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-white/5 ${focusedAnnotationId === a.id ? 'bg-white/5' : ''}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: a.color || '#facc15' }} />
                            <span className="text-gray-300 uppercase">{a.type}</span>
                            <span className="text-gray-500">P{a.pageNumber}</span>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); void removeAnnotation(a.id) }}
                            className="text-red-300 hover:text-red-200"
                            title="Delete annotation"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                        {a.type === 'note' && (
                          <div className="mt-1 text-gray-400 truncate">{shortText(a.text)}</div>
                        )}
                      </button>
                    ))}
                  </div>
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
