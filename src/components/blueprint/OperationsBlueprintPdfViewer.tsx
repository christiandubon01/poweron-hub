// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowUpRight,
  Bold,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  ClipboardPaste,
  Copy,
  Crosshair,
  Eraser,
  Eye,
  EyeOff,
  Highlighter,
  Italic,
  Layers,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  Unlock,
  Minus,
  MousePointer2,
  Move,
  Pencil,
  PenLine,
  RefreshCw,
  Ruler,
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
import { useAuth } from '@/hooks/useAuth'
import { createRFI } from '@/agents/blueprint/rfiManager'
import { createCoordinationItem } from '@/agents/blueprint/coordinationTracker'
import {
  buildBlueprintPdfRuntimeKey,
  registerBlueprintPdfRuntimeProvider,
  unregisterBlueprintPdfRuntimeProvider,
} from '@/features/blueprint-vr/blueprintPdfTraceRuntimeBridge'

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


function shouldUseDesktopBlueprintLayout() {
  if (typeof window === 'undefined') return false
  const nav = window.navigator
  const ua = nav.userAgent || ''
  const platform = nav.platform || ''
  const maxTouchPoints = nav.maxTouchPoints || 0
  const isIPadLike =
    /iPad/i.test(ua) ||
    ((/MacIntel|Macintosh/i.test(platform) || /Macintosh/i.test(ua)) && maxTouchPoints > 1)

  return !isIPadLike && window.innerWidth >= 1280
}

function isTabletDevice() {
  if (typeof window === 'undefined') return false
  const nav = window.navigator
  const ua = nav.userAgent || ''
  const platform = nav.platform || ''
  const maxTouchPoints = nav.maxTouchPoints || 0
  const isIPadLike =
    /iPad/i.test(ua) ||
    ((/MacIntel|Macintosh/i.test(platform) || /Macintosh/i.test(ua)) && maxTouchPoints > 1)
  
  return isIPadLike
}

// Zoom floor = 1.0 means the user can never zoom out past "Fit to Full Page".
// The fit scale is always relativeZoom = 1.0. Going below 1.0 would make the
// page smaller than the fitted size, which is unwanted.
const MIN_RELATIVE_ZOOM = 1
// Desktop cap: 4Ãƒâ€" fit. Mobile cap: 8Ãƒâ€" fit (detected at render time).
const MAX_RELATIVE_ZOOM_DESKTOP = 4.5
const MAX_RELATIVE_ZOOM_MOBILE = 8
const MAX_RENDER_SCALE = 4.5
const PINCH_SENSITIVITY = 0.55
const PINCH_DEADZONE_PX = 2
// Debounce window for committing wheel-zoom changes to the actual PDF canvas
// re-render. During the debounce window, the page is visually scaled via CSS
// transform (instant feedback), then re-rendered sharp once the user stops.
// 120ms keeps the sharp re-render close on the user's heels so the blurry
// CSS-transform intermediate is barely visible. Tested on desktop wheel.
const WHEEL_ZOOM_COMMIT_DELAY_MS = 150
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
// Normalized offset applied when pasting a copied annotation via the toolbar
// button (no explicit drop point) so repeated pastes cascade and stay visible.
const PASTE_OFFSET_NORM = 0.03

type ToolbarBucket = 'annotate' | 'draw' | 'generate' | 'view' | 'measure'
type ToolMode =
  | 'select'
  | 'note'
  | 'highlight'
  | 'textHighlight'
  | 'underline'
  | 'textBox'
  | 'pen'
  | 'marker'
  | 'eraser'
  | 'shape'
  | 'callout'
  | 'generate'
  | 'calibrate'
  | 'measure-distance'
  | 'measure-area'
  | 'measure-perimeter'

type ShapeKind = 'square' | 'circle' | 'line' | 'arrow' | 'arch-line' | 'star' | 'cross' | 'diamond' | 'pentagon' | 'can-light-4' | 'can-light-6'
type BorderStyle = 'solid' | 'dashed' | 'dotted'
type HatchPattern = 'none' | 'diagonal' | 'cross' | 'dots'
type GenerateQuestionType = 'coordination' | 'rfi'

// Ã¢â€â‚¬Ã¢â€â‚¬ Measurement & calibration types Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
type CalibrationUnit = 'ft' | 'm' | 'in' | 'cm' | 'mm'
type CalibrationStatus = 'none' | 'pending' | 'saved'

interface CalibrationData {
  pageNumber: number
  // Euclidean distance in normalised page-coords (0-1 Ãƒâ€" page width)
  normDistance: number
  realWorldValue: number
  realWorldUnit: CalibrationUnit
  savedAt: string
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Auto-scale detection types Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
interface DetectedScaleCandidate {
  parsedScale: string
  realWidthFeet: number
  confidence: number
  sourceText: string
}
interface DetectedScaleResult {
  pageNumber: number
  candidates: DetectedScaleCandidate[]
  ambiguous: boolean
  detectedAt: string
}

interface MeasurementStyle {
  endpointStyle: 'dot' | 'arrow' | 'bar' | 'none'
  lineThickness: number
  lineColor: string
  textSize: number
  fillColor: string
  fillOpacity: number
  fillPattern: 'none' | 'solid' | 'diagonal' | 'cross' | 'crosshatch' | 'dots' | 'horizontal'
}

const DEFAULT_MEASUREMENT_STYLE: MeasurementStyle = {
  endpointStyle: 'dot',
  lineThickness: 2,
  lineColor: '#38bdf8',
  textSize: 12,
  fillColor: '#38bdf8',
  fillOpacity: 0.15,
  fillPattern: 'none',
}

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
  return s.length > max ? `${s.slice(0, max)}Ã¢â‚¬Â¦` : s
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

// Can-light detection — used to render the third "light output" ring and to
// surface the Light Output control. Relies on the existing shape metadata.
function isCanLightShape(annotation: any) {
  if (!annotation || annotation.type !== 'shape') return false
  const kind = getAnnotationMeta(annotation).shapeKind
  return kind === 'can-light-4' || kind === 'can-light-6'
}

// Supported can-light color temperatures (Kelvin). 3000K is the default when missing.
const CAN_LIGHT_KELVIN_OPTIONS = [2700, 3000, 3500, 4000, 5000, 6000] as const
const DEFAULT_CAN_LIGHT_KELVIN = 3000

// Can-light Light Output scale (the SIZE of the orange output overlay) — single
// source of truth so the max can never silently drift back down. 1 = normal/base
// output, 20 = maximum (≈20× the base fixture spread), 0.25 = dimmest. Both the
// Light Output slider and the overlay-render clamp reference these constants.
const LIGHT_OUTPUT_MIN = 0.25
const LIGHT_OUTPUT_BASE = 1
const LIGHT_OUTPUT_MAX = 20

// Maps a can-light color temperature to a representative tint for the output
// overlay — warm amber at low Kelvin → cool blue-white at high Kelvin. Color only;
// the overlay's size/opacity stay driven by Light Output (lightIntensity).
function getLightKelvinColor(kelvin: number) {
  switch (Number(kelvin)) {
    case 2700: return '#ff7a18'  // warm amber/orange
    case 3000: return '#ffa64d'  // warm soft orange
    case 3500: return '#ffd29a'  // warm neutral
    case 4000: return '#fff0d8'  // neutral white (soft warm-white)
    case 5000: return '#e6f0ff'  // cool white
    case 6000: return '#b9d2ff'  // cool blue-white
    default:   return '#ffa64d'  // default → 3000K
  }
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

// SVG <pattern> element for measurement area fills Ã¢â‚¬â€ returns null for solid/none.
function getMeasurePatternDef(patternId: string, pattern: string, color: string, opacity: number) {
  const col = hexWithAlpha(color, Math.min(1, opacity + 0.25))
  switch (pattern) {
    case 'diagonal':
      return <pattern id={patternId} patternUnits="userSpaceOnUse" width={8} height={8} patternTransform="rotate(45 0 0)"><line x1={0} y1={0} x2={0} y2={8} stroke={col} strokeWidth={2} /></pattern>
    case 'crosshatch': case 'cross':
      return <pattern id={patternId} patternUnits="userSpaceOnUse" width={8} height={8}><line x1={0} y1={4} x2={8} y2={4} stroke={col} strokeWidth={1} /><line x1={4} y1={0} x2={4} y2={8} stroke={col} strokeWidth={1} /></pattern>
    case 'dots':
      return <pattern id={patternId} patternUnits="userSpaceOnUse" width={8} height={8}><circle cx={4} cy={4} r={1.5} fill={col} /></pattern>
    case 'horizontal':
      return <pattern id={patternId} patternUnits="userSpaceOnUse" width={8} height={8}><line x1={0} y1={4} x2={8} y2={4} stroke={col} strokeWidth={1.5} /></pattern>
    default: return null
  }
}

// Best-effort blueprint scale text detection from PDF text items.
// Returns null if no recognisable scale found.
function detectBlueprintScaleText(
  textItems: string[],
  pageWidthPts: number,
  pageNumber: number,
): DetectedScaleResult | null {
  const joined = textItems.join(' ')
  const paperWidthInches = pageWidthPts / 72
  const candidates: DetectedScaleCandidate[] = []

  // Fractional inch = 1 foot: e.g. "1/4" = 1'-0"", "3/16" = 1'-0""
  const fracRe = /(\d+)\s*\/\s*(\d+)\s*["""]?\s*=\s*1\s*[-'''`]\s*0\s*["""]?/g
  let m: RegExpExecArray | null
  while ((m = fracRe.exec(joined)) !== null) {
    const num = parseInt(m[1], 10), den = parseInt(m[2], 10)
    if (num > 0 && den > 0) {
      const S = den / num   // feet per paper inch (e.g. 4 for 1/4")
      candidates.push({ parsedScale: m[0].trim(), realWidthFeet: paperWidthInches * S, confidence: 0.95, sourceText: m[0] })
    }
  }

  // Integer inch = 1 foot: e.g. "1" = 1'-0"", "2" = 1'-0""
  const intRe = /(?<!\d)(\d+)\s*["""]?\s*=\s*1\s*[-'''`]\s*0\s*["""]?/g
  while ((m = intRe.exec(joined)) !== null) {
    const num = parseInt(m[1], 10)
    if (num > 0) {
      const S = 1 / num   // feet per paper inch (e.g. 0.5 for 2")
      const rw = paperWidthInches * S
      if (!candidates.some(c => Math.abs(c.realWidthFeet - rw) / Math.max(0.001, rw) < 0.05)) {
        candidates.push({ parsedScale: m[0].trim(), realWidthFeet: rw, confidence: 0.85, sourceText: m[0] })
      }
    }
  }

  // Ratio form: "Scale 1:48", "1:100"
  const ratioRe = /(?:scale\s*[=:]?\s*)?1\s*:\s*(\d+)/gi
  while ((m = ratioRe.exec(joined)) !== null) {
    const ratio = parseInt(m[1], 10)
    if (ratio >= 5 && ratio <= 10000) {
      // 1:ratio Ã¢â€ â€™ 1 paper inch = ratio real inches = ratio/12 feet
      const rw = paperWidthInches * (ratio / 12)
      if (!candidates.some(c => Math.abs(c.realWidthFeet - rw) / Math.max(0.001, rw) < 0.05)) {
        candidates.push({ parsedScale: m[0].trim(), realWidthFeet: rw, confidence: 0.75, sourceText: m[0] })
      }
    }
  }

  if (candidates.length === 0) return null

  // Deduplicate within 5% relative tolerance
  const deduped: DetectedScaleCandidate[] = []
  for (const c of candidates) {
    if (!deduped.some(d => Math.abs(d.realWidthFeet - c.realWidthFeet) / Math.max(0.001, c.realWidthFeet) < 0.05)) {
      deduped.push(c)
    }
  }
  return { pageNumber, candidates: deduped, ambiguous: deduped.length > 1, detectedAt: new Date().toISOString() }
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
  if (annotation.type === 'textBox') return 'Insert Text'
  if (annotation.type === 'callout') return 'Callout'
  if (annotation.type === 'generate') return getAnnotationMeta(annotation).questionType === 'rfi' ? 'RFI Question' : 'Coordination Question'
  if (annotation.type === 'pen') return 'Pen'
  if (annotation.type === 'marker') return 'Marker'
  if (annotation.type === 'shape') return `${String(getAnnotationMeta(annotation).shapeKind || 'shape')}`
  if (annotation.type === 'underline') return 'Underline'
  if (annotation.type === 'measure-distance') return 'Distance'
  if (annotation.type === 'measure-area') return 'Area'
  if (annotation.type === 'measure-perimeter') return 'Perimeter'
  if (annotation.type === 'calibrate') return 'Calibration'
  return String(annotation.type || 'annotation')
}

// Note: maxRelativeZoom is resolved inside the component (device-aware).
// This module-level helper uses the desktop cap; the component uses the
// instance-level maxRelativeZoom const for clamping zoom state.
function clampRelativeZoomStatic(v: number, max = MAX_RELATIVE_ZOOM_DESKTOP) {
  return Math.max(MIN_RELATIVE_ZOOM, Math.min(max, v))
}
// Alias used throughout Ã¢â‚¬â€ replaced by component-level clampRelativeZoom below.
const clampRelativeZoom = (v: number) => Math.max(MIN_RELATIVE_ZOOM, Math.min(MAX_RELATIVE_ZOOM, v))

// Handle fullscreen toggling with device-aware routing:
// - Desktop: use native browser Fullscreen API
// - Tablet: use in-app immersive fullscreen overlay (no browser fullscreen)
function handleFullscreenToggle(
  isCurrentlyInFullscreen: boolean,
  isTabletDevice: boolean,
  viewerElement: HTMLDivElement | null,
  onSetDesktopFullscreen: (value: boolean) => void,
  onSetTabletImmersiveFullscreen: (value: boolean) => void,
) {
  const doc: any = document
  const fullscreenEl = doc.fullscreenElement || doc.webkitFullscreenElement

  // If we're in OS-level fullscreen, exit it first
  if (fullscreenEl) {
    if (doc.exitFullscreen) doc.exitFullscreen()
    else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen()
    onSetDesktopFullscreen(false)
    return
  }

  // Toggle out of any fullscreen state
  if (isCurrentlyInFullscreen) {
    onSetDesktopFullscreen(false)
    onSetTabletImmersiveFullscreen(false)
    return
  }

  // Route to device-appropriate fullscreen mode
  if (isTabletDevice) {
    // Tablet: use in-app immersive fullscreen overlay
    onSetTabletImmersiveFullscreen(true)
  } else {
    // Desktop: use native browser fullscreen API
    if (viewerElement && viewerElement.requestFullscreen) {
      viewerElement.requestFullscreen().then(() => {
        onSetDesktopFullscreen(true)
      }).catch(() => {
        // Fallback if browser fullscreen fails
        onSetDesktopFullscreen(true)
      })
    } else if (viewerElement && (viewerElement as any).webkitRequestFullscreen) {
      ; (viewerElement as any).webkitRequestFullscreen()
      onSetDesktopFullscreen(true)
    } else {
      // Fallback: use in-app fullscreen
      onSetDesktopFullscreen(true)
    }
  }
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
  const { profile } = useAuth()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const pdfDocRef = useRef<any>(null)
  const renderTaskRef = useRef<any>(null)
  const noteEditorRef = useRef<HTMLTextAreaElement>(null)
  const richTextEditorRef = useRef<HTMLTextAreaElement>(null)
  const draftTextBoxIdRef = useRef<string | null>(null)
  const textBoxSnapshotRef = useRef<BlueprintAnnotation | null>(null)
  const allAnnotationsRef = useRef<BlueprintAnnotation[]>([])
  const inlineTextOriginalRef = useRef<string>('')
  const inlineTextBoxEditorRef = useRef<HTMLDivElement | null>(null)
  const cancelTextBoxEditSessionRef = useRef<() => void>(() => {})
  const focusedAnnotationElRef = useRef<HTMLElement | null>(null)
  const isSavingTextBoxRef = useRef(false)
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve())
  // Track annotation IDs that have been locally deleted but may not yet be flushed to storage.
  // loadAnnotations filters these out so a quick reload never re-surfaces a deleted item.
  const locallyDeletedIdsRef = useRef<Set<string>>(new Set())
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  // Ref to the viewer's outermost element Ã¢â‚¬â€ used as the target for the
  // Fullscreen API on mobile (iPad/Android) so the viewer opens like a
  // video does, escaping browser chrome.
  const viewerRootRef = useRef<HTMLDivElement>(null)
  const pageFrameRef = useRef<HTMLDivElement>(null)
  // Ref to the toolbar area so we can measure its height and set the
  // scroll area to exactly fill the remaining vertical space.
  const toolbarAreaRef = useRef<HTMLDivElement>(null)
  // Draft rect DOM ref Ã¢â‚¬â€ mutated directly during pointer-move for zero-lag
  // visual feedback (bypasses React re-renders entirely during active drag).
  const draftRectDomRef = useRef<HTMLDivElement>(null)
  const draftLineDomRef = useRef<SVGLineElement>(null)
  const draftArchPathDomRef = useRef<SVGPathElement>(null)
  // Point-to-point line placement: stores the first click position (pixel coords within overlay).
  const lineFirstPointRef = useRef<{ x: number; y: number } | null>(null)
  // Tracks how many annotation mutations are in-flight so loadAnnotations() fires only when the queue drains.
  const pendingAnnotationMutationsRef = useRef(0)
  const pendingScrollResetRef = useRef(false)
  const relativeZoomRef = useRef(1)
  // True when viewport width is phone/tablet-sized (< 1024px).
  const isMobileRef = useRef(typeof window !== 'undefined' && window.innerWidth < 1024)
  const [isDesktopBlueprintLayout, setIsDesktopBlueprintLayout] = useState(shouldUseDesktopBlueprintLayout)
  const maxRelativeZoom = isMobileRef.current ? MAX_RELATIVE_ZOOM_MOBILE : MAX_RELATIVE_ZOOM_DESKTOP
  // Component-level zoom clamp Ã¢â‚¬â€ uses the correct device-aware ceiling.
  const clampRelativeZoom = (v: number) => Math.max(MIN_RELATIVE_ZOOM, Math.min(maxRelativeZoom, v))
  const [scrollAreaHeight, setScrollAreaHeight] = useState(0)
  useEffect(() => {
    const syncViewportFlags = () => {
      if (typeof window === 'undefined') return
      isMobileRef.current = window.innerWidth < 1024
      setIsDesktopBlueprintLayout(shouldUseDesktopBlueprintLayout())
    }

    syncViewportFlags()
    window.addEventListener('resize', syncViewportFlags, { passive: true })
    return () => window.removeEventListener('resize', syncViewportFlags)
  }, [])

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
  const currentPageRef = useRef(1)
  currentPageRef.current = currentPage
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
  const getLoadedPdfDoc = useCallback(() => {
  const doc = pdfDocRef.current || pdfDoc
  return doc && typeof doc.getPage === 'function' ? doc : null
}, [pdfDoc])

const getSafePdfPageNumber = useCallback((value: number | string | null | undefined) => {
  const doc = pdfDocRef.current || pdfDoc
  const maxPages = Math.max(
    1,
    Number(doc?.numPages || numPages || blueprint?.pageCount || 1)
  )
  const requested = Math.floor(Number(value) || 1)
  return Math.max(1, Math.min(maxPages, requested))
}, [blueprint?.pageCount, numPages, pdfDoc])

  const [isFullScreenView, setIsFullScreenView] = useState(false)
  // iPad/tablet immersive fullscreen mode (in-app overlay, not browser fullscreen)
  const [isTabletImmersiveFullscreen, setIsTabletImmersiveFullscreen] = useState(false)
  const [tabletAnnotationsOpen, setTabletAnnotationsOpen] = useState(false)
  const [indexModalOpen, setIndexModalOpen] = useState(false)
  const [rfiModal, setRfiModal] = useState<{ open: boolean; annotation: BlueprintAnnotation | null }>({ open: false, annotation: null })
  const [cordModal, setCordModal] = useState<{ open: boolean; annotation: BlueprintAnnotation | null }>({ open: false, annotation: null })
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [rfiForm, setRfiForm] = useState({ requestedFrom: '', category: 'coordination', dueDate: '' })
  const [cordForm, setCordForm] = useState({ category: 'light', dueDate: '' })
  const [submittingRfi, setSubmittingRfi] = useState(false)
  const [submittingCord, setSubmittingCord] = useState(false)
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
    const normalBlueprintViewerMinHeight = isDesktopBlueprintLayout
    ? 'calc(100dvh - 120px)'
    : 'clamp(420px, 72dvh, 760px)'

  useEffect(() => {
    if (!blueprint?.id || !pdfDoc) return
    const resolvedPageCount = Number(numPages || pdfDoc?.numPages || blueprint?.pageCount || 0)
    const sourceSetName = blueprint.title || blueprint.fileName
    const fileName = blueprint.fileName || blueprint.storagePath || blueprint.title
    const runtimeIdentity = {
      projectId: blueprint.projectId,
      blueprintId: blueprint.id,
      sourceSetId: blueprint.id,
      sourceSetName,
      fileName,
      pageCount: resolvedPageCount,
    }
    const runtimeKey = buildBlueprintPdfRuntimeKey(runtimeIdentity)
    if (!runtimeKey) return
    const missingFields = Object.entries(runtimeIdentity)
      .filter(([, value]) => value === null || value === undefined || String(value).trim() === '' || String(value).trim() === '0')
      .map(([key]) => key)
    registerBlueprintPdfRuntimeProvider(runtimeKey, {
      projectId: blueprint.projectId,
      blueprintId: blueprint.id,
      sourceSetId: blueprint.id,
      sourceSetName,
      fileName,
      pageCount: resolvedPageCount,
      metadata: {
        ...runtimeIdentity,
        runtimeKey,
        registeredAt: new Date().toISOString(),
        missingFields,
        opsConstants: (_pdfjsLib as any)?.OPS ?? {},
        pdfDocReady: Boolean(pdfDoc),
        hasGetPage: true,
        numPages: resolvedPageCount,
      },
      getPage: async (pageNumber: number) => {
        const doc = pdfDocRef.current
        if (!doc || typeof doc.getPage !== 'function') {
          throw new Error('PDF document is not loaded in the viewer runtime.')
        }
        const nextPage = Math.max(1, Math.floor(Number(pageNumber) || 1))
        return doc.getPage(nextPage)
      },
      getCurrentPage: async () => {
        const doc = pdfDocRef.current
        if (!doc || typeof doc.getPage !== 'function') {
          throw new Error('PDF document is not loaded in the viewer runtime.')
        }
        return doc.getPage(Math.max(1, Math.floor(Number(currentPageRef.current) || 1)))
      },
      getTextContent: async (pageNumber: number) => {
        const doc = pdfDocRef.current
        if (!doc || typeof doc.getPage !== 'function') {
          throw new Error('PDF document is not loaded in the viewer runtime.')
        }
        const page = await doc.getPage(Math.max(1, Math.floor(Number(pageNumber) || 1)))
        if (typeof page?.getTextContent !== 'function') {
          throw new Error('PDF page textContent is unavailable.')
        }
        return page.getTextContent()
      },
      getOperatorList: async (pageNumber: number) => {
        const doc = pdfDocRef.current
        if (!doc || typeof doc.getPage !== 'function') {
          throw new Error('PDF document is not loaded in the viewer runtime.')
        }
        const page = await doc.getPage(Math.max(1, Math.floor(Number(pageNumber) || 1)))
        if (typeof page?.getOperatorList !== 'function') {
          throw new Error('PDF page operator list is unavailable.')
        }
        return page.getOperatorList()
      },
    })
    return () => {
      unregisterBlueprintPdfRuntimeProvider(runtimeKey, 'component-unmount-or-source-change')
    }
  }, [blueprint?.id, blueprint?.projectId, blueprint?.title, blueprint?.fileName, blueprint?.storagePath, blueprint?.pageCount, pdfDoc, numPages])

  // Ã¢â€â‚¬Ã¢â€â‚¬ Pane resize state Ã¢â‚¬â€ persisted across hard reloads Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const [leftPaneWidth, setLeftPaneWidth] = useState(() => {
    const saved = localStorage.getItem('blueprint_left_pane_width')
    return saved ? Math.max(160, Math.min(480, parseInt(saved, 10))) : 280
  })
  const [rightPaneWidth, setRightPaneWidth] = useState(() => {
    const saved = localStorage.getItem('blueprint_right_pane_width')
    return saved ? Math.max(160, Math.min(480, parseInt(saved, 10))) : 320
  })
  const [draggingDivider, setDraggingDivider] = useState<'left' | 'right' | null>(null)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(0)

  useEffect(() => {
    if (!draggingDivider) return
    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - dragStartXRef.current
      if (draggingDivider === 'left') {
        const next = Math.max(160, Math.min(480, dragStartWidthRef.current + delta))
        setLeftPaneWidth(next)
        localStorage.setItem('blueprint_left_pane_width', String(next))
      } else {
        const next = Math.max(160, Math.min(480, dragStartWidthRef.current - delta))
        setRightPaneWidth(next)
        localStorage.setItem('blueprint_right_pane_width', String(next))
      }
    }
    const onMouseUp = () => setDraggingDivider(null)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [draggingDivider])

  // Ã¢â€â‚¬Ã¢â€â‚¬ Measurement calibration state Ã¢â‚¬â€ page-specific Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  // savedCalibrations: committed calibrations keyed by pageNumber
  const [savedCalibrations, setSavedCalibrations] = useState<Record<number, CalibrationData>>({})
  // pendingCalibration: drawn but not yet committed (recalibration replaces this)
  const [pendingCalibration, setPendingCalibration] = useState<CalibrationData | null>(null)
  // measurementStyle: shared style options for all measure annotation types
  const [measurementStyle, setMeasurementStyle] = useState<MeasurementStyle>(DEFAULT_MEASUREMENT_STYLE)

  // Ã¢â€â‚¬Ã¢â€â‚¬ Measurement draft state Ã¢â‚¬â€ multi-click accumulation Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const [measureDraftPoints, setMeasureDraftPoints] = useState<Array<{ x: number; y: number }>>([])
  const measureDraftRef = useRef<Array<{ x: number; y: number }>>([])
  const [measureCursorPx, setMeasureCursorPx] = useState<{ x: number; y: number } | null>(null)
  const lastMeasureClickRef = useRef<{ time: number; nx: number; ny: number }>({ time: 0, nx: 0, ny: 0 })
  const [calibrateInput, setCalibrateInput] = useState<{
    p1: { x: number; y: number }
    p2: { x: number; y: number }
    value: string
    unit: CalibrationUnit
  } | null>(null)
  const [measurePendingCommit, setMeasurePendingCommit] = useState<{
    type: 'measure-distance' | 'measure-area' | 'measure-perimeter'
    points: Array<{ x: number; y: number }>
    pageNumber: number
  } | null>(null)

  // Ã¢â€â‚¬Ã¢â€â‚¬ Auto-detected scale results Ã¢â‚¬â€ keyed by pageNumber Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const [detectedScales, setDetectedScales] = useState<Record<number, DetectedScaleResult>>({})
  // Tracks which pages have already been scanned so we don't repeat work.
  const scannedPagesRef = useRef<Set<number>>(new Set())

  // Normalized PDF text item positions keyed by page number — used for text-aware textHighlight quads
  type TextItemNorm = { x: number; y: number; w: number; h: number }
  const [textItemsCache, setTextItemsCache] = useState<Record<number, TextItemNorm[]>>({})
  const textItemsCacheRef = useRef<Record<number, TextItemNorm[]>>({})

  // Ã¢â€â‚¬Ã¢â€â‚¬ Derived calibration for current page Ã¢â‚¬â€ precedence: manual > auto > none Ã¢â€â‚¬
  const savedCalibration: CalibrationData | null = savedCalibrations[currentPage] ?? null
  const detectedResult: DetectedScaleResult | null = detectedScales[currentPage] ?? null
  const autoCalibration: CalibrationData | null = (() => {
    if (!detectedResult || detectedResult.ambiguous || detectedResult.candidates.length !== 1) return null
    const c = detectedResult.candidates[0]
    return { pageNumber: currentPage, normDistance: 1.0, realWorldValue: c.realWidthFeet, realWorldUnit: 'ft' as CalibrationUnit, savedAt: detectedResult.detectedAt }
  })()
  const activeCalibration: CalibrationData | null = savedCalibration ?? autoCalibration
  const detectedScale: number | null = activeCalibration
    ? activeCalibration.normDistance / Math.max(0.001, activeCalibration.realWorldValue)
    : null
  type CalibrationSource = 'manual' | 'auto' | 'ambiguous' | 'none'
  const calibrationSource: CalibrationSource =
    savedCalibration ? 'manual' :
    detectedResult?.ambiguous ? 'ambiguous' :
    autoCalibration ? 'auto' : 'none'
  const calibrationStatus: CalibrationStatus =
    pendingCalibration?.pageNumber === currentPage ? 'pending' :
    activeCalibration ? 'saved' : 'none'

  const [toolbarBucket, setToolbarBucket] = useState<ToolbarBucket>('annotate')
  const [toolMode, setToolMode] = useState<ToolMode>('select')

  // Per-tool color memory (replaces single activeColor)
  type ToolKey = 'highlight' | 'textHighlight' | 'underline' | 'textBox' | 'pen' | 'marker' | 'eraser' | 'shape' | 'callout' | 'generate' | 'note' | 'calibrate' | 'measure-distance' | 'measure-area' | 'measure-perimeter'
  const [toolColors, setToolColors] = useState<Record<ToolKey, string>>({
    highlight: '#facc15',
    textHighlight: '#facc15', // default yellow Ã¢â‚¬â€ distinct palette in popover
    underline: '#facc15',
    textBox: '#111827',
    pen: '#facc15',
    marker: '#facc15',
    eraser: '#facc15',
    shape: '#facc15',
    callout: '#facc15',
    generate: '#facc15',
    note: '#facc15',
    calibrate: '#38bdf8',
    'measure-distance': '#38bdf8',
    'measure-area': '#22c55e',
    'measure-perimeter': '#f97316',
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
  const [inlineTextEditId, setInlineTextEditId] = useState<string | null>(null)
  const [focusedAnnotationRect, setFocusedAnnotationRect] = useState<{ top: number; left: number; right: number; bottom: number; width: number; height: number } | null>(null)

  // Show/hide all placed annotation overlays without deleting them (Fix 2).
  const [annotationsVisible, setAnnotationsVisible] = useState(true)
  // Show/hide ONLY the can-light glow/output overlay (Step 12B). Symbol body
  // (trim ring, crosshair, aperture, label) stays visible and selectable either way.
  const [lightingEffectsVisible, setLightingEffectsVisible] = useState(true)
  // Copied annotation/shape design awaiting paste (Fix 1). Strips id/timestamps/page
  // at copy time; cloneAnnotationForPaste() builds it, pasteCopiedAnnotationAt() consumes it.
  const [copiedAnnotationTemplate, setCopiedAnnotationTemplate] = useState<any>(null)
  // Active paste mode: only while true does a bare-page tap drop a copy. Kept
  // separate from the template so "Stop Pasting" halts placement without losing the
  // copied design — the user can resume via Paste without copying again.
  const [pasteModeActive, setPasteModeActive] = useState(false)

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
  // Ref mirror so handleAnnotationLayoutPointerMove reads the latest value before React batches the setState
  const layoutDragRef = useRef<{
    annotationId: string
    mode: 'move' | 'resize'
    pointerId: number
    startClientX: number
    startClientY: number
    startBox: { x: number; y: number; w: number; h: number }
  } | null>(null)

  const [endpointDrag, setEndpointDrag] = useState<{
    annotationId: string
    endpoint: 'start' | 'end'
    pointerId: number
    startClientX: number
    startClientY: number
    startAbsX: number
    startAbsY: number
    otherAbsX: number
    otherAbsY: number
  } | null>(null)
  const endpointDragRef = useRef<{
    annotationId: string
    endpoint: 'start' | 'end'
    pointerId: number
    startClientX: number
    startClientY: number
    startAbsX: number
    startAbsY: number
    otherAbsX: number
    otherAbsY: number
  } | null>(null)

  const [barDragOffset, setBarDragOffset] = useState<{ x: number; y: number } | null>(null)
  const barDragRef = useRef<{ pointerId: number; startClientX: number; startClientY: number; startX: number; startY: number } | null>(null)

  const [archControlDrag, setArchControlDrag] = useState<{
    annotationId: string
    pointerId: number
  } | null>(null)
  const archControlDragRef = useRef<{
    annotationId: string
    pointerId: number
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

  // Ã¢â€â‚¬Ã¢â€â‚¬ Keyboard handler for measurement tools Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        measureDraftRef.current = []
        setMeasureDraftPoints([])
        setMeasureCursorPx(null)
        setCalibrateInput(null)
        lastMeasureClickRef.current = { time: 0, nx: 0, ny: 0 }
        lineFirstPointRef.current = null
        if (draftLineDomRef.current) draftLineDomRef.current.style.display = 'none'
        if (draftArchPathDomRef.current) draftArchPathDomRef.current.style.display = 'none'
      }
      if (e.key === 'Enter' && effectiveTool === 'measure-perimeter' && !calibrateInput) {
        const pts = [...measureDraftRef.current]
        if (pts.length >= 2) {
          setMeasurePendingCommit({ type: 'measure-perimeter', points: pts, pageNumber: currentPageRef.current })
          measureDraftRef.current = []
          setMeasureDraftPoints([])
          setMeasureCursorPx(null)
          lastMeasureClickRef.current = { time: 0, nx: 0, ny: 0 }
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [effectiveTool, calibrateInput])

  // Ã¢â€â‚¬Ã¢â€â‚¬ Clear measure draft on tool/page change Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  useEffect(() => {
    measureDraftRef.current = []
    setMeasureDraftPoints([])
    setMeasureCursorPx(null)
    setCalibrateInput(null)
    lastMeasureClickRef.current = { time: 0, nx: 0, ny: 0 }
  }, [effectiveTool, currentPage])

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
      const pending = locallyDeletedIdsRef.current
      setAllAnnotations((Array.isArray(items) ? items : []).filter(item => !pending.has(item.id)))
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

  // Measure toolbar area height so the scroll area can fill exactly the
  // remaining vertical space without a hard-coded pixel constant.
  useEffect(() => {
    const el = toolbarAreaRef.current
    if (!el) return
    const obs = new ResizeObserver(() => {
      setScrollAreaHeight(window.innerHeight - el.getBoundingClientRect().bottom)
    })
    obs.observe(el)
    // Also recompute on window resize.
    const onResize = () => setScrollAreaHeight(window.innerHeight - el.getBoundingClientRect().bottom)
    window.addEventListener('resize', onResize, { passive: true })
    return () => { obs.disconnect(); window.removeEventListener('resize', onResize) }
  }, [])

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

        if (!pdfDoc || typeof pdfDoc.getPage !== 'function') return
        const page = await pdfDoc.getPage(Math.max(1, Math.min(Number(pdfDoc.numPages || numPages || 1), clampedPage)))
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

  useEffect(() => {
    if (!inlineTextEditId) {
      inlineTextBoxEditorRef.current = null
      return
    }
    const el = inlineTextBoxEditorRef.current
    if (el) {
      const ann = allAnnotationsRef.current.find((item) => item.id === inlineTextEditId)
      if (ann) el.textContent = ann.text || ''
      el.focus()
    }
    const frame = requestAnimationFrame(() => {
      const ann = allAnnotationsRef.current.find((item) => item.id === inlineTextEditId)
      if (!ann || ann.type !== 'textBox') return
      const anchorEl = (overlayRef.current?.querySelector(`[data-annotation-anchor-id="${inlineTextEditId}"]`) as HTMLElement | null)
        || (overlayRef.current?.querySelector(`[data-annotation-id="${inlineTextEditId}"]`) as HTMLElement | null)
      if (!anchorEl) return
      focusedAnnotationElRef.current = anchorEl
      const r = anchorEl.getBoundingClientRect()
      setFocusedAnnotationRect({ top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height })
    })
    return () => cancelAnimationFrame(frame)
  }, [inlineTextEditId])

  // Ã¢â€â‚¬Ã¢â€â‚¬ Fullscreen Policy Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  // Sync focusedAnnotationRect whenever the focused annotation changes.
  // Handles sidebar-initiated selections (which only call setFocusedAnnotationId)
  // so the floating action bar always has a valid anchor rect.
  useEffect(() => {
    if (!focusedAnnotationId) return
    const rafId = requestAnimationFrame(() => {
      const el = (overlayRef.current?.querySelector(`[data-annotation-anchor-id="${focusedAnnotationId}"]`) as HTMLElement | null)
        || (overlayRef.current?.querySelector(`[data-annotation-id="${focusedAnnotationId}"]`) as HTMLElement | null)
      if (!el) return
      const r = el.getBoundingClientRect()
      focusedAnnotationElRef.current = el
      setFocusedAnnotationRect({ top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height })
    })
    return () => cancelAnimationFrame(rafId)
  }, [focusedAnnotationId])

  useEffect(() => {
  if (!focusedAnnotationId) return

  let rafId: number | null = null

  const updateFocusedRect = () => {
    if (rafId != null) cancelAnimationFrame(rafId)

    rafId = requestAnimationFrame(() => {
      const el =
        (overlayRef.current?.querySelector(`[data-annotation-anchor-id="${focusedAnnotationId}"]`) as HTMLElement | null) ||
        (overlayRef.current?.querySelector(`[data-annotation-id="${focusedAnnotationId}"]`) as HTMLElement | null)

      if (!el) return

      focusedAnnotationElRef.current = el
      const r = el.getBoundingClientRect()

      setFocusedAnnotationRect({
        top: r.top,
        left: r.left,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      })
    })
  }

  updateFocusedRect()

  const scrollEl = overlayRef.current?.closest('.operations-pdf-scroll') as HTMLElement | null
  scrollEl?.addEventListener('scroll', updateFocusedRect, { passive: true })
  window.addEventListener('resize', updateFocusedRect)

  return () => {
    if (rafId != null) cancelAnimationFrame(rafId)
    scrollEl?.removeEventListener('scroll', updateFocusedRect)
    window.removeEventListener('resize', updateFocusedRect)
  }
}, [focusedAnnotationId, currentPage, displaySize.w, displaySize.h, relativeZoom, pinchPreviewZoom])

  // Fullscreen exits ONLY via:
  //   1. Explicit close button in the header (when isFullScreenView === true)
  //   2. Escape key (when no annotation UI is open)
  //   3. OS-level fullscreen exit sync (e.g., swipe-down on iPad, Esc in OS)
  // No app-side implicit exits from drag, backdrop clicks, or touch logic.
  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  // Sync isFullScreenView with the browser's native Fullscreen API state.
  // Fires when user presses Esc, swipes down on iPad, or otherwise exits
  // OS-level fullscreen, so the UI's "Exit Full Screen" toggle stays correct.
  useEffect(() => {
    function handleFullscreenChange() {
      const doc: any = document
      const isInFullscreen = !!(doc.fullscreenElement || doc.webkitFullscreenElement)
      if (!isInFullscreen) {
        // OS-level fullscreen was exited (e.g., Esc, swipe-down on iPad).
        // Sync the UI state. This is passiveÃ¢â‚¬â€we do not initiate the exit.
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

  // iPad/tablet fullscreen: lock background page scroll, own all scroll/pan within viewer.
  // This prevents touch drags from leaking to outer page and prevents accidental fullscreen exit.
  useEffect(() => {
    if (!isFullScreenView && !isTabletImmersiveFullscreen) {
      // Restore normal scrolling when exiting fullscreen
      const html = document.documentElement
      const body = document.body
      html.style.overflow = ''
      body.style.overflow = ''
      html.style.position = ''
      body.style.position = ''
      return
    }

    // Lock outer page scroll during fullscreen so document drags stay contained
    const html = document.documentElement
    const body = document.body
    const originalHtmlOverflow = html.style.overflow
    const originalBodyOverflow = body.style.overflow
    const originalHtmlPosition = html.style.position
    const originalBodyPosition = body.style.position

    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    html.style.position = 'fixed'
    body.style.position = 'fixed'

    return () => {
      html.style.overflow = originalHtmlOverflow
      body.style.overflow = originalBodyOverflow
      html.style.position = originalHtmlPosition
      body.style.position = originalBodyPosition
    }
  }, [isFullScreenView, isTabletImmersiveFullscreen])

  // Notify V15rLayout to hide sidebar/header during tablet immersive fullscreen.
  // iOS Safari z-index stacking inside -webkit-overflow-scrolling containers is unreliable,
  // so we hide the shell elements via custom event rather than relying on z-index alone.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('poweron:blueprint-immersive', { detail: isTabletImmersiveFullscreen }))
    return () => { window.dispatchEvent(new CustomEvent('poweron:blueprint-immersive', { detail: false })) }
  }, [isTabletImmersiveFullscreen])

  // Escape key handler: closes UI state first, then exits fullscreen if no UI open.
  // This ensures Escape closes annotation editors, measurements, etc. before exiting fullscreen.
  // Fullscreen exit only happens when all annotation UI is closed.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      // Stop paste mode first (Fix 1, req 6) — before closing editors/fullscreen.
      // Keeps copiedAnnotationTemplate so the user can resume via Paste.
      if (pasteModeActive) {
        setPasteModeActive(false)
        return
      }
      if (inlineTextEditId) {
        cancelTextBoxEditSessionRef.current()
        return
      }
      const hasOpenState = !!(noteEditor || richTextEditor || draftRect || dragStart || inkDraft || focusedAnnotationId || layoutEditId || openPopover)
      if (hasOpenState) {
        // Annotation UI is open: close it first.
        setDraftRect(null)
        setDragStart(null)
        setInkDraft(null)
        setNoteEditor(null)
        setRichTextEditor(null)
        setFocusedAnnotationId(null)
        setLayoutEditId(null)
        setLayoutDrag(null)
      } else if (isTabletImmersiveFullscreen) {
        setIsTabletImmersiveFullscreen(false)
      } else if (isFullScreenView) {
        // No annotation UI open and in fullscreen: explicit exit.
        setIsFullScreenView(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isFullScreenView, isTabletImmersiveFullscreen, noteEditor, richTextEditor, draftRect, dragStart, inkDraft, focusedAnnotationId, layoutEditId, inlineTextEditId, openPopover, pasteModeActive])

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
    // Increment before queuing so the counter is accurate when mutations overlap.
    pendingAnnotationMutationsRef.current += 1
    const op = async () => {
      try {
        const backup = getBackupData()
        if (!backup) return
        await upsertOperationsBlueprintAnnotation(backup, annotation)
        onAnnotationsChanged?.()
      } catch (e: any) {
        setError(e?.message || 'Failed to save annotation.')
      } finally {
        pendingAnnotationMutationsRef.current = Math.max(0, pendingAnnotationMutationsRef.current - 1)
        // Only refresh annotations from backup once the entire queue has drained.
        // Calling loadAnnotations() after every individual save was overwriting the
        // optimistic setAllAnnotations updates that the UI had already applied, causing
        // the opacity/color to snap back to the pre-click value mid-sequence.
        if (pendingAnnotationMutationsRef.current === 0) {
          loadAnnotations()
        }
      }
    }
    mutationQueueRef.current = mutationQueueRef.current.then(op)
    return mutationQueueRef.current
  }, [loadAnnotations, onAnnotationsChanged])

  // ─── Copy / Paste for placed annotations & shapes (Fix 1) ─────────────────────
  // Builds a paste-ready template that preserves the full design (type, rect,
  // color, path and ALL meta — shapeKind, border/fill/hatch, line/arrow/arch
  // endpoints, text content, can-light lightIntensity) while dropping anything
  // that would corrupt a fresh row (id, createdAt, updatedAt, pageNumber).
  const cloneAnnotationForPaste = useCallback((source: BlueprintAnnotation) => {
    const meta = getAnnotationMeta(source)
    let clonedMeta: Record<string, any> = {}
    try { clonedMeta = JSON.parse(JSON.stringify(meta || {})) } catch { clonedMeta = { ...(meta || {}) } }
    return {
      type: source.type,
      rect: source.rect ? { ...source.rect } : undefined,
      path: Array.isArray(source.path) ? source.path.map((p: any) => ({ x: p.x, y: p.y })) : undefined,
      text: source.text,
      color: source.color || '#facc15',
      meta: clonedMeta,
    }
  }, [])

  const copyAnnotation = useCallback((source: BlueprintAnnotation) => {
    if (!source) return
    const tpl = cloneAnnotationForPaste(source)
    // lastRect tracks where the most recent copy/paste landed so toolbar-button
    // pastes cascade instead of stacking exactly on top of each other.
    setCopiedAnnotationTemplate({ ...tpl, lastRect: tpl.rect })
    // Activate paste mode immediately and force the Select tool so bare-page taps
    // start dropping copies right away (Fix 1). The select-mode guard below keeps
    // paste mode from being torn down by the tool-change watcher.
    setToolMode('select')
    setPasteModeActive(true)
  }, [cloneAnnotationForPaste])

  // Creates a brand-new annotation from the copied template, persists it via the
  // existing flow, and focuses it. targetX/targetY (page-normalized) center the
  // paste on a tapped point; omit them to drop a cascading offset copy.
  const pasteCopiedAnnotationAt = useCallback(async (targetX?: number, targetY?: number, opts?: { focus?: boolean }) => {
    const tpl = copiedAnnotationTemplate
    if (!tpl || !blueprint) return
    // Default to focusing the new copy, but repeated paste-mode taps pass focus:false
    // so the per-annotation action bar doesn't pop up and block the next tap target.
    const focusAfter = opts?.focus !== false
    const now = new Date().toISOString()
    const newId = `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

    const srcRect = tpl.rect || { x: 0.4, y: 0.4, w: 0.12, h: 0.12 }
    const w = clampNorm(srcRect.w || 0.05, 0.005, 1)
    const h = clampNorm(srcRect.h || 0.05, 0.005, 1)

    let desiredX: number
    let desiredY: number
    if (typeof targetX === 'number' && typeof targetY === 'number') {
      // Center the design on the tapped/clicked point.
      desiredX = targetX - w / 2
      desiredY = targetY - h / 2
    } else {
      // No drop point: offset from the last placement so repeated pastes cascade.
      desiredX = (tpl.lastRect?.x ?? srcRect.x) + PASTE_OFFSET_NORM
      desiredY = (tpl.lastRect?.y ?? srcRect.y) + PASTE_OFFSET_NORM
    }

    const clampedRect = clampRectToPage({ x: desiredX, y: desiredY, w, h })
    // Effective delta after clamping — applied to absolute-coordinate metadata so
    // pen/marker strokes and the arch control point follow the rect exactly.
    const dx = clampedRect.x - srcRect.x
    const dy = clampedRect.y - srcRect.y

    const nextMeta: Record<string, any> = { ...(tpl.meta || {}) }
    if (Array.isArray(nextMeta.points)) {
      // pen/marker freehand points are page-normalized — shift by the same delta.
      nextMeta.points = nextMeta.points.map((p: any) => ({
        x: clampNorm((Number(p?.x) || 0) + dx),
        y: clampNorm((Number(p?.y) || 0) + dy),
      }))
    }
    if (nextMeta.archCtrlX !== undefined && nextMeta.archCtrlY !== undefined) {
      // arch-line control point is stored as absolute page-normalized coords.
      nextMeta.archCtrlX = clampNorm(Number(nextMeta.archCtrlX) + dx)
      nextMeta.archCtrlY = clampNorm(Number(nextMeta.archCtrlY) + dy)
    }
    if (nextMeta.box && typeof nextMeta.box === 'object') {
      // callout/generate/textBox keep their visible box as absolute page coords.
      nextMeta.box = {
        ...nextMeta.box,
        x: clampNorm((Number(nextMeta.box.x) || 0) + dx),
        y: clampNorm((Number(nextMeta.box.y) || 0) + dy),
      }
    }
    if (nextMeta.anchor && typeof nextMeta.anchor === 'object') {
      // callout/note leader-line target — keep it attached to the same offset.
      nextMeta.anchor = {
        ...nextMeta.anchor,
        x: clampNorm((Number(nextMeta.anchor.x) || 0) + dx),
        y: clampNorm((Number(nextMeta.anchor.y) || 0) + dy),
      }
    }
    // line/arrow endpoints (lineX1..lineY2) are box-relative — preserved as-is so
    // the shape's direction/length stays identical.

    const nextPath = Array.isArray(tpl.path)
      ? tpl.path.map((p: any) => ({ x: clampNorm((Number(p?.x) || 0) + dx), y: clampNorm((Number(p?.y) || 0) + dy) }))
      : undefined

    const pasted = {
      id: newId,
      blueprintSetId: blueprint.id,
      projectId: blueprint.projectId,
      pageNumber: currentPage,
      type: tpl.type,
      rect: clampedRect,
      path: nextPath,
      text: tpl.text,
      color: tpl.color || '#facc15',
      meta: nextMeta,
      metadata: nextMeta,
      createdAt: now,
      updatedAt: now,
    } as BlueprintAnnotation

    // Immediate local render, then persist via the existing single annotation flow.
    setAllAnnotations((prev) => [...prev, pasted])
    setCopiedAnnotationTemplate((prev: any) => (prev ? { ...prev, lastRect: clampedRect } : prev))
    setOpenPopover(null)
    setLayoutEditId(null)
    if (focusAfter) {
      setToolMode('select')
      setFocusedAnnotationId(newId)
    }
    await persistAnnotation(pasted)
  }, [copiedAnnotationTemplate, blueprint, currentPage, persistAnnotation])

  // Choosing any drawing/annotation tool other than Select cancels paste mode so the
  // user can't keep dropping copies while trying to draw something else (Fix 1, req 7).
  useEffect(() => {
    if (pasteModeActive && toolMode !== 'select') setPasteModeActive(false)
  }, [toolMode, pasteModeActive])

  const clearTextBoxEditSessionState = useCallback(() => {
    draftTextBoxIdRef.current = null
    textBoxSnapshotRef.current = null
    inlineTextOriginalRef.current = ''
    setInlineTextEditId(null)
    setOpenPopover(null)
  }, [])

  const cancelTextBoxEditSession = useCallback(() => {
    const editingId = inlineTextEditId
    if (!editingId) return
    const isDraft = draftTextBoxIdRef.current === editingId
    if (isDraft) {
      setAllAnnotations((prev) => prev.filter((ann) => ann.id !== editingId))
      setFocusedAnnotationId(null)
    } else {
      const snap = textBoxSnapshotRef.current
      if (snap) {
        setAllAnnotations((prev) => prev.map((ann) => (ann.id === snap.id ? snap : ann)))
        setFocusedAnnotationId(snap.id)
      } else {
        setAllAnnotations((prev) => prev.map((ann) => (
          ann.id === editingId ? { ...ann, text: inlineTextOriginalRef.current } : ann
        )))
        setFocusedAnnotationId(editingId)
      }
    }
    clearTextBoxEditSessionState()
  }, [inlineTextEditId, clearTextBoxEditSessionState])

  const saveTextBoxEditSession = useCallback(async () => {
    if (!blueprint || !inlineTextEditId) return
    if (isSavingTextBoxRef.current) return
    isSavingTextBoxRef.current = true
    try {
      const editingId = inlineTextEditId
      const current = allAnnotationsRef.current.find((ann) => ann.id === editingId)
      if (!current || current.type !== 'textBox') {
        clearTextBoxEditSessionState()
        return
      }
      const now = new Date().toISOString()
      const meta = getAnnotationMeta(current)
      let rect = clampRectToPage(current.rect || meta.box || DEFAULT_TEXT_BOX)
      // Measure tight rect from anchor DOM element if available
      const overlayEl = overlayRef.current
      const anchorDomEl = (overlayEl?.querySelector(`[data-annotation-anchor-id="${editingId}"]`) as HTMLElement | null)
        || (overlayEl?.querySelector(`[data-annotation-id="${editingId}"]`) as HTMLElement | null)
      if (anchorDomEl && overlayEl) {
        const oRect = overlayEl.getBoundingClientRect()
        const aRect = anchorDomEl.getBoundingClientRect()
        if (aRect.width > 4 && aRect.height > 4 && oRect.width > 0 && oRect.height > 0) {
          rect = clampRectToPage({
            x: (aRect.left - oRect.left) / oRect.width,
            y: (aRect.top - oRect.top) / oRect.height,
            w: Math.max(aRect.width / oRect.width, 0.01),
            h: Math.max(aRect.height / oRect.height, 0.01),
          })
        }
      }
      const isDraft = draftTextBoxIdRef.current === editingId
      if (isDraft && !(current.text || '').trim()) {
        setAllAnnotations((prev) => prev.filter((ann) => ann.id !== editingId))
        setFocusedAnnotationId(null)
        clearTextBoxEditSessionState()
        return
      }
      const persistedId = isDraft
        ? `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
        : current.id
      const payload = withAnnotationMeta(
        {
          ...current,
          id: persistedId,
          rect,
          updatedAt: now,
        },
        {
          ...meta,
          box: rect,
          anchor: meta.anchor || { x: rect.x, y: rect.y },
        },
      ) as BlueprintAnnotation
      if (isDraft) {
        setAllAnnotations((prev) => prev.map((ann) => (ann.id === editingId ? payload : ann)))
      }
      setFocusedAnnotationId(persistedId)
      clearTextBoxEditSessionState()
      setToolMode('select')
      const fId = persistedId
      requestAnimationFrame(() => {
        const el = (overlayRef.current?.querySelector(`[data-annotation-anchor-id="${fId}"]`) as HTMLElement | null)
          || (overlayRef.current?.querySelector(`[data-annotation-id="${fId}"]`) as HTMLElement | null)
        if (el) {
          focusedAnnotationElRef.current = el
          const r = el.getBoundingClientRect()
          setFocusedAnnotationRect({ top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height })
        }
      })
      await persistAnnotation(payload)
    } finally {
      isSavingTextBoxRef.current = false
    }
  }, [blueprint, inlineTextEditId, clearTextBoxEditSessionState, persistAnnotation])

  useEffect(() => {
    cancelTextBoxEditSessionRef.current = cancelTextBoxEditSession
  }, [cancelTextBoxEditSession])

  // Ã¢â€â‚¬Ã¢â€â‚¬ Measurement pending commit processor Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  // Must live AFTER persistAnnotation is declared to avoid TDZ ReferenceError.
  useEffect(() => {
    if (!measurePendingCommit) return
    const { type, points, pageNumber } = measurePendingCommit
    setMeasurePendingCommit(null)
    if (!blueprint) return
    // Manual calibration takes precedence over auto-detected.
    const manualCal = savedCalibrations[pageNumber] ?? null
    const detRes = detectedScales[pageNumber] ?? null
    const autoCal: CalibrationData | null = (() => {
      if (!detRes || detRes.ambiguous || detRes.candidates.length !== 1) return null
      const c = detRes.candidates[0]
      return { pageNumber, normDistance: 1.0, realWorldValue: c.realWidthFeet, realWorldUnit: 'ft' as CalibrationUnit, savedAt: detRes.detectedAt }
    })()
    const calForPage = manualCal ?? autoCal
    const scaleForPage = calForPage
      ? calForPage.normDistance / Math.max(0.001, calForPage.realWorldValue)
      : null
    if (!calForPage || !scaleForPage) return
    const now = new Date().toISOString()
    const id = `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const color = toolColors[type as ToolKey] || '#38bdf8'
    let label = ''
    let meta: Record<string, any> = {}
    if (type === 'measure-distance' && points.length >= 2) {
      const normDist = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
      const realDist = normDist / scaleForPage
      label = `${realDist.toFixed(2)} ${calForPage.realWorldUnit}`
      meta = { points, label, normDistance: normDist, realWorldDistance: realDist, unit: calForPage.realWorldUnit, style: measurementStyle }
    } else if (type === 'measure-area' && points.length >= 3) {
      let normArea = 0
      for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length
        normArea += points[i].x * points[j].y - points[j].x * points[i].y
      }
      normArea = Math.abs(normArea) / 2
      const realArea = normArea / (scaleForPage * scaleForPage)
      label = `${realArea.toFixed(2)} ${calForPage.realWorldUnit}Ã‚Â²`
      meta = { points, label, normArea, realWorldArea: realArea, unit: calForPage.realWorldUnit, style: measurementStyle }
    } else if (type === 'measure-perimeter' && points.length >= 2) {
      let normPerim = 0
      for (let i = 1; i < points.length; i++) {
        normPerim += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
      }
      const realPerim = normPerim / scaleForPage
      label = `${realPerim.toFixed(2)} ${calForPage.realWorldUnit}`
      meta = { points, label, normPerimeter: normPerim, realWorldPerimeter: realPerim, unit: calForPage.realWorldUnit, style: measurementStyle }
    } else {
      return
    }
    const bounds = clampRectToPage(getPointsBounds(points))
    const ann = {
      id,
      blueprintSetId: blueprint.id,
      projectId: blueprint.projectId,
      pageNumber,
      type,
      rect: bounds,
      color,
      meta,
      metadata: meta,
      createdAt: now,
      updatedAt: now,
    } as BlueprintAnnotation
    void persistAnnotation(ann)
    setFocusedAnnotationId(ann.id)
    setToolMode('select')
  }, [measurePendingCommit, blueprint, persistAnnotation, savedCalibrations, detectedScales, toolColors, measurementStyle])

  // Ã¢â€â‚¬Ã¢â€â‚¬ Persist manual calibrations to localStorage Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  useEffect(() => {
    if (!blueprint?.id) return
    try { localStorage.setItem(`blueprint_calibrations_${blueprint.id}`, JSON.stringify(savedCalibrations)) } catch {}
  }, [savedCalibrations, blueprint?.id])

  // Ã¢â€â‚¬Ã¢â€â‚¬ Persist detected scales to localStorage Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  useEffect(() => {
    if (!blueprint?.id) return
    try { localStorage.setItem(`blueprint_detected_scales_${blueprint.id}`, JSON.stringify(detectedScales)) } catch {}
  }, [detectedScales, blueprint?.id])

  // Ã¢â€â‚¬Ã¢â€â‚¬ Rehydrate calibration and detection state when blueprint changes Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  useEffect(() => {
    if (!blueprint?.id) return
    scannedPagesRef.current = new Set()
    try {
      const cal = localStorage.getItem(`blueprint_calibrations_${blueprint.id}`)
      setSavedCalibrations(cal ? JSON.parse(cal) : {})
      const det = localStorage.getItem(`blueprint_detected_scales_${blueprint.id}`)
      setDetectedScales(det ? JSON.parse(det) : {})
    } catch {
      setSavedCalibrations({})
      setDetectedScales({})
    }
  }, [blueprint?.id])

  // Ã¢â€â‚¬Ã¢â€â‚¬ Auto-detect blueprint scale from PDF text content Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  // Runs once per page per blueprint session. Does not overwrite manual calibration.
  useEffect(() => {
    if (!pdfDoc || !currentPage) return
    if (scannedPagesRef.current.has(currentPage)) return
    scannedPagesRef.current.add(currentPage)
    void (async () => {
      try {
        const doc = getLoadedPdfDoc()
        if (!doc) return
        const safePageNumber = getSafePdfPageNumber(currentPage)
        const page = await doc.getPage(safePageNumber)
        const pageW: number = page.view?.[2] ?? 612
        const pageH: number = page.view?.[3] ?? 792
        const textContent = await page.getTextContent()
        const rawItems: any[] = textContent.items || []
        const strItems: string[] = rawItems.map((it: any) => it.str || '')
        const result = detectBlueprintScaleText(strItems, pageW, safePageNumber)
        if (result) setDetectedScales(prev => ({ ...prev, [safePageNumber]: result }))

        // Cache normalized text item positions for text-aware textHighlight quads.
        // PDF coordinate system: origin bottom-left, Y-axis UP → flip to screen space (Y down).
        const normItems = rawItems
          .filter((it: any) => it.str?.trim())
          .map((it: any) => {
            const tx: number = it.transform?.[4] ?? 0
            const ty: number = it.transform?.[5] ?? 0
            const iw: number = Math.abs(it.width ?? 0)
            // Font height: use the font size from the transform matrix (|transform[3]|) with a fallback
            const ih: number = Math.abs(it.transform?.[3] ?? 12)
            // PDF Y is the baseline; convert to top-left screen coords
            return {
              x: tx / Math.max(1, pageW),
              y: 1 - (ty + ih) / Math.max(1, pageH),
              w: iw / Math.max(1, pageW),
              h: ih / Math.max(1, pageH),
            }
          })
          .filter((it: any) => it.w > 0.001 && it.h > 0.001)
        textItemsCacheRef.current[safePageNumber] = normItems
        setTextItemsCache(prev => ({ ...prev, [safePageNumber]: normItems }))
      } catch {}
    })()
  }, [pdfDoc, currentPage, getLoadedPdfDoc, getSafePdfPageNumber])

  const removeAnnotation = useCallback(async (annotationId: string) => {
    if (!blueprint?.id) return
    // Guard loadAnnotations from re-surfacing this ID before storage commits the delete.
    locallyDeletedIdsRef.current.add(annotationId)
    setAllAnnotations((prev) => prev.filter((a) => a.id !== annotationId))
    setFocusedAnnotationId((prev) => (prev === annotationId ? null : prev))
    const bpId = blueprint.id
    const op = async () => {
      try {
        const backup = getBackupData()
        if (!backup) return
        await deleteOperationsBlueprintAnnotation(backup, bpId, annotationId)
        // Keep ID in locallyDeletedIdsRef so any concurrent loadAnnotations
        // triggered by onAnnotationsChanged cannot re-surface a deleted item.
        onAnnotationsChanged?.()
      } catch (e: any) {
        locallyDeletedIdsRef.current.delete(annotationId)
        setError(e?.message || 'Failed to delete annotation.')
        loadAnnotations()
      }
    }
    mutationQueueRef.current = mutationQueueRef.current.then(op)
  }, [blueprint?.id, loadAnnotations, onAnnotationsChanged])

  const handleAnnotationSelectCapture = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
  const target = e.target as Element | null
  const annEl = target?.closest?.('[data-annotation-id]') as HTMLElement | null
  const annotationId = annEl?.getAttribute('data-annotation-id')

  if (!annEl || !annotationId) return

  // If the user is already moving/resizing this annotation, let the edit handles work.
  if (layoutEditId === annotationId) return

  e.preventDefault()
  e.stopPropagation()

  if (effectiveTool === 'eraser') {
    void removeAnnotation(annotationId)
    return
  }

  focusedAnnotationElRef.current = annEl
  const r = annEl.getBoundingClientRect()

  setOpenPopover(null)
  setBarDragOffset(null)
  setFocusedAnnotationRect({
    top: r.top,
    left: r.left,
    right: r.right,
    bottom: r.bottom,
    width: r.width,
    height: r.height,
  })
  setFocusedAnnotationId(annotationId)
}, [effectiveTool, layoutEditId, removeAnnotation])

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
      setToolMode('select')
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
    if (annotation.type === 'textBox') return
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
    if (annotationType === 'textBox') {
      const draftId = `ann_draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      const now = new Date().toISOString()
      if (blueprint) {
        const draftAnn: BlueprintAnnotation = {
          id: draftId,
          blueprintSetId: blueprint.id,
          projectId: blueprint.projectId,
          pageNumber: currentPage,
          type: 'textBox',
          rect: safeRect,
          text: '',
          color: toolColors.textBox || '#111827',
          meta: { box: safeRect, anchor: anchor || { x: safeRect.x, y: safeRect.y }, textStyle: {} },
          metadata: {},
          createdAt: now,
          updatedAt: now,
        } as BlueprintAnnotation
        setAllAnnotations(prev => [...prev, draftAnn])
      }
      draftTextBoxIdRef.current = draftId
      textBoxSnapshotRef.current = null
      inlineTextOriginalRef.current = ''
      setInlineTextEditId(draftId)
      setFocusedAnnotationId(draftId)
      return
    }
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
  }, [toolColors, generateQuestionType, blueprint, currentPage])

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
      const annId = richTextEditor.annotationType === 'textBox' && richTextEditor.annotationId
        ? richTextEditor.annotationId
        : `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      const ann: BlueprintAnnotation = {
        id: annId,
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
      draftTextBoxIdRef.current = null
      setFocusedAnnotationId(ann.id)
      setToolMode('select')
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
    draftTextBoxIdRef.current = null
    textBoxSnapshotRef.current = null
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
      if (ann.type === 'textBox' || ann.type === 'highlight' || ann.type === 'textHighlight' || ann.type === 'underline' || ann.type === 'shape') {
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
    const drag = {
      annotationId: annotation.id,
      mode,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startBox: box,
    }
    // Write ref synchronously — the first pointermove fires before React batches setLayoutDrag
    layoutDragRef.current = drag
    setLayoutDrag(drag)
    // Capture to overlay so pointermove/up events keep routing even if pointer leaves the handle
    try { overlayRef.current?.setPointerCapture?.(e.pointerId) } catch { }
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId) } catch { }
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const startAnnotationEndpointDrag = useCallback((e: React.PointerEvent<HTMLElement>, annotation: BlueprintAnnotation, endpoint: 'start' | 'end') => {
    const meta = getAnnotationMeta(annotation)
    const rect = annotation.rect || { x: 0, y: 0, w: 0.1, h: 0.1 }
    const lx1 = meta.lineX1 ?? 0
    const ly1 = meta.lineY1 ?? 0
    const lx2 = meta.lineX2 ?? 1
    const ly2 = meta.lineY2 ?? 1
    const startAbsX = rect.x + lx1 * (rect.w || 0)
    const startAbsY = rect.y + ly1 * (rect.h || 0)
    const endAbsX = rect.x + lx2 * (rect.w || 0)
    const endAbsY = rect.y + ly2 * (rect.h || 0)
    const drag = {
      annotationId: annotation.id,
      endpoint,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startAbsX: endpoint === 'start' ? startAbsX : endAbsX,
      startAbsY: endpoint === 'start' ? startAbsY : endAbsY,
      otherAbsX: endpoint === 'start' ? endAbsX : startAbsX,
      otherAbsY: endpoint === 'start' ? endAbsY : startAbsY,
    }
    endpointDragRef.current = drag
    setEndpointDrag(drag)
    setFocusedAnnotationId(annotation.id)
    setLayoutEditId(annotation.id)
    try { overlayRef.current?.setPointerCapture(e.pointerId) } catch {}
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const startArchControlDrag = useCallback((e: React.PointerEvent<HTMLElement>, annotation: BlueprintAnnotation) => {
    const drag = { annotationId: annotation.id, pointerId: e.pointerId }
    archControlDragRef.current = drag
    setArchControlDrag(drag)
    setFocusedAnnotationId(annotation.id)
    setLayoutEditId(annotation.id)
    try { overlayRef.current?.setPointerCapture(e.pointerId) } catch {}
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleAnnotationLayoutPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    // Use the ref mirror to avoid stale-closure miss on the first pointermove after setLayoutDrag
    const drag = layoutDragRef.current || layoutDrag
    if (!drag || drag.pointerId !== e.pointerId || !overlayRef.current) return
    const rect = overlayRef.current.getBoundingClientRect()
    const dx = (e.clientX - drag.startClientX) / Math.max(1, rect.width)
    const dy = (e.clientY - drag.startClientY) / Math.max(1, rect.height)
    const start = drag.startBox
    const next = drag.mode === 'resize'
      ? { ...start, w: start.w + dx, h: start.h + dy }
      : { ...start, x: start.x + dx, y: start.y + dy }
    updateAnnotationLayout(drag.annotationId, next)
    e.preventDefault()
    e.stopPropagation()
  }, [layoutDrag, updateAnnotationLayout])

  const handleAnnotationLayoutPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const drag = layoutDragRef.current || layoutDrag
    if (!drag || drag.pointerId !== e.pointerId) return
    const id = drag.annotationId
    layoutDragRef.current = null
    setLayoutDrag(null)
    void commitAnnotationLayout(id)
    e.preventDefault()
    e.stopPropagation()
  }, [layoutDrag, commitAnnotationLayout])

  const handleOverlayClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Always prevent propagation and default to avoid any parent handlers interfering
    e.stopPropagation()
    e.preventDefault()
    
    // If suppression window is active (e.g., after a drag/pan), skip annotation creation
    if (Date.now() < suppressAnnotationUntilRef.current) return
    // Deselect any focused annotation on bare canvas click
    if (focusedAnnotationId) {
      setFocusedAnnotationId(null)
      setLayoutEditId(null)
      setOpenPopover(null)
    }
    if (!blueprint || isEditorOpen) return
    if (!overlayRef.current || !displaySize.w || !displaySize.h) return
    const rect = overlayRef.current.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const n = toNorm(px, py, rect.width, rect.height)

    // Paste-on-click (Fix 1): only while paste mode is active does a bare-page tap
    // drop a fresh copy at that point. This fires from the overlay click handler,
    // which annotation elements stopPropagation on — so tapping an existing item
    // selects it instead of pasting over it. focus:false keeps the repeated-paste
    // flow clean (no action bar popping up between placements).
    if (copiedAnnotationTemplate && pasteModeActive && effectiveTool === 'select') {
      void pasteCopiedAnnotationAt(n.x, n.y, { focus: false })
      return
    }

    if (effectiveTool === 'note') {
      openCreateNoteEditorAt(n.x, n.y)
      return
    }

    if (effectiveTool === 'textBox') {
      // Guard: isSavingTextBoxRef is true during the blur→save flow, so the click
      // that triggered the blur does not immediately open a new text box.
      if (isSavingTextBoxRef.current) return
      const bx = clampNorm(n.x, 0, 1 - DEFAULT_TEXT_BOX.w)
      const by = clampNorm(n.y, 0, 1 - DEFAULT_TEXT_BOX.h)
      openCreateRichTextEditor('textBox', { x: bx, y: by, w: DEFAULT_TEXT_BOX.w, h: DEFAULT_TEXT_BOX.h }, { x: n.x, y: n.y })
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
  }, [effectiveTool, isEditorOpen, blueprint, displaySize, openCreateNoteEditorAt, openCreateRichTextEditor, focusedAnnotationId, copiedAnnotationTemplate, pasteModeActive, pasteCopiedAnnotationAt])

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
      if (targetEl?.closest('button, textarea, input, select, a, [data-annotation-id]')) {
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
      e.stopPropagation()
      return
    }

    if (e.pointerType === 'touch') {
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
        e.stopPropagation()
        return
      }

      // One-finger pan only in Select/Pan mode, and only when the touch is NOT
      // on an annotation element (annotation taps must fire click → selectAnnotation).
      if (activeTouchPointersRef.current.size === 1 && effectiveTool === 'select' && !isEditorOpen && !lockView) {
        const touchTargetEl = e.target as HTMLElement | null
        if (!touchTargetEl?.closest('[data-annotation-id]')) {
          touchPanRef.current = {
            active: true,
            pointerId: e.pointerId,
            lastX: e.clientX,
            lastY: e.clientY,
            moved: false,
          }
          e.preventDefault()
          e.stopPropagation()
          return
        }
      }
    }
    if (Date.now() < suppressAnnotationUntilRef.current) return
    // Middle mouse button (button === 1) always pans regardless of active tool.
    if (e.pointerType === 'mouse' && e.button === 1 && !isEditorOpen && !lockView) {
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
      e.stopPropagation()
      return
    }
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

    if (effectiveTool === 'calibrate' || effectiveTool === 'measure-distance' || effectiveTool === 'measure-area' || effectiveTool === 'measure-perimeter') {
      const n = toNorm(x, y, rect.width, rect.height)
      // Double-click on perimeter Ã¢â€ â€™ complete
      if (effectiveTool === 'measure-perimeter') {
        const last = lastMeasureClickRef.current
        if (Date.now() - last.time < 300 && Math.hypot(n.x - last.nx, n.y - last.ny) < 0.03) {
          const pts = [...measureDraftRef.current]
          if (pts.length >= 2) {
            setMeasurePendingCommit({ type: 'measure-perimeter', points: pts, pageNumber: currentPageRef.current })
          }
          measureDraftRef.current = []
          setMeasureDraftPoints([])
          setMeasureCursorPx(null)
          lastMeasureClickRef.current = { time: 0, nx: 0, ny: 0 }
          e.preventDefault()
          return
        }
      }
      lastMeasureClickRef.current = { time: Date.now(), nx: n.x, ny: n.y }
      const next = [...measureDraftRef.current, n]
      measureDraftRef.current = next
      setMeasureDraftPoints([...next])
      if (effectiveTool === 'calibrate' && next.length === 2) {
        // Keep measureDraftPoints so the placed line stays visible while input is open
        setCalibrateInput({ p1: next[0], p2: next[1], value: '', unit: 'ft' })
        measureDraftRef.current = []
        lastMeasureClickRef.current = { time: 0, nx: 0, ny: 0 }
      } else if (effectiveTool === 'measure-distance' && next.length === 2) {
        setMeasurePendingCommit({ type: 'measure-distance', points: next, pageNumber: currentPageRef.current })
        measureDraftRef.current = []
        setMeasureDraftPoints([])
        setMeasureCursorPx(null)
        lastMeasureClickRef.current = { time: 0, nx: 0, ny: 0 }
      } else if (effectiveTool === 'measure-area' && next.length === 4) {
        setMeasurePendingCommit({ type: 'measure-area', points: next, pageNumber: currentPageRef.current })
        measureDraftRef.current = []
        setMeasureDraftPoints([])
        setMeasureCursorPx(null)
        lastMeasureClickRef.current = { time: 0, nx: 0, ny: 0 }
      }
      e.preventDefault()
      return
    }

    // Point-to-point line/arrow placement: first left-click sets start point.
    // Second click (handled in handlePointerUp) creates the annotation.
    // Middle mouse is already handled above and will never reach here.
    if (effectiveTool === 'shape' && (shapeKind === 'line' || shapeKind === 'arrow' || shapeKind === 'arch-line')) {
      if (!lineFirstPointRef.current) {
        lineFirstPointRef.current = { x, y }
        if (shapeKind === 'arch-line') {
          const archEl = draftArchPathDomRef.current
          if (archEl) { archEl.setAttribute('d', `M ${x} ${y} Q ${x} ${y} ${x} ${y}`); archEl.style.display = '' }
        } else {
          const lineEl = draftLineDomRef.current
          if (lineEl) {
            lineEl.setAttribute('x1', String(x)); lineEl.setAttribute('y1', String(y))
            lineEl.setAttribute('x2', String(x)); lineEl.setAttribute('y2', String(y))
            lineEl.style.display = ''
          }
        }
        e.preventDefault()
        return
      }
      // Second click: commit first point as dragStart so handlePointerUp creates the annotation.
      dragStartRef.current = lineFirstPointRef.current
      setDragStart(lineFirstPointRef.current)
      lineFirstPointRef.current = null
      try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId) } catch { }
      e.preventDefault()
      return
    }

    if (effectiveTool === 'highlight' || effectiveTool === 'textHighlight' || effectiveTool === 'underline' || effectiveTool === 'shape' || effectiveTool === 'callout' || effectiveTool === 'generate') {
      dragStartRef.current = { x, y }
      setDragStart({ x, y })
      if (draftRectDomRef.current) draftRectDomRef.current.style.display = 'none'
      if (draftLineDomRef.current && !lineFirstPointRef.current) draftLineDomRef.current.style.display = 'none'
      try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId) } catch { }
      e.preventDefault()
    }
  }, [effectiveTool, isEditorOpen, handleTwoFingerGesture, lockView, shapeKind])

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
        e.stopPropagation()
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
        e.stopPropagation()
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
          e.stopPropagation()
          return
        }
      }
    }
    const epDrag = endpointDragRef.current
    if (epDrag && epDrag.pointerId === e.pointerId && overlayRef.current) {
      const overlayRect = overlayRef.current.getBoundingClientRect()
      const dx = (e.clientX - epDrag.startClientX) / Math.max(1, overlayRect.width)
      const dy = (e.clientY - epDrag.startClientY) / Math.max(1, overlayRect.height)
      const newAbsX = Math.max(0, Math.min(1, epDrag.startAbsX + dx))
      const newAbsY = Math.max(0, Math.min(1, epDrag.startAbsY + dy))
      const x1 = epDrag.endpoint === 'start' ? newAbsX : epDrag.otherAbsX
      const y1 = epDrag.endpoint === 'start' ? newAbsY : epDrag.otherAbsY
      const x2 = epDrag.endpoint === 'end' ? newAbsX : epDrag.otherAbsX
      const y2 = epDrag.endpoint === 'end' ? newAbsY : epDrag.otherAbsY
      const nx = Math.min(x1, x2)
      const ny = Math.min(y1, y2)
      const nw = Math.max(0.002, Math.abs(x2 - x1))
      const nh = Math.max(0.002, Math.abs(y2 - y1))
      setAllAnnotations((prev) => prev.map((ann) => {
        if (ann.id !== epDrag.annotationId) return ann
        const m = getAnnotationMeta(ann)
        return withAnnotationMeta(
          { ...ann, rect: { x: nx, y: ny, w: nw, h: nh }, updatedAt: new Date().toISOString() },
          { ...m, lineX1: (x1 - nx) / nw, lineY1: (y1 - ny) / nh, lineX2: (x2 - nx) / nw, lineY2: (y2 - ny) / nh }
        ) as BlueprintAnnotation
      }))
      e.preventDefault()
      e.stopPropagation()
      return
    }

    const acDrag = archControlDragRef.current
    if (acDrag && acDrag.pointerId === e.pointerId && overlayRef.current) {
      const overlayRect = overlayRef.current.getBoundingClientRect()
      // Store the cursor position directly as a freeform 2D control point in page-normalized space.
      // No projection — the user has full X and Y freedom to set depth and angle simultaneously.
      const nhx = (e.clientX - overlayRect.left) / Math.max(1, overlayRect.width)
      const nhy = (e.clientY - overlayRect.top) / Math.max(1, overlayRect.height)
      setAllAnnotations((prev) => prev.map((ann) => {
        if (ann.id !== acDrag.annotationId) return ann
        const m = getAnnotationMeta(ann)
        return withAnnotationMeta({ ...ann, updatedAt: new Date().toISOString() }, { ...m, archCtrlX: nhx, archCtrlY: nhy }) as BlueprintAnnotation
      }))
      e.preventDefault()
      e.stopPropagation()
      return
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

    if (effectiveTool === 'calibrate' || effectiveTool === 'measure-distance' || effectiveTool === 'measure-area' || effectiveTool === 'measure-perimeter') {
      if (measureDraftRef.current.length > 0) {
        setMeasureCursorPx({ x, y })
      }
      return
    }

    // Update live-preview line while waiting for the second click in point-to-point mode.
    if (effectiveTool === 'shape' && (shapeKind === 'line' || shapeKind === 'arrow') && lineFirstPointRef.current) {
      const lineEl = draftLineDomRef.current
      if (lineEl) {
        lineEl.setAttribute('x2', String(x))
        lineEl.setAttribute('y2', String(y))
      }
      return
    }
    if (effectiveTool === 'shape' && shapeKind === 'arch-line' && lineFirstPointRef.current) {
      const archEl = draftArchPathDomRef.current
      const p1 = lineFirstPointRef.current
      if (archEl) {
        const cpx = (p1.x + x) / 2 + 0.5 * (y - p1.y)
        const cpy = (p1.y + y) / 2 - 0.5 * (x - p1.x)
        archEl.setAttribute('d', `M ${p1.x} ${p1.y} Q ${cpx} ${cpy} ${x} ${y}`)
        archEl.style.display = ''
      }
      return
    }

    const activeDragStart = dragStartRef.current || dragStart
    if (!(effectiveTool === 'highlight' || effectiveTool === 'textHighlight' || effectiveTool === 'underline' || effectiveTool === 'shape' || effectiveTool === 'eraser' || effectiveTool === 'callout' || effectiveTool === 'generate') || !activeDragStart) return

    const left = Math.min(activeDragStart.x, x)
    const top = Math.min(activeDragStart.y, y)
    const w = Math.abs(x - activeDragStart.x)
    const h = Math.abs(y - activeDragStart.y)

    // Direct DOM mutation Ã¢â‚¬â€ zero React re-renders during drag for smooth preview.
    const domEl = draftRectDomRef.current
    if (domEl) {
      domEl.style.display = 'block'
      domEl.style.left = `${left}px`
      domEl.style.top = `${top}px`
      domEl.style.width = `${w}px`
      domEl.style.height = `${h}px`
    }
    // For line/arrow shapes: update the SVG line preview element directly.
    const lineEl = draftLineDomRef.current
    if (lineEl) {
      const isLineKind = effectiveTool === 'shape' && (shapeKind === 'line' || shapeKind === 'arrow')
      if (isLineKind) {
        lineEl.setAttribute('x1', String(activeDragStart.x))
        lineEl.setAttribute('y1', String(activeDragStart.y))
        lineEl.setAttribute('x2', String(x))
        lineEl.setAttribute('y2', String(y))
        lineEl.style.display = ''
      } else {
        lineEl.style.display = 'none'
      }
    }
    // For arch-line: update the SVG path preview element directly.
    const archEl = draftArchPathDomRef.current
    if (archEl) {
      const isArchKind = effectiveTool === 'shape' && shapeKind === 'arch-line'
      if (isArchKind) {
        const cpx = (activeDragStart.x + x) / 2 + 0.5 * (y - activeDragStart.y)
        const cpy = (activeDragStart.y + y) / 2 - 0.5 * (x - activeDragStart.x)
        archEl.setAttribute('d', `M ${activeDragStart.x} ${activeDragStart.y} Q ${cpx} ${cpy} ${x} ${y}`)
        archEl.style.display = ''
      } else {
        archEl.style.display = 'none'
      }
    }
    // Keep dragStartRef in sync but do NOT call setDraftRect here Ã¢â‚¬â€
    // the DOM refs above give zero-lag visual feedback without any React re-renders.
    dragStartRef.current = activeDragStart
  }, [effectiveTool, dragStart, inkDraft, isEditorOpen, handleTwoFingerGesture, lockView, shapeKind])

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
      e.stopPropagation()
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
        e.preventDefault()
        e.stopPropagation()
        return
      }
      endTouchPointer(e.pointerId)
      if (pinchStateRef.current.active || Date.now() < suppressAnnotationUntilRef.current) {
        return
      }
    }
    const epDragUp = endpointDragRef.current
    if (epDragUp && epDragUp.pointerId === e.pointerId) {
      endpointDragRef.current = null
      setEndpointDrag(null)
      const ann = allAnnotationsRef.current.find((a) => a.id === epDragUp.annotationId)
      if (ann) void persistAnnotation({ ...ann, updatedAt: new Date().toISOString() })
      e.preventDefault()
      e.stopPropagation()
      return
    }

    const acDragUp = archControlDragRef.current
    if (acDragUp && acDragUp.pointerId === e.pointerId) {
      archControlDragRef.current = null
      setArchControlDrag(null)
      const ann = allAnnotationsRef.current.find((a) => a.id === acDragUp.annotationId)
      if (ann) void persistAnnotation({ ...ann, updatedAt: new Date().toISOString() })
      e.preventDefault()
      e.stopPropagation()
      return
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
      setToolMode('select')
      return
    }

    const activeDragStart = dragStartRef.current || dragStart

    if (effectiveTool === 'eraser' && activeDragStart) {
      const eraseNorm = normRectFromDrag(activeDragStart, { x, y }, rect.width, rect.height)
      dragStartRef.current = null
      setDragStart(null)
      setDraftRect(null)
      if (draftRectDomRef.current) draftRectDomRef.current.style.display = 'none'
      if (draftLineDomRef.current) draftLineDomRef.current.style.display = 'none'
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
      if (draftRectDomRef.current) draftRectDomRef.current.style.display = 'none'
      if (draftLineDomRef.current) draftLineDomRef.current.style.display = 'none'
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

    if (!(effectiveTool === 'highlight' || effectiveTool === 'textHighlight' || effectiveTool === 'underline' || effectiveTool === 'shape') || !activeDragStart) return

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
    // Hide DOM draft elements after commit
    if (draftRectDomRef.current) draftRectDomRef.current.style.display = 'none'
    if (draftLineDomRef.current) draftLineDomRef.current.style.display = 'none'

    if (effectiveTool === 'underline') {
      const minUnderlineWidth = 2 / Math.max(1, rect.width)
      if (norm.w < minUnderlineWidth) return
    } else if (effectiveTool === 'shape' && (shapeKind === 'line' || shapeKind === 'arrow' || shapeKind === 'arch-line')) {
      // Lines, arrows, and arch-lines can be nearly horizontal or vertical — only require total length.
      if (Math.hypot(norm.w, norm.h) < MIN_HIGHLIGHT_NORM) return
    } else if (norm.w < MIN_HIGHLIGHT_NORM || norm.h < MIN_HIGHLIGHT_NORM) return

    const now = new Date().toISOString()
    const type = effectiveTool === 'underline' ? 'underline' : effectiveTool === 'shape' ? 'shape' : effectiveTool === 'textHighlight' ? 'textHighlight' : 'highlight'

    // For line/arrow/arch-line shapes: store normalized start/end within the bounding box.
    const lineDirectionMeta = (effectiveTool === 'shape' && (shapeKind === 'line' || shapeKind === 'arrow' || shapeKind === 'arch-line'))
      ? (() => {
          const normStart = toNorm(activeDragStart.x, activeDragStart.y, rect.width, rect.height)
          const normEnd = toNorm(x, y, rect.width, rect.height)
          const bw = Math.max(rawNorm.w, 0.0001)
          const bh = Math.max(rawNorm.h, 0.0001)
          const base = {
            lineX1: (normStart.x - rawNorm.x) / bw,
            lineY1: (normStart.y - rawNorm.y) / bh,
            lineX2: (normEnd.x - rawNorm.x) / bw,
            lineY2: (normEnd.y - rawNorm.y) / bh,
          }
          if (shapeKind === 'arch-line') {
            // Compute default freeform control point from archFactor=0.5 on perpendicular bisector.
            // Store as absolute page-normalized coords so first drag just continues from the handle position.
            const defaultFactor = 0.5
            const abs1x = rawNorm.x + base.lineX1 * bw
            const abs1y = rawNorm.y + base.lineY1 * bh
            const abs2x = rawNorm.x + base.lineX2 * bw
            const abs2y = rawNorm.y + base.lineY2 * bh
            const amx = (abs1x + abs2x) / 2, amy = (abs1y + abs2y) / 2
            const archCtrlX = amx + defaultFactor * (abs2y - abs1y)
            const archCtrlY = amy + defaultFactor * (abs1x - abs2x)
            return { ...base, archFactor: defaultFactor, archCtrlX, archCtrlY }
          }
          return base
        })()
      : {}

    // For textHighlight: intersect cached PDF text items with the drag rect and store as relative quads
    const textHighlightItems = (effectiveTool === 'textHighlight')
      ? (textItemsCacheRef.current[currentPage] || []).filter((it) =>
          it.x < rawNorm.x + rawNorm.w &&
          it.x + it.w > rawNorm.x &&
          it.y < rawNorm.y + rawNorm.h &&
          it.y + it.h > rawNorm.y
        )
      : []
    const textHighlightQuads = textHighlightItems.length > 0
      ? textHighlightItems.map((it) => ({
          x: (it.x - rawNorm.x) / Math.max(rawNorm.w, 0.0001),
          y: (it.y - rawNorm.y) / Math.max(rawNorm.h, 0.0001),
          w: it.w / Math.max(rawNorm.w, 0.0001),
          h: it.h / Math.max(rawNorm.h, 0.0001),
        }))
      : null

    const meta = effectiveTool === 'shape'
      ? { shapeKind, ...shapeOptions, ...lineDirectionMeta }
      : effectiveTool === 'underline'
        ? { thickness: drawOptions.thickness, opacity: drawOptions.opacity }
        : effectiveTool === 'textHighlight'
          ? { opacity: 0.4, ...(textHighlightQuads ? { quads: textHighlightQuads } : {}) }
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
    if (effectiveTool === 'shape') {
      // Immediate local render — shape appears on release without waiting for Supabase
      setAllAnnotations((prev) => [...prev, ann])
      setFocusedAnnotationId(ann.id)
      setToolMode('select')
      void persistAnnotation(ann)
    } else {
      await persistAnnotation(ann)
      setFocusedAnnotationId(ann.id)
      setToolMode('select')
    }
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
    endpointDragRef.current = null
    setEndpointDrag(null)
    archControlDragRef.current = null
    setArchControlDrag(null)
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
      : ['note', 'highlight', 'underline', 'textBox', 'pen', 'marker', 'shape', 'callout', 'generate', 'calibrate', 'measure-distance', 'measure-area', 'measure-perimeter'].includes(effectiveTool)
        ? 'cursor-crosshair'
        : effectiveTool === 'eraser'
          ? 'cursor-not-allowed'
          : 'cursor-grab'

  const livePinchZoom = pinchPreviewZoom ?? relativeZoom
  const visualScale = Math.max(1, livePinchZoom / Math.max(0.001, clampRelativeZoom(relativeZoom)))
  const visualDisplayWidth = displaySize.w ? Math.ceil(displaySize.w * visualScale) : 0
  const visualDisplayHeight = displaySize.h ? Math.ceil(displaySize.h * visualScale) : 0
  const useDesktopThreePaneLayout = isDesktopBlueprintLayout
  const annotationPanelExpanded =
  useDesktopThreePaneLayout && !isFullScreenView && !isTabletImmersiveFullscreen
    ? true
    : tabletAnnotationsOpen

const annotationPanelSizeClass =
  (isFullScreenView || isTabletImmersiveFullscreen) && !useDesktopThreePaneLayout
    ? annotationPanelExpanded
      ? 'h-full max-h-none min-h-0'
      : 'h-10 max-h-10 min-h-0 overflow-hidden'
    : !useDesktopThreePaneLayout
      ? annotationPanelExpanded
        ? 'h-auto max-h-56 min-h-0'
        : 'h-10 max-h-10 min-h-0 overflow-hidden'
      : ''

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Annotation Ã¢â€ â€ tool-key mapping Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  function annotationTypeToToolKey(type: string): ToolKey | null {
    const map: Record<string, ToolKey> = {
      highlight: 'highlight', textHighlight: 'textHighlight', underline: 'underline', textBox: 'textBox',
      pen: 'pen', marker: 'marker', shape: 'shape', callout: 'callout',
      generate: 'generate',
      calibrate: 'calibrate',
      'measure-distance': 'measure-distance',
      'measure-area': 'measure-area',
      'measure-perimeter': 'measure-perimeter',
    }
    return map[type] ?? null
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Edit-mode helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  // ─── Focused annotation rect tracking ────────────────────────────────────────
  // Clear rect when nothing is selected
  useEffect(() => {
    if (!focusedAnnotationId) {
      focusedAnnotationElRef.current = null
      setFocusedAnnotationRect(null)
    }
  }, [focusedAnnotationId])

  useEffect(() => { setBarDragOffset(null) }, [focusedAnnotationId])

  // Refresh rect on scroll so the bar tracks the annotation as the page scrolls
  useEffect(() => {
    const scroll = scrollAreaRef.current
    if (!scroll) return
    const update = () => {
      const el = focusedAnnotationElRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setFocusedAnnotationRect({ top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height })
    }
    scroll.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update, { passive: true })
    return () => { scroll.removeEventListener('scroll', update); window.removeEventListener('resize', update) }
  }, [])

  // Refresh rect after annotations update (e.g., after a drag/move commits the new position)
  useEffect(() => {
    const el = focusedAnnotationElRef.current
    if (!el || !focusedAnnotationId) return
    const r = el.getBoundingClientRect()
    setFocusedAnnotationRect({ top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height })
  }, [allAnnotations, focusedAnnotationId])

  // Opens the ToolPopover anchored to an explicit element — used by the floating action bar
  const openStylePopoverForAnnotation = useCallback((annotation: BlueprintAnnotation, anchorEl: HTMLElement) => {
    const toolKey = annotationTypeToToolKey(annotation.type)
    if (!toolKey) return
    setFocusedAnnotationId(annotation.id)
    setOpenPopover({ tool: toolKey as ToolMode, anchorEl, mode: 'edit', editingAnnotationId: annotation.id })
  }, [])

  const editingAnnotation = openPopover?.editingAnnotationId
    ? (allAnnotations.find(a => a.id === openPopover.editingAnnotationId) ?? null)
    : null

  const persistEditAnnotation = (changes: Partial<BlueprintAnnotation>) => {
    if (!editingAnnotation) return
    void persistAnnotation({ ...editingAnnotation, ...changes, updatedAt: new Date().toISOString() })
  }

  const persistEditAnnotationMeta = (metaChanges: Record<string, any>) => {
    if (!editingAnnotation) return
    const editId = editingAnnotation.id
    // Use allAnnotationsRef.current so rapid stepper clicks (before React re-renders)
    // read the latest in-flight state rather than the stale closure value.
    const latest = allAnnotationsRef.current.find((ann) => ann.id === editId) ?? editingAnnotation
    const updated = withAnnotationMeta(
      { ...latest, updatedAt: new Date().toISOString() },
      { ...getAnnotationMeta(latest), ...metaChanges }
    )
    // Optimistic local update so stepper changes appear instantly without waiting for persist
    setAllAnnotations((prev) => prev.map((ann) => ann.id === editId ? updated as BlueprintAnnotation : ann))
    void persistAnnotation(updated)
  }

  // Live (non-persisting) meta update — used while dragging the Light Output slider
  // so the ring updates every frame; the value is committed once on pointer/key up.
  const updateEditingAnnotationMetaLocal = (metaChanges: Record<string, any>) => {
    if (!editingAnnotation) return
    const editId = editingAnnotation.id
    const latest = allAnnotationsRef.current.find((ann) => ann.id === editId) ?? editingAnnotation
    const updated = withAnnotationMeta(
      { ...latest, updatedAt: new Date().toISOString() },
      { ...getAnnotationMeta(latest), ...metaChanges }
    )
    setAllAnnotations((prev) => prev.map((ann) => ann.id === editId ? updated as BlueprintAnnotation : ann))
  }

  const updateEditingTextBoxLocally = (patch: Partial<BlueprintAnnotation> & { textStyle?: Record<string, any> }) => {
    if (!editingAnnotation || editingAnnotation.type !== 'textBox') return
    const currentMeta = getAnnotationMeta(editingAnnotation)
    const { textStyle: textStylePatch, ...annotationPatch } = patch
    const nextMeta = textStylePatch
      ? { ...currentMeta, textStyle: { ...(currentMeta.textStyle ?? {}), ...textStylePatch } }
      : currentMeta
    const nextAnnotation = withAnnotationMeta(
      { ...editingAnnotation, ...annotationPatch, updatedAt: new Date().toISOString() },
      nextMeta
    ) as BlueprintAnnotation
    setAllAnnotations((prev) => prev.map((ann) => (ann.id === editingAnnotation.id ? nextAnnotation : ann)))
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Per-tool popover content Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

    // Ã¢â€â‚¬Ã¢â€â‚¬ 1. HIGHLIGHTER Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

    // Ã¢â€â‚¬Ã¢â€â‚¬ 1b. TEXT HIGHLIGHTER Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    if (tool === 'textHighlight') {
      const TEXT_HIGHLIGHT_COLORS = ['#facc15', '#86efac', '#f9a8d4', '#93c5fd', '#fdba74', '#c4b5fd', '#67e8f9']
      const color = isEdit ? (editingAnnotation?.color ?? toolColors.textHighlight) : toolColors.textHighlight
      const opacity = isEdit ? Math.round((eMeta.opacity ?? 0.4) * 100) : 40
      return {
        title: 'Text Highlighter',
        primary: (
          <>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Color</div>
            <ColorRow value={color} colors={TEXT_HIGHLIGHT_COLORS} onChange={(c) => {
              if (isEdit) persistEditAnnotation({ color: c })
              else setToolColor('textHighlight', c)
            }} />
          </>
        ),
        additional: (
          <Stepper label="Opacity" value={opacity} min={10} max={100} step={5} unit="%"
            onChange={(v) => {
              if (isEdit) persistEditAnnotationMeta({ opacity: v / 100 })
            }} />
        ),
      }
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ 2. UNDERLINE Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

    // Ã¢â€â‚¬Ã¢â€â‚¬ 3. TEXT BOX Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    if (tool === 'textBox') {
      const tsMeta = isEdit ? (eMeta.textStyle ?? {}) : {}
      const ts = isEdit ? { ...textStyle, ...tsMeta } : textStyle
      const updateTs = (patch: Partial<typeof textStyle>) => {
        if (isEdit) {
          const currentStyle = editingAnnotation ? (getAnnotationMeta(editingAnnotation).textStyle ?? {}) : tsMeta
          updateEditingTextBoxLocally({ textStyle: { ...currentStyle, ...patch } })
          return
        }
        setTextStyle((p) => ({ ...p, ...patch }))
      }
      return {
        title: 'Insert Text',
        primary: (
          <>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Text Color</div>
            <ColorRow value={ts.color} onChange={(c) => updateTs({ color: c })} />
            <LabeledSelect label="Font" value={ts.fontFamily ?? 'Helvetica'} options={FONT_FAMILIES}
              onChange={(v) => updateTs({ fontFamily: v })} />
            <Stepper label="Size" value={ts.fontSize ?? 14} min={6} max={144} step={0.5} unit="pt"
              onChange={(v) => updateTs({ fontSize: v })} />
            <ToggleRow buttons={[
              { label: <Bold size={11} />, active: !!(ts.bold), onClick: () => updateTs({ bold: !ts.bold }) },
              { label: <Italic size={11} />, active: !!(ts.italic), onClick: () => updateTs({ italic: !ts.italic }) },
              { label: <Underline size={11} />, active: !!(ts.underline), onClick: () => updateTs({ underline: !ts.underline }) },
            ]} />
          </>
        ),
      }
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ 4. PEN Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

    // Ã¢â€â‚¬Ã¢â€â‚¬ 5. MARKER Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

    // Ã¢â€â‚¬Ã¢â€â‚¬ 6. ERASER Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    if (tool === 'eraser') {
      return {
        title: 'Eraser',
        primary: (
          <Stepper label="Size" value={eraserSize} min={4} max={80} step={1} unit="px"
            onChange={setEraserSize} />
        ),
      }
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ 7. SHAPE Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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
            {isEdit && (currentKind === 'can-light-4' || currentKind === 'can-light-6') && (
              <div style={{ marginBottom: 2 }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Light Output</div>
                {/* LIGHT_OUTPUT_MIN..LIGHT_OUTPUT_MAX scale (0.25..20): base 1 = normal,
                    20 ≈ 20× the fixture spread. Drives lightIntensity directly (no lumen
                    numbers). Legacy values clamp into range so old can lights still render. */}
                <input
                  type="range"
                  min={LIGHT_OUTPUT_MIN}
                  max={LIGHT_OUTPUT_MAX}
                  step={0.05}
                  value={clampNorm(eMeta.lightIntensity ?? LIGHT_OUTPUT_BASE, LIGHT_OUTPUT_MIN, LIGHT_OUTPUT_MAX)}
                  onChange={(e) => updateEditingAnnotationMetaLocal({ lightIntensity: Number(e.target.value) })}
                  onPointerUp={(e) => persistEditAnnotationMeta({ lightIntensity: Number((e.target as HTMLInputElement).value) })}
                  onKeyUp={(e) => persistEditAnnotationMeta({ lightIntensity: Number((e.target as HTMLInputElement).value) })}
                  style={{ width: '100%', accentColor: '#f97316', cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                  <span>Lower</span><span>Higher</span>
                </div>
              </div>
            )}
            {isEdit && (currentKind === 'can-light-4' || currentKind === 'can-light-6') && (
              <div style={{ marginBottom: 4 }}>
                {/* Color temperature (Kelvin) — tints the output overlay only; size/intensity
                    stays on Light Output. Discrete options persist + update the overlay live.
                    No lumen numbers. Default 3000K when unset (Fix 2). */}
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Color Temperature</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {CAN_LIGHT_KELVIN_OPTIONS.map((k) => {
                    const selected = Number(eMeta.lightKelvin ?? DEFAULT_CAN_LIGHT_KELVIN) === k
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => persistEditAnnotationMeta({ lightKelvin: k })}
                        title={`${k}K color temperature`}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                          border: selected ? '1px solid rgba(96,165,250,0.9)' : '1px solid rgba(255,255,255,0.12)',
                          background: selected ? 'rgba(59,130,246,0.18)' : 'rgba(255,255,255,0.05)',
                          color: selected ? 'rgba(191,219,254,1)' : 'rgba(255,255,255,0.8)',
                          fontSize: 11,
                        }}
                      >
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: getLightKelvinColor(k), border: '1px solid rgba(0,0,0,0.35)', flexShrink: 0 }} />
                        {k}K
                      </button>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                  <span>Warm</span><span>Neutral</span><span>Cool</span>
                </div>
              </div>
            )}
            <LabeledSelect label="Shape" value={currentKind}
              options={[
                { label: 'Square', value: 'square' },
                { label: 'Circle', value: 'circle' },
                { label: 'Line', value: 'line' },
                { label: 'Arrow', value: 'arrow' },
                { label: 'Arch Line', value: 'arch-line' },
                { label: 'Diamond', value: 'diamond' },
                { label: 'Star', value: 'star' },
                { label: 'Cross', value: 'cross' },
                { label: 'Pentagon', value: 'pentagon' },
                { label: 'Can Light 4"', value: 'can-light-4' },
                { label: 'Can Light 6"', value: 'can-light-6' },
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

    // Ã¢â€â‚¬Ã¢â€â‚¬ 8. CALLOUT Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

    // Ã¢â€â‚¬Ã¢â€â‚¬ 9. GENERATE Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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
      className={isFullScreenView && isDesktopBlueprintLayout
        ? 'fixed inset-0 z-[9999] bg-[#0d0e14] flex flex-col overflow-hidden'
        : isFullScreenView || isTabletImmersiveFullscreen
        ? 'fixed inset-0 z-[9999] bg-[#0d0e14] flex flex-col overflow-hidden'
        : 'rounded-xl border overflow-hidden w-full'
      }
      style={isFullScreenView || isTabletImmersiveFullscreen ? {} : { borderColor: '#1e2128', backgroundColor: '#0d0e14' }}
      onClick={(e) => {
        // In fullscreen mode, prevent any clicks that haven't been explicitly handled
        // from reaching the OS-level fullscreen backdrop, which would exit fullscreen.
        // This is critical for iPad and other touch devices where the fullscreen
        // behavior can be triggered by unintended click propagation.
        if ((isFullScreenView || isTabletImmersiveFullscreen) && e.target === e.currentTarget) {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
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
        .bv-tool-bucket > button {
          width: auto !important;
          flex-shrink: 0 !important;
          white-space: nowrap;
        }
      `}</style>

      {!isFullScreenView && !isTabletImmersiveFullscreen && !useDesktopThreePaneLayout && (
        <div className="px-3 py-1.5 border-b border-gray-800 bg-[#0d0e14] flex-shrink-0 flex items-center gap-2 overflow-x-auto">
          {/* Enter fullscreen */}
          <button
            onClick={() => {
              handleFullscreenToggle(
                false,
                isTabletDevice(),
                viewerRootRef.current,
                setIsFullScreenView,
                setIsTabletImmersiveFullscreen,
              )
            }}
            className="shrink-0 inline-flex items-center justify-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-700 text-gray-300 hover:text-white"
            title="Enter fullscreen"
          >
            <Maximize2 size={14} />
          </button>
          {/* Page Navigation */}
          <div className="shrink-0 inline-flex items-center gap-1 bg-gray-900/40 rounded-md border border-gray-700/50 px-1.5 py-0.5">
            <button
              disabled={!canRender || currentPage <= 1 || isRendering}
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              className="inline-flex items-center justify-center text-xs px-1 py-1 rounded-md border border-transparent text-gray-300 hover:border-gray-600 hover:text-white disabled:opacity-40 transition-colors"
              title="Previous page"
            >
              <ChevronLeft size={12} />
            </button>
            <input
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') jumpToPage() }}
              className="w-8 rounded-sm border border-gray-600 bg-gray-900/60 text-gray-100 text-xs px-1 py-0.5 text-center font-medium"
              placeholder="1"
              title="Page number"
            />
            <span className="text-xs text-gray-500 px-0.5">/{numPages || 1}</span>
            <button
              disabled={!canRender || currentPage >= numPages || isRendering}
              onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
              className="inline-flex items-center justify-center text-xs px-1 py-1 rounded-md border border-transparent text-gray-300 hover:border-gray-600 hover:text-white disabled:opacity-40 transition-colors"
              title="Next page"
            >
              <ChevronRight size={12} />
            </button>
          </div>
          {/* Zoom */}
          <div className="shrink-0 inline-flex items-center gap-1 bg-gray-900/40 rounded-md border border-gray-700/50 px-1.5 py-0.5">
            <button
              disabled={!canRender || relativeZoom <= MIN_RELATIVE_ZOOM}
              onClick={() => applyRelativeZoomDelta(-0.1)}
              className="inline-flex items-center justify-center text-xs px-1 py-1 rounded-md border border-transparent text-gray-300 hover:border-gray-600 hover:text-white disabled:opacity-40 transition-colors"
              title="Zoom out"
            >
              <ZoomOut size={12} />
            </button>
            <span className="text-xs text-gray-400 w-7 text-center font-medium">{Math.round(clampRelativeZoom(relativeZoom) * 100)}%</span>
            <button
              disabled={!canRender || relativeZoom >= maxRelativeZoom}
              onClick={() => applyRelativeZoomDelta(0.1)}
              className="inline-flex items-center justify-center text-xs px-1 py-1 rounded-md border border-transparent text-gray-300 hover:border-gray-600 hover:text-white disabled:opacity-40 transition-colors"
              title="Zoom in"
            >
              <ZoomIn size={12} />
            </button>
          </div>
          {/* Fit + Lock */}
          <div className="shrink-0 inline-flex items-center gap-1">
            <button
              disabled={!canRender}
              onClick={() => { pendingScrollResetRef.current = true; setRelativeZoom(1) }}
              className="inline-flex items-center justify-center text-xs px-1.5 py-1 rounded-md border border-blue-500/60 text-blue-300 bg-blue-900/20 hover:border-blue-500 hover:bg-blue-900/30 disabled:opacity-40 transition-colors"
              title="Fit page to view"
            >
              <ArrowUpRight size={12} />
            </button>
            <button
              disabled={!canRender}
              onClick={() => setLockView((v) => !v)}
              className={`inline-flex items-center justify-center text-xs px-1.5 py-1 rounded-md border transition-colors ${lockView ? 'border-blue-500/60 text-blue-300 bg-blue-900/20 hover:border-blue-500 hover:bg-blue-900/30' : 'border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white'} disabled:opacity-40`}
              title={lockView ? 'Unlock view' : 'Lock view'}
            >
              {lockView ? <Lock size={12} /> : <Unlock size={12} />}
            </button>
          </div>
          {/* Title strip */}
          <div className="min-w-0 flex-1 ml-1 flex items-center gap-2">
            <p className="text-xs text-gray-300 font-semibold truncate">{blueprint.title}</p>
            <button
              onClick={() => void loadPdf()}
              className="shrink-0 inline-flex items-center justify-center text-xs px-1 py-1 rounded-sm border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600"
              title="Refresh PDF link"
            >
              <RefreshCw size={11} />
            </button>
          </div>
        </div>
      )}

      {!hasStoragePath ? (
        <div className="p-6 text-sm text-amber-300 bg-amber-900/10 border-t border-amber-800/30">
          This blueprint is missing `storagePath`, so the PDF cannot be opened yet.
        </div>
      ) : (
        <>
          {isFullScreenView && isDesktopBlueprintLayout && (
            <div className="px-4 py-2 border-b border-gray-800 flex items-center justify-between gap-3 bg-[#0d0e14] flex-shrink-0">
              <div className="min-w-0 flex items-center gap-3">
                <p className="text-sm text-gray-100 font-semibold truncate">{blueprint.title}</p>
                <p className="text-xs text-gray-500 truncate hidden xl:block">{blueprint.projectName} Ã¢â‚¬Â¢ {blueprint.fileName}</p>
              </div>
              <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                <button
                  onClick={() => void loadPdf()}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-700 text-gray-300 hover:text-white flex-shrink-0"
                  title="Refresh PDF link"
                >
                  <RefreshCw size={12} />
                  <span className="hidden sm:inline">Link</span>
                </button>
                {/* Explicit fullscreen toggle button.
                    Entering: requests OS fullscreen API + sets UI state.
                    Exiting: calls exitFullscreen API + sets UI state to false.
                    This is the ONLY app-side fullscreen exit control (besides Escape key).
                */}
                <button
                  onClick={() => {
                    const isInAnyFullscreen = isFullScreenView || isTabletImmersiveFullscreen
                    handleFullscreenToggle(
                      isInAnyFullscreen,
                      isTabletDevice(),
                      viewerRootRef.current,
                      setIsFullScreenView,
                      setIsTabletImmersiveFullscreen,
                    )
                  }}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-gray-700 text-gray-300 hover:text-white flex-shrink-0 font-medium"
                  title={isFullScreenView || isTabletImmersiveFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                >
                  {isFullScreenView ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  {isFullScreenView ? 'Exit Full Screen' : 'Full Screen'}
                </button>
              </div>
            </div>
          )}

          {isTabletImmersiveFullscreen && !isDesktopBlueprintLayout && (
            <>
            {/* Row 1: exit - title - page nav - zoom - fit - lock */}
            <div className="px-3 py-2 border-b border-gray-800 bg-[#0d0e14] flex-shrink-0 flex items-center gap-2">
              {/* Exit fullscreen */}
              <button
                onClick={() => {
                  const isInAnyFullscreen = isFullScreenView || isTabletImmersiveFullscreen
                  handleFullscreenToggle(
                    isInAnyFullscreen,
                    isTabletDevice(),
                    viewerRootRef.current,
                    setIsFullScreenView,
                    setIsTabletImmersiveFullscreen,
                  )
                }}
                className="shrink-0 inline-flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded-md border border-gray-700 text-gray-300 hover:text-white"
                title="Exit fullscreen"
              >
                <Minimize2 size={14} />
              </button>

              {/* Title */}
              <div className="min-w-0 flex-1 flex items-center gap-1.5">
                <p className="text-xs text-gray-200 font-semibold truncate">{blueprint.title}</p>
                <button
                  onClick={() => void loadPdf()}
                  className="shrink-0 inline-flex items-center justify-center text-xs p-1 rounded border border-gray-700/60 text-gray-500 hover:text-gray-300"
                  title="Refresh PDF link"
                >
                  <RefreshCw size={10} />
                </button>
              </div>

              {/* Page Navigation */}
              <div className="shrink-0 inline-flex items-center gap-0.5 bg-gray-900/50 rounded-md border border-gray-700/60 px-1 py-0.5">
                <button
                  disabled={!canRender || currentPage <= 1 || isRendering}
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  className="inline-flex items-center justify-center px-2 py-1.5 rounded text-gray-300 hover:text-white disabled:opacity-40 transition-colors"
                  title="Previous page"
                >
                  <ChevronLeft size={14} />
                </button>
                <input
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') jumpToPage() }}
                  className="w-8 rounded border border-gray-600 bg-gray-900/60 text-gray-100 text-xs px-1 py-0.5 text-center font-medium"
                  placeholder="1"
                  title="Page number"
                />
                <span className="text-xs text-gray-500 px-0.5">/{numPages || 1}</span>
                <button
                  disabled={!canRender || currentPage >= numPages || isRendering}
                  onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
                  className="inline-flex items-center justify-center px-2 py-1.5 rounded text-gray-300 hover:text-white disabled:opacity-40 transition-colors"
                  title="Next page"
                >
                  <ChevronRight size={14} />
                </button>
              </div>

              {/* Zoom */}
              <div className="shrink-0 inline-flex items-center gap-0.5 bg-gray-900/50 rounded-md border border-gray-700/60 px-1 py-0.5">
                <button
                  disabled={!canRender || relativeZoom <= MIN_RELATIVE_ZOOM}
                  onClick={() => applyRelativeZoomDelta(-0.1)}
                  className="inline-flex items-center justify-center px-2 py-1.5 rounded text-gray-300 hover:text-white disabled:opacity-40 transition-colors"
                  title="Zoom out"
                >
                  <ZoomOut size={14} />
                </button>
                <span className="text-xs text-gray-400 w-9 text-center font-medium tabular-nums">{Math.round(clampRelativeZoom(relativeZoom) * 100)}%</span>
                <button
                  disabled={!canRender || relativeZoom >= maxRelativeZoom}
                  onClick={() => applyRelativeZoomDelta(0.1)}
                  className="inline-flex items-center justify-center px-2 py-1.5 rounded text-gray-300 hover:text-white disabled:opacity-40 transition-colors"
                  title="Zoom in"
                >
                  <ZoomIn size={14} />
                </button>
              </div>

              {/* Fit + Lock */}
              <div className="shrink-0 flex items-center gap-1">
                <button
                  disabled={!canRender}
                  onClick={() => { pendingScrollResetRef.current = true; setRelativeZoom(1) }}
                  className="inline-flex items-center justify-center px-2 py-1.5 rounded-md border border-blue-500/60 text-blue-300 bg-blue-900/20 hover:bg-blue-900/40 disabled:opacity-40 transition-colors"
                  title="Fit page to view"
                >
                  <ArrowUpRight size={14} />
                </button>
                <button
                  disabled={!canRender}
                  onClick={() => setLockView((v) => !v)}
                  className={`inline-flex items-center justify-center px-2 py-1.5 rounded-md border transition-colors ${lockView ? 'border-blue-500/60 text-blue-300 bg-blue-900/20 hover:bg-blue-900/40' : 'border-gray-700 text-gray-300 hover:text-white'} disabled:opacity-40`}
                  title={lockView ? 'Unlock view' : 'Lock view'}
                >
                  {lockView ? <Lock size={14} /> : <Unlock size={14} />}
                </button>
              </div>
            </div>

            {/* -- Row 2: centered bucket tabs -- */}
            <div className="px-3 py-1.5 border-b border-gray-700/40 bg-[#0d0e14] flex-shrink-0 flex items-center justify-center gap-1 overflow-x-auto">
              {([
                ['annotate', 'Annotate', Layers],
                ['draw', 'Draw / Mark', PenLine],
                ['generate', 'Generate', Sparkles],
                ['view', 'View', MousePointer2],
                ['measure', 'Measure', Ruler],
              ] as Array<[ToolbarBucket, string, any]>).map(([bucket, label, Icon]) => (
                <button
                  key={bucket}
                  onClick={() => setToolbarBucket(bucket)}
                  className={`shrink-0 flex items-center gap-1.5 h-8 text-xs px-3 rounded-md border transition-colors ${
                    toolbarBucket === bucket
                      ? bucket === 'measure'
                        ? 'border-sky-500 text-sky-300 bg-sky-900/25'
                        : 'border-blue-500 text-blue-300 bg-blue-900/25'
                      : 'border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600'
                  }`}
                  title={label}
                >
                  <Icon size={12} className="shrink-0" />
                  <span className="whitespace-nowrap font-medium">{label}</span>
                  {bucket === 'measure' && calibrationStatus !== 'none' && (
                    <span className={`ml-0.5 w-1.5 h-1.5 rounded-full ${calibrationStatus === 'saved' ? 'bg-green-500' : 'bg-amber-500'}`} />
                  )}
                </button>
              ))}
            </div>
            </>
          )}

          <div
            className={useDesktopThreePaneLayout ? `grid grid-rows-[auto_auto_minmax(0,1fr)] p-4${draggingDivider ? ' select-none' : ''}` : isTabletImmersiveFullscreen ? 'flex-1 flex flex-col min-h-0' : ''}
            style={useDesktopThreePaneLayout ? {
              gridTemplateColumns: `${leftPaneWidth}px 6px 1fr 6px ${rightPaneWidth}px`,
              columnGap: 0,
              rowGap: 16,
              minHeight: isFullScreenView && isDesktopBlueprintLayout ? 'calc(100vh - 52px)' : isTabletImmersiveFullscreen ? 'calc(100vh - 40px)' : normalBlueprintViewerMinHeight,
              height: isFullScreenView && isDesktopBlueprintLayout ? 'calc(100vh - 52px)' : isTabletImmersiveFullscreen ? 'calc(100vh - 40px)' : 'auto',
            } : undefined}
          >
            {useDesktopThreePaneLayout && (
              <div className="col-start-1 row-start-2 self-start rounded-xl border border-gray-800 bg-[#10131c] p-4 space-y-3">
                {/* Document Title & Info */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-100 truncate">{blueprint.title}</p>
                    <div className="mt-1 space-y-0.5">
                      <p className="text-xs text-gray-500 truncate">{blueprint.projectName}</p>
                      <p className="text-xs text-gray-600 truncate" title={blueprint.fileName}>{blueprint.fileName}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => void loadPdf()}
                    className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-md border border-gray-700 px-2.5 py-1.5 text-xs text-gray-300 hover:text-white hover:border-gray-600 transition-colors"
                    title="Refresh PDF link"
                  >
                    <RefreshCw size={13} />
                  </button>
                </div>

                {/* Page & Annotation Info */}
                <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-700/50 bg-gray-900/40 px-3 py-2">
                  <span className="text-xs text-gray-400">Page</span>
                  <span className="text-sm font-semibold text-gray-200">{pageLabel}</span>
                </div>

                {/* Annotation Count & URL Status */}
                {!!signedUrl && (
                  <div className="text-xs text-gray-500 space-y-1">
                    <p>{pageAnnotations.length} annotation{pageAnnotations.length !== 1 ? 's' : ''} on this page</p>
                    <p className="text-gray-600">Link active for session</p>
                  </div>
                )}
              </div>
            )}

          {/* Ã¢â€â‚¬Ã¢â€â‚¬ Divider 1: drag handle between left panel and center pane Ã¢â€â‚¬Ã¢â€â‚¬ */}
          {useDesktopThreePaneLayout && (
            <div
              className="col-start-2 row-start-1 row-span-3 flex items-center justify-center cursor-col-resize group z-10"
              onMouseDown={(e) => {
                e.preventDefault()
                dragStartXRef.current = e.clientX
                dragStartWidthRef.current = leftPaneWidth
                setDraggingDivider('left')
              }}
            >
              <div className="w-[3px] h-full rounded-full bg-gray-800 group-hover:bg-blue-500/60 transition-colors duration-150" />
            </div>
          )}

          {/* Ã¢â€â‚¬Ã¢â€â‚¬ Toolbar: 5 bucket selectors + tool buttons (popovers handle options) Ã¢â€â‚¬Ã¢â€â‚¬ */}
          <div
            ref={toolbarAreaRef}
            className={useDesktopThreePaneLayout
              ? 'col-start-1 row-start-3 self-start rounded-xl border border-gray-800 bg-[#10131c] p-4 space-y-2'
              : 'px-3 sm:px-4 py-1 border-b border-gray-800 space-y-1 flex-shrink-0'}
          >
            {/* â"€â"€â"€â"€ Tablet: Compact single-row segmented bucket selector â"€â"€â"€â"€ */}
            {!useDesktopThreePaneLayout && !isTabletImmersiveFullscreen && (
              <div className="flex gap-0.5 items-stretch overflow-x-auto">
                {([
                  ['annotate', 'Annotate', Layers],
                  ['draw', 'Draw / Mark', PenLine],
                  ['generate', 'Generate', Sparkles],
                  ['view', 'View', MousePointer2],
                  ['measure', 'Measure', Ruler],
                ] as Array<[ToolbarBucket, string, any]>).map(([bucket, label, Icon]) => (
                  <button
                    key={bucket}
                    onClick={() => setToolbarBucket(bucket)}
                    className={`shrink-0 flex items-center gap-1 h-7 text-xs px-2.5 rounded-md border transition-colors ${
                      toolbarBucket === bucket
                        ? bucket === 'measure'
                          ? 'border-sky-500 text-sky-300 bg-sky-900/25'
                          : 'border-blue-500 text-blue-300 bg-blue-900/25'
                        : 'border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600'
                    }`}
                    title={label}
                  >
                    <Icon size={11} className="shrink-0" />
                    <span className="whitespace-nowrap">{label}</span>
                    {bucket === 'measure' && calibrationStatus !== 'none' && (
                      <span className={`ml-0.5 w-1.5 h-1.5 rounded-full ${calibrationStatus === 'saved' ? 'bg-green-500' : 'bg-amber-500'}`} />
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* â"€â"€â"€â"€ Desktop: 2Ã—2 grid + full-width Measure row â"€â"€â"€â"€ */}
            {useDesktopThreePaneLayout && (
              <>
                <div className="grid grid-cols-2 gap-1.5">
                  {([
                    ['annotate', 'Annotate'],
                    ['draw', 'Draw / Mark'],
                    ['generate', 'Generate'],
                    ['view', 'View'],
                  ] as Array<[ToolbarBucket, string]>).map(([bucket, label]) => (
                    <button
                      key={bucket}
                      onClick={() => setToolbarBucket(bucket)}
                      className={`w-full inline-flex items-center justify-center gap-1 h-8 text-xs rounded-md border truncate px-2 ${toolbarBucket === bucket ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                    >
                      {bucket === 'annotate' && <Layers size={12} />}
                      {bucket === 'draw' && <PenLine size={12} />}
                      {bucket === 'generate' && <Sparkles size={12} />}
                      {bucket === 'view' && <MousePointer2 size={12} />}
                      {label}
                    </button>
                  ))}
                  <button
                    onClick={() => setToolbarBucket('measure')}
                    className={`col-span-2 w-full inline-flex items-center justify-center gap-1.5 h-8 text-xs rounded-md border px-2 ${toolbarBucket === 'measure' ? 'border-sky-500 text-sky-300 bg-sky-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                  >
                    <Ruler size={12} /> Measure
                    {calibrationStatus !== 'none' && (
                      <span className={`ml-1 text-[10px] px-1.5 py-0 rounded-full border ${calibrationStatus === 'saved' ? 'border-green-600 text-green-400' : 'border-amber-600 text-amber-400'}`}>
                        {calibrationStatus === 'saved' ? 'calibrated' : 'pending'}
                      </span>
                    )}
                  </button>
                </div>
                <div className="text-[11px] text-gray-500">
                  Active: <span className="text-gray-300">{annotationLabel({ type: toolMode } as BlueprintAnnotation)}</span>{isEditorOpen ? ' (editing)' : ''}
                </div>
              </>
            )}



            {/* Ã¢â€â‚¬Ã¢â€â‚¬ Annotate: Text Box Ã‚Â· Text Highlight Ã‚Â· Underline Ã‚Â· Note Ã‚Â· Callout Ã¢â€â‚¬Ã¢â€â‚¬ */}
            {toolbarBucket === 'annotate' && (
              <div className={`${useDesktopThreePaneLayout ? 'grid grid-cols-2' : `flex flex-nowrap overflow-x-auto bv-tool-bucket${isTabletImmersiveFullscreen ? ' justify-center' : ''}`} gap-1.5 pt-0.5`}>
                <button
                  onClick={() => { setToolMode('textBox'); setOpenPopover(null) }}
                  className={`w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${toolMode === 'textBox' ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                ><Type size={12} /> Insert Text</button>
                <button
                  onClick={(e) => { setToolMode('textHighlight'); setOpenPopover({ tool: 'textHighlight', anchorEl: e.currentTarget, mode: 'tool' }) }}
                  className={`w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${toolMode === 'textHighlight' ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                ><Highlighter size={12} /> Text Highlight</button>
                <button
                  onClick={(e) => { setToolMode('underline'); setOpenPopover({ tool: 'underline', anchorEl: e.currentTarget, mode: 'tool' }) }}
                  className={`w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${toolMode === 'underline' ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                ><Underline size={12} /> Underline</button>
                <button
                  onClick={() => { setToolMode('note'); setOpenPopover(null) }}
                  className={`w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${toolMode === 'note' ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                ><StickyNote size={12} /> Note</button>
                <button
                  onClick={(e) => { setToolMode('callout'); setOpenPopover({ tool: 'callout', anchorEl: e.currentTarget, mode: 'tool' }) }}
                  className={`${useDesktopThreePaneLayout ? 'col-span-2' : ''} w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${toolMode === 'callout' ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                ><ArrowUpRight size={12} /> Callout</button>
              </div>
            )}

            {/* Ã¢â€â‚¬Ã¢â€â‚¬ Draw / Mark: Pen Ã‚Â· Marker Ã‚Â· Eraser Ã‚Â· Shapes Ã¢â€â‚¬Ã¢â€â‚¬ */}
            {toolbarBucket === 'draw' && (
              <div className={`${useDesktopThreePaneLayout ? 'grid grid-cols-2' : `flex flex-nowrap overflow-x-auto bv-tool-bucket${isTabletImmersiveFullscreen ? ' justify-center' : ''}`} gap-1.5 pt-0.5`}>
                <button
                  onClick={(e) => { setToolMode('pen'); setOpenPopover({ tool: 'pen', anchorEl: e.currentTarget, mode: 'tool' }) }}
                  className={`w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${toolMode === 'pen' ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                ><PenLine size={12} /> Pen</button>
                <button
                  onClick={(e) => { setToolMode('marker'); setOpenPopover({ tool: 'marker', anchorEl: e.currentTarget, mode: 'tool' }) }}
                  className={`w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${toolMode === 'marker' ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                ><Highlighter size={12} /> Marker</button>
                <button
                  onClick={(e) => { setToolMode('eraser'); setOpenPopover({ tool: 'eraser', anchorEl: e.currentTarget, mode: 'tool' }) }}
                  className={`w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${toolMode === 'eraser' ? 'border-red-500 text-red-300 bg-red-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                ><Eraser size={12} /> Eraser</button>
                <button
                  onClick={(e) => { setToolMode('shape'); setOpenPopover({ tool: 'shape', anchorEl: e.currentTarget, mode: 'tool' }) }}
                  className={`w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${toolMode === 'shape' ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                ><Shapes size={12} /> Shapes{toolMode === 'shape' && <span className="text-gray-400 text-[10px] ml-0.5">({shapeKind})</span>}</button>
              </div>
            )}

            {/* Ã¢â€â‚¬Ã¢â€â‚¬ Generate Ã¢â€â‚¬Ã¢â€â‚¬ */}
            {toolbarBucket === 'generate' && (
              <div className="flex flex-col gap-1.5 pt-0.5">
                <button
                  onClick={(e) => { setToolMode('generate'); setOpenPopover({ tool: 'generate', anchorEl: e.currentTarget, mode: 'tool' }) }}
                  className={`w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${toolMode === 'generate' ? 'border-amber-500 text-amber-300 bg-amber-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                ><Sparkles size={12} /> Generate from Pinpoint</button>
                <p className="text-[11px] text-gray-500 leading-snug">Click a point on the blueprint, write the question, save.</p>
              </div>
            )}

            {/* Ã¢â€â‚¬Ã¢â€â‚¬ View Ã¢â€â‚¬Ã¢â€â‚¬ */}
            {toolbarBucket === 'view' && (
              <div className={`${useDesktopThreePaneLayout ? 'grid grid-cols-2' : `flex flex-nowrap overflow-x-auto bv-tool-bucket${isTabletImmersiveFullscreen ? ' justify-center' : ''}`} gap-1.5 pt-0.5`}>
                <button
                  onClick={() => { setToolMode('select'); setOpenPopover(null) }}
                  className={`w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${toolMode === 'select' ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                ><MousePointer2 size={12} /> Select / Pan</button>
                <button
                  onClick={() => setLockView((v) => !v)}
                  className={`w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${lockView ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                >Lock View</button>
                {/* Hide/Show all annotation overlays (Fix 2) — overlays only; nothing is deleted. */}
                <button
                  onClick={() => {
                    setAnnotationsVisible((v) => {
                      const next = !v
                      if (!next) {
                        // Hiding: drop selection so no action bar / popover floats over a hidden layer.
                        setFocusedAnnotationId(null)
                        setLayoutEditId(null)
                        setOpenPopover(null)
                      }
                      return next
                    })
                  }}
                  className={`w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${annotationsVisible ? 'border-gray-700 text-gray-300 hover:text-white' : 'border-amber-500 text-amber-300 bg-amber-900/20'}`}
                  title={annotationsVisible ? 'Hide all annotation overlays' : 'Show all annotation overlays'}
                >
                  {annotationsVisible ? <EyeOff size={12} /> : <Eye size={12} />}
                  {annotationsVisible ? 'Hide Annotations' : 'Show Annotations'}
                </button>
                {/* Hide/Show ONLY the can-light glow/output overlay (Step 12B) — symbol body,
                    selection, count, and side panel listing are unaffected either way. */}
                <button
                  onClick={() => setLightingEffectsVisible((v) => !v)}
                  className={`w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${lightingEffectsVisible ? 'border-gray-700 text-gray-300 hover:text-white' : 'border-amber-500 text-amber-300 bg-amber-900/20'}`}
                  title={lightingEffectsVisible ? 'Hide light output/glow around lighting symbols' : 'Show light output/glow around lighting symbols'}
                >
                  {lightingEffectsVisible ? <EyeOff size={12} /> : <Eye size={12} />}
                  {lightingEffectsVisible ? 'Hide Lighting Effects' : 'Show Lighting Effects'}
                </button>
                <button
                  onClick={() => { pendingScrollResetRef.current = true; setRelativeZoom(1) }}
                  className={`${useDesktopThreePaneLayout ? 'col-span-2' : ''} w-full inline-flex items-center justify-center gap-1.5 h-8 text-xs px-2 rounded-md border border-blue-500 text-blue-300 bg-blue-900/20`}
                >Fit to Full Page</button>
                <p className={`${useDesktopThreePaneLayout ? 'col-span-2' : ''} text-[11px] text-gray-500 leading-snug`}>Wheel/pinch to zoom Ã‚Â· Select / Pan to drag.</p>
              </div>
            )}

            {/* Ã¢â€â‚¬Ã¢â€â‚¬ Measure Ã¢â€â‚¬Ã¢â€â‚¬ */}
            {toolbarBucket === 'measure' && (
              <div className={`${useDesktopThreePaneLayout ? 'grid grid-cols-2' : `flex flex-nowrap overflow-x-auto bv-tool-bucket${isTabletImmersiveFullscreen ? ' justify-center' : ''}`} gap-1.5 pt-0.5`}>
                {/* Calibration status badge Ã¢â‚¬â€ shows manual / auto / ambiguous / pending / none */}
                <div className={`${useDesktopThreePaneLayout ? 'col-span-2' : 'w-full'} rounded-md border border-gray-800 bg-gray-900/40 px-2 py-1.5`}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-gray-400">Page {currentPage}</span>
                    {pendingCalibration?.pageNumber === currentPage
                      ? <span className="text-amber-400">pending calibration</span>
                      : calibrationSource === 'manual'
                      ? <span className="text-green-400">manual</span>
                      : calibrationSource === 'auto'
                      ? <span className="text-sky-400">auto-detected</span>
                      : calibrationSource === 'ambiguous'
                      ? <span className="text-orange-400">ambiguous</span>
                      : <span className="text-gray-600">not calibrated</span>
                    }
                  </div>
                  {calibrationSource === 'manual' && savedCalibration && (
                    <div className="mt-0.5 text-[10px] text-green-300/70 truncate">{savedCalibration.realWorldValue} {savedCalibration.realWorldUnit} per ref line</div>
                  )}
                  {calibrationSource === 'auto' && detectedResult && (
                    <div className="mt-0.5 text-[10px] text-sky-300/70 truncate">{detectedResult.candidates[0].parsedScale}</div>
                  )}
                  {calibrationSource === 'ambiguous' && detectedResult && (
                    <div className="mt-1 flex flex-col gap-1">
                      <div className="text-[10px] text-orange-300/70">Multiple scales found Ã¢â‚¬â€ pick one or calibrate manually:</div>
                      {detectedResult.candidates.map((c, i) => (
                        <button key={i} type="button"
                          onClick={() => setSavedCalibrations(prev => ({
                            ...prev,
                            [currentPage]: { pageNumber: currentPage, normDistance: 1.0, realWorldValue: c.realWidthFeet, realWorldUnit: 'ft', savedAt: new Date().toISOString() },
                          }))}
                          className="text-left text-[10px] px-2 py-0.5 rounded border border-orange-700/60 text-orange-300 hover:bg-orange-900/20 truncate"
                        >{c.parsedScale}</button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Calibrate tool */}
                <button
                  onClick={() => { setToolMode('calibrate'); setOpenPopover(null) }}
                  className={`${useDesktopThreePaneLayout ? 'col-span-2' : 'w-full'} w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${toolMode === 'calibrate' ? 'border-sky-500 text-sky-300 bg-sky-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                ><Crosshair size={12} /> Calibrate Ã¢â‚¬â€ draw known distance</button>

                {/* Measure tools */}
                <button
                  onClick={() => { setToolMode('measure-distance'); setOpenPopover(null) }}
                  className={`w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${toolMode === 'measure-distance' ? 'border-sky-500 text-sky-300 bg-sky-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                ><Ruler size={12} /> Distance</button>
                <button
                  onClick={() => { setToolMode('measure-area'); setOpenPopover(null) }}
                  className={`w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${toolMode === 'measure-area' ? 'border-sky-500 text-sky-300 bg-sky-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                ><Square size={12} /> Area</button>
                <button
                  onClick={() => { setToolMode('measure-perimeter'); setOpenPopover(null) }}
                  className={`w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${toolMode === 'measure-perimeter' ? 'border-sky-500 text-sky-300 bg-sky-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                ><Shapes size={12} /> Perimeter</button>

                {/* Commit / clear pending calibration */}
                {calibrationStatus === 'pending' && (
                  <>
                    <button
                      onClick={() => {
                        if (!pendingCalibration) return
                        setSavedCalibrations((prev) => ({ ...prev, [pendingCalibration.pageNumber]: pendingCalibration }))
                        setPendingCalibration(null)
                      }}
                      className={`${useDesktopThreePaneLayout ? 'col-span-2' : 'w-full'} w-full inline-flex items-center justify-center gap-1.5 h-8 text-xs px-2 rounded-md border border-green-600 text-green-300 bg-green-900/20 hover:bg-green-900/40`}
                    >Save Calibration for Page {currentPage}</button>
                    <button
                      onClick={() => setPendingCalibration(null)}
                      className={`${useDesktopThreePaneLayout ? 'col-span-2' : 'w-full'} w-full inline-flex items-center justify-center gap-1.5 h-8 text-xs px-2 rounded-md border border-gray-700 text-gray-400 hover:text-gray-200`}
                    >Discard Pending</button>
                  </>
                )}
                {calibrationStatus === 'saved' && (
                  <button
                    onClick={() => setSavedCalibrations((prev) => { const n = { ...prev }; delete n[currentPage]; return n })}
                    className={`${useDesktopThreePaneLayout ? 'col-span-2' : 'w-full'} w-full inline-flex items-center justify-center gap-1.5 h-8 text-xs px-2 rounded-md border border-gray-700 text-gray-400 hover:text-red-300 hover:border-red-700`}
                  >Clear Calibration</button>
                )}

                <p className={`${useDesktopThreePaneLayout ? 'col-span-2' : 'w-full'} text-[11px] text-gray-500 leading-snug`}>
                  Calibrate first, then draw measurements. Calibration is per-page.
                </p>
              </div>
            )}
          </div>

          {useDesktopThreePaneLayout && (
          <div className="col-start-1 row-start-1 self-start rounded-xl border border-gray-800 bg-[#10131c] p-4 space-y-3">
            {/* Page Navigation Group */}
            <div className="flex items-center gap-2">
              {/* Prev/Next */}
              <div className="inline-flex items-center gap-1.5 bg-gray-900/40 rounded-lg border border-gray-700/50 p-1">
                <button
                  disabled={!canRender || currentPage <= 1 || isRendering}
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  className="inline-flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded-md border border-transparent text-gray-300 hover:border-gray-600 hover:text-white disabled:opacity-50 transition-colors"
                  title="Previous page"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  disabled={!canRender || currentPage >= numPages || isRendering}
                  onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
                  className="inline-flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded-md border border-transparent text-gray-300 hover:border-gray-600 hover:text-white disabled:opacity-50 transition-colors"
                  title="Next page"
                >
                  <ChevronRight size={14} />
                </button>
              </div>

              {/* Page Jump Input */}
              <div className="inline-flex items-center gap-1">
                <input
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') jumpToPage() }}
                  className="w-12 rounded border border-gray-700 bg-gray-900/40 text-gray-100 text-xs px-2 py-1.5 text-center font-medium"
                  placeholder="1"
                  title="Enter page number"
                />
                <button
                  disabled={!canRender}
                  onClick={jumpToPage}
                  className="inline-flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded-md border border-gray-700 text-gray-300 hover:text-white hover:border-gray-600 disabled:opacity-50 transition-colors"
                  title="Go to page"
                >
                  <Search size={12} />
                </button>
              </div>

              {/* Page Counter */}
              <span className="text-xs text-gray-400">/ {pageLabel.split(' ').pop()}</span>

              {/* Selection & Fit */}
              <div className="ml-auto inline-flex items-center gap-1.5">
                <button
                  disabled={!canRender}
                  onClick={toggleCurrentPageSelection}
                  className={`inline-flex items-center justify-center text-xs px-2.5 py-1.5 rounded-md border transition-colors ${isCurrentPageSelected ? 'border-amber-500/60 text-amber-300 bg-amber-900/20' : 'border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white'}`}
                  title={isCurrentPageSelected ? 'Remove from selection' : 'Add to selection'}
                >
                  <Minus size={12} />
                </button>
                <span className="text-xs text-gray-400 min-w-fit">+{selectedPageNumbers.length}</span>
              </div>
            </div>

            {/* View Controls Group */}
            <div className="flex items-center gap-2">
              {/* Zoom & View */}
              <div className="inline-flex items-center gap-1.5 bg-gray-900/40 rounded-lg border border-gray-700/50 p-1">
                <button
                  disabled={!canRender || relativeZoom <= MIN_RELATIVE_ZOOM}
                  onClick={() => applyRelativeZoomDelta(-0.1)}
                  className="inline-flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded-md border border-transparent text-gray-300 hover:border-gray-600 hover:text-white disabled:opacity-50 transition-colors"
                  title="Zoom out"
                >
                  <ZoomOut size={14} />
                </button>
                <span className="text-xs text-gray-400 w-9 text-center font-medium">{Math.round(clampRelativeZoom(relativeZoom) * 100)}%</span>
                <button
                  disabled={!canRender || relativeZoom >= maxRelativeZoom}
                  onClick={() => applyRelativeZoomDelta(0.1)}
                  className="inline-flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded-md border border-transparent text-gray-300 hover:border-gray-600 hover:text-white disabled:opacity-50 transition-colors"
                  title="Zoom in"
                >
                  <ZoomIn size={14} />
                </button>
              </div>

              {/* Fit & Lock */}
              <button
                onClick={() => {
                  pendingScrollResetRef.current = true
                  setRelativeZoom(1)
                }}
                className="inline-flex items-center justify-center text-xs px-2.5 py-1.5 rounded-md border border-blue-500/60 text-blue-300 bg-blue-900/20 hover:border-blue-500 hover:bg-blue-900/30 transition-colors"
                title="Fit page to view"
              >
                <ArrowUpRight size={13} />
              </button>

              <button
                onClick={() => setLockView((v) => !v)}
                className={`inline-flex items-center justify-center text-xs px-2.5 py-1.5 rounded-md border transition-colors ${lockView ? 'border-blue-500/60 text-blue-300 bg-blue-900/20 hover:border-blue-500 hover:bg-blue-900/30' : 'border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white'}`}
                title={lockView ? 'Unlock view' : 'Lock view'}
              >
                {lockView ? <Lock size={14} /> : <Unlock size={14} />}
              </button>

              {/* Fullscreen button: explicit fullscreen toggle.
                  Only explicit control for fullscreen exit (besides Escape key).
                  Entering: requests OS fullscreen + sets UI state.
                  Exiting: calls exitFullscreen API + sets UI state to false.
              */}
              <button
                onClick={() => {
                  const isInAnyFullscreen = isFullScreenView || isTabletImmersiveFullscreen
                  handleFullscreenToggle(
                    isInAnyFullscreen,
                    isTabletDevice(),
                    viewerRootRef.current,
                    setIsFullScreenView,
                    setIsTabletImmersiveFullscreen,
                  )
                }}
                className={`inline-flex items-center text-xs rounded-md border border-gray-700 text-gray-300 hover:text-white hover:border-gray-600 transition-colors ${useDesktopThreePaneLayout ? 'gap-1.5 px-3 py-2 font-medium' : 'justify-center px-2.5 py-1.5'}`}
                title={isFullScreenView || isTabletImmersiveFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              >
                {isFullScreenView || isTabletImmersiveFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                {useDesktopThreePaneLayout && (isFullScreenView ? 'Exit Full Screen' : 'Full Screen')}
              </button>
            </div>
          </div>
          )}

          {(isLoading || isRendering) && (
            <div className={useDesktopThreePaneLayout ? 'col-start-3 row-start-1 self-start text-xs text-blue-300 flex items-center gap-2' : 'px-4 py-2 text-xs text-blue-300 flex items-center gap-2'}>
              <Loader2 size={12} className="animate-spin" />
              {isLoading ? 'Loading PDF...' : 'Rendering page...'}
            </div>
          )}

          {error && (
            <div className={useDesktopThreePaneLayout ? 'col-start-3 row-start-1 mt-8 text-sm text-red-300 bg-red-900/20 border border-red-800/40 rounded-md px-3 py-2' : 'mx-4 mt-3 text-sm text-red-300 bg-red-900/20 border border-red-800/40 rounded-md px-3 py-2'}>
              {error}
            </div>
          )}

          <div className={useDesktopThreePaneLayout ? 'contents' : isTabletImmersiveFullscreen ? 'flex-1 min-h-0 overflow-hidden' : isFullScreenView ? 'flex-1 min-h-0 overflow-hidden p-2 sm:p-4' : 'p-2'}>
            <div className={useDesktopThreePaneLayout ? 'contents' : isTabletImmersiveFullscreen ? 'grid grid-cols-1 h-full' : isFullScreenView ? 'grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-2 sm:gap-4 h-full' : 'grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-3 sm:gap-4'}>
              <style>{`
                .operations-pdf-scroll::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
              `}</style>
              <div
                ref={scrollAreaRef}
                className={`${useDesktopThreePaneLayout ? 'col-start-3 row-start-1 row-span-3 min-h-0 min-w-0 bg-[#0d0e14]' : ''} operations-pdf-scroll ${lockView ? 'overflow-hidden' : 'overflow-scroll'} ${isFullScreenView || isTabletImmersiveFullscreen && !useDesktopThreePaneLayout ? 'h-full max-h-none min-h-0' : !useDesktopThreePaneLayout ? 'min-h-[320px] sm:min-h-[360px] lg:min-h-[400px]' : ''} rounded border border-gray-800`}
                style={{
                  // Dynamic height: fills from bottom of toolbar to bottom of viewport.
                  // Falls back to calc(100vh-300px) until toolbarAreaRef is measured.
                  ...(useDesktopThreePaneLayout
                    ? { height: isFullScreenView && isDesktopBlueprintLayout ? 'calc(100dvh - 52px - 32px - 16px)' : isTabletImmersiveFullscreen ? 'calc(100dvh - 40px - 32px - 16px)' : normalBlueprintViewerMinHeight }
                    : isFullScreenView || isTabletImmersiveFullscreen
                      ? {}
                      : {
                        height: scrollAreaHeight > 100 ? `${scrollAreaHeight - 16}px` : 'calc(100vh - 300px)',
                      }),
                  // Hide scrollbars across all browsers Ã¢â‚¬â€ inline guarantees they
                  // apply regardless of CSS file load order. Container still
                  // scrolls programmatically (required by pan/zoom logic).
                  scrollbarWidth: 'none',          /* Firefox */
                  msOverflowStyle: 'none' as any,  /* IE / old Edge */
                } as React.CSSProperties}
                onWheel={handleWheel}
                onTouchStart={(e) => {
                  // In fullscreen, ensure scroll container owns all touch events
                  // so they don't leak to the background page or trigger fullscreen exit
                  if (isFullScreenView && activeTouchPointersRef.current.size === 0) {
                    const targetEl = e.target as HTMLElement | null
                    if (targetEl && (targetEl.closest('button, textarea, input, select, a') === null)) {
                      e.preventDefault()
                    }
                  }
                }}
                onTouchMove={(e) => {
                  // In fullscreen, prevent background page scroll during document pan/zoom
                  if (isFullScreenView) {
                    const targetEl = e.target as HTMLElement | null
                    if (targetEl && !targetEl.closest('button, textarea, input, select, a')) {
                      e.preventDefault()
                    }
                  }
                }}
              >
                <div
                  className="relative p-2 sm:p-3"
                  style={{
                    width: visualDisplayWidth ? Math.max(visualDisplayWidth + (isMobileRef.current ? 16 : 24), viewportWidth || 0) : '100%',
                    minHeight: visualDisplayHeight ? visualDisplayHeight + (isMobileRef.current ? 16 : 24) : '100%',
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
                    onPointerDownCapture={handleAnnotationSelectCapture}
                    onClick={handleOverlayClick}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerCancel}
                  >
                      {pageAnnotations.map((a) => {
                        // Visibility toggle (Fix 2): skip drawing overlays while hidden.
                        // Annotations stay in state/persistence — only the canvas layer is suppressed.
                        if (!annotationsVisible) return null
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
                        const selectAnnotation = (
                          e: React.MouseEvent<HTMLElement | SVGElement> | React.PointerEvent<HTMLElement | SVGElement>
                        ) => {
                          e.preventDefault()
                          e.stopPropagation()

                          if (effectiveTool === 'eraser') {
                            void removeAnnotation(a.id)
                            return
                          }

                          const current = e.currentTarget as Element
                          const el = (current instanceof HTMLElement
                            ? current
                            : current.closest('[data-annotation-id]')) as HTMLElement | null

                          if (!el) return

                          focusedAnnotationElRef.current = el
                          const r = el.getBoundingClientRect()

                          setOpenPopover(null)
                          setBarDragOffset(null)
                          setFocusedAnnotationRect({
                            top: r.top,
                            left: r.left,
                            right: r.right,
                            bottom: r.bottom,
                            width: r.width,
                            height: r.height,
                          })
                          setFocusedAnnotationId(a.id)
                        }

                        if (a.type === 'pen' || a.type === 'marker') {
                          const points = Array.isArray(meta.points) ? meta.points : []
                          const svgPoints = points.map((p: any) => `${clampNorm(p.x) * displaySize.w},${clampNorm(p.y) * displaySize.h}`).join(' ')
                          const handle = points[points.length - 1] || { x: rect.x + rect.w, y: rect.y + rect.h }
                          return (
                            <div key={a.id} data-annotation-id={a.id} className="absolute inset-0" style={{ pointerEvents: 'none' }}>
                              <svg className="absolute inset-0 overflow-visible" width={displaySize.w} height={displaySize.h}>
                                <polyline points={svgPoints} fill="none" stroke={color} strokeWidth={meta.thickness || (a.type === 'marker' ? 12 : 3)} strokeLinecap="round" strokeLinejoin="round" opacity={meta.opacity ?? (a.type === 'marker' ? 0.35 : 0.9)} style={{ pointerEvents: 'none' }} />
                                <polyline points={svgPoints} fill="none" stroke="transparent" strokeWidth={(meta.thickness || 8) + 14} strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'stroke', cursor: 'pointer', touchAction: 'none' }} onPointerDown={selectAnnotation as any} onClick={selectAnnotation as any} />
                              </svg>
                            </div>
                          )
                        }

                        if (a.type === 'underline') {
                          return (
                            <div key={a.id} data-annotation-id={a.id} className="absolute group" style={{ left, top, width, height }} onPointerDown={selectAnnotation} onClick={selectAnnotation}>
                              <div
                                className={`${isFocused ? 'ring-2 ring-white/80' : ''}`}
                                style={{ position: 'absolute', left: 0, right: 0, bottom: 0, borderBottom: `${meta.thickness || 3}px solid ${color}`, opacity: meta.opacity ?? 1 }}
                              />
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
                            // Use stored relative endpoints (0–1 within bounding box) for correct direction.
                            // Fallback to TL→BR (0%,0%→100%,100%) for legacy annotations without stored coords.
                            const lx1 = meta.lineX1 != null ? `${meta.lineX1 * 100}%` : '0%'
                            const ly1 = meta.lineY1 != null ? `${meta.lineY1 * 100}%` : '0%'
                            const lx2 = meta.lineX2 != null ? `${meta.lineX2 * 100}%` : '100%'
                            const ly2 = meta.lineY2 != null ? `${meta.lineY2 * 100}%` : '100%'
                            return (
                              <div key={a.id} data-annotation-id={a.id} className={`absolute group ${isFocused ? 'ring-2 ring-white/80' : ''}`} style={{ left, top, width, height }} onPointerDown={selectAnnotation} onClick={selectAnnotation}>
                                <svg className="absolute inset-0 overflow-visible" width="100%" height="100%" preserveAspectRatio="none">
                                  <defs>
                                    <marker id={`arrow-${a.id}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                                      <path d="M0,0 L8,4 L0,8 z" fill={borderColor} />
                                    </marker>
                                  </defs>
                                  <line x1={lx1} y1={ly1} x2={lx2} y2={ly2} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={borderStyle === 'dashed' ? '8 5' : borderStyle === 'dotted' ? '2 5' : undefined} markerEnd={kind === 'arrow' ? `url(#arrow-${a.id})` : undefined} opacity={fillOpacity} />
                                </svg>
                                {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'move')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute inset-0 cursor-move" style={{ zIndex: 1 }} />}
                                {isLayoutEditing && <div onPointerDown={(e) => { e.stopPropagation(); startAnnotationEndpointDrag(e, a, 'start') }} className="absolute w-3 h-3 rounded-full bg-blue-400 border border-white shadow cursor-crosshair" style={{ left: lx1, top: ly1, transform: 'translate(-50%,-50%)', zIndex: 3, touchAction: 'none' }} />}
                                {isLayoutEditing && <div onPointerDown={(e) => { e.stopPropagation(); startAnnotationEndpointDrag(e, a, 'end') }} className="absolute w-3 h-3 rounded-full bg-green-400 border border-white shadow cursor-crosshair" style={{ left: lx2, top: ly2, transform: 'translate(-50%,-50%)', zIndex: 3, touchAction: 'none' }} />}
                              </div>
                            )
                          }
                          if (kind === 'arch-line') {
                            const alx1f = meta.lineX1 ?? 0, aly1f = meta.lineY1 ?? 0
                            const alx2f = meta.lineX2 ?? 1, aly2f = meta.lineY2 ?? 1
                            const avx1 = alx1f * 100, avy1 = aly1f * 100
                            const avx2 = alx2f * 100, avy2 = aly2f * 100
                            // Freeform control point: stored as absolute page-normalized coords (archCtrlX/Y).
                            // Legacy fallback: derive control point from archFactor scalar on perpendicular bisector.
                            let avcx: number, avcy: number
                            if (meta.archCtrlX !== undefined && meta.archCtrlY !== undefined) {
                              // Convert page-normalized control point → annotation-local viewBox (0-100) coords
                              const arect = a.rect || { x: 0, y: 0, w: 0.0001, h: 0.0001 }
                              avcx = ((meta.archCtrlX - arect.x) / Math.max(arect.w, 0.0001)) * 100
                              avcy = ((meta.archCtrlY - arect.y) / Math.max(arect.h, 0.0001)) * 100
                            } else {
                              const archFactor = meta.archFactor ?? 0.5
                              const avmx = (avx1 + avx2) / 2, avmy = (avy1 + avy2) / 2
                              avcx = avmx + archFactor * (avy2 - avy1)
                              avcy = avmy + archFactor * (avx1 - avx2)
                            }
                            const alx1css = `${alx1f * 100}%`, aly1css = `${aly1f * 100}%`
                            const alx2css = `${alx2f * 100}%`, aly2css = `${aly2f * 100}%`
                            return (
                              <div key={a.id} data-annotation-id={a.id} className={`absolute group ${isFocused ? 'ring-2 ring-white/80' : ''}`} style={{ left, top, width, height }} onPointerDown={selectAnnotation} onClick={selectAnnotation}>
                                <svg className="absolute inset-0 overflow-visible" viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">
                                  <path d={`M ${avx1} ${avy1} Q ${avcx} ${avcy} ${avx2} ${avy2}`} fill="none" stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={borderStyle === 'dashed' ? '8 5' : borderStyle === 'dotted' ? '2 5' : undefined} strokeLinecap="round" opacity={fillOpacity} />
                                </svg>
                                {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'move')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute inset-0 cursor-move" style={{ zIndex: 1 }} />}
                                {isLayoutEditing && <div onPointerDown={(e) => { e.stopPropagation(); startAnnotationEndpointDrag(e, a, 'start') }} className="absolute w-3 h-3 rounded-full bg-blue-400 border border-white shadow cursor-crosshair" style={{ left: alx1css, top: aly1css, transform: 'translate(-50%,-50%)', zIndex: 3, touchAction: 'none' }} />}
                                {isLayoutEditing && <div onPointerDown={(e) => { e.stopPropagation(); startAnnotationEndpointDrag(e, a, 'end') }} className="absolute w-3 h-3 rounded-full bg-green-400 border border-white shadow cursor-crosshair" style={{ left: alx2css, top: aly2css, transform: 'translate(-50%,-50%)', zIndex: 3, touchAction: 'none' }} />}
                              </div>
                            )
                          }
                          if (isCanLightShape(a)) {
                            // Can-light symbol: outer trim ring + crosshair + aperture circle + size label.
                            // If blueprint calibration is active, the user sizes the marker to match scale via drag.
                            // Without calibration the symbol is still clear — 4" vs 6" distinguished by aperture radius + label.
                            const aperture = kind === 'can-light-4' ? 20 : 26
                            const label = kind === 'can-light-4' ? '4"' : '6"'
                            // Light-output overlay — a single smooth glow whose radius scales with
                            // lightIntensity on the LIGHT_OUTPUT_MIN..LIGHT_OUTPUT_MAX scale (0.25..20;
                            // base 1 = normal, 20 ≈ 20× the fixture spread). Its TINT comes from the
                            // selected Kelvin color temperature: warm amber (low K) → cool blue-white
                            // (high K). Size/opacity stay on Light Output; colour stays on Kelvin. No
                            // dashed ring, no lumen numbers. Legacy intensity values (0..1 / 0..2) and a
                            // missing Kelvin both clamp/fall back safely. Shares the can-light center and
                            // scales with the same viewBox, so it reads correctly at all zoom levels.
                            const FIXTURE_REF_R = 46            // outer trim ring = base fixture radius
                            const lightIntensity = clampNorm(meta.lightIntensity ?? LIGHT_OUTPUT_BASE, LIGHT_OUTPUT_MIN, LIGHT_OUTPUT_MAX)
                            const outputOverlayR = FIXTURE_REF_R * lightIntensity   // 11.5 @0.25 → 46 @1 → 920 @20 (≈20×)
                            const kelvinColor = getLightKelvinColor(meta.lightKelvin ?? DEFAULT_CAN_LIGHT_KELVIN)
                            const glowId = `canlight-glow-${a.id}`
                            return (
                              <div key={a.id} data-annotation-id={a.id} className={`absolute group ${isFocused ? 'ring-2 ring-white/80 rounded-full' : ''}`} style={{ left, top, width, height }} onPointerDown={selectAnnotation} onClick={selectAnnotation}>
                                <svg
                                  className="absolute inset-0 overflow-visible"
                                  viewBox="0 0 100 100"
                                  width="100%"
                                  height="100%"
                                  preserveAspectRatio="xMidYMid meet"
                                >
                                  <defs>
                                    {/* Smooth Kelvin-tinted light-output glow — brightest at the fixture,
                                        fading to fully transparent at the overlay edge. No dashed marks. */}
                                    <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
                                      <stop offset="0%" stopColor={kelvinColor} stopOpacity={0.5} />
                                      <stop offset="55%" stopColor={kelvinColor} stopOpacity={0.24} />
                                      <stop offset="100%" stopColor={kelvinColor} stopOpacity={0} />
                                    </radialGradient>
                                  </defs>
                                  {/* Kelvin-tinted light-output overlay — the ONLY outer output visual.
                                      Behind the fixture, non-interactive so it never steals selection.
                                      Hidden via "Hide Lighting Effects" (Step 12B) — fixture body below
                                      (trim ring, crosshair, aperture, label) always stays visible. */}
                                  {lightingEffectsVisible && (
                                    <circle cx="50" cy="50" r={outputOverlayR} fill={`url(#${glowId})`} stroke="none" style={{ pointerEvents: 'none' }} />
                                  )}
                                  {/* Outer trim ring */}
                                  <circle cx="50" cy="50" r="46" fill="none" stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={borderStyle === 'dashed' ? '8 5' : borderStyle === 'dotted' ? '2 5' : undefined} opacity={fillOpacity} />
                                  {/* Crosshair — horizontal */}
                                  <line x1="4" y1="50" x2="96" y2="50" stroke={borderColor} strokeWidth={Math.max(0.8, borderThickness * 0.55)} opacity={fillOpacity * 0.65} />
                                  {/* Crosshair — vertical */}
                                  <line x1="50" y1="4" x2="50" y2="96" stroke={borderColor} strokeWidth={Math.max(0.8, borderThickness * 0.55)} opacity={fillOpacity * 0.65} />
                                  {/* Aperture circle — filled by fillColor so the color swatch is reflected */}
                                  <circle cx="50" cy="50" r={aperture} fill={fillColor === 'transparent' ? 'none' : hexWithAlpha(fillColor, Math.max(fillOpacity, 0.6))} stroke={borderColor} strokeWidth={borderThickness} />
                                  {/* Size label centered inside aperture */}
                                  <text x="50" y="55" textAnchor="middle" fontSize="16" fontWeight="700" fontFamily="monospace" fill={borderColor} opacity={fillOpacity}>{label}</text>
                                </svg>
                                {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'move')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute inset-0 cursor-move" />}
                                {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'resize')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute -right-1 -bottom-1 h-3 w-3 cursor-nwse-resize rounded-sm bg-blue-400" />}
                              </div>
                            )
                          }
                          if (kind === 'diamond' || kind === 'star' || kind === 'cross' || kind === 'pentagon') {
                            const svgFill = fillColor === 'transparent' ? 'none' : hexWithAlpha(fillColor, 1)
                            const polyPoints =
                              kind === 'diamond' ? '50,0 100,50 50,100 0,50' :
                              kind === 'star' ? '50,3 61,35 95,36 68,56 78,88 50,69 22,88 32,56 5,36 39,35' :
                              kind === 'cross' ? '37,0 63,0 63,37 100,37 100,63 63,63 63,100 37,100 37,63 0,63 0,37 37,37' :
                              '50,3 95,36 78,88 22,88 5,36'
                            return (
                              <div key={a.id} data-annotation-id={a.id} className={`absolute group ${isFocused ? 'ring-2 ring-white/80' : ''}`} style={{ left, top, width, height, opacity: fillOpacity }} onPointerDown={selectAnnotation} onClick={selectAnnotation}>
                                <svg className="absolute inset-0" viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">
                                  <polygon points={polyPoints} fill={svgFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={borderStyle === 'dashed' ? '8 5' : borderStyle === 'dotted' ? '2 5' : undefined} />
                                </svg>
                                {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'move')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute inset-0 cursor-move" />}
                                {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'resize')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute -right-1 -bottom-1 h-3 w-3 cursor-nwse-resize rounded-sm bg-blue-400" />}
                              </div>
                            )
                          }
                          return (
                            <div key={a.id} data-annotation-id={a.id} className={`absolute group ${isFocused ? 'ring-2 ring-white/80 rounded-sm' : ''}`} style={{ left, top, width, height }} onPointerDown={selectAnnotation} onClick={selectAnnotation}>
                              <div
                                className="w-full h-full pointer-events-none"
                                style={{
                                  opacity: fillOpacity,
                                  border: `${borderThickness}px ${borderStyle} ${borderColor}`,
                                  borderRadius: kind === 'circle' ? '9999px' : '0.25rem',
                                  background: getHatchBackground(hatchPattern, borderColor, fillColor, 1),
                                  backgroundSize: hatchPattern === 'dots' ? '8px 8px' : undefined,
                                }}
                              />
                              {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'move')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute inset-0 cursor-move" />}
                              {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'resize')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute -right-1 -bottom-1 h-3 w-3 cursor-nwse-resize rounded-sm bg-blue-400" />}
                            </div>
                          )
                        }

                        if (a.type === 'textBox') {
                          const textMeta = meta.textStyle || {}
                          const isInlineEditing = inlineTextEditId === a.id
                          const textAlign = textMeta.align ?? 'left'
                          const textSurfaceStyle = {
                            color: textMeta.color || '#111827',
                            fontSize: textMeta.fontSize || 14,
                            fontWeight: textMeta.bold ? 700 : (textMeta.fontWeight || 400),
                            fontStyle: textMeta.italic ? 'italic' : undefined,
                            textDecoration: textMeta.underline ? 'underline' : undefined,
                            fontFamily: textMeta.fontFamily || 'Helvetica',
                            textAlign,
                            lineHeight: 1.25,
                          }
                          return (
                            <div
                              key={a.id}
                              data-annotation-id={a.id}
                              className="absolute group cursor-pointer"
                              style={isInlineEditing ? { left, top, width, height } : { left, top }}
                              onPointerDown={selectAnnotation} onClick={selectAnnotation}
                              onDoubleClick={(e) => {
                                e.stopPropagation()
                                if (isInlineEditing) return
                                const snapMeta = getAnnotationMeta(a)
                                textBoxSnapshotRef.current = { ...a, meta: { ...snapMeta }, metadata: { ...snapMeta } }
                                inlineTextOriginalRef.current = a.text || ''
                                setInlineTextEditId(a.id)
                                setFocusedAnnotationId(a.id)
                              }}
                            >
                              {isInlineEditing ? (
                                <div className="relative h-full w-full overflow-hidden" style={{ background: 'transparent', border: 'none' }}>
                                  <div
                                    ref={inlineTextBoxEditorRef}
                                    data-annotation-anchor-id={a.id}
                                    contentEditable
                                    suppressContentEditableWarning
                                    className="h-full w-full overflow-auto bg-transparent p-2 outline-none whitespace-pre-wrap break-words"
                                    style={textSurfaceStyle}
                                    onInput={(e) => {
                                      const val = e.currentTarget.textContent || ''
                                      setAllAnnotations((prev) => prev.map((ann) => (ann.id === a.id ? { ...ann, text: val } : ann)))
                                    }}
                                    onBlur={() => { void saveTextBoxEditSession() }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        cancelTextBoxEditSession()
                                      }
                                      if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault()
                                        void saveTextBoxEditSession()
                                      }
                                    }}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                </div>
                              ) : (
                                <div
                                  data-annotation-anchor-id={a.id}
                                  className="whitespace-pre-wrap break-words p-2"
                                  style={textSurfaceStyle}
                                >
                                  {a.text}
                                </div>
                              )}
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
                                data-annotation-id={a.id}
                                className="pointer-events-auto absolute group"
                                style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, minHeight: `${box.h * 100}%` }}
                                onPointerDown={selectAnnotation} onClick={selectAnnotation}
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
                                {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'move')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute inset-0 z-10 cursor-move" />}
                                {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'resize')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute -right-1 -bottom-1 z-20 h-3 w-3 cursor-nwse-resize rounded-sm bg-blue-400" />}
                              </div>
                            </div>
                          )
                        }

                        if (a.type === 'highlight') {
                          return (
                            <div key={a.id} data-annotation-id={a.id} className="absolute group" style={{ left, top, width, height }} onPointerDown={selectAnnotation} onClick={selectAnnotation}>
                              <div className={`w-full h-full pointer-events-none ${isFocused ? 'ring-2 ring-white/80' : ''}`} style={{ border: `1px solid ${color}`, backgroundColor: hexWithAlpha(color, meta.opacity ?? 0.35) }} />
                              {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'move')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute inset-0 cursor-move" />}
                              {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'resize')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute -right-1 -bottom-1 h-3 w-3 cursor-nwse-resize rounded-sm bg-blue-400" />}
                            </div>
                          )
                        }

                        if (a.type === 'textHighlight') {
                          // Text Highlighter: no border, pure fill Ã¢â‚¬â€ looks like a text marker pen.
                          // Text Highlighter: narrow centered band (72% of bounding-box height) so it
                          // sits across the text baseline rather than covering the full drag rectangle.
                          const hlColor = hexWithAlpha(color, meta.opacity ?? 0.4)
                          const quads: Array<{ x: number; y: number; w: number; h: number }> | null =
                            Array.isArray(meta.quads) && meta.quads.length > 0 ? meta.quads : null
                          if (quads) {
                            return (
                              <div key={a.id} data-annotation-id={a.id} className={`absolute group ${isFocused ? 'ring-2 ring-white/80 rounded-sm' : ''}`} style={{ left, top, width, height }} onPointerDown={selectAnnotation} onClick={selectAnnotation}>
                                {quads.map((q, qi) => (
                                  <div
                                    key={qi}
                                    className="absolute pointer-events-none rounded-sm"
                                    style={{
                                      left: `${Math.max(0, q.x) * 100}%`,
                                      top: `${Math.max(0, q.y) * 100}%`,
                                      width: `${Math.min(1 - Math.max(0, q.x), q.w) * 100}%`,
                                      height: `${Math.min(1 - Math.max(0, q.y), q.h) * 100}%`,
                                      backgroundColor: hlColor,
                                    }}
                                  />
                                ))}
                                {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'move')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute inset-0 cursor-move" />}
                                {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'resize')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute -right-1 -bottom-1 h-3 w-3 cursor-nwse-resize rounded-sm bg-blue-400" />}
                              </div>
                            )
                          }
                          return (
                            <div key={a.id} data-annotation-id={a.id} className={`absolute group ${isFocused ? 'ring-2 ring-white/80 rounded-sm' : ''}`} style={{ left, top, width, height }} onPointerDown={selectAnnotation} onClick={selectAnnotation}>
                              <div
                                className="absolute pointer-events-none rounded-sm"
                                style={{
                                  left: 0,
                                  right: 0,
                                  top: '14%',
                                  bottom: '14%',
                                  backgroundColor: hlColor,
                                }}
                              />
                              {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'move')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute inset-0 cursor-move" />}
                              {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'resize')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute -right-1 -bottom-1 h-3 w-3 cursor-nwse-resize rounded-sm bg-blue-400" />}
                            </div>
                          )
                        }

                        if (a.type === 'measure-distance' || a.type === 'measure-area' || a.type === 'measure-perimeter') {
                          const pts: Array<{ x: number; y: number }> = Array.isArray(meta.points) ? meta.points : []
                          if (pts.length < 2) return null
                          const col = a.color || '#38bdf8'
                          const lbl = meta.label || ''
                          const mStyle = meta.style || {}
                          const endStyle: string = mStyle.endpointStyle || 'dot'
                          const fillPat: string = mStyle.fillPattern || 'none'
                          const fillCol: string = mStyle.fillColor || col
                          const fillOp: number = mStyle.fillOpacity ?? 0.15
                          const lineW: number = mStyle.lineThickness || 2
                          const pxPts = pts.map((p: any) => ({ px: clampNorm(p.x) * displaySize.w, py: clampNorm(p.y) * displaySize.h }))
                          const midPx = pxPts.reduce((acc, p) => ({ px: acc.px + p.px / pxPts.length, py: acc.py + p.py / pxPts.length }), { px: 0, py: 0 })
                          const lastPt = pts[pts.length - 1]
                          const patId = `mfill-${a.id}`
                          const usePattern = a.type === 'measure-area' && fillPat !== 'none' && fillPat !== 'solid'
                          const areaFill = a.type !== 'measure-area' ? 'none'
                            : usePattern ? `url(#${patId})`
                            : hexWithAlpha(fillCol, fillOp)

                          // Endpoint rendering
                          const renderEndpoints = () => {
                            if (endStyle === 'none') return null
                            if (endStyle === 'dot') return pxPts.map((p, i) => <circle key={i} cx={p.px} cy={p.py} r={4} fill={col} opacity={0.9} />)
                            if (endStyle === 'bar') {
                              const bars: any[] = []
                              const addBar = (ia: number, ib: number, at: number) => {
                                const pt = pxPts[at]
                                const dx = pxPts[ib].px - pxPts[ia].px, dy = pxPts[ib].py - pxPts[ia].py
                                const len = Math.hypot(dx, dy) || 1
                                const nx = -dy / len * 7, ny = dx / len * 7
                                bars.push(<line key={`bar-${at}`} x1={pt.px - nx} y1={pt.py - ny} x2={pt.px + nx} y2={pt.py + ny} stroke={col} strokeWidth={lineW} />)
                              }
                              addBar(0, 1, 0)
                              addBar(pxPts.length - 2, pxPts.length - 1, pxPts.length - 1)
                              return bars
                            }
                            return null  // arrows rendered via SVG markers below
                          }
                          const arrowMarkStart = endStyle === 'arrow' ? `url(#ms-${a.id})` : undefined
                          const arrowMarkEnd   = endStyle === 'arrow' ? `url(#me-${a.id})` : undefined

                          return (
                            <div key={a.id} className="absolute inset-0" style={{ pointerEvents: 'none' }}>
                              <svg className="absolute inset-0 overflow-visible" width={displaySize.w} height={displaySize.h}>
                                <defs>
                                  {usePattern && getMeasurePatternDef(patId, fillPat, fillCol, fillOp)}
                                  {endStyle === 'arrow' && (
                                    <>
                                      <marker id={`ms-${a.id}`} markerWidth={8} markerHeight={8} refX={1} refY={4} orient="auto" markerUnits="strokeWidth"><path d="M8,0 L0,4 L8,8 z" fill={col} /></marker>
                                      <marker id={`me-${a.id}`} markerWidth={8} markerHeight={8} refX={7} refY={4} orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 z" fill={col} /></marker>
                                    </>
                                  )}
                                </defs>
                                {a.type === 'measure-distance' ? (
                                  <line x1={pxPts[0].px} y1={pxPts[0].py} x2={pxPts[1].px} y2={pxPts[1].py} stroke={col} strokeWidth={lineW} opacity={0.9} strokeLinecap="round" markerStart={arrowMarkStart} markerEnd={arrowMarkEnd} style={{ pointerEvents: 'none' }} />
                                ) : a.type === 'measure-perimeter' ? (
                                  <polygon points={pxPts.map(p => `${p.px},${p.py}`).join(' ')} fill="none" stroke={col} strokeWidth={lineW} opacity={0.9} strokeLinejoin="round" markerStart={arrowMarkStart} markerEnd={arrowMarkEnd} style={{ pointerEvents: 'none' }} />
                                ) : (
                                  <polygon points={pxPts.map(p => `${p.px},${p.py}`).join(' ')} fill={areaFill} stroke={col} strokeWidth={lineW} opacity={0.9} strokeLinejoin="round" style={{ pointerEvents: 'none' }} />
                                )}
                                {renderEndpoints()}
                                {lbl && (
                                  <>
                                    <rect x={midPx.px - 2} y={midPx.py - 10} width={lbl.length * 7 + 10} height={16} rx={3} fill="#0a0d16" opacity={0.88} style={{ pointerEvents: 'none' }} />
                                    <text x={midPx.px + 3} y={midPx.py} fontSize={11} fill={col} fontFamily="monospace" dominantBaseline="middle" textAnchor="start" style={{ pointerEvents: 'none' }}>{lbl}</text>
                                  </>
                                )}
                                <polyline points={pxPts.map(p => `${p.px},${p.py}`).join(' ')} fill="none" stroke="transparent" strokeWidth={16} style={{ pointerEvents: 'stroke', cursor: 'pointer' }} onClick={selectAnnotation as any} />
                              </svg>
                            </div>
                          )
                        }

                        return (
                          <div key={a.id} data-annotation-id={a.id} className="absolute group" style={{ left, top }} onPointerDown={selectAnnotation} onClick={selectAnnotation}>
                            <button
                              onPointerDown={selectAnnotation} onClick={selectAnnotation}
                              className={`w-5 h-5 rounded-full border text-white text-[10px] font-bold ${isFocused ? 'ring-2 ring-white/80' : ''}`}
                              style={{ backgroundColor: color }}
                              title={a.text || 'Note'}
                            >
                              N
                            </button>
                          </div>
                        )
                      })}

                      {/* Permanent DOM-ref draft rect Ã¢â‚¬â€ hidden by default, shown + mutated directly
                          during pointer-move to avoid React re-renders during active drag. */}
                      {/* Arch control handle — yellow draggable handle at bezier control point for selected arch-line */}
                      {layoutEditId && (() => {
                        const archAnn = pageAnnotations.find(a => a.id === layoutEditId)
                        if (!archAnn) return null
                        const archMeta = getAnnotationMeta(archAnn)
                        if (archMeta.shapeKind !== 'arch-line') return null
                        const archRect = archAnn.rect || { x: 0, y: 0, w: 0.1, h: 0.1 }
                        // Freeform control point position: use stored archCtrlX/Y (page-normalized) if available,
                        // otherwise derive from legacy archFactor perpendicular bisector scalar.
                        let acx: number, acy: number
                        if (archMeta.archCtrlX !== undefined && archMeta.archCtrlY !== undefined) {
                          acx = archMeta.archCtrlX
                          acy = archMeta.archCtrlY
                        } else {
                          const alx1 = archMeta.lineX1 ?? 0, aly1 = archMeta.lineY1 ?? 0
                          const alx2 = archMeta.lineX2 ?? 1, aly2 = archMeta.lineY2 ?? 1
                          const archFactor = archMeta.archFactor ?? 0.5
                          const ap1x = archRect.x + alx1 * (archRect.w || 0)
                          const ap1y = archRect.y + aly1 * (archRect.h || 0)
                          const ap2x = archRect.x + alx2 * (archRect.w || 0)
                          const ap2y = archRect.y + aly2 * (archRect.h || 0)
                          const amx = (ap1x + ap2x) / 2, amy = (ap1y + ap2y) / 2
                          acx = amx + archFactor * (ap2y - ap1y)
                          acy = amy + archFactor * (ap1x - ap2x)
                        }
                        return (
                          <div
                            key="arch-control-handle"
                            style={{ position: 'absolute', left: `${acx * 100}%`, top: `${acy * 100}%`, transform: 'translate(-50%,-50%)', zIndex: 4, touchAction: 'none' }}
                            className="w-3 h-3 rounded-full bg-yellow-400 border border-white shadow cursor-move"
                            title="Drag to adjust arch curve depth and angle"
                            onPointerDown={(e) => { e.stopPropagation(); startArchControlDrag(e, archAnn) }}
                          />
                        )
                      })()}

                      <div
                        ref={draftRectDomRef}
                        className="absolute pointer-events-none"
                        style={{
                          display: 'none',
                          border: effectiveTool === 'shape' && shapeKind !== 'line' && shapeKind !== 'arrow'
                            ? `${shapeOptions.borderThickness}px ${shapeOptions.borderStyle} ${shapeOptions.borderColor}`
                            : effectiveTool === 'underline' || (effectiveTool === 'shape' && (shapeKind === 'line' || shapeKind === 'arrow'))
                              ? 'none'
                              : `1px solid ${toolColors[effectiveTool as ToolKey] || '#facc15'}`,
                          borderRadius: effectiveTool === 'shape' && (shapeKind === 'circle' || shapeKind === 'can-light-4' || shapeKind === 'can-light-6') ? '9999px' : '0.25rem',
                          background: effectiveTool === 'highlight'
                            ? hexWithAlpha(toolColors.highlight || '#facc15', highlightOpacity / 100)
                            : effectiveTool === 'textHighlight'
                              ? hexWithAlpha(toolColors.textHighlight || '#facc15', 0.4)
                              : effectiveTool === 'shape' && shapeKind !== 'line' && shapeKind !== 'arrow' && shapeKind !== 'arch-line' && shapeKind !== 'can-light-4' && shapeKind !== 'can-light-6'
                                ? getHatchBackground(shapeOptions.hatchPattern, shapeOptions.borderColor, shapeOptions.fillColor, shapeOptions.fillOpacity)
                                : 'transparent',
                          borderBottom: effectiveTool === 'underline' ? `${underlineThickness}px solid ${toolColors.underline || '#facc15'}` : undefined,
                        }}
                      />
                      {/* SVG for line/arrow shape preview Ã¢â‚¬â€ line element mutated directly during drag. */}
                      <svg
                        className="absolute inset-0 pointer-events-none overflow-visible"
                        width={displaySize.w}
                        height={displaySize.h}
                        style={{ display: effectiveTool === 'shape' && (shapeKind === 'line' || shapeKind === 'arrow' || shapeKind === 'arch-line') ? '' : 'none' }}
                      >
                        <defs>
                          <marker id="draft-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth">
                            <path d="M0,0 L9,4.5 L0,9 z" fill={shapeOptions.borderColor} />
                          </marker>
                        </defs>
                        <line
                          ref={draftLineDomRef}
                          x1="0" y1="0" x2="0" y2="0"
                          stroke={shapeOptions.borderColor}
                          strokeWidth={shapeOptions.borderThickness}
                          strokeDasharray={shapeOptions.borderStyle === 'dashed' ? '8,4' : shapeOptions.borderStyle === 'dotted' ? '2,4' : undefined}
                          markerEnd={shapeKind === 'arrow' ? 'url(#draft-arrow)' : undefined}
                          style={{ display: 'none' }}
                        />
                        <path
                          ref={draftArchPathDomRef}
                          d="M 0 0 Q 0 0 0 0"
                          fill="none"
                          stroke={shapeOptions.borderColor}
                          strokeWidth={shapeOptions.borderThickness}
                          strokeDasharray={shapeOptions.borderStyle === 'dashed' ? '8,4' : shapeOptions.borderStyle === 'dotted' ? '2,4' : undefined}
                          strokeLinecap="round"
                          style={{ display: 'none' }}
                        />
                      </svg>

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

                      {/* Measure draft SVG Ã¢â‚¬â€ placed points + rubber-band to cursor */}
                      {displaySize.w > 0 && measureDraftPoints.length > 0 && (effectiveTool === 'calibrate' || effectiveTool === 'measure-distance' || effectiveTool === 'measure-area' || effectiveTool === 'measure-perimeter') && (
                        <svg className="absolute inset-0 pointer-events-none overflow-visible" width={displaySize.w} height={displaySize.h}>
                          {(() => {
                            const col = toolColors[effectiveTool as ToolKey] || '#38bdf8'
                            const pxPts = measureDraftPoints.map(p => ({ px: p.x * displaySize.w, py: p.y * displaySize.h }))
                            return (
                              <>
                                {pxPts.length >= 2 && (
                                  effectiveTool === 'measure-area'
                                    ? <polygon points={pxPts.map(p => `${p.px},${p.py}`).join(' ')} fill={hexWithAlpha(col, 0.1)} stroke={col} strokeWidth={2} strokeDasharray="5,3" opacity={0.85} />
                                    : <polyline points={pxPts.map(p => `${p.px},${p.py}`).join(' ')} fill="none" stroke={col} strokeWidth={2} strokeDasharray="5,3" opacity={0.85} />
                                )}
                                {pxPts.map((p, i) => <circle key={i} cx={p.px} cy={p.py} r={4} fill={col} opacity={0.9} />)}
                                {!calibrateInput && measureCursorPx && pxPts.length >= 1 && (
                                  <line
                                    x1={pxPts[pxPts.length - 1].px} y1={pxPts[pxPts.length - 1].py}
                                    x2={measureCursorPx.x} y2={measureCursorPx.y}
                                    stroke={col} strokeWidth={1.5} strokeDasharray="4,3" opacity={0.55}
                                  />
                                )}
                              </>
                            )
                          })()}
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

                      {calibrateInput && (
                        <div
                          className="absolute z-40 rounded-lg border border-sky-700 bg-[#0f1624] p-3 shadow-2xl"
                          style={{
                            left: `${Math.min(0.68, Math.max(0.02, (calibrateInput.p1.x + calibrateInput.p2.x) / 2)) * 100}%`,
                            top: `${Math.min(0.85, Math.max(0.02, (calibrateInput.p1.y + calibrateInput.p2.y) / 2)) * 100}%`,
                            transform: 'translate(-50%, 12px)',
                            width: 230,
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-sky-400">
                            Calibrate Ã¢â‚¬â€ real-world distance
                          </div>
                          <div className="flex gap-2">
                            <input
                              type="number"
                              min={0.01}
                              step={0.01}
                              value={calibrateInput.value}
                              onChange={(e) => setCalibrateInput((prev) => prev ? { ...prev, value: e.target.value } : prev)}
                              className="w-24 rounded border border-gray-600 bg-gray-900/80 px-2 py-1 text-sm text-white outline-none focus:border-sky-500"
                              placeholder="e.g. 20"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const val = parseFloat(calibrateInput.value)
                                  if (!val || val <= 0) return
                                  const normDist = Math.hypot(calibrateInput.p2.x - calibrateInput.p1.x, calibrateInput.p2.y - calibrateInput.p1.y)
                                  setSavedCalibrations((prev) => ({
                                    ...prev,
                                    [currentPage]: { pageNumber: currentPage, normDistance: normDist, realWorldValue: val, realWorldUnit: calibrateInput.unit, savedAt: new Date().toISOString() },
                                  }))
                                  setPendingCalibration(null)
                                  setCalibrateInput(null)
                                  setMeasureDraftPoints([])
                                  setMeasureCursorPx(null)
                                }
                              }}
                            />
                            <select
                              value={calibrateInput.unit}
                              onChange={(e) => setCalibrateInput((prev) => prev ? { ...prev, unit: e.target.value as CalibrationUnit } : prev)}
                              className="rounded border border-gray-600 bg-gray-900/80 px-2 py-1 text-sm text-white outline-none focus:border-sky-500"
                            >
                              <option value="ft">ft</option>
                              <option value="m">m</option>
                              <option value="in">in</option>
                              <option value="cm">cm</option>
                              <option value="mm">mm</option>
                            </select>
                          </div>
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const val = parseFloat(calibrateInput.value)
                                if (!val || val <= 0) return
                                const normDist = Math.hypot(calibrateInput.p2.x - calibrateInput.p1.x, calibrateInput.p2.y - calibrateInput.p1.y)
                                setSavedCalibrations((prev) => ({
                                  ...prev,
                                  [currentPage]: { pageNumber: currentPage, normDistance: normDist, realWorldValue: val, realWorldUnit: calibrateInput.unit, savedAt: new Date().toISOString() },
                                }))
                                setPendingCalibration(null)
                                setCalibrateInput(null)
                                setMeasureDraftPoints([])
                                setMeasureCursorPx(null)
                              }}
                              className="flex-1 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
                            >
                              Save Calibration
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setCalibrateInput(null)
                                setMeasureDraftPoints([])
                                setMeasureCursorPx(null)
                              }}
                              className="rounded border border-gray-600 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {richTextEditor && richTextEditor.annotationType !== 'textBox' && (
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
                          {richTextEditor.annotationType !== 'textBox' && (
                            <div className="mt-2 rounded border border-gray-800 bg-gray-950/30 px-2 py-1.5 text-[11px] text-gray-400">
                              Callout boxes auto-size to the text when saved. Use Move after saving to reposition or resize.
                            </div>
                          )}

                          <div className="mt-3">
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
                              onClick={() => {
                                if (richTextEditor.annotationType === 'textBox') {
                                  if (richTextEditor.mode === 'create' && richTextEditor.annotationId) {
                                    const id = richTextEditor.annotationId
                                    setAllAnnotations(prev => prev.filter(a => a.id !== id))
                                  } else if (richTextEditor.mode === 'edit' && textBoxSnapshotRef.current) {
                                    const snap = textBoxSnapshotRef.current
                                    setAllAnnotations(prev => prev.map(a => a.id === snap.id ? snap : a))
                                  }
                                  draftTextBoxIdRef.current = null
                                  textBoxSnapshotRef.current = null
                                }
                                setRichTextEditor(null)
                              }}
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

              {/* Ã¢â€â‚¬Ã¢â€â‚¬ Divider 2: drag handle between center pane and right panel Ã¢â€â‚¬Ã¢â€â‚¬ */}
              {useDesktopThreePaneLayout && (
                <div
                  className="col-start-4 row-start-1 row-span-3 flex items-center justify-center cursor-col-resize group z-10"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    dragStartXRef.current = e.clientX
                    dragStartWidthRef.current = rightPaneWidth
                    setDraggingDivider('right')
                  }}
                >
                  <div className="w-[3px] h-full rounded-full bg-gray-800 group-hover:bg-blue-500/60 transition-colors duration-150" />
                </div>
              )}

              <div
                className={`${useDesktopThreePaneLayout ? 'col-start-5 row-start-1 row-span-3 min-h-0 min-w-0' : ''} operations-pdf-scroll border border-gray-800 rounded-md bg-[#10131c] overflow-auto ${annotationPanelSizeClass}`}
                style={{
                  ...(useDesktopThreePaneLayout ? { height: isFullScreenView && isDesktopBlueprintLayout ? 'calc(100dvh - 52px - 32px - 16px)' : isTabletImmersiveFullscreen ? 'calc(100dvh - 40px - 32px - 16px)' : normalBlueprintViewerMinHeight } : {}),
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none' as any,
                } as React.CSSProperties}
              >
                {/* ── Annotations panel header ── */}
                <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-100">Annotations</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setIndexModalOpen(true)}
                      className="text-[10px] px-2 py-0.5 rounded bg-gray-700/50 border border-gray-700/80 text-gray-300 hover:bg-gray-700 transition-colors"
                      title="All pages annotation index"
                    >
                      Index
                    </button>
                    {(!useDesktopThreePaneLayout || isFullScreenView || isTabletImmersiveFullscreen) && (
                      <button
                        onClick={() => setTabletAnnotationsOpen(v => !v)}
                        className="inline-flex items-center justify-center p-0.5 rounded text-gray-400 hover:text-gray-200"
                        title={tabletAnnotationsOpen ? 'Collapse annotations' : 'Expand annotations'}
                      >
                        {tabletAnnotationsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    )}
                  </div>
                </div>

                {/* ── Current Page Annotations block ── */}
                {annotationPanelExpanded && (
                  <div className="px-3 pt-2.5 pb-2 border-b border-gray-800">
                    <div className="text-[11px] font-semibold text-gray-300">Current Page Annotations</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">Page {currentPage} · {pageAnnotations.length} {pageAnnotations.length === 1 ? 'annotation' : 'annotations'}</div>
                  </div>
                )}

                {/* ── Grouped annotation list ── */}
                {annotationPanelExpanded && (() => {
                  if (pageAnnotations.length === 0) {
                    return <div className="px-3 py-4 text-xs text-gray-500 text-center">No annotations on this page.</div>
                  }

                  const textInserts = pageAnnotations.filter(a => a.type === 'textBox')
                  const highlighted = pageAnnotations.filter(a => a.type === 'highlight' || a.type === 'textHighlight')
                  const underlined = pageAnnotations.filter(a => a.type === 'underline')
                  const notes = pageAnnotations.filter(a => a.type === 'note')
                  const callouts = pageAnnotations.filter(a => a.type === 'callout')
                  const penMarker = pageAnnotations.filter(a => a.type === 'pen' || a.type === 'marker')
                  const shapes = pageAnnotations.filter(a => a.type === 'shape' || a.type === 'freehand' || a.type === 'arrow' || a.type === 'cloud')
                  const measurements = pageAnnotations.filter(a => a.type === 'measure-distance' || a.type === 'measure-area' || a.type === 'measure-perimeter' || a.type === 'calibrate')
                  const generated = pageAnnotations.filter(a => a.type === 'generate')

                  const annotationsCount = textInserts.length + highlighted.length + underlined.length + notes.length + callouts.length
                  const drawingsCount = penMarker.length + shapes.length + measurements.length
                  const generatedCount = generated.length

                  const toggleGroup = (key: string) => {
                    setCollapsedGroups(prev => {
                      const next = new Set(prev)
                      next.has(key) ? next.delete(key) : next.add(key)
                      return next
                    })
                  }

                  const AnnotationRow = ({ a }: { a: BlueprintAnnotation }) => (
                    <button
                      key={a.id}
                      onClick={(e) => {
                        setFocusedAnnotationId(a.id)
                        setLayoutEditId(null)
                        if (a.type === 'note') { openEditNoteEditor(a); return }
                        const toolKey = annotationTypeToToolKey(a.type)
                        if (toolKey && a.type !== 'textBox') {
                          setOpenPopover({ tool: toolKey as ToolMode, anchorEl: e.currentTarget as HTMLElement, mode: 'edit', editingAnnotationId: a.id })
                        }
                      }}
                      className={`w-full text-left pl-6 pr-3 py-1.5 text-xs hover:bg-white/5 ${focusedAnnotationId === a.id ? 'bg-white/5' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: a.color || '#facc15' }} />
                          <span className="text-gray-400 truncate">{shortText(a.text, 28) || annotationLabel(a)}</span>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); void removeAnnotation(a.id) }}
                          className="text-red-400/60 hover:text-red-300 flex-shrink-0"
                          title="Delete annotation"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </button>
                  )

                  const GeneratedRow = ({ a }: { a: BlueprintAnnotation }) => {
                    const meta = getAnnotationMeta(a)
                    return (
                      <div
                        className={`pl-6 pr-3 py-1.5 text-xs hover:bg-white/5 ${focusedAnnotationId === a.id ? 'bg-white/5' : ''}`}
                      >
                        <button
                          className="w-full text-left"
                          onClick={(e) => {
                            setFocusedAnnotationId(a.id)
                            setLayoutEditId(null)
                            const toolKey = annotationTypeToToolKey(a.type)
                            if (toolKey) {
                              setOpenPopover({ tool: toolKey as ToolMode, anchorEl: e.currentTarget as HTMLElement, mode: 'edit', editingAnnotationId: a.id })
                            }
                          }}
                        >
                          <div className="flex items-center gap-1.5 min-w-0 mb-1">
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-amber-400" />
                            <span className="text-amber-300/80 text-[10px] uppercase tracking-wide">{meta.questionType === 'rfi' ? 'RFI' : 'Coordination'}</span>
                          </div>
                          <div className="text-gray-400 truncate mb-1.5">{shortText(a.text, 32)}</div>
                        </button>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              setRfiForm({ requestedFrom: '', category: 'coordination', dueDate: '' })
                              setRfiModal({ open: true, annotation: a })
                            }}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-300 hover:bg-blue-600/35 transition-colors whitespace-nowrap"
                            title="Generate RFI from this entry"
                          >
                            Generate RFI
                          </button>
                          <button
                            onClick={() => {
                              setCordForm({ category: 'light', dueDate: '' })
                              setCordModal({ open: true, annotation: a })
                            }}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/35 transition-colors whitespace-nowrap"
                            title="Generate Coordination Question from this entry"
                          >
                            Cord. Question
                          </button>
                          <div className="flex-1" />
                          <button
                            onClick={() => void removeAnnotation(a.id)}
                            className="text-red-400/60 hover:text-red-300"
                            title="Delete annotation"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    )
                  }

                  const SubGroup = ({ groupKey, title, items }: { groupKey: string; title: string; items: BlueprintAnnotation[] }) => {
                    const isCollapsed = collapsedGroups.has(groupKey)
                    return (
                      <div>
                        <button
                          onClick={() => toggleGroup(groupKey)}
                          className="w-full flex items-center gap-1 pl-4 pr-3 py-1 text-[10px] text-gray-400 hover:text-gray-300 hover:bg-white/3"
                        >
                          {isCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                          <span>{title}</span>
                          <span className="ml-auto text-gray-500">{items.length}</span>
                        </button>
                        {!isCollapsed && items.length === 0 && (
                          <div className="pl-6 pr-3 py-1 text-[10px] text-gray-600 italic">None</div>
                        )}
                        {!isCollapsed && items.map(a => <AnnotationRow key={a.id} a={a} />)}
                      </div>
                    )
                  }

                  const TopGroup = ({ groupKey, title, count, children }: { groupKey: string; title: string; count: number; children: React.ReactNode }) => {
                    const isCollapsed = collapsedGroups.has(groupKey)
                    return (
                      <div className="border-b border-gray-800/60">
                        <button
                          onClick={() => toggleGroup(groupKey)}
                          className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-white/5"
                        >
                          {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                          <span>{title}</span>
                          <span className="ml-auto text-[10px] font-normal text-gray-500">{count}</span>
                        </button>
                        {!isCollapsed && <div className="pb-1">{children}</div>}
                      </div>
                    )
                  }

                  return (
                    <div>
                      <TopGroup groupKey="grp-annotations" title="Annotations" count={annotationsCount}>
                        <SubGroup groupKey="sub-text" title="Text Inserts" items={textInserts} />
                        <SubGroup groupKey="sub-highlight" title="Highlighted" items={highlighted} />
                        <SubGroup groupKey="sub-underline" title="Underlined" items={underlined} />
                        <SubGroup groupKey="sub-notes" title="Notes" items={notes} />
                        <SubGroup groupKey="sub-callouts" title="Callouts" items={callouts} />
                      </TopGroup>
                      <TopGroup groupKey="grp-drawings" title="Drawings" count={drawingsCount}>
                        <SubGroup groupKey="sub-pen" title="Pen and Marker" items={penMarker} />
                        <SubGroup groupKey="sub-shapes" title="Shapes" items={shapes} />
                        {measurements.length > 0 && <SubGroup groupKey="sub-measure" title="Measurements" items={measurements} />}
                      </TopGroup>
                      <TopGroup groupKey="grp-generated" title="Generated" count={generatedCount}>
                        {generated.length === 0 && (
                          <div className="pl-6 pr-3 py-1.5 text-[10px] text-gray-600 italic">No generated entries</div>
                        )}
                        {generated.map(a => <GeneratedRow key={a.id} a={a} />)}
                      </TopGroup>
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>

          </div>

          {signedUrl && !useDesktopThreePaneLayout && (
            <div className="px-4 pb-4 text-[11px] text-gray-500 truncate">
              Signed URL active for this session. {pageAnnotations.length} annotation{pageAnnotations.length !== 1 ? 's' : ''} on this page.
            </div>
          )}
        </>
      )}

      {/* Ã¢â€â‚¬Ã¢â€â‚¬ Floating tool popover (portal) Ã¢â€â‚¬Ã¢â€â‚¬ */}
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

      {/* ── Floating action bar — portal to body so it is never clipped by the scroll container ── */}
      {focusedAnnotationId && !inlineTextEditId && annotationsVisible && (() => {
        const focusedAnn = allAnnotations.find(ann => ann.id === focusedAnnotationId)
        if (!focusedAnn) return null
        const isLayoutEditingFocused = layoutEditId === focusedAnnotationId
        const fCanMove = focusedAnn.type === 'callout' || focusedAnn.type === 'generate' || focusedAnn.type === 'textBox' || focusedAnn.type === 'shape' || focusedAnn.type === 'highlight' || focusedAnn.type === 'textHighlight' || focusedAnn.type === 'underline' || focusedAnn.type === 'note'
        const fCanStyle = focusedAnn.type === 'highlight' || focusedAnn.type === 'textHighlight' || focusedAnn.type === 'underline' || focusedAnn.type === 'shape' || focusedAnn.type === 'pen' || focusedAnn.type === 'marker' || focusedAnn.type === 'callout' || focusedAnn.type === 'generate' || focusedAnn.type === 'textBox'
        const focusedEl =
          (overlayRef.current?.querySelector(`[data-annotation-anchor-id="${focusedAnnotationId}"]`) as HTMLElement | null) ||
          (overlayRef.current?.querySelector(`[data-annotation-id="${focusedAnnotationId}"]`) as HTMLElement | null)

        const resolvedFocusedRect = focusedAnnotationRect || focusedEl?.getBoundingClientRect() || null
        const BAR_APPROX_W = 220
        const BAR_APPROX_H = 34
        const GAP = 8

        const barTop = (() => {
          if (!resolvedFocusedRect) return Math.max(8, window.innerHeight - 72)

          const aboveTop = resolvedFocusedRect.top - GAP - BAR_APPROX_H
          const belowTop = resolvedFocusedRect.bottom + GAP

          if (aboveTop >= 8) return aboveTop
          if (belowTop + BAR_APPROX_H <= window.innerHeight - 8) return belowTop

          return Math.max(8, Math.min(window.innerHeight - BAR_APPROX_H - 8, aboveTop))
        })()

        const barLeft = (() => {
          if (!resolvedFocusedRect) return Math.max(8, Math.floor((window.innerWidth - BAR_APPROX_W) / 2))

          const centerLeft = resolvedFocusedRect.left + resolvedFocusedRect.width / 2 - BAR_APPROX_W / 2
          return Math.max(8, Math.min(window.innerWidth - BAR_APPROX_W - 8, centerLeft))
        })()

        const finalBarTop = barDragOffset ? barDragOffset.y : barTop
        const finalBarLeft = barDragOffset ? barDragOffset.x : barLeft
        const handleBarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
          e.stopPropagation()
          if ((e.target as HTMLElement).closest('button')) return
          barDragRef.current = { pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, startX: finalBarLeft, startY: finalBarTop }
          try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
        }
        const handleBarPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
          const d = barDragRef.current
          if (!d || d.pointerId !== e.pointerId) return
          e.stopPropagation()
          setBarDragOffset({
            x: Math.max(0, Math.min(window.innerWidth - 160, d.startX + e.clientX - d.startClientX)),
            y: Math.max(0, Math.min(window.innerHeight - 40, d.startY + e.clientY - d.startClientY)),
          })
        }
        const handleBarPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
          if (barDragRef.current?.pointerId === e.pointerId) barDragRef.current = null
          e.stopPropagation()
        }
        const bar = (
          <div
           style={{
              position: 'fixed',
              top: finalBarTop,
              left: finalBarLeft,
              zIndex: 99999,
              touchAction: 'none',
            }}
            className="flex items-center gap-1 rounded-md border border-gray-700 bg-[#111827]/95 p-1 shadow-lg select-none"
            onPointerDown={handleBarPointerDown}
            onPointerMove={handleBarPointerMove}
            onPointerUp={handleBarPointerUp}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cursor-grab px-0.5 text-gray-500" title="Drag to reposition" style={{ fontSize: 11, lineHeight: '1', userSelect: 'none' }}>⠿</div>
            {fCanMove && (
              <button
                type="button"
                onClick={() => { setLayoutEditId((prev) => prev === focusedAnn.id ? null : focusedAnn.id) }}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${isLayoutEditingFocused ? 'bg-blue-600 text-white' : 'text-white hover:bg-white/10'}`}
                title="Move or resize"
              >
                <Move size={10} /> Move
              </button>
            )}
            {focusedAnn.type === 'note' && (
              <button
                type="button"
                onClick={() => openEditNoteEditor(focusedAnn)}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white hover:bg-white/10"
                title="Edit note"
              >
                <Pencil size={10} /> Edit
              </button>
            )}
            {fCanStyle && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (focusedAnn.type === 'textBox') {
                    const anchorEl = focusedAnnotationElRef.current || (e.currentTarget as HTMLElement)
                    openStylePopoverForAnnotation(focusedAnn, anchorEl)
                    return
                  }
                  openStylePopoverForAnnotation(focusedAnn, e.currentTarget as HTMLElement)
                }}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white hover:bg-white/10"
                title="Edit style"
              >
                <Pencil size={10} /> Edit
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                copyAnnotation(focusedAnn)
              }}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white hover:bg-white/10"
              title="Copy this design — then tap the page or press Paste"
            >
              <Copy size={10} /> Copy
            </button>
            {copiedAnnotationTemplate && (
              pasteModeActive ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setPasteModeActive(false)
                  }}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-amber-200 bg-amber-900/40 hover:bg-amber-900/60"
                  title="Stop placing copies"
                >
                  <X size={10} /> Stop Pasting
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setToolMode('select')
                    setPasteModeActive(true)
                  }}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-900/30"
                  title="Paste mode — then tap the page to place copies"
                >
                  <ClipboardPaste size={10} /> Paste
                </button>
              )
            )}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const cx = focusedAnnotationRect.left + focusedAnnotationRect.width / 2
                const cy = focusedAnnotationRect.top + focusedAnnotationRect.height / 2
                void removeAnnotation(focusedAnn.id)
                requestAnimationFrame(() => {
                  const els = document.elementsFromPoint(cx, cy)
                  const nextEl = els.find((el) => {
                    const id = (el as HTMLElement).dataset?.annotationId
                    return id && !locallyDeletedIdsRef.current.has(id)
                  }) as HTMLElement | undefined
                  if (nextEl?.dataset?.annotationId) {
                    const nextId = nextEl.dataset.annotationId
                    focusedAnnotationElRef.current = nextEl
                    const r = nextEl.getBoundingClientRect()
                    setFocusedAnnotationRect({ top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height })
                    setFocusedAnnotationId(nextId)
                  }
                })
              }}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-900/40"
              title="Delete annotation"
            >
              <Trash2 size={10} /> Delete
            </button>
          </div>
        )
        return createPortal(bar, document.body)
      })()}

      {/* ── Paste-mode control bar (Fix 1) — portal so it floats above the viewer on
            desktop + iPad and stays reachable without a focused annotation. Adapts
            between "Stop Pasting" (active) and "Paste"/"Clear" (idle with a template). ── */}
      {copiedAnnotationTemplate && createPortal(
        <div
          style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 100000, touchAction: 'manipulation' }}
          className="flex items-center gap-2 rounded-full border border-gray-700 bg-[#111827]/95 pl-3 pr-1.5 py-1.5 shadow-xl select-none"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {pasteModeActive ? (
            <>
              <span className="text-[11px] text-gray-200 whitespace-nowrap">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 align-middle" />
                Paste mode: tap the page to place copies
              </span>
              <button
                type="button"
                onClick={() => setPasteModeActive(false)}
                className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-amber-400 active:bg-amber-300"
                title="Stop placing copies"
              >
                <X size={13} /> Stop Pasting
              </button>
            </>
          ) : (
            <>
              <span className="text-[11px] text-gray-300 whitespace-nowrap">
                <ClipboardPaste size={12} className="inline mr-1 align-middle" />
                Copied design ready
              </span>
              <button
                type="button"
                onClick={() => { setToolMode('select'); setFocusedAnnotationId(null); setPasteModeActive(true) }}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-emerald-400 active:bg-emerald-300"
                title="Resume paste mode — then tap the page to place copies"
              >
                <ClipboardPaste size={13} /> Paste
              </button>
              <button
                type="button"
                onClick={() => { setPasteModeActive(false); setCopiedAnnotationTemplate(null) }}
                className="inline-flex items-center justify-center rounded-full p-1.5 text-gray-400 hover:text-gray-200 hover:bg-white/10"
                title="Clear copied design"
              >
                <X size={13} />
              </button>
            </>
          )}
        </div>,
        document.body
      )}

      {/* ── All Pages Index Modal ── */}
      {indexModalOpen && createPortal(
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70"
          onClick={() => setIndexModalOpen(false)}
        >
          <div
            className="relative bg-[#10131c] border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <span className="text-sm font-semibold text-gray-200">All Pages — Annotation Index</span>
              <button onClick={() => setIndexModalOpen(false)} className="text-gray-400 hover:text-gray-200" title="Close">
                <X size={16} />
              </button>
            </div>
            <div className="overflow-auto flex-1 p-2">
              {numPages === 0 ? (
                <div className="p-4 text-xs text-gray-500 text-center">No pages loaded.</div>
              ) : (
                Array.from({ length: numPages }, (_, i) => i + 1).map(pg => {
                  const pgAnns = allAnnotations.filter(a => Number(a.pageNumber) === pg)
                  const counts = {
                    'Text Inserts': pgAnns.filter(a => a.type === 'textBox').length,
                    'Highlighted': pgAnns.filter(a => a.type === 'highlight' || a.type === 'textHighlight').length,
                    'Underlined': pgAnns.filter(a => a.type === 'underline').length,
                    'Notes': pgAnns.filter(a => a.type === 'note').length,
                    'Callouts': pgAnns.filter(a => a.type === 'callout').length,
                    'Pen/Marker': pgAnns.filter(a => a.type === 'pen' || a.type === 'marker').length,
                    'Shapes': pgAnns.filter(a => a.type === 'shape' || a.type === 'freehand' || a.type === 'arrow' || a.type === 'cloud').length,
                    'Generated': pgAnns.filter(a => a.type === 'generate').length,
                  }
                  const total = Object.values(counts).reduce((s, v) => s + v, 0)
                  const active = Object.entries(counts).filter(([, v]) => v > 0)
                  return (
                    <div key={pg} className="mb-1 rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-gray-300">Page {pg}</span>
                        <span className="text-[10px] text-gray-500">{total} total</span>
                      </div>
                      {active.length === 0 ? (
                        <span className="text-[10px] text-gray-600 italic">No annotations</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {active.map(([label, cnt]) => (
                            <span key={label} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400">
                              {label}: {cnt}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Generate RFI Modal ── */}
      {rfiModal.open && rfiModal.annotation && createPortal(
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70"
          onClick={() => setRfiModal({ open: false, annotation: null })}
        >
          <div
            className="relative bg-[#10131c] border border-gray-700 rounded-xl shadow-2xl w-full max-w-md"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <span className="text-sm font-semibold text-gray-200">Generate RFI</span>
              <button onClick={() => setRfiModal({ open: false, annotation: null })} className="text-gray-400 hover:text-gray-200" title="Close">
                <X size={16} />
              </button>
            </div>
            <div className="px-4 py-3 space-y-3">
              <div>
                <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">Question (pre-filled from annotation)</label>
                <div className="px-2 py-1.5 rounded bg-gray-800/60 text-xs text-gray-300 border border-gray-700 min-h-[48px]">
                  {rfiModal.annotation.text || '(No text)'}
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">Requested From</label>
                <input
                  type="text"
                  value={rfiForm.requestedFrom}
                  onChange={e => setRfiForm(f => ({ ...f, requestedFrom: e.target.value }))}
                  placeholder="e.g. Architect, Engineer…"
                  className="w-full px-2 py-1.5 rounded bg-gray-800/60 text-xs text-gray-200 border border-gray-700 focus:border-blue-500 outline-none"
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">Category</label>
                  <select
                    value={rfiForm.category}
                    onChange={e => setRfiForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full px-2 py-1.5 rounded bg-gray-800/60 text-xs text-gray-200 border border-gray-700 focus:border-blue-500 outline-none"
                  >
                    <option value="coordination">Coordination</option>
                    <option value="design">Design</option>
                    <option value="supplier">Supplier</option>
                    <option value="permit">Permit</option>
                    <option value="ahj">AHJ</option>
                    <option value="inspection">Inspection</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">Due Date</label>
                  <input
                    type="date"
                    value={rfiForm.dueDate}
                    onChange={e => setRfiForm(f => ({ ...f, dueDate: e.target.value }))}
                    className="w-full px-2 py-1.5 rounded bg-gray-800/60 text-xs text-gray-200 border border-gray-700 focus:border-blue-500 outline-none"
                  />
                </div>
              </div>
              {actionMsg && (
                <div className={`text-xs px-2 py-1.5 rounded ${actionMsg.type === 'success' ? 'bg-emerald-900/30 text-emerald-300' : 'bg-red-900/30 text-red-300'}`}>
                  {actionMsg.text}
                </div>
              )}
            </div>
            <div className="px-4 pb-4 flex justify-end gap-2">
              <button
                onClick={() => { setRfiModal({ open: false, annotation: null }); setActionMsg(null) }}
                className="px-3 py-1.5 text-xs rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                disabled={submittingRfi || !rfiForm.requestedFrom.trim()}
                onClick={async () => {
                  const ann = rfiModal.annotation
                  if (!ann || !blueprint?.projectId || !profile?.org_id) {
                    setActionMsg({ type: 'error', text: 'Missing project or org context.' })
                    return
                  }
                  setSubmittingRfi(true)
                  setActionMsg(null)
                  try {
                    await createRFI(
                      profile.org_id,
                      blueprint.projectId,
                      ann.text || '',
                      rfiForm.requestedFrom.trim(),
                      rfiForm.category as any,
                      rfiForm.dueDate || null,
                      undefined,
                      undefined,
                      profile.id
                    )
                    setActionMsg({ type: 'success', text: 'RFI created successfully.' })
                    setTimeout(() => { setRfiModal({ open: false, annotation: null }); setActionMsg(null) }, 1200)
                  } catch (err) {
                    setActionMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to create RFI.' })
                  } finally {
                    setSubmittingRfi(false)
                  }
                }}
                className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {submittingRfi && <Loader2 size={11} className="animate-spin" />}
                Create RFI
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Generate Coordination Question Modal ── */}
      {cordModal.open && cordModal.annotation && createPortal(
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70"
          onClick={() => setCordModal({ open: false, annotation: null })}
        >
          <div
            className="relative bg-[#10131c] border border-gray-700 rounded-xl shadow-2xl w-full max-w-md"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <span className="text-sm font-semibold text-gray-200">Generate Coordination Question</span>
              <button onClick={() => setCordModal({ open: false, annotation: null })} className="text-gray-400 hover:text-gray-200" title="Close">
                <X size={16} />
              </button>
            </div>
            <div className="px-4 py-3 space-y-3">
              <div>
                <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">Description (pre-filled from annotation)</label>
                <div className="px-2 py-1.5 rounded bg-gray-800/60 text-xs text-gray-300 border border-gray-700 min-h-[48px]">
                  {cordModal.annotation.text || '(No text)'}
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">Category</label>
                  <select
                    value={cordForm.category}
                    onChange={e => setCordForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full px-2 py-1.5 rounded bg-gray-800/60 text-xs text-gray-200 border border-gray-700 focus:border-emerald-500 outline-none"
                  >
                    <option value="light">Light</option>
                    <option value="main">Main</option>
                    <option value="urgent">Urgent</option>
                    <option value="research">Research</option>
                    <option value="permit">Permit</option>
                    <option value="inspect">Inspect</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">Due Date</label>
                  <input
                    type="date"
                    value={cordForm.dueDate}
                    onChange={e => setCordForm(f => ({ ...f, dueDate: e.target.value }))}
                    className="w-full px-2 py-1.5 rounded bg-gray-800/60 text-xs text-gray-200 border border-gray-700 focus:border-emerald-500 outline-none"
                  />
                </div>
              </div>
              {actionMsg && (
                <div className={`text-xs px-2 py-1.5 rounded ${actionMsg.type === 'success' ? 'bg-emerald-900/30 text-emerald-300' : 'bg-red-900/30 text-red-300'}`}>
                  {actionMsg.text}
                </div>
              )}
            </div>
            <div className="px-4 pb-4 flex justify-end gap-2">
              <button
                onClick={() => { setCordModal({ open: false, annotation: null }); setActionMsg(null) }}
                className="px-3 py-1.5 text-xs rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                disabled={submittingCord}
                onClick={async () => {
                  const ann = cordModal.annotation
                  if (!ann || !blueprint?.projectId || !profile?.org_id) {
                    setActionMsg({ type: 'error', text: 'Missing project or org context.' })
                    return
                  }
                  setSubmittingCord(true)
                  setActionMsg(null)
                  try {
                    await createCoordinationItem(
                      profile.org_id,
                      blueprint.projectId,
                      cordForm.category as any,
                      ann.text || '',
                      cordForm.dueDate || null,
                      undefined,
                      undefined,
                      profile.id
                    )
                    setActionMsg({ type: 'success', text: 'Coordination question created.' })
                    setTimeout(() => { setCordModal({ open: false, annotation: null }); setActionMsg(null) }, 1200)
                  } catch (err) {
                    setActionMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to create coordination item.' })
                  } finally {
                    setSubmittingCord(false)
                  }
                }}
                className="px-3 py-1.5 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {submittingCord && <Loader2 size={11} className="animate-spin" />}
                Create Item
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
