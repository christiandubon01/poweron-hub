// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Bold,
  ChevronLeft,
  ChevronRight,
  Circle,
  Eraser,
  Highlighter,
  Italic,
  Layers,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  MousePointer2,
  Move,
  PenLine,
  RefreshCw,
  Search,
  Shapes,
  Sparkles,
  Square,
  StickyNote,
  Type,
  Trash2,
  Underline,
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
import { ToolPopover, ColorRow, Stepper, LabeledSelect, ToggleRow } from './ToolPopover'

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

const MIN_RELATIVE_ZOOM = 0.25
const MAX_RELATIVE_ZOOM = 4
const MAX_RENDER_SCALE = 3.0
const PINCH_SENSITIVITY = 0.55
const PINCH_DEADZONE_PX = 2
// Debounce window for committing wheel-zoom changes to the actual PDF canvas
// re-render. During the debounce window, the page is visually scaled via CSS
// transform (instant feedback), then re-rendered sharp once the user stops.
// 120ms keeps the sharp re-render close on the user's heels so the blurry
// CSS-transform intermediate is barely visible. Tested on desktop wheel.
const WHEEL_ZOOM_COMMIT_DELAY_MS = 120
const MIN_HIGHLIGHT_NORM = 0.005
const NOTE_MARKER_SIZE_NORM = 0.018
const ANNOTATION_COLORS = ['#facc15', '#38bdf8', '#f97316', '#22c55e', '#a78bfa', '#ef4444', '#ffffff', '#111827']
const TEXT_COLOR_OPTIONS = ['#111827', '#ffffff', '#facc15', '#38bdf8', '#22c55e', '#ef4444']
const FONT_SIZE_OPTIONS = [10, 12, 14, 16, 18, 24]
const FONT_WEIGHT_OPTIONS = [
  { label: 'Light', value: 300 },
  { label: 'Regular', value: 400 },
  { label: 'Medium', value: 500 },
  { label: 'Semi Bold', value: 600 },
  { label: 'Bold', value: 700 },
  { label: 'Extra Bold', value: 800 },
]
const THICKNESS_OPTIONS = [1, 2, 3, 5, 8, 12]
const OPACITY_OPTIONS = [0.25, 0.4, 0.55, 0.7, 0.85, 1]
const DEFAULT_TEXT_BOX = { w: 0.22, h: 0.08 }
const DEFAULT_CALLOUT_BOX = { w: 0.24, h: 0.1 }

type ToolbarBucket = 'annotate' | 'callouts' | 'draw' | 'generate' | 'view'
type ToolMode =
  | 'select'
  | 'note'
  | 'highlight'
  | 'underline'
  | 'textBox'
  | 'pen'
  | 'marker'
  | 'eraser'
  | 'shape'
  | 'callout'
  | 'generate'

type ShapeKind = 'square' | 'circle' | 'line' | 'arrow'
type BorderStyle = 'solid' | 'dashed' | 'dotted'
type HatchPattern = 'none' | 'diagonal' | 'cross' | 'dots'
type GenerateQuestionType = 'coordination' | 'rfi'

interface OperationsBlueprintPdfViewerProps {
  blueprint: BlueprintLibraryItem | null
  onAnnotationsChanged?: () => void
  selectedPageNumbers?: number[]
  onSelectedPagesChange?: (pages: number[]) => void
  externalPage?: number | null
  onPageChange?: (page: number) => void
  onGenerateQuestion?: (payload: {
    annotation: BlueprintAnnotation
    questionType: GenerateQuestionType
    question: string
    pageNumber: number
    blueprint: BlueprintLibraryItem
  }) => void
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

function clampNorm(v: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number.isFinite(v) ? v : min))
}

function clampRectToPage(rect: { x: number; y: number; w: number; h: number }) {
  const w = clampNorm(rect.w, 0.01, 1)
  const h = clampNorm(rect.h, 0.01, 1)
  return {
    x: clampNorm(rect.x, 0, Math.max(0, 1 - w)),
    y: clampNorm(rect.y, 0, Math.max(0, 1 - h)),
    w,
    h,
  }
}

function getAnnotationMeta(annotation: any) {
  return annotation?.meta || annotation?.metadata || {}
}

function withAnnotationMeta(annotation: any, meta: Record<string, any>) {
  return { ...annotation, meta: { ...getAnnotationMeta(annotation), ...meta }, metadata: { ...getAnnotationMeta(annotation), ...meta } }
}

function hexWithAlpha(hex: string, opacity: number) {
  const safe = String(hex || '#facc15').replace('#', '')
  if (safe.length !== 6) return hex
  const alpha = Math.round(clampNorm(opacity, 0, 1) * 255).toString(16).padStart(2, '0')
  return `#${safe}${alpha}`
}

function getHatchBackground(pattern: HatchPattern, color: string, fillColor: string, opacity: number) {
  const fill = hexWithAlpha(fillColor || color, opacity)
  const hatch = hexWithAlpha(color || '#facc15', Math.min(1, opacity + 0.15))
  if (pattern === 'diagonal') {
    return `repeating-linear-gradient(45deg, ${fill}, ${fill} 6px, ${hatch} 6px, ${hatch} 8px)`
  }
  if (pattern === 'cross') {
    return `repeating-linear-gradient(45deg, ${fill}, ${fill} 6px, ${hatch} 6px, ${hatch} 8px), repeating-linear-gradient(-45deg, transparent, transparent 6px, ${hatch} 6px, ${hatch} 8px)`
  }
  if (pattern === 'dots') {
    return `radial-gradient(${hatch} 1px, ${fill} 1px)`
  }
  return fill
}

function normalizePoints(points: Array<{ x: number; y: number }>, width: number, height: number) {
  return points.map((p) => toNorm(p.x, p.y, width, height))
}

function getPointsBounds(points: Array<{ x: number; y: number }>) {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 }
  const xs = points.map(p => p.x)
  const ys = points.map(p => p.y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  const right = Math.max(...xs)
  const bottom = Math.max(...ys)
  return { x: left, y: top, w: Math.max(0.001, right - left), h: Math.max(0.001, bottom - top) }
}

function clampPx(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}

function estimateTextBoxSize(
  text: string,
  fontSize: number,
  pageWidth: number,
  pageHeight: number,
  hasHeader = false
) {
  const safeText = String(text || ' ')
  const lines = safeText.split(/\r?\n/)
  const longestLine = Math.max(1, ...lines.map((line) => line.length))
  const lineCount = Math.max(1, lines.length)
  const widthPx = clampPx((longestLine * fontSize * 0.62) + 28, 72, Math.max(72, pageWidth * 0.42))
  const heightPx = clampPx((lineCount * fontSize * 1.35) + 22 + (hasHeader ? 16 : 0), 34, Math.max(34, pageHeight * 0.32))
  return {
    w: clampNorm(widthPx / Math.max(1, pageWidth), 0.05, 0.5),
    h: clampNorm(heightPx / Math.max(1, pageHeight), 0.025, 0.34),
  }
}

function annotationLabel(annotation: BlueprintAnnotation) {
  if (annotation.type === 'textBox') return 'Text Box'
  if (annotation.type === 'callout') return 'Callout'
  if (annotation.type === 'generate') return getAnnotationMeta(annotation).questionType === 'rfi' ? 'RFI Question' : 'Coordination Question'
  if (annotation.type === 'pen') return 'Pen'
  if (annotation.type === 'marker') return 'Marker'
  if (annotation.type === 'shape') return `${String(getAnnotationMeta(annotation).shapeKind || 'shape')}`
  if (annotation.type === 'underline') return 'Underline'
  return String(annotation.type || 'annotation')
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
  onGenerateQuestion,
}: OperationsBlueprintPdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const pdfDocRef = useRef<any>(null)
  const renderTaskRef = useRef<any>(null)
  const noteEditorRef = useRef<HTMLTextAreaElement>(null)
  const richTextEditorRef = useRef<HTMLTextAreaElement>(null)
  const allAnnotationsRef = useRef<BlueprintAnnotation[]>([])
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  // Ref to the viewer's outermost element — used as the target for the
  // Fullscreen API on mobile (iPad/Android) so the viewer opens like a
  // video does, escaping browser chrome.
  const viewerRootRef = useRef<HTMLDivElement>(null)
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
  // containerReady: true once the scroll area has a non-zero height.
  // Prevents Fit-to-Full-Page from running before the DOM is sized.
  const [containerReady, setContainerReady] = useState(false)

  const [isFullScreenView, setIsFullScreenView] = useState(false)

  const [toolbarBucket, setToolbarBucket] = useState<ToolbarBucket>('annotate')
  const [toolMode, setToolMode] = useState<ToolMode>('select')

  // Per-tool color memory (replaces single activeColor)
  type ToolKey = 'highlight' | 'underline' | 'textBox' | 'pen' | 'marker' | 'eraser' | 'shape' | 'callout' | 'generate' | 'note'
  const [toolColors, setToolColors] = useState<Record<ToolKey, string>>({
    highlight: '#facc15',
    underline: '#facc15',
    textBox: '#111827',
    pen: '#facc15',
    marker: '#facc15',
    eraser: '#facc15',
    shape: '#facc15',
    callout: '#facc15',
    generate: '#facc15',
    note: '#facc15',
  })
  const setToolColor = (tool: ToolKey, color: string) => setToolColors((prev) => ({ ...prev, [tool]: color }))

  // Floating popover state
  const [openPopover, setOpenPopover] = useState<{
    tool: ToolMode
    anchorEl: HTMLElement | null
    mode: 'tool' | 'edit'
    editingAnnotationId?: string
  } | null>(null)

  // Per-tool numeric options
  const [eraserSize, setEraserSize] = useState(20)
  const [highlightOpacity, setHighlightOpacity] = useState(35) // stored as 0-100 for stepper
  const [underlineThickness, setUnderlineThickness] = useState(2)

  const [allAnnotations, setAllAnnotations] = useState<BlueprintAnnotation[]>([])
  const [focusedAnnotationId, setFocusedAnnotationId] = useState<string | null>(null)
  const [layoutEditId, setLayoutEditId] = useState<string | null>(null)

  const [draftRect, setDraftRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)

  const [inkDraft, setInkDraft] = useState<Array<{ x: number; y: number }> | null>(null)
  const inkDraftRef = useRef<Array<{ x: number; y: number }> | null>(null)
  const [layoutDrag, setLayoutDrag] = useState<{
    annotationId: string
    mode: 'move' | 'resize'
    pointerId: number
    startClientX: number
    startClientY: number
    startBox: { x: number; y: number; w: number; h: number }
  } | null>(null)

  const [noteEditor, setNoteEditor] = useState<{
    mode: 'create' | 'edit'
    annotationId?: string
    x: number
    y: number
    text: string
    color: string
  } | null>(null)

  const [richTextEditor, setRichTextEditor] = useState<{
    mode: 'create' | 'edit'
    annotationId?: string
    annotationType: 'textBox' | 'callout' | 'generate'
    x: number
    y: number
    w: number
    h: number
    anchor?: { x: number; y: number }
    text: string
    color: string
    questionType?: GenerateQuestionType
  } | null>(null)

  const [textStyle, setTextStyle] = useState({
    fontSize: 14,
    fontWeight: 400,
    fontFamily: 'Helvetica',
    italic: false,
    underline: false,
    bold: false,
    color: '#111827',
    backgroundColor: '#ffffff',
    boxFill: 'transparent',
    borderColor: 'transparent',
    borderWidth: 1,
    align: 'left' as 'left' | 'center' | 'right',
  })
  const [drawOptions, setDrawOptions] = useState({ thickness: 3, opacity: 0.85 })
  const [markerOptions, setMarkerOptions] = useState({ thickness: 12, opacity: 0.35 })
  const [shapeKind, setShapeKind] = useState<ShapeKind>('square')
  const [showShapePicker, setShowShapePicker] = useState(false)
  const [shapeOptions, setShapeOptions] = useState({
    borderColor: '#facc15',
    borderThickness: 2,
    borderStyle: 'solid' as BorderStyle,
    hatchPattern: 'none' as HatchPattern,
    fillColor: 'transparent',
    fillOpacity: 0.22,
    opacity: 100, // 10-100 for stepper, % display
  })
  const [generateQuestionType, setGenerateQuestionType] = useState<GenerateQuestionType>('coordination')

  const hasStoragePath = !!blueprint?.storagePath?.trim()
  const canRender = !!pdfDoc && numPages > 0
  const isEditorOpen = !!noteEditor || !!richTextEditor
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

  useEffect(() => {
    allAnnotationsRef.current = allAnnotations
  }, [allAnnotations])

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
        try { renderTaskRef.current.cancel() } catch { }
        renderTaskRef.current = null
      }
      if (pdfDocRef.current) {
        try { await pdfDocRef.current.destroy() } catch { }
      }
      if (pinchZoomRafRef.current != null) {
        try { cancelAnimationFrame(pinchZoomRafRef.current) } catch { }
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
      setInkDraft(null)
      setNoteEditor(null)
      setRichTextEditor(null)
      setFocusedAnnotationId(null)
      setLayoutEditId(null)
      setLayoutDrag(null)
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
      // Flip containerReady once the scroll area has a real height so
      // the render effect can perform an accurate Fit-to-Full-Page calculation.
      if (rect.height > 0) setContainerReady(true)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [scrollAreaRef.current])

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current || !containerReady) return
    const clampedPage = Math.max(1, Math.min(numPages || 1, currentPage))
    let isDisposed = false

    const run = async () => {
      setIsRendering(true)
      setError(null)
      try {
        if (renderTaskRef.current) {
          try { renderTaskRef.current.cancel() } catch { }
          renderTaskRef.current = null
        }

        const page = await pdfDoc.getPage(clampedPage)
        const baseViewport = page.getViewport({ scale: 1 })
        const measuredWidth = viewportWidth || scrollAreaRef.current?.clientWidth || 0
        const measuredHeight = scrollAreaRef.current?.clientHeight || 0
        const availableWidth = Math.max(120, measuredWidth - 26)
        const availableHeight = Math.max(120, measuredHeight - 26)
        // Fit-to-Full-Page: fit the WHOLE sheet within the container, both
        // dimensions. Picks the more constraining dimension (width or height)
        // so nothing gets cut off. User zooms in from there.
        const widthScale = availableWidth / Math.max(1, baseViewport.width)
        const heightScale = measuredHeight > 0
          ? availableHeight / Math.max(1, baseViewport.height)
          : widthScale
        const fitWidthScale = Math.max(0.01, Math.min(widthScale, heightScale))
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
        try { renderTaskRef.current.cancel() } catch { }
      }
    }
  }, [pdfDoc, currentPage, numPages, viewportWidth, relativeZoom, lockView, clampScroll, containerReady])

  useEffect(() => {
    if (!isEditorOpen) return
    setTimeout(() => {
      if (richTextEditor) richTextEditorRef.current?.focus()
      else noteEditorRef.current?.focus()
    }, 20)
  }, [isEditorOpen, richTextEditor])

  // Sync isFullScreenView with the browser's native Fullscreen API state.
  // Fires when user presses Esc, swipes down on iPad, or otherwise exits
  // OS-level fullscreen, so the UI's "Exit Full Screen" toggle stays correct.
  useEffect(() => {
    function handleFullscreenChange() {
      const doc: any = document
      const isInFullscreen = !!(doc.fullscreenElement || doc.webkitFullscreenElement)
      if (!isInFullscreen) {
        setIsFullScreenView(false)
      }
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      const hasOpenState = !!(noteEditor || richTextEditor || draftRect || dragStart || inkDraft || focusedAnnotationId || layoutEditId)
      if (hasOpenState) {
        setDraftRect(null)
        setDragStart(null)
        setInkDraft(null)
        setNoteEditor(null)
        setRichTextEditor(null)
        setFocusedAnnotationId(null)
        setLayoutEditId(null)
        setLayoutDrag(null)
      } else if (isFullScreenView) {
        setIsFullScreenView(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isFullScreenView, noteEditor, richTextEditor, draftRect, dragStart, inkDraft, focusedAnnotationId, layoutEditId])

  useEffect(() => {
    pendingScrollResetRef.current = true
    setRelativeZoom(1)
  }, [currentPage, blueprint?.id])

  useEffect(() => {
    if (externalPage === null || externalPage === undefined) return

    const requestedPage = Number(externalPage)
    if (!Number.isFinite(requestedPage) || requestedPage < 1) return

    const maxPage = Math.max(1, Number(numPages || 1))
    const next = Math.max(1, Math.min(maxPage, Math.floor(requestedPage)))

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
    setLayoutEditId(null)
    setNoteEditor(null)
    setRichTextEditor(null)
    setDraftRect(null)
    setDragStart(null)
    setInkDraft(null)
  }, [pageInput, numPages])

  const openCreateNoteEditorAt = useCallback((normX: number, normY: number) => {
    setFocusedAnnotationId(null)
    setNoteEditor({
      mode: 'create',
      x: normX,
      y: normY,
      text: '',
      color: toolColors.note,
    })
  }, [toolColors])

  const openEditNoteEditor = useCallback((annotation: BlueprintAnnotation) => {
    const rect = annotation.rect || { x: 0, y: 0 }
    setFocusedAnnotationId(annotation.id)
    setNoteEditor({
      mode: 'edit',
      annotationId: annotation.id,
      x: rect.x || 0,
      y: rect.y || 0,
      text: annotation.text || '',
      color: annotation.color || toolColors.note,
    })
  }, [toolColors])

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
        color: noteEditor.color || toolColors.note,
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
      color: noteEditor.color || toolColors.note,
      updatedAt: now,
    }
    await persistAnnotation(updated)
    setFocusedAnnotationId(updated.id)
    setNoteEditor(null)
  }, [blueprint, noteEditor, toolColors, currentPage, persistAnnotation, allAnnotations])


  const openRichTextEditor = useCallback((annotation: BlueprintAnnotation) => {
    const rect = clampRectToPage(annotation.rect || { x: 0.02, y: 0.02, w: DEFAULT_TEXT_BOX.w, h: DEFAULT_TEXT_BOX.h })
    const meta = getAnnotationMeta(annotation)
    const box = clampRectToPage(meta.box || rect)
    setFocusedAnnotationId(annotation.id)
    setLayoutEditId(null)
    setRichTextEditor({
      mode: 'edit',
      annotationId: annotation.id,
      annotationType: annotation.type === 'generate' ? 'generate' : annotation.type === 'callout' ? 'callout' : 'textBox',
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      anchor: meta.anchor,
      text: annotation.text || '',
      color: annotation.color || toolColors[annotation.type as ToolKey] || '#facc15',
      questionType: meta.questionType || generateQuestionType,
    })
    setTextStyle((prev) => ({
      ...prev,
      ...(meta.textStyle || {}),
      color: meta.textStyle?.color || prev.color,
      backgroundColor: meta.textStyle?.backgroundColor || prev.backgroundColor,
    }))
  }, [toolColors, generateQuestionType])

  const openCreateRichTextEditor = useCallback((annotationType: 'textBox' | 'callout' | 'generate', rect: { x: number; y: number; w: number; h: number }, anchor?: { x: number; y: number }) => {
    const safeRect = clampRectToPage(rect)
    setFocusedAnnotationId(null)
    setLayoutEditId(null)
    setRichTextEditor({
      mode: 'create',
      annotationType,
      x: safeRect.x,
      y: safeRect.y,
      w: safeRect.w,
      h: safeRect.h,
      anchor,
      text: '',
      color: toolColors[annotationType as ToolKey] || '#facc15',
      questionType: generateQuestionType,
    })
  }, [toolColors, generateQuestionType])

  const saveRichTextEditor = useCallback(async () => {
    if (!blueprint || !richTextEditor) return
    const trimmed = (richTextEditor.text || '').trim()
    if (!trimmed) {
      setRichTextEditor(null)
      return
    }

    const now = new Date().toISOString()
    const initialBox = { x: richTextEditor.x, y: richTextEditor.y, w: richTextEditor.w, h: richTextEditor.h }
    const autoSize = richTextEditor.annotationType === 'callout' || richTextEditor.annotationType === 'generate'
      ? estimateTextBoxSize(
        trimmed,
        Number(textStyle.fontSize || 13),
        Math.max(1, displaySizeRef.current.w || displaySize.w),
        Math.max(1, displaySizeRef.current.h || displaySize.h),
        richTextEditor.annotationType === 'generate'
      )
      : null
    const box = clampRectToPage(autoSize ? { ...initialBox, ...autoSize } : initialBox)
    const anchor = richTextEditor.anchor || { x: box.x, y: box.y }
    const baseMeta = {
      box,
      anchor,
      textStyle: { ...textStyle, fontWeight: Number(textStyle.fontWeight || 400) },
      questionType: richTextEditor.questionType || generateQuestionType,
    }

    if (richTextEditor.mode === 'create') {
      const ann: BlueprintAnnotation = {
        id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        blueprintSetId: blueprint.id,
        projectId: blueprint.projectId,
        pageNumber: currentPage,
        type: richTextEditor.annotationType,
        rect: richTextEditor.annotationType === 'textBox' ? box : { x: anchor.x, y: anchor.y, w: NOTE_MARKER_SIZE_NORM, h: NOTE_MARKER_SIZE_NORM },
        text: trimmed,
        color: richTextEditor.color || toolColors[richTextEditor.annotationType as ToolKey] || '#facc15',
        meta: baseMeta,
        metadata: baseMeta,
        createdAt: now,
        updatedAt: now,
      } as BlueprintAnnotation
      await persistAnnotation(ann)
      setFocusedAnnotationId(ann.id)
      setRichTextEditor(null)
      if (richTextEditor.annotationType === 'generate') {
        onGenerateQuestion?.({
          annotation: ann,
          questionType: baseMeta.questionType,
          question: trimmed,
          pageNumber: currentPage,
          blueprint,
        })
      }
      return
    }

    const existing = allAnnotations.find(a => a.id === richTextEditor.annotationId)
    if (!existing) {
      setRichTextEditor(null)
      return
    }
    const updated = withAnnotationMeta({
      ...existing,
      text: trimmed,
      color: richTextEditor.color || toolColors[richTextEditor.annotationType as ToolKey] || '#facc15',
      rect: richTextEditor.annotationType === 'textBox' ? box : (existing.rect || { x: anchor.x, y: anchor.y, w: NOTE_MARKER_SIZE_NORM, h: NOTE_MARKER_SIZE_NORM }),
      updatedAt: now,
    }, baseMeta) as BlueprintAnnotation
    await persistAnnotation(updated)
    setFocusedAnnotationId(updated.id)
    setRichTextEditor(null)
    if (richTextEditor.annotationType === 'generate') {
      onGenerateQuestion?.({
        annotation: updated,
        questionType: baseMeta.questionType,
        question: trimmed,
        pageNumber: currentPage,
        blueprint,
      })
    }
  }, [blueprint, richTextEditor, toolColors, currentPage, generateQuestionType, persistAnnotation, allAnnotations, onGenerateQuestion, textStyle, displaySize])

  const updateAnnotationLayout = useCallback((annotationId: string, box: { x: number; y: number; w: number; h: number }) => {
    const safeBox = clampRectToPage(box)
    setAllAnnotations((prev) => prev.map((ann) => {
      if (ann.id !== annotationId) return ann
      if (ann.type === 'textBox' || ann.type === 'highlight' || ann.type === 'underline' || ann.type === 'shape') {
        return { ...ann, rect: safeBox, updatedAt: new Date().toISOString() } as BlueprintAnnotation
      }
      return withAnnotationMeta({ ...ann, updatedAt: new Date().toISOString() }, { box: safeBox }) as BlueprintAnnotation
    }))
  }, [])

  const commitAnnotationLayout = useCallback(async (annotationId: string) => {
    const ann = allAnnotationsRef.current.find((item) => item.id === annotationId)
    if (!ann) return
    await persistAnnotation({ ...ann, updatedAt: new Date().toISOString() })
  }, [persistAnnotation])

  const startAnnotationLayoutDrag = useCallback((e: React.PointerEvent<HTMLElement>, annotation: BlueprintAnnotation, mode: 'move' | 'resize') => {
    const meta = getAnnotationMeta(annotation)
    const box = clampRectToPage(meta.box || annotation.rect || { x: 0.02, y: 0.02, w: DEFAULT_TEXT_BOX.w, h: DEFAULT_TEXT_BOX.h })
    setFocusedAnnotationId(annotation.id)
    setLayoutEditId(annotation.id)
    setLayoutDrag({
      annotationId: annotation.id,
      mode,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startBox: box,
    })
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId) } catch { }
    e.preventDefault()
    e.stopPropagation()
  }, [])


  const handleAnnotationLayoutPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!layoutDrag || layoutDrag.pointerId !== e.pointerId || !overlayRef.current) return
    const rect = overlayRef.current.getBoundingClientRect()
    const dx = (e.clientX - layoutDrag.startClientX) / Math.max(1, rect.width)
    const dy = (e.clientY - layoutDrag.startClientY) / Math.max(1, rect.height)
    const start = layoutDrag.startBox
    const next = layoutDrag.mode === 'resize'
      ? { ...start, w: start.w + dx, h: start.h + dy }
      : { ...start, x: start.x + dx, y: start.y + dy }
    updateAnnotationLayout(layoutDrag.annotationId, next)
    e.preventDefault()
    e.stopPropagation()
  }, [layoutDrag, updateAnnotationLayout])

  const handleAnnotationLayoutPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!layoutDrag || layoutDrag.pointerId !== e.pointerId) return
    const id = layoutDrag.annotationId
    setLayoutDrag(null)
    void commitAnnotationLayout(id)
    e.preventDefault()
    e.stopPropagation()
  }, [layoutDrag, commitAnnotationLayout])

  const handleOverlayClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (Date.now() < suppressAnnotationUntilRef.current) return
    if (!blueprint || isEditorOpen) return
    if (!overlayRef.current || !displaySize.w || !displaySize.h) return
    const rect = overlayRef.current.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const n = toNorm(px, py, rect.width, rect.height)

    if (effectiveTool === 'note') {
      openCreateNoteEditorAt(n.x, n.y)
      return
    }

    if (effectiveTool === 'callout' || effectiveTool === 'generate') {
      const boxW = effectiveTool === 'generate' ? 0.28 : DEFAULT_CALLOUT_BOX.w
      const boxH = effectiveTool === 'generate' ? 0.12 : DEFAULT_CALLOUT_BOX.h
      const preferredX = n.x > 0.68 ? n.x - boxW - 0.04 : n.x + 0.04
      const preferredY = n.y > 0.78 ? n.y - boxH - 0.04 : n.y + 0.04
      openCreateRichTextEditor(
        effectiveTool === 'generate' ? 'generate' : 'callout',
        { x: preferredX, y: preferredY, w: boxW, h: boxH },
        { x: n.x, y: n.y }
      )
    }
  }, [effectiveTool, isEditorOpen, blueprint, displaySize, openCreateNoteEditorAt, openCreateRichTextEditor])

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
      // PINCH DRIFT FIX: Capture the anchor ONCE at gesture start so subsequent
      // move events reuse the same page-relative pinch midpoint. Without this,
      // anchor recomputes against a scroll position that itself was moved by
      // the previous frame, causing the page to drift right during pinch.
      if (scroll && displaySizeRef.current.w > 0 && displaySizeRef.current.h > 0) {
        const baseCommittedZoom = Math.max(0.001, clampRelativeZoom(relativeZoomRef.current))
        const startVisualScale = Math.max(1, startZoom / baseCommittedZoom)
        const startVisualW = displaySizeRef.current.w * startVisualScale
        const startVisualH = displaySizeRef.current.h * startVisualScale
        const startAnchor = getPinchAnchorFromMidpoint(midpointClientX, midpointClientY, startVisualW, startVisualH)
        if (startAnchor) {
          pendingPinchAnchorRef.current = {
            ratioX: startAnchor.ratioX,
            ratioY: startAnchor.ratioY,
            centerInScrollX: startAnchor.centerInScrollX,
            centerInScrollY: startAnchor.centerInScrollY,
          }
        }
      }
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
        // Reuse the anchor captured at pinch start (fixes drift). The anchor's
        // ratioX/ratioY stay fixed to the page point under the user's fingers;
        // only the visual width/height change as zoom changes.
        if (scroll && displaySizeRef.current.w > 0 && displaySizeRef.current.h > 0) {
          const startAnchor = pendingPinchAnchorRef.current
          if (startAnchor) {
            const baseCommittedZoom = Math.max(0.001, clampRelativeZoom(relativeZoomRef.current))
            const nextVisualScale = Math.max(1, nextZoom / baseCommittedZoom)
            const nextVisualW = displaySizeRef.current.w * nextVisualScale
            const nextVisualH = displaySizeRef.current.h * nextVisualScale
            // Get the page's current top-left offset (it may have moved between events)
            const page = pageFrameRef.current
            const scrollRect = scroll.getBoundingClientRect()
            const pageRect = page?.getBoundingClientRect()
            const pageOffsetX = pageRect ? (pageRect.left - scrollRect.left) + scroll.scrollLeft : 0
            const pageOffsetY = pageRect ? (pageRect.top - scrollRect.top) + scroll.scrollTop : 0
            const targetLeft = pageOffsetX + (startAnchor.ratioX * nextVisualW) - startAnchor.centerInScrollX
            const targetTop = pageOffsetY + (startAnchor.ratioY * nextVisualH) - startAnchor.centerInScrollY
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
      try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId) } catch { }
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
    if (isEditorOpen) return
    if (!overlayRef.current) return
    const rect = overlayRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    if (effectiveTool === 'pen' || effectiveTool === 'marker') {
      const firstPoint = [{ x, y }]
      inkDraftRef.current = firstPoint
      setInkDraft(firstPoint)
      try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId) } catch { }
      e.preventDefault()
      return
    }

    if (effectiveTool === 'highlight' || effectiveTool === 'underline' || effectiveTool === 'textBox' || effectiveTool === 'shape' || effectiveTool === 'callout' || effectiveTool === 'generate') {
      dragStartRef.current = { x, y }
      setDragStart({ x, y })
      setDraftRect({ x, y, w: 0, h: 0 })
      try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId) } catch { }
      e.preventDefault()
    }
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
    if (!overlayRef.current || isEditorOpen) return
    const rect = overlayRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    if (effectiveTool === 'pen' || effectiveTool === 'marker') {
      const currentPoints = inkDraftRef.current
      if (!currentPoints) return
      const nextPoints = [...currentPoints, { x, y }]
      inkDraftRef.current = nextPoints
      setInkDraft(nextPoints)
      e.preventDefault()
      return
    }

    const activeDragStart = dragStartRef.current || dragStart
    if (!(effectiveTool === 'highlight' || effectiveTool === 'underline' || effectiveTool === 'textBox' || effectiveTool === 'shape' || effectiveTool === 'eraser' || effectiveTool === 'callout' || effectiveTool === 'generate') || !activeDragStart) return

    const left = Math.min(activeDragStart.x, x)
    const top = Math.min(activeDragStart.y, y)
    const w = Math.abs(x - activeDragStart.x)
    const h = Math.abs(y - activeDragStart.y)
    setDraftRect({ x: left, y: top, w, h })
  }, [effectiveTool, dragStart, inkDraft, isEditorOpen, handleTwoFingerGesture, lockView])

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
    if (!overlayRef.current || !blueprint || isEditorOpen) return
    const rect = overlayRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    if ((effectiveTool === 'pen' || effectiveTool === 'marker') && inkDraft) {
      const points = [...inkDraft, { x, y }]
      setInkDraft(null)
      if (points.length < 2) return
      const normPoints = normalizePoints(points, rect.width, rect.height)
      const bounds = clampRectToPage(getPointsBounds(normPoints))
      const options = effectiveTool === 'marker' ? markerOptions : drawOptions
      const now = new Date().toISOString()
      const meta = { points: normPoints, thickness: options.thickness, opacity: options.opacity }
      const ann: BlueprintAnnotation = {
        id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        blueprintSetId: blueprint.id,
        projectId: blueprint.projectId,
        pageNumber: currentPage,
        type: effectiveTool,
        rect: bounds,
        color: toolColors[effectiveTool as ToolKey] || '#facc15',
        meta,
        metadata: meta,
        createdAt: now,
        updatedAt: now,
      } as BlueprintAnnotation
      await persistAnnotation(ann)
      setFocusedAnnotationId(ann.id)
      return
    }

    const activeDragStart = dragStartRef.current || dragStart

    if (effectiveTool === 'eraser' && activeDragStart) {
      const eraseNorm = normRectFromDrag(activeDragStart, { x, y }, rect.width, rect.height)
      dragStartRef.current = null
      setDragStart(null)
      setDraftRect(null)
      const toDelete = allAnnotationsRef.current.filter((a) => {
        if (Number(a.pageNumber) !== Number(currentPage)) return false
        const ar = a.rect
        if (!ar) return false
        return !(ar.x > eraseNorm.x + eraseNorm.w || ar.x + ar.w < eraseNorm.x || ar.y > eraseNorm.y + eraseNorm.h || ar.y + ar.h < eraseNorm.y)
      })
      for (const a of toDelete) { void removeAnnotation(a.id) }
      return
    }

    // Callout/Generate: drag defines both the anchor (drag-start) and the box (dragged rect).
    // Falls back to click-placement (via handleOverlayClick) when the drag is too small.
    if ((effectiveTool === 'callout' || effectiveTool === 'generate') && activeDragStart) {
      const rawNorm = normRectFromDrag(activeDragStart, { x, y }, rect.width, rect.height)
      dragStartRef.current = null
      setDragStart(null)
      setDraftRect(null)
      const anchor = toNorm(activeDragStart.x, activeDragStart.y, rect.width, rect.height)
      if (rawNorm.w >= MIN_HIGHLIGHT_NORM && rawNorm.h >= MIN_HIGHLIGHT_NORM) {
        const boxW = effectiveTool === 'generate' ? 0.28 : DEFAULT_CALLOUT_BOX.w
        const boxH = effectiveTool === 'generate' ? 0.12 : DEFAULT_CALLOUT_BOX.h
        const boxNorm = clampRectToPage({ ...rawNorm, w: Math.max(rawNorm.w, boxW), h: Math.max(rawNorm.h, boxH) })
        openCreateRichTextEditor(
          effectiveTool === 'generate' ? 'generate' : 'callout',
          boxNorm,
          anchor,
        )
      }
      // If drag too small, handleOverlayClick will fire and handle single-click placement.
      return
    }

    if (!(effectiveTool === 'highlight' || effectiveTool === 'underline' || effectiveTool === 'textBox' || effectiveTool === 'shape') || !activeDragStart) return

    const rawNorm = normRectFromDrag(activeDragStart, { x, y }, rect.width, rect.height)
    const underlineY = toNorm(0, activeDragStart.y, rect.width, rect.height).y
    const norm = effectiveTool === 'underline'
      ? clampRectToPage({
        x: rawNorm.x,
        y: clampNorm(underlineY - 0.006, 0, 0.994),
        w: rawNorm.w,
        h: Math.max(rawNorm.h, 0.012),
      })
      : rawNorm
    dragStartRef.current = null
    setDragStart(null)
    setDraftRect(null)

    if (effectiveTool === 'underline') {
      const minUnderlineWidth = 2 / Math.max(1, rect.width)
      if (norm.w < minUnderlineWidth) return
    } else if (norm.w < MIN_HIGHLIGHT_NORM || norm.h < MIN_HIGHLIGHT_NORM) return

    if (effectiveTool === 'textBox') {
      openCreateRichTextEditor('textBox', { ...norm, w: Math.max(norm.w, DEFAULT_TEXT_BOX.w), h: Math.max(norm.h, DEFAULT_TEXT_BOX.h) })
      return
    }

    const now = new Date().toISOString()
    const type = effectiveTool === 'underline' ? 'underline' : effectiveTool === 'shape' ? 'shape' : 'highlight'
    const meta = effectiveTool === 'shape'
      ? { shapeKind, ...shapeOptions }
      : effectiveTool === 'underline'
        ? { thickness: drawOptions.thickness, opacity: drawOptions.opacity }
        : { opacity: 0.35 }
    const ann: BlueprintAnnotation = {
      id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      blueprintSetId: blueprint.id,
      projectId: blueprint.projectId,
      pageNumber: currentPage,
      type,
      rect: norm,
      color: effectiveTool === 'shape' ? shapeOptions.borderColor : (toolColors[effectiveTool as ToolKey] || '#facc15'),
      meta,
      metadata: meta,
      createdAt: now,
      updatedAt: now,
    } as BlueprintAnnotation
    await persistAnnotation(ann)
    setFocusedAnnotationId(ann.id)
  }, [effectiveTool, dragStart, inkDraft, blueprint, currentPage, persistAnnotation, toolColors, isEditorOpen, endTouchPointer, openCreateRichTextEditor, shapeKind, shapeOptions, drawOptions, markerOptions])

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
      dragStartRef.current = null
      inkDraftRef.current = null
      setDragStart(null)
      setDraftRect(null)
      setInkDraft(null)
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
      : ['note', 'highlight', 'underline', 'textBox', 'pen', 'marker', 'shape', 'callout', 'generate'].includes(effectiveTool)
        ? 'cursor-crosshair'
        : effectiveTool === 'eraser'
          ? 'cursor-not-allowed'
          : 'cursor-grab'

  const livePinchZoom = pinchPreviewZoom ?? relativeZoom
  const visualScale = Math.max(1, livePinchZoom / Math.max(0.001, clampRelativeZoom(relativeZoom)))
  const visualDisplayWidth = displaySize.w ? Math.ceil(displaySize.w * visualScale) : 0
  const visualDisplayHeight = displaySize.h ? Math.ceil(displaySize.h * visualScale) : 0

  // ─── Annotation ↔ tool-key mapping ────────────────────────────────────────
  function annotationTypeToToolKey(type: string): ToolKey | null {
    const map: Record<string, ToolKey> = {
      highlight: 'highlight', underline: 'underline', textBox: 'textBox',
      pen: 'pen', marker: 'marker', shape: 'shape', callout: 'callout',
      generate: 'generate',
    }
    return map[type] ?? null
  }

  // ─── Edit-mode helpers ────────────────────────────────────────────────────
  const editingAnnotation = openPopover?.editingAnnotationId
    ? (allAnnotations.find(a => a.id === openPopover.editingAnnotationId) ?? null)
    : null

  const persistEditAnnotation = (changes: Partial<BlueprintAnnotation>) => {
    if (!editingAnnotation) return
    void persistAnnotation({ ...editingAnnotation, ...changes, updatedAt: new Date().toISOString() })
  }

  const persistEditAnnotationMeta = (metaChanges: Record<string, any>) => {
    if (!editingAnnotation) return
    const updated = withAnnotationMeta(
      { ...editingAnnotation, updatedAt: new Date().toISOString() },
      { ...getAnnotationMeta(editingAnnotation), ...metaChanges }
    )
    void persistAnnotation(updated)
  }

  // ─── Per-tool popover content ─────────────────────────────────────────────
  const FONT_FAMILIES = [
    { label: 'Helvetica', value: 'Helvetica' },
    { label: 'Arial', value: 'Arial' },
    { label: 'Times New Roman', value: 'Times New Roman' },
    { label: 'Courier', value: 'Courier' },
    { label: 'Georgia', value: 'Georgia' },
  ]
  const WEIGHT_OPTIONS = [
    { label: 'Light', value: '300' },
    { label: 'Regular', value: '400' },
    { label: 'Semibold', value: '600' },
    { label: 'Bold', value: '700' },
  ]
  const ALIGN_OPTIONS = [
    { label: 'Left', value: 'left' },
    { label: 'Center', value: 'center' },
    { label: 'Right', value: 'right' },
  ]

  type PopoverContent = { title: string; primary: React.ReactNode; additional?: React.ReactNode }

  const getPopoverContent = (): PopoverContent | null => {
    if (!openPopover) return null
    const { tool, mode } = openPopover
    const isEdit = mode === 'edit'
    const eMeta = editingAnnotation ? getAnnotationMeta(editingAnnotation) : {}

    // ── 1. HIGHLIGHTER ────────────────────────────────────────────────────
    if (tool === 'highlight') {
      const color = isEdit ? (editingAnnotation?.color ?? toolColors.highlight) : toolColors.highlight
      const opacity = isEdit ? Math.round((eMeta.opacity ?? 0.35) * 100) : highlightOpacity
      return {
        title: 'Highlighter',
        primary: (
          <>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Color</div>
            <ColorRow value={color} onChange={(c) => {
              if (isEdit) persistEditAnnotation({ color: c })
              else setToolColor('highlight', c)
            }} />
          </>
        ),
        additional: (
          <Stepper label="Opacity" value={opacity} min={10} max={100} step={5} unit="%"
            onChange={(v) => {
              if (isEdit) persistEditAnnotationMeta({ opacity: v / 100 })
              else setHighlightOpacity(v)
            }} />
        ),
      }
    }

    // ── 2. UNDERLINE ──────────────────────────────────────────────────────
    if (tool === 'underline') {
      const color = isEdit ? (editingAnnotation?.color ?? toolColors.underline) : toolColors.underline
      const thickness = isEdit ? (eMeta.thickness ?? underlineThickness) : underlineThickness
      return {
        title: 'Underline',
        primary: (
          <>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Color</div>
            <ColorRow value={color} onChange={(c) => {
              if (isEdit) persistEditAnnotation({ color: c })
              else setToolColor('underline', c)
            }} />
            <Stepper label="Thickness" value={thickness} min={0.5} max={20} step={0.5} unit="px"
              onChange={(v) => {
                if (isEdit) persistEditAnnotationMeta({ thickness: v })
                else setUnderlineThickness(v)
              }} />
          </>
        ),
      }
    }

    // ── 3. TEXT BOX ───────────────────────────────────────────────────────
    if (tool === 'textBox') {
      const tsMeta = isEdit ? (eMeta.textStyle ?? {}) : {}
      const ts = isEdit ? { ...textStyle, ...tsMeta } : textStyle
      const updateTs = (patch: Partial<typeof textStyle>) => {
        if (isEdit) persistEditAnnotationMeta({ textStyle: { ...tsMeta, ...patch } })
        else setTextStyle((p) => ({ ...p, ...patch }))
      }
      return {
        title: 'Text Box',
        primary: (
          <>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Text Color</div>
            <ColorRow value={ts.color} onChange={(c) => updateTs({ color: c })} />
            <LabeledSelect label="Font" value={ts.fontFamily ?? 'Helvetica'} options={FONT_FAMILIES}
              onChange={(v) => updateTs({ fontFamily: v })} />
            <LabeledSelect label="Weight" value={String(ts.fontWeight ?? 400)} options={WEIGHT_OPTIONS}
              onChange={(v) => updateTs({ fontWeight: Number(v) })} />
            <Stepper label="Size" value={ts.fontSize ?? 14} min={6} max={144} step={0.5} unit="pt"
              onChange={(v) => updateTs({ fontSize: v })} />
            <ToggleRow buttons={[
              { label: <Bold size={11} />, active: !!(ts.bold), onClick: () => updateTs({ bold: !ts.bold }) },
              { label: <Italic size={11} />, active: !!(ts.italic), onClick: () => updateTs({ italic: !ts.italic }) },
              { label: <Underline size={11} />, active: !!(ts.underline), onClick: () => updateTs({ underline: !ts.underline }) },
            ]} />
          </>
        ),
        additional: (
          <>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Box Fill</div>
            <ColorRow value={ts.boxFill ?? 'transparent'} allowTransparent
              onChange={(c) => updateTs({ boxFill: c })} />
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4, marginTop: 4 }}>Border Color</div>
            <ColorRow value={ts.borderColor ?? 'transparent'} allowTransparent
              onChange={(c) => updateTs({ borderColor: c })} />
            <Stepper label="Border Width" value={ts.borderWidth ?? 1} min={0.5} max={20} step={0.5} unit="px"
              onChange={(v) => updateTs({ borderWidth: v })} />
            <LabeledSelect label="Alignment" value={ts.align ?? 'left'} options={ALIGN_OPTIONS}
              onChange={(v) => updateTs({ align: v as 'left' | 'center' | 'right' })} />
          </>
        ),
      }
    }

    // ── 4. PEN ────────────────────────────────────────────────────────────
    if (tool === 'pen') {
      const color = isEdit ? (editingAnnotation?.color ?? toolColors.pen) : toolColors.pen
      const thickness = isEdit ? (eMeta.thickness ?? drawOptions.thickness) : drawOptions.thickness
      const opacity = isEdit ? Math.round((eMeta.opacity ?? drawOptions.opacity) * 100) : Math.round(drawOptions.opacity * 100)
      return {
        title: 'Pen',
        primary: (
          <>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Color</div>
            <ColorRow value={color} onChange={(c) => {
              if (isEdit) persistEditAnnotation({ color: c })
              else setToolColor('pen', c)
            }} />
            <Stepper label="Thickness" value={thickness} min={0.5} max={20} step={0.5} unit="px"
              onChange={(v) => {
                if (isEdit) persistEditAnnotationMeta({ thickness: v })
                else setDrawOptions((p) => ({ ...p, thickness: v }))
              }} />
            <Stepper label="Opacity" value={opacity} min={10} max={100} step={5} unit="%"
              onChange={(v) => {
                if (isEdit) persistEditAnnotationMeta({ opacity: v / 100 })
                else setDrawOptions((p) => ({ ...p, opacity: v / 100 }))
              }} />
          </>
        ),
      }
    }

    // ── 5. MARKER ────────────────────────────────────────────────────────
    if (tool === 'marker') {
      const color = isEdit ? (editingAnnotation?.color ?? toolColors.marker) : toolColors.marker
      const thickness = isEdit ? (eMeta.thickness ?? markerOptions.thickness) : markerOptions.thickness
      const opacity = isEdit ? Math.round((eMeta.opacity ?? markerOptions.opacity) * 100) : Math.round(markerOptions.opacity * 100)
      return {
        title: 'Marker',
        primary: (
          <>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Color</div>
            <ColorRow value={color} onChange={(c) => {
              if (isEdit) persistEditAnnotation({ color: c })
              else setToolColor('marker', c)
            }} />
            <Stepper label="Thickness" value={thickness} min={4} max={40} step={1} unit="px"
              onChange={(v) => {
                if (isEdit) persistEditAnnotationMeta({ thickness: v })
                else setMarkerOptions((p) => ({ ...p, thickness: v }))
              }} />
            <Stepper label="Opacity" value={opacity} min={10} max={100} step={5} unit="%"
              onChange={(v) => {
                if (isEdit) persistEditAnnotationMeta({ opacity: v / 100 })
                else setMarkerOptions((p) => ({ ...p, opacity: v / 100 }))
              }} />
          </>
        ),
      }
    }

    // ── 6. ERASER ────────────────────────────────────────────────────────
    if (tool === 'eraser') {
      return {
        title: 'Eraser',
        primary: (
          <Stepper label="Size" value={eraserSize} min={4} max={80} step={1} unit="px"
            onChange={setEraserSize} />
        ),
      }
    }

    // ── 7. SHAPE ─────────────────────────────────────────────────────────
    if (tool === 'shape') {
      const borderColor = isEdit ? (eMeta.borderColor ?? shapeOptions.borderColor) : shapeOptions.borderColor
      const borderThickness = isEdit ? (eMeta.borderThickness ?? shapeOptions.borderThickness) : shapeOptions.borderThickness
      const fillColor = isEdit ? (eMeta.fillColor ?? shapeOptions.fillColor) : shapeOptions.fillColor
      const borderStyle = isEdit ? (eMeta.borderStyle ?? shapeOptions.borderStyle) : shapeOptions.borderStyle
      const hatchPattern = isEdit ? (eMeta.hatchPattern ?? shapeOptions.hatchPattern) : shapeOptions.hatchPattern
      const opacityPct = isEdit ? Math.round((eMeta.fillOpacity ?? shapeOptions.fillOpacity) * 100) : Math.round(shapeOptions.fillOpacity * 100)
      const currentKind = isEdit ? (eMeta.shapeKind ?? shapeKind) : shapeKind
      return {
        title: 'Shape',
        primary: (
          <>
            <LabeledSelect label="Shape" value={currentKind}
              options={[
                { label: 'Square', value: 'square' },
                { label: 'Circle', value: 'circle' },
                { label: 'Line', value: 'line' },
                { label: 'Arrow', value: 'arrow' },
              ]}
              onChange={(v) => {
                if (isEdit) persistEditAnnotationMeta({ shapeKind: v })
                else setShapeKind(v as ShapeKind)
              }} />
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Border Color</div>
            <ColorRow value={borderColor} onChange={(c) => {
              if (isEdit) persistEditAnnotationMeta({ borderColor: c })
              else setShapeOptions((p) => ({ ...p, borderColor: c }))
            }} />
            <Stepper label="Border Thickness" value={borderThickness} min={0.5} max={20} step={0.5} unit="px"
              onChange={(v) => {
                if (isEdit) persistEditAnnotationMeta({ borderThickness: v })
                else setShapeOptions((p) => ({ ...p, borderThickness: v }))
              }} />
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Fill Color</div>
            <ColorRow value={fillColor} allowTransparent onChange={(c) => {
              if (isEdit) persistEditAnnotationMeta({ fillColor: c })
              else setShapeOptions((p) => ({ ...p, fillColor: c }))
            }} />
          </>
        ),
        additional: (
          <>
            <LabeledSelect label="Border Style" value={borderStyle}
              options={[
                { label: 'Solid', value: 'solid' },
                { label: 'Dashed', value: 'dashed' },
                { label: 'Dotted', value: 'dotted' },
              ]}
              onChange={(v) => {
                if (isEdit) persistEditAnnotationMeta({ borderStyle: v })
                else setShapeOptions((p) => ({ ...p, borderStyle: v as BorderStyle }))
              }} />
            <LabeledSelect label="Hatch" value={hatchPattern}
              options={[
                { label: 'None', value: 'none' },
                { label: 'Diagonal', value: 'diagonal' },
                { label: 'Cross Hatch', value: 'cross' },
                { label: 'Horizontal', value: 'horizontal' },
                { label: 'Vertical', value: 'vertical' },
              ]}
              onChange={(v) => {
                if (isEdit) persistEditAnnotationMeta({ hatchPattern: v })
                else setShapeOptions((p) => ({ ...p, hatchPattern: v as HatchPattern }))
              }} />
            <Stepper label="Opacity" value={opacityPct} min={10} max={100} step={5} unit="%"
              onChange={(v) => {
                if (isEdit) persistEditAnnotationMeta({ fillOpacity: v / 100 })
                else setShapeOptions((p) => ({ ...p, fillOpacity: v / 100 }))
              }} />
          </>
        ),
      }
    }

    // ── 8. CALLOUT ───────────────────────────────────────────────────────
    if (tool === 'callout') {
      const color = isEdit ? (editingAnnotation?.color ?? toolColors.callout) : toolColors.callout
      const tsMeta = isEdit ? (eMeta.textStyle ?? {}) : {}
      const ts = isEdit ? { ...textStyle, ...tsMeta } : textStyle
      const updateTs = (patch: Partial<typeof textStyle>) => {
        if (isEdit) persistEditAnnotationMeta({ textStyle: { ...tsMeta, ...patch } })
        else setTextStyle((p) => ({ ...p, ...patch }))
      }
      const boxFillVal = ts.boxFill ?? 'transparent'
      const sizeVal = ts.fontSize ?? 14
      return {
        title: 'Callout',
        primary: (
          <>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Border / Arrow Color</div>
            <ColorRow value={color} onChange={(c) => {
              if (isEdit) persistEditAnnotation({ color: c })
              else setToolColor('callout', c)
            }} />
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Text Color</div>
            <ColorRow value={ts.color} onChange={(c) => updateTs({ color: c })} />
            <LabeledSelect label="Font" value={ts.fontFamily ?? 'Helvetica'} options={FONT_FAMILIES}
              onChange={(v) => updateTs({ fontFamily: v })} />
            <Stepper label="Size" value={sizeVal} min={6} max={144} step={0.5} unit="pt"
              onChange={(v) => updateTs({ fontSize: v })} />
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Box Fill</div>
            <ColorRow value={boxFillVal} allowTransparent onChange={(c) => updateTs({ boxFill: c })} />
          </>
        ),
        additional: (
          <>
            <Stepper label="Border Thickness" value={ts.borderWidth ?? 1} min={0.5} max={20} step={0.5} unit="px"
              onChange={(v) => updateTs({ borderWidth: v })} />
            <ToggleRow buttons={[
              { label: <Bold size={11} />, active: !!(ts.bold), onClick: () => updateTs({ bold: !ts.bold }) },
              { label: <Italic size={11} />, active: !!(ts.italic), onClick: () => updateTs({ italic: !ts.italic }) },
            ]} />
            <LabeledSelect label="Alignment" value={ts.align ?? 'left'} options={ALIGN_OPTIONS}
              onChange={(v) => updateTs({ align: v as 'left' | 'center' | 'right' })} />
          </>
        ),
      }
    }

    // ── 9. GENERATE ──────────────────────────────────────────────────────
    if (tool === 'generate') {
      const color = isEdit ? (editingAnnotation?.color ?? toolColors.generate) : toolColors.generate
      const tsMeta = isEdit ? (eMeta.textStyle ?? {}) : {}
      const ts = isEdit ? { ...textStyle, ...tsMeta } : textStyle
      const updateTs = (patch: Partial<typeof textStyle>) => {
        if (isEdit) persistEditAnnotationMeta({ textStyle: { ...tsMeta, ...patch } })
        else setTextStyle((p) => ({ ...p, ...patch }))
      }
      const qType = isEdit ? (eMeta.questionType ?? generateQuestionType) : generateQuestionType
      return {
        title: 'Generate',
        primary: (
          <>
            <LabeledSelect label="Question Type" value={qType}
              options={[
                { label: 'Coordination', value: 'coordination' },
                { label: 'RFI', value: 'rfi' },
              ]}
              onChange={(v) => {
                if (isEdit) persistEditAnnotationMeta({ questionType: v })
                else setGenerateQuestionType(v as GenerateQuestionType)
              }} />
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Border Color</div>
            <ColorRow value={color} onChange={(c) => {
              if (isEdit) persistEditAnnotation({ color: c })
              else setToolColor('generate', c)
            }} />
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Text Color</div>
            <ColorRow value={ts.color} onChange={(c) => updateTs({ color: c })} />
          </>
        ),
        additional: (
          <>
            <LabeledSelect label="Font" value={ts.fontFamily ?? 'Helvetica'} options={FONT_FAMILIES}
              onChange={(v) => updateTs({ fontFamily: v })} />
            <Stepper label="Size" value={ts.fontSize ?? 14} min={6} max={144} step={0.5} unit="pt"
              onChange={(v) => updateTs({ fontSize: v })} />
            <ToggleRow buttons={[
              { label: <Bold size={11} />, active: !!(ts.bold), onClick: () => updateTs({ bold: !ts.bold }) },
              { label: <Italic size={11} />, active: !!(ts.italic), onClick: () => updateTs({ italic: !ts.italic }) },
            ]} />
          </>
        ),
      }
    }

    return null
  }

  const _popoverContent = getPopoverContent()

  return (
    <div
      ref={viewerRootRef}
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
                  onClick={() => {
                    const el = viewerRootRef.current
                    const doc: any = document
                    const fullscreenEl = doc.fullscreenElement || doc.webkitFullscreenElement
                    if (fullscreenEl) {
                      if (doc.exitFullscreen) doc.exitFullscreen()
                      else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen()
                      setIsFullScreenView(false)
                      return
                    }
                    if (isFullScreenView) {
                      setIsFullScreenView(false)
                      return
                    }
                    if (el && el.requestFullscreen) {
                      el.requestFullscreen().then(() => {
                        setIsFullScreenView(true)
                      }).catch(() => {
                        setIsFullScreenView(true)
                      })
                    } else if (el && (el as any).webkitRequestFullscreen) {
                      ; (el as any).webkitRequestFullscreen()
                      setIsFullScreenView(true)
                    } else {
                      setIsFullScreenView(true)
                    }
                  }}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-700 text-gray-300 hover:text-white"
                >
                  {isFullScreenView ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                  {isFullScreenView ? 'Exit Full Screen' : 'Full Size Screen'}
                </button>
              </div>
            </div>
          )}

          {/* ── Toolbar: 5 bucket selectors + tool buttons (popovers handle options) ── */}
          <div className="px-4 py-3 border-b border-gray-800 space-y-2">
            {/* Bucket selectors */}
            <div className="flex flex-wrap items-center gap-2">
              {([
                ['annotate', 'Annotate'],
                ['callouts', 'Callouts'],
                ['draw', 'Draw / Mark'],
                ['generate', 'Generate'],
                ['view', 'View'],
              ] as Array<[ToolbarBucket, string]>).map(([bucket, label]) => (
                <button
                  key={bucket}
                  onClick={() => setToolbarBucket(bucket)}
                  className={`inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border ${toolbarBucket === bucket ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                >
                  {bucket === 'annotate' && <Layers size={12} />}
                  {bucket === 'callouts' && <StickyNote size={12} />}
                  {bucket === 'draw' && <PenLine size={12} />}
                  {bucket === 'generate' && <Sparkles size={12} />}
                  {bucket === 'view' && <MousePointer2 size={12} />}
                  {label}
                </button>
              ))}
              <span className="text-xs text-gray-400 ml-2">
                Active: <span className="text-gray-200">{annotationLabel({ type: toolMode } as BlueprintAnnotation)}</span>{isEditorOpen ? ' (editing)' : ''}
              </span>
            </div>

            {/* Annotate bucket */}
            {toolbarBucket === 'annotate' && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  onClick={() => { setToolMode('select'); setLayoutEditId(null); setOpenPopover(null) }}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${toolMode === 'select' ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300'}`}
                ><MousePointer2 size={12} /> Select / Pan</button>
                <button
                  onClick={(e) => { setToolMode('highlight'); setOpenPopover({ tool: 'highlight', anchorEl: e.currentTarget, mode: 'tool' }) }}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${toolMode === 'highlight' ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300'}`}
                ><Highlighter size={12} /> Highlighter</button>
                <button
                  onClick={(e) => { setToolMode('underline'); setOpenPopover({ tool: 'underline', anchorEl: e.currentTarget, mode: 'tool' }) }}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${toolMode === 'underline' ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300'}`}
                ><Underline size={12} /> Underline</button>
                <button
                  onClick={(e) => { setToolMode('textBox'); setOpenPopover({ tool: 'textBox', anchorEl: e.currentTarget, mode: 'tool' }) }}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${toolMode === 'textBox' ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300'}`}
                ><Type size={12} /> Text Box</button>
                <button
                  onClick={() => { setToolMode('note'); setOpenPopover(null) }}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${toolMode === 'note' ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300'}`}
                ><StickyNote size={12} /> Note</button>
              </div>
            )}

            {/* Callouts bucket */}
            {toolbarBucket === 'callouts' && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  onClick={(e) => { setToolMode('callout'); setOpenPopover({ tool: 'callout', anchorEl: e.currentTarget, mode: 'tool' }) }}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${toolMode === 'callout' ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300'}`}
                ><ArrowUpRight size={12} /> Create Callout</button>
                <span className="text-xs text-gray-500">Drag to define the callout box — the drag start point becomes the anchor.</span>
              </div>
            )}

            {/* Draw bucket */}
            {toolbarBucket === 'draw' && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  onClick={(e) => { setToolMode('pen'); setOpenPopover({ tool: 'pen', anchorEl: e.currentTarget, mode: 'tool' }) }}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${toolMode === 'pen' ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300'}`}
                ><PenLine size={12} /> Pen</button>
                <button
                  onClick={(e) => { setToolMode('marker'); setOpenPopover({ tool: 'marker', anchorEl: e.currentTarget, mode: 'tool' }) }}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${toolMode === 'marker' ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300'}`}
                ><Highlighter size={12} /> Marker</button>
                <button
                  onClick={(e) => { setToolMode('eraser'); setOpenPopover({ tool: 'eraser', anchorEl: e.currentTarget, mode: 'tool' }) }}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${toolMode === 'eraser' ? 'border-red-500 text-red-300 bg-red-900/20' : 'border-gray-700 text-gray-300'}`}
                ><Eraser size={12} /> Eraser</button>
                <button
                  onClick={(e) => { setToolMode('shape'); setOpenPopover({ tool: 'shape', anchorEl: e.currentTarget, mode: 'tool' }) }}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${toolMode === 'shape' ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300'}`}
                ><Shapes size={12} /> Shapes {toolMode === 'shape' && <span className="text-gray-400">({shapeKind})</span>}</button>
              </div>
            )}

            {/* Generate bucket */}
            {toolbarBucket === 'generate' && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  onClick={(e) => { setToolMode('generate'); setOpenPopover({ tool: 'generate', anchorEl: e.currentTarget, mode: 'tool' }) }}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${toolMode === 'generate' ? 'border-amber-500 text-amber-300 bg-amber-900/20' : 'border-gray-700 text-gray-300'}`}
                ><Sparkles size={12} /> Generate from Pinpoint</button>
                <span className="text-xs text-gray-500">Click a point on the blueprint, write the question, save.</span>
              </div>
            )}

            {/* View bucket */}
            {toolbarBucket === 'view' && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  onClick={() => { setToolMode('select'); setOpenPopover(null) }}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${toolMode === 'select' ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300'}`}
                ><MousePointer2 size={12} /> Select / Pan</button>
                <button
                  onClick={() => setLockView((v) => !v)}
                  className={`text-xs px-2 py-1 rounded-md border ${lockView ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300'}`}
                >Lock View</button>
                <button
                  onClick={() => { pendingScrollResetRef.current = true; setRelativeZoom(1) }}
                  className="text-xs px-2 py-1 rounded-md border border-blue-500 text-blue-300 bg-blue-900/20"
                >Fit to Full Page</button>
                <span className="text-xs text-gray-400">Wheel/pinch to zoom · Select / Pan to drag.</span>
              </div>
            )}
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
                Fit to Full Page
              </button>
              <button
                onClick={() => {
                  const el = viewerRootRef.current
                  // If a real fullscreen is already active, exit it
                  const doc: any = document
                  const fullscreenEl = doc.fullscreenElement || doc.webkitFullscreenElement
                  if (fullscreenEl) {
                    if (doc.exitFullscreen) doc.exitFullscreen()
                    else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen()
                    setIsFullScreenView(false)
                    return
                  }
                  // If currently in CSS-only fullscreen (iPhone fallback), toggle off
                  if (isFullScreenView) {
                    setIsFullScreenView(false)
                    return
                  }
                  // Try Fullscreen API (iPad/Android/desktop)
                  if (el && el.requestFullscreen) {
                    el.requestFullscreen().then(() => {
                      setIsFullScreenView(true)
                    }).catch(() => {
                      // API rejected — fall back to CSS-only fullscreen
                      setIsFullScreenView(true)
                    })
                  } else if (el && (el as any).webkitRequestFullscreen) {
                    // Safari (older iPadOS / desktop Safari)
                    ; (el as any).webkitRequestFullscreen()
                    setIsFullScreenView(true)
                  } else {
                    // iPhone Safari and other unsupported — CSS-only fullscreen
                    setIsFullScreenView(true)
                  }
                }}
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
              <style>{`
                .operations-pdf-scroll::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
              `}</style>
              <div
                ref={scrollAreaRef}
                className={`operations-pdf-scroll ${lockView ? 'overflow-hidden' : 'overflow-scroll'} ${isFullScreenView ? 'h-full max-h-none min-h-0' : 'h-[calc(100vh-180px)] min-h-[60vh]'} rounded border border-gray-800`}
                style={{
                  // Hide scrollbars across all browsers — inline guarantees they
                  // apply regardless of CSS file load order. Container still
                  // scrolls programmatically (required by pan/zoom logic).
                  scrollbarWidth: 'none',          /* Firefox */
                  msOverflowStyle: 'none' as any,  /* IE / old Edge */
                } as React.CSSProperties}
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
                        const meta = getAnnotationMeta(a)
                        const rect = clampRectToPage(a.rect as any)
                        const left = `${(rect.x || 0) * 100}%`
                        const top = `${(rect.y || 0) * 100}%`
                        const width = `${Math.max(0.01, (rect.w || 0)) * 100}%`
                        const height = `${Math.max(0.01, (rect.h || 0)) * 100}%`
                        const isFocused = focusedAnnotationId === a.id
                        const isLayoutEditing = layoutEditId === a.id
                        const color = a.color || '#facc15'
                        const selectAnnotation = (e: React.MouseEvent) => {
                          e.stopPropagation()
                          if (effectiveTool === 'eraser') {
                            void removeAnnotation(a.id)
                            return
                          }
                          setFocusedAnnotationId(a.id)
                          if (a.type === 'note') {
                            openEditNoteEditor(a)
                            return
                          }
                          const toolKey = annotationTypeToToolKey(a.type)
                          if (toolKey) {
                            setOpenPopover({
                              tool: toolKey as ToolMode,
                              anchorEl: e.currentTarget as HTMLElement,
                              mode: 'edit',
                              editingAnnotationId: a.id,
                            })
                          }
                        }
                        const ActionButtons = ({ className = '' }: { className?: string }) => (
                          <div
                            className={`absolute -top-8 right-0 z-50 hidden group-hover:flex items-center gap-1 rounded-md border border-gray-700 bg-[#111827]/95 p-1 shadow-lg ${isFocused ? '!flex' : ''} ${className}`}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {(a.type === 'callout' || a.type === 'generate' || a.type === 'textBox' || a.type === 'shape' || a.type === 'highlight' || a.type === 'underline') && (
                              <button
                                type="button"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFocusedAnnotationId(a.id); setLayoutEditId((prev) => prev === a.id ? null : a.id) }}
                                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${isLayoutEditing ? 'bg-blue-600 text-white' : 'text-gray-200 hover:bg-white/10'}`}
                                title="Move or resize"
                              >
                                <Move size={10} /> Move
                              </button>
                            )}
                            {(a.type === 'textBox' || a.type === 'callout' || a.type === 'generate') && (
                              <button
                                type="button"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); openRichTextEditor(a) }}
                                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-gray-200 hover:bg-white/10"
                                title="Edit text"
                              >
                                <Type size={10} /> Edit
                              </button>
                            )}
                            <button
                              type="button"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); void removeAnnotation(a.id) }}
                              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-red-200 hover:bg-red-900/40"
                              title="Delete annotation"
                            >
                              <Trash2 size={10} /> Delete
                            </button>
                          </div>
                        )

                        if (a.type === 'pen' || a.type === 'marker') {
                          const points = Array.isArray(meta.points) ? meta.points : []
                          const svgPoints = points.map((p: any) => `${clampNorm(p.x) * displaySize.w},${clampNorm(p.y) * displaySize.h}`).join(' ')
                          const handle = points[points.length - 1] || { x: rect.x + rect.w, y: rect.y + rect.h }
                          return (
                            <div key={a.id} className="absolute inset-0 group" onClick={selectAnnotation}>
                              <svg className="absolute inset-0 overflow-visible" width={displaySize.w} height={displaySize.h} style={{ pointerEvents: 'none' }}>
                                <polyline points={svgPoints} fill="none" stroke={color} strokeWidth={meta.thickness || (a.type === 'marker' ? 12 : 3)} strokeLinecap="round" strokeLinejoin="round" opacity={meta.opacity ?? (a.type === 'marker' ? 0.35 : 0.9)} />
                                <polyline points={svgPoints} fill="none" stroke="transparent" strokeWidth={(meta.thickness || 8) + 14} strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'stroke' }} onClick={selectAnnotation as any} />
                              </svg>
                              <div className="absolute" style={{ left: `${clampNorm(handle.x) * 100}%`, top: `${clampNorm(handle.y) * 100}%` }}>
                                <ActionButtons />
                              </div>
                            </div>
                          )
                        }

                        if (a.type === 'underline') {
                          return (
                            <div key={a.id} className="absolute group" style={{ left, top, width, height }} onClick={selectAnnotation}>
                              <div
                                className={`${isFocused ? 'ring-2 ring-white/80' : ''}`}
                                style={{ position: 'absolute', left: 0, right: 0, bottom: 0, borderBottom: `${meta.thickness || 3}px solid ${color}`, opacity: meta.opacity ?? 1 }}
                              />
                              <ActionButtons />
                              {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'move')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute inset-0 cursor-move" />}
                              {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'resize')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute -right-1 -bottom-1 h-3 w-3 cursor-nwse-resize rounded-sm bg-blue-400" />}
                            </div>
                          )
                        }

                        if (a.type === 'shape') {
                          const kind = meta.shapeKind || 'square'
                          const borderColor = meta.borderColor || color
                          const borderThickness = meta.borderThickness || 2
                          const borderStyle = meta.borderStyle || 'solid'
                          const fillColor = meta.fillColor || color
                          const fillOpacity = meta.fillOpacity ?? 0.22
                          const hatchPattern = meta.hatchPattern || 'none'
                          if (kind === 'line' || kind === 'arrow') {
                            return (
                              <div key={a.id} className="absolute group" style={{ left, top, width, height }} onClick={selectAnnotation}>
                                <svg className={`absolute inset-0 overflow-visible ${isFocused ? 'ring-2 ring-white/80' : ''}`} width="100%" height="100%" preserveAspectRatio="none">
                                  <defs>
                                    <marker id={`arrow-${a.id}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                                      <path d="M0,0 L8,4 L0,8 z" fill={borderColor} />
                                    </marker>
                                  </defs>
                                  <line x1="0" y1="0" x2="100%" y2="100%" stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={borderStyle === 'dashed' ? '8 5' : borderStyle === 'dotted' ? '2 5' : undefined} markerEnd={kind === 'arrow' ? `url(#arrow-${a.id})` : undefined} />
                                </svg>
                                <ActionButtons />
                                {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'move')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute inset-0 cursor-move" />}
                                {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'resize')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute -right-1 -bottom-1 h-3 w-3 cursor-nwse-resize rounded-sm bg-blue-400" />}
                              </div>
                            )
                          }
                          return (
                            <div key={a.id} className="absolute group" style={{ left, top, width, height }} onClick={selectAnnotation}>
                              <div
                                className={`w-full h-full pointer-events-none ${isFocused ? 'ring-2 ring-white/80' : ''}`}
                                style={{
                                  border: `${borderThickness}px ${borderStyle} ${borderColor}`,
                                  borderRadius: kind === 'circle' ? '9999px' : '0.25rem',
                                  background: getHatchBackground(hatchPattern, borderColor, fillColor, fillOpacity),
                                  backgroundSize: hatchPattern === 'dots' ? '8px 8px' : undefined,
                                }}
                              />
                              <ActionButtons />
                              {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'move')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute inset-0 cursor-move" />}
                              {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'resize')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute -right-1 -bottom-1 h-3 w-3 cursor-nwse-resize rounded-sm bg-blue-400" />}
                            </div>
                          )
                        }

                        if (a.type === 'textBox') {
                          const textMeta = meta.textStyle || {}
                          return (
                            <div key={a.id} className="absolute group" style={{ left, top, width, height }} onClick={selectAnnotation} onDoubleClick={(e) => { e.stopPropagation(); openRichTextEditor(a) }}>
                              <div
                                className={`h-full w-full overflow-hidden rounded border p-2 shadow-sm ${isFocused ? 'ring-2 ring-white/80' : ''}`}
                                style={{
                                  borderColor: color,
                                  backgroundColor: textMeta.backgroundColor || '#ffffff',
                                  color: textMeta.color || '#111827',
                                  fontSize: textMeta.fontSize || 14,
                                  fontWeight: textMeta.fontWeight || 400,
                                  fontStyle: textMeta.italic ? 'italic' : undefined,
                                  textDecoration: textMeta.underline ? 'underline' : undefined,
                                  lineHeight: 1.25,
                                }}
                              >
                                {a.text}
                              </div>
                              <ActionButtons />
                              {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'move')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute inset-0 cursor-move" />}
                              {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'resize')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute -right-1 -bottom-1 h-3 w-3 cursor-nwse-resize rounded-sm bg-blue-400" />}
                            </div>
                          )
                        }

                        if (a.type === 'callout' || a.type === 'generate') {
                          const box = clampRectToPage(meta.box || { x: rect.x + 0.04, y: rect.y + 0.04, ...DEFAULT_CALLOUT_BOX })
                          const anchor = meta.anchor || { x: rect.x, y: rect.y }
                          const textMeta = meta.textStyle || {}
                          const boxLeftPx = box.x * displaySize.w
                          const boxTopPx = box.y * displaySize.h
                          const boxRightPx = (box.x + box.w) * displaySize.w
                          const boxBottomPx = (box.y + box.h) * displaySize.h
                          const anchorPxX = anchor.x * displaySize.w
                          const anchorPxY = anchor.y * displaySize.h
                          const edgePx = (() => {
                            if (anchorPxX < boxLeftPx) return { x: boxLeftPx, y: clampPx(anchorPxY, boxTopPx, boxBottomPx) }
                            if (anchorPxX > boxRightPx) return { x: boxRightPx, y: clampPx(anchorPxY, boxTopPx, boxBottomPx) }
                            if (anchorPxY < boxTopPx) return { x: clampPx(anchorPxX, boxLeftPx, boxRightPx), y: boxTopPx }
                            return { x: clampPx(anchorPxX, boxLeftPx, boxRightPx), y: boxBottomPx }
                          })()
                          const elbowX = edgePx.x + ((anchorPxX - edgePx.x) * 0.5)
                          const pathD = `M ${edgePx.x} ${edgePx.y} L ${elbowX} ${edgePx.y} L ${elbowX} ${anchorPxY} L ${anchorPxX} ${anchorPxY}`
                          return (
                            <div key={a.id} className="pointer-events-none absolute inset-0">
                              <svg className="pointer-events-none absolute inset-0 overflow-visible" width={displaySize.w} height={displaySize.h}>
                                <defs>
                                  <marker id={`callout-arrow-${a.id}`} markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth">
                                    <path d="M0,0 L9,4.5 L0,9 z" fill={color} />
                                  </marker>
                                </defs>
                                <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" markerEnd={`url(#callout-arrow-${a.id})`} />
                                <circle cx={anchorPxX} cy={anchorPxY} r="4" fill={color} opacity="0.95" />
                              </svg>
                              <div
                                className="pointer-events-auto absolute group"
                                style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, minHeight: `${box.h * 100}%` }}
                                onClick={selectAnnotation}
                                onDoubleClick={(e) => { e.stopPropagation(); openRichTextEditor(a) }}
                              >
                                <div
                                  className={`min-h-full w-full whitespace-pre-wrap break-words rounded-md border px-2 py-1.5 shadow-xl ${isFocused ? 'ring-2 ring-white/80' : ''}`}
                                  style={{
                                    borderColor: color,
                                    backgroundColor: textMeta.backgroundColor || (a.type === 'generate' ? '#fffbeb' : '#ffffff'),
                                    color: textMeta.color || '#111827',
                                    fontSize: textMeta.fontSize || 13,
                                    fontWeight: textMeta.fontWeight || 400,
                                    fontStyle: textMeta.italic ? 'italic' : undefined,
                                    textDecoration: textMeta.underline ? 'underline' : undefined,
                                    lineHeight: 1.25,
                                  }}
                                >
                                  {a.type === 'generate' && <div className="mb-1 text-[10px] uppercase tracking-wide text-amber-700">{meta.questionType === 'rfi' ? 'RFI' : 'Coordination'}</div>}
                                  {a.text}
                                </div>
                                <ActionButtons />
                                {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'move')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute inset-0 z-10 cursor-move" />}
                                {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'resize')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute -right-1 -bottom-1 z-20 h-3 w-3 cursor-nwse-resize rounded-sm bg-blue-400" />}
                              </div>
                            </div>
                          )
                        }

                        if (a.type === 'highlight') {
                          return (
                            <div key={a.id} className="absolute group" style={{ left, top, width, height }} onClick={selectAnnotation}>
                              <div className={`w-full h-full pointer-events-none ${isFocused ? 'ring-2 ring-white/80' : ''}`} style={{ border: `1px solid ${color}`, backgroundColor: hexWithAlpha(color, meta.opacity ?? 0.35) }} />
                              <ActionButtons />
                              {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'move')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute inset-0 cursor-move" />}
                              {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'resize')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute -right-1 -bottom-1 h-3 w-3 cursor-nwse-resize rounded-sm bg-blue-400" />}
                            </div>
                          )
                        }

                        return (
                          <div key={a.id} className="absolute group" style={{ left, top }} onClick={selectAnnotation}>
                            <button
                              onClick={(e) => { e.stopPropagation(); if (effectiveTool === 'eraser') void removeAnnotation(a.id); else openEditNoteEditor(a) }}
                              className={`w-5 h-5 rounded-full border text-white text-[10px] font-bold ${isFocused ? 'ring-2 ring-white/80' : ''}`}
                              style={{ backgroundColor: color }}
                              title={a.text || 'Note'}
                            >
                              N
                            </button>
                            <ActionButtons />
                          </div>
                        )
                      })}

                      {draftRect && (effectiveTool === 'highlight' || effectiveTool === 'underline' || effectiveTool === 'textBox' || effectiveTool === 'shape' || effectiveTool === 'eraser') && (

                        <div
                          className="absolute pointer-events-none"
                          style={{
                            left: draftRect.x,
                            top: draftRect.y,
                            width: draftRect.w,
                            height: draftRect.h,
                            border: effectiveTool === 'shape'
                              ? `${shapeOptions.borderThickness}px ${shapeOptions.borderStyle} ${shapeOptions.borderColor}`
                              : effectiveTool === 'underline'
                                ? 'none'
                                : `1px solid ${toolColors[effectiveTool as ToolKey] || '#facc15'}`,
                            borderRadius: effectiveTool === 'shape' && shapeKind === 'circle' ? '9999px' : '0.25rem',
                            background: effectiveTool === 'highlight'
                              ? hexWithAlpha(toolColors.highlight || '#facc15', highlightOpacity / 100)
                              : effectiveTool === 'shape' && shapeKind !== 'line' && shapeKind !== 'arrow'
                                ? getHatchBackground(shapeOptions.hatchPattern, shapeOptions.borderColor, shapeOptions.fillColor, shapeOptions.fillOpacity)
                                : 'transparent',
                            borderBottom: effectiveTool === 'underline' ? `${underlineThickness}px solid ${toolColors.underline || '#facc15'}` : undefined,
                          }}
                        />
                      )}

                      {inkDraft && (effectiveTool === 'pen' || effectiveTool === 'marker') && (
                        <svg className="absolute inset-0 pointer-events-none overflow-visible" width={displaySize.w} height={displaySize.h}>
                          <polyline
                            points={inkDraft.map((p) => `${p.x},${p.y}`).join(' ')}
                            fill="none"
                            stroke={toolColors[effectiveTool as ToolKey] || '#facc15'}
                            strokeWidth={effectiveTool === 'marker' ? markerOptions.thickness : drawOptions.thickness}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            opacity={effectiveTool === 'marker' ? markerOptions.opacity : drawOptions.opacity}
                          />
                        </svg>
                      )}

                      {noteEditor && (
                        <div
                          className="absolute z-30 w-64 rounded-lg border border-gray-700 bg-[#121521] p-3 shadow-2xl"
                          style={{
                            left: `${Math.min(0.82, Math.max(0.02, noteEditor.x)) * 100}%`,
                            top: `${Math.min(0.82, Math.max(0.02, noteEditor.y)) * 100}%`,
                            transform: 'translate(8px, 8px)',
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <textarea
                            ref={noteEditorRef}
                            value={noteEditor.text}
                            onChange={(e) => setNoteEditor((prev) => (prev ? { ...prev, text: e.target.value } : prev))}
                            className="w-full h-24 resize-none rounded border border-gray-700 bg-gray-900/60 text-gray-100 text-xs p-2 outline-none focus:border-blue-500"
                            placeholder="Enter note..."
                          />
                          <div className="mt-2 flex flex-wrap items-center gap-1">
                            <span className="mr-1 text-[11px] text-gray-400">Note color</span>
                            {ANNOTATION_COLORS.map((c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => setNoteEditor((prev) => (prev ? { ...prev, color: c } : prev))}
                                className={`h-4 w-4 rounded-full border ${(noteEditor.color || toolColors.note) === c ? 'border-white' : 'border-gray-600'}`}
                                style={{ backgroundColor: c }}
                                title={c}
                              />
                            ))}
                          </div>
                          <div className="mt-3 flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setNoteEditor(null)}
                              className="inline-flex min-w-[72px] items-center justify-center gap-1 rounded border border-gray-700 px-2 py-1.5 text-[11px] text-gray-300 hover:bg-white/5"
                            >
                              <X size={10} /> Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => void saveNoteEditor()}
                              className="inline-flex min-w-[72px] items-center justify-center rounded bg-blue-600 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-500"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      )}

                      {richTextEditor && (
                        <div
                          className="absolute z-40 w-80 rounded-lg border border-gray-700 bg-[#121521] p-3 shadow-2xl"
                          style={{
                            left: `${Math.min(0.78, Math.max(0.02, richTextEditor.x)) * 100}%`,
                            top: `${Math.min(0.78, Math.max(0.02, richTextEditor.y)) * 100}%`,
                            transform: richTextEditor.annotationType === 'callout' || richTextEditor.annotationType === 'generate' ? 'translate(0, 0)' : 'translate(8px, 8px)',
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="text-xs font-semibold text-gray-200">
                              {richTextEditor.annotationType === 'generate'
                                ? `Generate ${richTextEditor.questionType === 'rfi' ? 'RFI' : 'Coordination'} Question`
                                : richTextEditor.annotationType === 'callout'
                                  ? 'Callout Text'
                                  : 'Text Box'}
                            </div>
                            {richTextEditor.annotationType === 'generate' && (
                              <select
                                value={richTextEditor.questionType || generateQuestionType}
                                onChange={(e) => setRichTextEditor((prev) => prev ? { ...prev, questionType: e.target.value as GenerateQuestionType } : prev)}
                                className="rounded border border-gray-700 bg-gray-900/60 text-gray-100 text-[11px] px-1 py-0.5"
                              >
                                <option value="coordination">Coordination</option>
                                <option value="rfi">RFI</option>
                              </select>
                            )}
                          </div>
                          <textarea
                            ref={richTextEditorRef}
                            value={richTextEditor.text}
                            onChange={(e) => setRichTextEditor((prev) => (prev ? { ...prev, text: e.target.value } : prev))}
                            className="w-full h-24 resize-none rounded border border-gray-700 bg-gray-900/60 p-2 outline-none focus:border-blue-500"
                            onPointerDown={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                            style={{
                              backgroundColor: textStyle.backgroundColor || '#ffffff',
                              color: textStyle.color || '#111827',
                              fontSize: textStyle.fontSize || 14,
                              fontWeight: textStyle.fontWeight || 400,
                              fontStyle: textStyle.italic ? 'italic' : undefined,
                              textDecoration: textStyle.underline ? 'underline' : undefined,
                            }}
                            placeholder={richTextEditor.annotationType === 'generate' ? 'Write the coordination or RFI question...' : 'Enter text...'}
                          />
                          {richTextEditor.annotationType === 'textBox' ? (
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <label className="text-[11px] text-gray-400">
                                Width
                                <input
                                  type="range"
                                  min="0.08"
                                  max="0.5"
                                  step="0.01"
                                  value={richTextEditor.w}
                                  onChange={(e) => setRichTextEditor((prev) => prev ? { ...prev, w: Number(e.target.value) } : prev)}
                                  className="w-full"
                                />
                              </label>
                              <label className="text-[11px] text-gray-400">
                                Height
                                <input
                                  type="range"
                                  min="0.04"
                                  max="0.32"
                                  step="0.01"
                                  value={richTextEditor.h}
                                  onChange={(e) => setRichTextEditor((prev) => prev ? { ...prev, h: Number(e.target.value) } : prev)}
                                  className="w-full"
                                />
                              </label>
                            </div>
                          ) : (
                            <div className="mt-2 rounded border border-gray-800 bg-gray-950/30 px-2 py-1.5 text-[11px] text-gray-400">
                              Callout boxes auto-size to the text when saved. Use Move after saving to reposition or resize.
                            </div>
                          )}

                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <label className="text-[11px] text-gray-400">
                              Font size
                              <select
                                value={textStyle.fontSize}
                                onChange={(e) => setTextStyle((prev) => ({ ...prev, fontSize: Number(e.target.value) }))}
                                className="mt-1 w-full rounded border border-gray-700 bg-gray-900/60 px-2 py-1 text-xs text-gray-100"
                              >
                                {FONT_SIZE_OPTIONS.map(size => <option key={size} value={size}>{size}px</option>)}
                              </select>
                            </label>
                            <label className="text-[11px] text-gray-400">
                              Weight
                              <select
                                value={textStyle.fontWeight}
                                onChange={(e) => setTextStyle((prev) => ({ ...prev, fontWeight: Number(e.target.value) }))}
                                className="mt-1 w-full rounded border border-gray-700 bg-gray-900/60 px-2 py-1 text-xs text-gray-100"
                              >
                                {FONT_WEIGHT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                            </label>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setTextStyle((prev) => ({ ...prev, italic: !prev.italic }))}
                              className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] ${textStyle.italic ? 'border-blue-500 bg-blue-900/20 text-blue-300' : 'border-gray-700 text-gray-300'}`}
                            >
                              <Italic size={10} /> Italic
                            </button>
                            <button
                              type="button"
                              onClick={() => setTextStyle((prev) => ({ ...prev, underline: !prev.underline }))}
                              className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] ${textStyle.underline ? 'border-blue-500 bg-blue-900/20 text-blue-300' : 'border-gray-700 text-gray-300'}`}
                            >
                              <Underline size={10} /> Underline
                            </button>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-1">
                            <span className="mr-1 text-[11px] text-gray-400">Shape color</span>
                            {ANNOTATION_COLORS.map((c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => setRichTextEditor((prev) => (prev ? { ...prev, color: c } : prev))}
                                className={`h-4 w-4 rounded-full border ${(richTextEditor.color || toolColors[richTextEditor.annotationType as ToolKey] || '#facc15') === c ? 'border-white' : 'border-gray-600'}`}
                                style={{ backgroundColor: c }}
                                title={c}
                              />
                            ))}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1">
                            <span className="mr-1 text-[11px] text-gray-400">Text color</span>
                            {TEXT_COLOR_OPTIONS.map((c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => setTextStyle((prev) => ({ ...prev, color: c }))}
                                className={`h-4 w-4 rounded-full border ${textStyle.color === c ? 'border-white' : 'border-gray-600'}`}
                                style={{ backgroundColor: c }}
                                title={c}
                              />
                            ))}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1">
                            <span className="mr-1 text-[11px] text-gray-400">Box fill</span>
                            {TEXT_COLOR_OPTIONS.map((c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => setTextStyle((prev) => ({ ...prev, backgroundColor: c }))}
                                className={`h-4 w-4 rounded-full border ${textStyle.backgroundColor === c ? 'border-white' : 'border-gray-600'}`}
                                style={{ backgroundColor: c }}
                                title={c}
                              />
                            ))}
                          </div>
                          <div className="mt-3 flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setRichTextEditor(null)}
                              className="inline-flex min-w-[72px] items-center justify-center gap-1 rounded border border-gray-700 px-2 py-1.5 text-[11px] text-gray-300 hover:bg-white/5"
                            >
                              <X size={10} /> Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => void saveRichTextEditor()}
                              className="inline-flex min-w-[72px] items-center justify-center rounded bg-blue-600 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-500"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div
                className={`operations-pdf-scroll border border-gray-800 rounded-md bg-[#10131c] overflow-auto ${isFullScreenView ? 'h-full max-h-none min-h-0' : 'h-[calc(100vh-180px)] min-h-[60vh]'}`}
                style={{
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none' as any,
                } as React.CSSProperties}
              >
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
                        onClick={(e) => {
                          setFocusedAnnotationId(a.id)
                          setLayoutEditId(null)
                          if (a.type === 'note') {
                            openEditNoteEditor(a)
                            return
                          }
                          const toolKey = annotationTypeToToolKey(a.type)
                          if (toolKey) {
                            setOpenPopover({
                              tool: toolKey as ToolMode,
                              anchorEl: e.currentTarget as HTMLElement,
                              mode: 'edit',
                              editingAnnotationId: a.id,
                            })
                          }
                        }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-white/5 ${focusedAnnotationId === a.id ? 'bg-white/5' : ''}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: a.color || '#facc15' }} />
                            <span className="text-gray-300 uppercase truncate">{annotationLabel(a)}</span>
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
                        {(a.text || a.type === 'note') && (
                          <div className="mt-1 text-gray-400 truncate">{shortText(a.text)}</div>
                        )}
                        {(a.type === 'callout' || a.type === 'generate') && (
                          <div className="mt-1 text-[11px] text-gray-500">Arrow callout pinned to exact point.</div>
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

      {/* ── Floating tool popover (portal) ── */}
      {_popoverContent && openPopover && (
        <ToolPopover
          open
          anchorEl={openPopover.anchorEl}
          onClose={() => setOpenPopover(null)}
          title={_popoverContent.title}
          additionalChildren={_popoverContent.additional}
        >
          {_popoverContent.primary}
        </ToolPopover>
      )}
    </div>
  )
}
