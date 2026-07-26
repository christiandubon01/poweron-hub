// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowUpRight,
  Bold,
  Cable,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Check,
  Circle,
  ClipboardPaste,
  Copy,
  Crosshair,
  Eraser,
  Eye,
  EyeOff,
  GripVertical,
  Highlighter,
  Italic,
  Layers,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  Unlock,
  MousePointer2,
  Move,
  Pencil,
  PenLine,
  RefreshCw,
  Redo2,
  RotateCw,
  Ruler,
  Settings,
  Shapes,
  Sparkles,
  Spline,
  Square,
  StickyNote,
  Type,
  Trash2,
  Underline,
  Undo2,
  Waypoints,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  deleteOperationsBlueprintAnnotation,
  deleteOperationsBlueprintScopeLayer,
  getBlueprintSignedUrl,
  getOperationsBlueprintAnnotations,
  getOperationsBlueprintQuickAccessWireProfileBinding,
  getOperationsBlueprintScopeLayers,
  getOperationsBlueprintWireProfiles,
  saveOperationsBlueprintQuickAccessWireProfileBinding,
  saveOperationsBlueprintScopeLayerAnimationScene,
  saveOperationsBlueprintScopeLayers,
  SCOPE_LAYER_CLOUD_SYNC_WARNING_MSG,
  type BlueprintAnnotation,
  type BlueprintLibraryItem,
  type BlueprintScopeItemRef,
  type BlueprintScopeLayer,
  upsertOperationsBlueprintAnnotation,
} from '@/services/blueprintLibraryService'
import { getBackupData } from '@/services/backupDataService'
import { setDirtyScope } from '@/services/liveCloudRefreshService'
import { ToolPopover, ColorRow, Stepper, LabeledSelect, ToggleRow } from './ToolPopover'
import { useAuth } from '@/hooks/useAuth'
import { useRemoteDataRefresh } from '@/hooks/useRemoteDataRefresh'
import { createRFI } from '@/agents/blueprint/rfiManager'
import { createCoordinationItem } from '@/agents/blueprint/coordinationTracker'
import {
  buildBlueprintPdfRuntimeKey,
  registerBlueprintPdfRuntimeProvider,
  unregisterBlueprintPdfRuntimeProvider,
} from '@/features/blueprint-vr/blueprintPdfTraceRuntimeBridge'
import {
  ensureCircuitTopologyIds,
  regenerateCircuitTopologyIds,
  translateNormalizedPoints,
} from '@/features/blueprint-animation/routeGeometry'
import {
  buildAutoCalibrationForPage as buildSharedAutoCalibrationForPage,
  buildManualKnownDistanceCalibration as buildSharedManualKnownDistanceCalibration,
  buildScaleCalibration as buildSharedScaleCalibration,
  convertMeasuredDistance as convertSharedMeasuredDistance,
  convertMeasuredPolygonArea as convertSharedMeasuredPolygonArea,
  convertMeasuredPolylineLength as convertSharedMeasuredPolylineLength,
  formatArchitecturalLength as formatSharedArchitecturalLength,
  getCircuitArcControl as getSharedCircuitArcControl,
  getLegacyScaleForPage as getSharedLegacyScaleForPage,
  getNormSegmentSheetDistanceInches as getSharedNormSegmentSheetDistanceInches,
  getPageSizeInchesFromPts as getSharedPageSizeInchesFromPts,
  resolveUnitsPerSheetInch as resolveSharedUnitsPerSheetInch,
  resolveEffectiveCalibration as resolveSharedEffectiveCalibration,
  sampleCircuitArcPolyline as sampleSharedCircuitArcPolyline,
} from '@/features/blueprint-measurements'
import {
  buildEffectiveWorkPackagesForPreview,
  buildWireQuantityResult,
  ProjectWireTotalsDialog,
  WireQuantitySummary,
} from '@/features/blueprint-wire-quantities'
import {
  assignNewWorkPackageOrder,
  decideWorkPackageRemoteRefreshApply,
  getVisibleWorkPackageMoveState,
  moveWorkPackageById,
  reorderVisibleWorkPackagesById,
  shouldRunDeferredWorkPackageRefresh,
  sortWorkPackages,
} from '@/features/blueprint-work-packages'
import { PackageAnimationRouteBuilder } from '@/features/blueprint-animation/PackageAnimationRouteBuilder'
import { PackageAnimationPlaybackControls } from '@/features/blueprint-animation/PackageAnimationPlaybackControls'
import type { PlaybackFixtureAppearance } from '@/features/blueprint-animation/playbackFixtureAppearance'
import { parseBlueprintAnimationScene } from '@/features/blueprint-animation/sceneSchema'
import {
  applyAnnotationSnapshotsToList,
  areAnnotationSnapshotsEqual,
  buildAnnotationMutationCommand,
  buildAnnotationRestorePayload,
  clearCommandHistory,
  clearHistoryScope,
  commitRedo,
  commitUndo,
  createCommandHistory,
  isHistoryCommandSourceCurrent,
  peekRedo,
  peekUndo,
  pushCommand,
} from '@/features/blueprint-history/commandHistory'
import type { AnnotationHistoryScope, AnnotationSnapshot } from '@/features/blueprint-history/types'
import {
  createEmptyPackageAnimationRouteDraft,
  decidePackageAnimationRouteCompletion,
  dispatchPackageAnimationRoutePick,
  getPackageAnimationPrimaryRouteCandidates,
  getPackageAnimationRouteOverlay,
  isRouteBuilderDeviceKind,
  isRouteBuilderSourceKind,
  loadPackageAnimationRouteDraft,
  applySavedAnimationScopeLayer,
  clearPackageAnimationRouteNotice,
  createSingleFlightGuard,
  openPackageAnimationRouteSession,
  packageAnimationRouteActionMessageClass,
  packageAnimationRouteNoticeKey,
  packageAnimationRouteDraftToScene,
  reconcilePackageAnimationRouteLocalRefresh,
  reconcilePackageAnimationRouteSave,
  resolvePackageAnimationRouteBaseRevision,
  resolvePackageAnimationRouteDraft,
  summarizePackageAnimationScene,
  upsertPackageAnimationRouteNotice,
  type PackageAnimationRouteConflictState,
  type PackageAnimationRouteDraft,
  type PackageAnimationRouteNotice,
  type RouteBuilderAnnotation,
} from '@/features/blueprint-animation/routeBuilderModel'
import { findFirstRouteDeviceHit, findNearestRouteNode, findNearestRouteSegment, resolveRoutePickIntent } from '@/features/blueprint-animation/routePicking'
import {
  QUICK_ACCESS_BINDING_SAVE_FAILURE_MESSAGE,
  applyQuickAccessWireProfileToAnnotationMeta,
  decideQuickAccessWireProfileActivation,
  getQuickAccessSlotKey,
  listSelectableQuickAccessWireProfiles,
  resolveQuickAccessWireProfileDisplay,
  supportsWireProfileAssignment,
  validateQuickAccessActivationIdentity,
  shouldCloseWireProfileManagerForProjectChange,
  WireProfileManagerDialog,
} from '@/features/blueprint-wire-profiles'

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


// ── Device / layout detection (Step 13B-QA7-R2) ──────────────────────────────
// iPad Pro landscape is 1366px wide — wider than the desktop xl breakpoint —
// so layout decisions must NEVER rely on viewport width alone. Detection
// combines the classic UA/platform sniff (iPadOS Safari reports "MacIntel" +
// multitouch in desktop-site mode) with a capability check (coarse primary
// pointer + multitouch), so iPads/tablets still get the stacked touch layout
// when the UA sniff misses (DevTools device emulation, third-party iPad
// browsers, future UA string changes). A wide window is only "desktop" when
// BOTH signals say it is not a touch-first device.
function isIPadLikeDevice() {
  if (typeof window === 'undefined') return false
  const nav = window.navigator
  const ua = nav.userAgent || ''
  const platform = nav.platform || ''
  const maxTouchPoints = nav.maxTouchPoints || 0
  return (
    /iPad/i.test(ua) ||
    ((/MacIntel|Macintosh/i.test(platform) || /Macintosh/i.test(ua)) && maxTouchPoints > 1)
  )
}

function isTouchFirstDevice() {
  if (typeof window === 'undefined') return false
  const maxTouchPoints = window.navigator.maxTouchPoints || 0
  let coarsePrimaryPointer = false
  try {
    coarsePrimaryPointer = !!window.matchMedia?.('(pointer: coarse)')?.matches
  } catch { /* matchMedia unavailable — treat as not touch-first */ }
  // Touch-capable laptops keep a fine primary pointer (mouse/trackpad) and so
  // stay on the desktop layout; touch-first tablets report a coarse pointer.
  // maxTouchPoints > 0 (not > 1): Chrome DevTools device/responsive emulation
  // reports exactly 1 — requiring > 1 made emulated iPads fall through to the
  // desktop three-pane layout. Real iPads report 5.
  return coarsePrimaryPointer && maxTouchPoints > 0
}

function shouldUseDesktopBlueprintLayout() {
  if (typeof window === 'undefined') return false
  return !isIPadLikeDevice() && !isTouchFirstDevice() && window.innerWidth >= 1280
}

function isTabletDevice() {
  return isIPadLikeDevice() || isTouchFirstDevice()
}

// Zoom floor = 1.0 means the user can never zoom out past "Fit to Full Page".
// The fit scale is always relativeZoom = 1.0. Going below 1.0 would make the
// page smaller than the fitted size, which is unwanted.
const MIN_RELATIVE_ZOOM = 1
// Desktop cap: 10x fit (1000%). Mobile cap: 10x fit (1000%), detected at render time.
const MAX_RELATIVE_ZOOM_DESKTOP = 10
const MAX_RELATIVE_ZOOM_MOBILE = 10
const MAX_RENDER_SCALE = 10
// Raster budget for the committed PDF canvas (and the annotation SVG overlays,
// which are sized to the same displaySize). iPad/iOS Safari silently paints
// nothing once a canvas/layer exceeds roughly 16.7M pixels, and giant layers
// destabilize the whole viewport. The canvas is therefore never rastered past
// this budget — the remaining zoom (up to the full 1000%) is applied as a CSS
// transform on the page frame (visualScale), the same mechanism the live pinch
// preview already uses. Zoom math stays in "relative zoom" space untouched.
const MAX_CANVAS_AREA_TOUCH = 15_000_000
const MAX_CANVAS_AREA_DESKTOP = 33_000_000
// Per-dimension safety cap (Safari max texture dimension is 8192 on older iPads).
const MAX_CANVAS_DIM_TOUCH = 8000
const MAX_CANVAS_DIM_DESKTOP = 16000
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
const ANNOTATION_COLORS = [
  '#facc15',
  '#38bdf8',
  '#f97316',
  '#22c55e',
  '#a78bfa',
  '#ef4444',
  '#ffffff',
  '#111827',
  '#991B1B',
  '#DC2626',
  '#EA580C',
  '#FB923C',
  '#CA8A04',
  '#EAB308',
  '#84CC16',
  '#16A34A',
  '#15803D',
  '#14B8A6',
  '#06B6D4',
  '#0284C7',
  '#2563EB',
  '#1D4ED8',
  '#4F46E5',
  '#7C3AED',
  '#9333EA',
  '#C026D3',
  '#DB2777',
  '#F43F5E',
  '#64748B',
  '#334155',
  '#78716C',
  '#A16207',
  '#0F172A',
]
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
const DEFAULT_SHAPE_FILL_OPACITY = 1
const LEGACY_SHAPE_FILL_OPACITY = 0.22
// Normalized offset applied when pasting a copied annotation via the toolbar
// button (no explicit drop point) so repeated pastes cascade and stay visible.
const PASTE_OFFSET_NORM = 0.03
// Guide Assist is soft / visual-only (Step 13D): a more forgiving threshold surfaces alignment
// opportunities earlier, but Guide Assist never moves the item — the user's drop is final.
const ALIGNMENT_GUIDE_THRESHOLD_NORM = 0.03
// Circuit/Switch-Leg Path: max distance (page-normalized) a click can be from an existing
// annotation's center and still snap to it, rather than using the raw click point.
const CIRCUIT_PATH_SNAP_RADIUS_NORM = 0.03
// KEYNUDGE: distance an arrow-key press moves the selected annotation, page-normalized.
// Deliberately far below every snap/threshold constant above (0.03) so the keyboard is a
// fine-tune tool, not a second placement gesture — ~1px on a 1000px-wide rendered page.
const NUDGE_STEP_NORM = 0.001
// Circuit Arc Path (CIRCUITARC): default perpendicular bulge applied to each segment at
// creation time, as a fraction of that segment's length. Deliberately gentler than Arch
// Line's 0.5 -- that factor reads fine on a single span but compounds into a scalloped
// mess when repeated across the many short segments of a fixture-to-fixture circuit run.
const CIRCUIT_ARC_DEFAULT_BULGE = 0.18
// refId (optional) = the annotation this guide is lining up against, so the canvas can highlight
// the reference item during Guide Assist. Purely visual — never used to move data.
type AlignmentGuideLine = { axis: 'x' | 'y'; value: number; refId?: string }
type PlacementPreviewRectPx = { left: number; top: number; w: number; h: number }

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

type ShapeKind =
  | 'square'
  | 'circle'
  | 'line'
  | 'arrow'
  | 'arch-line'
  | 'polyline'
  | 'circuit-path'
  | 'circuit-arc'
  | 'star'
  | 'cross'
  | 'diamond'
  | 'pentagon'
  | 'can-light-4'
  | 'can-light-6'
  | 'electrical-switch'
  | 'electrical-switch-3way'
  | 'electrical-switch-4way'
  | 'electrical-dimmer'
  | 'electrical-recessed-light'
  | 'electrical-pendant-light'
  | 'electrical-sconce'
  | 'electrical-emergency-exit-sign'
  | 'electrical-led-panel-2x2'
  | 'electrical-led-panel-2x4'
  | 'electrical-panel'
  | 'electrical-gfci'
  | 'electrical-receptacle'
  | 'electrical-receptacle-240v'
  | 'electrical-timer-control'
  | 'electrical-photocell'
  | 'electrical-ceiling-occupancy-sensor'
  | 'electrical-wall-occupancy-sensor'
  | 'electrical-smoke-alarm'
  | 'electrical-co-alarm'
  | 'electrical-hdmi'
  | 'electrical-data'
type BorderStyle = 'solid' | 'dashed' | 'dotted'
type HatchPattern = 'none' | 'diagonal' | 'cross' | 'dots'
type GenerateQuestionType = 'coordination' | 'rfi'

type ElectricalSymbolKind = Extract<ShapeKind,
  | 'electrical-switch'
  | 'electrical-switch-3way'
  | 'electrical-switch-4way'
  | 'electrical-dimmer'
  | 'electrical-recessed-light'
  | 'electrical-pendant-light'
  | 'electrical-sconce'
  | 'electrical-emergency-exit-sign'
  | 'electrical-led-panel-2x2'
  | 'electrical-led-panel-2x4'
  | 'electrical-panel'
  | 'electrical-gfci'
  | 'electrical-receptacle'
  | 'electrical-receptacle-240v'
  | 'electrical-timer-control'
  | 'electrical-photocell'
  | 'electrical-ceiling-occupancy-sensor'
  | 'electrical-wall-occupancy-sensor'
  | 'electrical-smoke-alarm'
  | 'electrical-co-alarm'
  | 'electrical-hdmi'
  | 'electrical-data'
>
type ElectricalSymbolCategory = 'lighting' | 'switching' | 'power' | 'control'

type ElectricalSymbolMetadata = {
  symbolKind: ElectricalSymbolKind
  displayName: string
  shortLabel: string
  category: ElectricalSymbolCategory
  countValue: number
  defaultPhase: string
  materialKey: string
  laborKey: string
  isElectricalSymbol: true
}

const ELECTRICAL_SYMBOL_METADATA: Record<ElectricalSymbolKind, ElectricalSymbolMetadata> = {
  'electrical-switch': {
    symbolKind: 'electrical-switch',
    displayName: 'Switch',
    shortLabel: 'S',
    category: 'switching',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'switch',
    laborKey: 'switch',
    isElectricalSymbol: true,
  },
  'electrical-switch-3way': {
    symbolKind: 'electrical-switch-3way',
    displayName: '3-Way Switch',
    shortLabel: 'S3',
    category: 'switching',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'switch-3way',
    laborKey: 'switch-3way',
    isElectricalSymbol: true,
  },
  'electrical-switch-4way': {
    symbolKind: 'electrical-switch-4way',
    displayName: '4-Way Switch',
    shortLabel: 'S4',
    category: 'switching',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'switch-4way',
    laborKey: 'switch-4way',
    isElectricalSymbol: true,
  },
  'electrical-dimmer': {
    symbolKind: 'electrical-dimmer',
    displayName: 'Dimmer',
    shortLabel: 'DIM',
    category: 'switching',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'dimmer',
    laborKey: 'dimmer',
    isElectricalSymbol: true,
  },
  'electrical-recessed-light': {
    symbolKind: 'electrical-recessed-light',
    displayName: 'Recessed Light',
    shortLabel: 'RL',
    category: 'lighting',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'recessed-light',
    laborKey: 'recessed-light',
    isElectricalSymbol: true,
  },
  'electrical-pendant-light': {
    symbolKind: 'electrical-pendant-light',
    displayName: 'Pendant Light',
    shortLabel: 'P',
    category: 'lighting',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'pendant-light',
    laborKey: 'pendant-light',
    isElectricalSymbol: true,
  },
  'electrical-sconce': {
    symbolKind: 'electrical-sconce',
    displayName: 'Sconce',
    shortLabel: 'SC',
    category: 'lighting',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'sconce',
    laborKey: 'sconce',
    isElectricalSymbol: true,
  },
  'electrical-emergency-exit-sign': {
    symbolKind: 'electrical-emergency-exit-sign',
    displayName: 'Emergency Exit Sign',
    shortLabel: 'EXIT',
    category: 'lighting',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'emergency-exit-sign',
    laborKey: 'emergency-exit-sign',
    isElectricalSymbol: true,
  },
  'electrical-led-panel-2x2': {
    symbolKind: 'electrical-led-panel-2x2',
    displayName: '2x2 LED Panel',
    shortLabel: '2x2',
    category: 'lighting',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'led-panel-2x2',
    laborKey: 'led-panel-2x2',
    isElectricalSymbol: true,
  },
  'electrical-led-panel-2x4': {
    symbolKind: 'electrical-led-panel-2x4',
    displayName: '2x4 LED Panel',
    shortLabel: '2x4',
    category: 'lighting',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'led-panel-2x4',
    laborKey: 'led-panel-2x4',
    isElectricalSymbol: true,
  },
  'electrical-panel': {
    symbolKind: 'electrical-panel',
    displayName: 'Electrical Panel',
    shortLabel: 'PNL',
    category: 'power',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'electrical-panel',
    laborKey: 'electrical-panel',
    isElectricalSymbol: true,
  },
  'electrical-gfci': {
    symbolKind: 'electrical-gfci',
    displayName: 'GFCI',
    shortLabel: 'GFCI',
    category: 'power',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'gfci',
    laborKey: 'gfci',
    isElectricalSymbol: true,
  },
  'electrical-receptacle': {
    symbolKind: 'electrical-receptacle',
    displayName: 'Receptacle',
    shortLabel: 'REC',
    category: 'power',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'receptacle',
    laborKey: 'receptacle',
    isElectricalSymbol: true,
  },
  'electrical-receptacle-240v': {
    symbolKind: 'electrical-receptacle-240v',
    displayName: '240V Receptacle',
    shortLabel: '240V',
    category: 'power',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'receptacle-240v',
    laborKey: 'receptacle-240v',
    isElectricalSymbol: true,
  },
  'electrical-timer-control': {
    symbolKind: 'electrical-timer-control',
    displayName: 'Timer Control Box',
    shortLabel: 'TMR',
    category: 'control',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'timer-control',
    laborKey: 'timer-control',
    isElectricalSymbol: true,
  },
  'electrical-photocell': {
    symbolKind: 'electrical-photocell',
    displayName: 'Photocell',
    shortLabel: 'PC',
    category: 'control',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'photocell',
    laborKey: 'photocell',
    isElectricalSymbol: true,
  },
  'electrical-ceiling-occupancy-sensor': {
    symbolKind: 'electrical-ceiling-occupancy-sensor',
    displayName: 'Ceiling Occupancy Sensor',
    shortLabel: 'OS-C',
    category: 'control',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'switch',
    laborKey: 'switch',
    isElectricalSymbol: true,
  },
  'electrical-wall-occupancy-sensor': {
    symbolKind: 'electrical-wall-occupancy-sensor',
    displayName: 'Wall Occupancy Sensor',
    shortLabel: 'OS-W',
    category: 'control',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'switch',
    laborKey: 'switch',
    isElectricalSymbol: true,
  },
  'electrical-smoke-alarm': {
    symbolKind: 'electrical-smoke-alarm',
    displayName: 'Smoke Alarm',
    shortLabel: 'SA',
    category: 'control',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'smoke-alarm',
    laborKey: 'smoke-alarm',
    isElectricalSymbol: true,
  },
  'electrical-co-alarm': {
    symbolKind: 'electrical-co-alarm',
    displayName: 'CO Alarm',
    shortLabel: 'CO',
    category: 'control',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'co-alarm',
    laborKey: 'co-alarm',
    isElectricalSymbol: true,
  },
  'electrical-hdmi': {
    symbolKind: 'electrical-hdmi',
    displayName: 'HDMI',
    shortLabel: 'HDMI',
    category: 'power',
    countValue: 1,
    defaultPhase: 'low-voltage',
    materialKey: 'hdmi',
    laborKey: 'hdmi',
    isElectricalSymbol: true,
  },
  'electrical-data': {
    symbolKind: 'electrical-data',
    displayName: 'Data',
    shortLabel: 'DATA',
    category: 'power',
    countValue: 1,
    defaultPhase: 'low-voltage',
    materialKey: 'data',
    laborKey: 'data',
    isElectricalSymbol: true,
  },
}

export const ELECTRICAL_SYMBOL_OPTIONS: Array<{ label: string; value: ElectricalSymbolKind; shortLabel: string }> =
  Object.values(ELECTRICAL_SYMBOL_METADATA).map((symbol) => ({
    label: symbol.displayName,
    value: symbol.symbolKind,
    shortLabel: symbol.shortLabel,
  }))

const CAN_LIGHT_TOOL_OPTIONS: Array<{ label: string; value: 'can-light-4' | 'can-light-6'; shortLabel: string }> = [
  { label: 'Can Light 4"', value: 'can-light-4', shortLabel: '4"' },
  { label: 'Can Light 6"', value: 'can-light-6', shortLabel: '6"' },
]

export const CIRCUIT_MEASUREMENT_LABELS_DEFAULT_VISIBLE = false
export const CIRCUIT_DRAW_GROUP_TOOL_ORDER = ['circuit-path', 'circuit-arc', 'circuit-labels'] as const

const GENERIC_SHAPE_KIND_OPTIONS: Array<{ label: string; value: ShapeKind }> = [
  { label: 'Square', value: 'square' },
  { label: 'Circle', value: 'circle' },
  { label: 'Line', value: 'line' },
  { label: 'Arrow', value: 'arrow' },
  { label: 'Arch Line', value: 'arch-line' },
  { label: 'Polyline / Multi-Point Line', value: 'polyline' },
  { label: 'Circuit / Switch-Leg Path', value: 'circuit-path' },
  { label: 'Circuit Arc Path', value: 'circuit-arc' },
  { label: 'Diamond', value: 'diamond' },
  { label: 'Star', value: 'star' },
  { label: 'Cross', value: 'cross' },
  { label: 'Pentagon', value: 'pentagon' },
]

const QUICK_ACCESS_STORAGE_KEY = 'poweron_blueprint_quick_access_presets_v1'
const QUICK_ACCESS_SLOT_COUNT = 10
type QuickAccessTool = Extract<ToolMode,
  | 'highlight'
  | 'textHighlight'
  | 'underline'
  | 'textBox'
  | 'note'
  | 'callout'
  | 'pen'
  | 'marker'
  | 'shape'
  | 'measure-distance'
  | 'measure-area'
  | 'measure-perimeter'
>
type QuickAccessPreset = {
  id: string
  label: string
  toolType: QuickAccessTool
  toolVariant?: ShapeKind
  color?: string
  highlightOpacity?: number
  underlineThickness?: number
  drawOptions?: { thickness: number; opacity: number }
  markerOptions?: { thickness: number; opacity: number }
  shapeOptions?: {
    borderColor: string
    borderThickness: number
    borderStyle: BorderStyle
    hatchPattern: HatchPattern
    fillColor: string
    fillOpacity: number
    opacity: number
  }
  textStyle?: Record<string, any>
  measurementStyle?: Record<string, any>
  createdAt: string
  updatedAt: string
}

const QUICK_ACCESS_TOOL_OPTIONS: Array<{ value: QuickAccessTool; label: string }> = [
  { value: 'shape', label: 'Drawing / Shape / Electrical Symbol' },
  { value: 'pen', label: 'Pen' },
  { value: 'marker', label: 'Marker' },
  { value: 'highlight', label: 'Highlight Area' },
  { value: 'textHighlight', label: 'Text Highlight' },
  { value: 'underline', label: 'Underline' },
  { value: 'textBox', label: 'Text Box' },
  { value: 'callout', label: 'Callout' },
  { value: 'note', label: 'Note' },
  { value: 'measure-distance', label: 'Measure Distance' },
  { value: 'measure-area', label: 'Measure Area' },
  { value: 'measure-perimeter', label: 'Measure Perimeter' },
]
const QUICK_ACCESS_TOOL_SET = new Set(QUICK_ACCESS_TOOL_OPTIONS.map((option) => option.value))

function loadQuickAccessPresets(): Array<QuickAccessPreset | null> {
  const empty = Array.from({ length: QUICK_ACCESS_SLOT_COUNT }, () => null as QuickAccessPreset | null)
  if (typeof window === 'undefined') return empty
  try {
    const parsed = JSON.parse(window.localStorage.getItem(QUICK_ACCESS_STORAGE_KEY) || '[]')
    if (!Array.isArray(parsed)) return empty
    return empty.map((_, index) => {
      const preset = parsed[index]
      if (!preset || typeof preset !== 'object' || !QUICK_ACCESS_TOOL_SET.has(preset.toolType)) return null
      return {
        ...preset,
        id: typeof preset.id === 'string' ? preset.id : `quick-access-${index + 1}`,
        label: typeof preset.label === 'string' && preset.label.trim() ? preset.label.trim() : `Slot ${index + 1}`,
      } as QuickAccessPreset
    })
  } catch {
    return empty
  }
}

function saveQuickAccessPresets(presets: Array<QuickAccessPreset | null>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(QUICK_ACCESS_STORAGE_KEY, JSON.stringify(presets.slice(0, QUICK_ACCESS_SLOT_COUNT)))
  } catch { /* local preferences are best-effort */ }
}

function isSyncBlockedMessage(message: string | null | undefined) {
  if (!message) return false
  return /cloud sync was blocked/i.test(message) || /could not prove it loaded the latest remote/i.test(message)
}

export function isElectricalShapeKind(shapeKind: any): shapeKind is ElectricalSymbolKind {
  return typeof shapeKind === 'string' && shapeKind in ELECTRICAL_SYMBOL_METADATA
}

export function getElectricalSymbolMetadata(shapeKind: any, meta: Record<string, any> = {}): ElectricalSymbolMetadata | null {
  if (!isElectricalShapeKind(shapeKind)) return null
  const base = ELECTRICAL_SYMBOL_METADATA[shapeKind]
  return {
    ...base,
    countValue: Number.isFinite(Number(meta.countValue)) ? Number(meta.countValue) : base.countValue,
  }
}

export function getElectricalSymbolDisplayName(shapeKind: any, meta: Record<string, any> = {}) {
  const symbol = getElectricalSymbolMetadata(shapeKind, meta)
  if (!symbol) return null
  return shapeKind === 'electrical-recessed-light' && meta.emergency
    ? `${symbol.displayName} · EM`
    : symbol.displayName
}

function getElectricalSymbolCountValue(shapeKind: any, meta: Record<string, any> = {}) {
  return getElectricalSymbolMetadata(shapeKind, meta)?.countValue ?? 0
}

function formatElectricalSymbolCategory(category: ElectricalSymbolCategory) {
  return category.charAt(0).toUpperCase() + category.slice(1)
}

export function getElectricalSymbolMetadataStamp(shapeKind: any, meta: Record<string, any> = {}) {
  const symbol = getElectricalSymbolMetadata(shapeKind, meta)
  if (!symbol) return {}
  return {
    symbolCategory: symbol.category,
    countValue: symbol.countValue,
    materialKey: symbol.materialKey,
    laborKey: symbol.laborKey,
  }
}

const DEFAULT_SCOPE_LAYER_COLOR = '#38bdf8'

function getBlueprintScopeLayerLaborTotal(layer: Pick<BlueprintScopeLayer, 'roughInHours' | 'trimHours' | 'testingHours' | 'cleanupHours'>) {
  return (
    Number(layer.roughInHours || 0) +
    Number(layer.trimHours || 0) +
    Number(layer.testingHours || 0) +
    Number(layer.cleanupHours || 0)
  )
}

// Distinct page count across a package's linked items — informational "Spans N pages" badge only.
function getBlueprintScopeLayerDistinctPageCount(layer: Pick<BlueprintScopeLayer, 'itemRefs'>) {
  const pages = new Set<number>()
  layer.itemRefs.forEach((ref) => { if (Number.isFinite(ref.pageNumber)) pages.add(ref.pageNumber) })
  return pages.size
}

export function buildBlueprintScopeItemRef(annotation: BlueprintAnnotation): BlueprintScopeItemRef {
  const meta = getAnnotationMeta(annotation)
  const shapeKind = annotation.type === 'shape' ? meta.shapeKind : undefined
  const electricalMetadata = getElectricalSymbolMetadata(shapeKind, meta)
  return {
    annotationId: annotation.id,
    pageNumber: Math.max(1, Math.floor(Number(annotation.pageNumber) || 1)),
    label: annotationLabel(annotation),
    ...(shapeKind ? { shapeKind } : {}),
    ...(electricalMetadata ? { category: electricalMetadata.category } : {}),
    ...(electricalMetadata ? { countValue: getElectricalSymbolCountValue(shapeKind, meta) } : {}),
  }
}

export function cloneBlueprintAnnotationForPaste(source: BlueprintAnnotation) {
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
}

export function buildElectricalPanelLabelPatch(value: string): Pick<BlueprintAnnotation, 'text'> {
  return { text: normalizeElectricalPanelLabel(value) }
}

export function normalizeElectricalPanelLabel(value: string | null | undefined): string | undefined {
  const label = String(value || '').trim()
  return label || undefined
}

export function buildElectricalPanelLabelCommit(
  annotationId: string | null | undefined,
  rawDraft: string,
  persistedText: string | null | undefined,
): { annotationId?: string; changed: boolean; patch?: Pick<BlueprintAnnotation, 'text'> } {
  if (!annotationId) return { changed: false }
  const next = normalizeElectricalPanelLabel(rawDraft)
  const previous = normalizeElectricalPanelLabel(persistedText)
  if (next === previous) return { annotationId, changed: false }
  return { annotationId, changed: true, patch: { text: next } }
}

export function ElectricalPanelLabelControl({
  value,
  onChange,
  onBlur,
  onKeyDown,
}: {
  value: string
  onChange(value: string): void
  onBlur(): void
  onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void
}) {
  return (
    <label style={{ display: 'block', marginBottom: 8, fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
      Label
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        placeholder="Panel, Subpanel, MDP, Panel A..."
        aria-label="Electrical panel label"
        style={{
          marginTop: 4,
          width: '100%',
          borderRadius: 6,
          border: '1px solid rgba(55,65,81,1)',
          background: 'rgba(3,7,18,0.6)',
          color: 'rgba(243,244,246,1)',
          padding: '7px 9px',
          fontSize: 12,
          outline: 'none',
        }}
      />
    </label>
  )
}

function buildBlueprintScopeItemRefs(annotations: BlueprintAnnotation[], annotationIds: string[]) {
  const idSet = new Set(annotationIds)
  return annotations
    .filter((annotation) => idSet.has(annotation.id))
    .map(buildBlueprintScopeItemRef)
}

function buildBlueprintScopeItemSummary(itemRefs: BlueprintScopeItemRef[]) {
  const grouped = new Map<string, number>()
  for (const item of itemRefs) {
    grouped.set(item.label, (grouped.get(item.label) || 0) + Number(item.countValue ?? 1))
  }
  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, count]) => `${count} ${label}${count === 1 ? '' : 's'}`)
}

function getShapeKindLabel(kind: any, meta: Record<string, any> = {}) {
  const electricalDisplayName = getElectricalSymbolDisplayName(kind, meta)
  if (electricalDisplayName) return electricalDisplayName
  switch (kind) {
    case 'arch-line': return 'Arch Line'
    case 'circuit-arc': return 'Circuit Arc Path'
    case 'can-light-4': return 'Can Light 4"'
    case 'can-light-6': return 'Can Light 6"'
    default:
      return String(kind || 'Shape').replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
  }
}

// Shape kinds placed by successive clicks (Stop/Cancel pill flow) rather than a single
// press-drag-release. They share draft state, the rubber band, and the hit-test bypass.
function isMultiPointShapeKind(kind: any): boolean {
  return kind === 'polyline' || kind === 'circuit-path' || kind === 'circuit-arc'
}

// Geometry a move has to carry along with the bounding box. Line endpoints, the arch control
// point, multi-point path points and Circuit Arc control points are all stored in ABSOLUTE
// page-normalized coordinates, so translating only the box would detach them from the shape.
// Captured once at the start of a mouse drag and re-read per keypress for a keyboard nudge.
type AnnotationMoveGeometry = {
  lineAbs: { x1: number; y1: number; x2: number; y2: number } | null
  archCtrl: { x: number; y: number } | null
  points: Array<{ x: number; y: number }> | null
  arcCtrls: Array<{ x: number; y: number }> | null
}

const EMPTY_MOVE_GEOMETRY: AnnotationMoveGeometry = { lineAbs: null, archCtrl: null, points: null, arcCtrls: null }

function getAnnotationMoveGeometry(meta: Record<string, any>): AnnotationMoveGeometry {
  const isLineLike = meta.shapeKind === 'line' || meta.shapeKind === 'arrow' || meta.shapeKind === 'arch-line'
  const isPathLike = isMultiPointShapeKind(meta.shapeKind)
  return {
    lineAbs: (isLineLike && meta.lineAbsX1 != null && meta.lineAbsY1 != null && meta.lineAbsX2 != null && meta.lineAbsY2 != null)
      ? { x1: meta.lineAbsX1, y1: meta.lineAbsY1, x2: meta.lineAbsX2, y2: meta.lineAbsY2 }
      : null,
    archCtrl: (isLineLike && meta.archCtrlX != null && meta.archCtrlY != null)
      ? { x: meta.archCtrlX, y: meta.archCtrlY }
      : null,
    points: (isPathLike && Array.isArray(meta.points)) ? meta.points.map((p: any) => ({ x: p.x, y: p.y })) : null,
    arcCtrls: (isPathLike && Array.isArray(meta.arcCtrls)) ? meta.arcCtrls.map((p: any) => ({ x: p.x, y: p.y })) : null,
  }
}

// Multi-point kinds that snap each click to a nearby fixture/symbol center.
function isCircuitShapeKind(kind: any): boolean {
  return kind === 'circuit-path' || kind === 'circuit-arc'
}

export function shouldRenderCircuitMeasurementLabel(options: {
  labelsVisible: boolean
  shapeKind: unknown
  distanceLabel: unknown
  localPointCount: number
}) {
  return options.labelsVisible
    && isCircuitShapeKind(options.shapeKind)
    && typeof options.distanceLabel === 'string'
    && options.distanceLabel.length > 0
    && options.localPointCount > 0
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Measurement & calibration types Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
type CalibrationUnit = 'ft' | 'm' | 'in' | 'cm' | 'mm'
type CalibrationStatus = 'none' | 'pending' | 'saved'

type CalibrationKind = 'auto-scale' | 'selected-scale' | 'manual-known-distance' | 'legacy'

interface PageSizeInches {
  pageWidthInches: number
  pageHeightInches: number
}

interface CalibrationData {
  pageNumber: number
  // Euclidean distance in normalised page-coords (0-1 Ãƒâ€" page width)
  normDistance: number
  realWorldValue: number
  realWorldUnit: CalibrationUnit
  savedAt: string
  pageWidthInches?: number
  pageHeightInches?: number
  sheetDistanceInches?: number
  unitsPerSheetInch?: number
  calibrationKind?: CalibrationKind
}

function getPageSizeInchesFromPts(pageWidthPts: number, pageHeightPts: number): PageSizeInches {
  return getSharedPageSizeInchesFromPts(pageWidthPts, pageHeightPts)
}

function getLegacyScaleForPage(cal: CalibrationData): number {
  return getSharedLegacyScaleForPage(cal)
}

function resolveUnitsPerSheetInch(cal: CalibrationData, pageSize: PageSizeInches | null): number | null {
  return resolveSharedUnitsPerSheetInch(cal, pageSize)
}

function getNormSegmentSheetDistanceInches(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  pageSize: PageSizeInches,
): number {
  return getSharedNormSegmentSheetDistanceInches(p1, p2, pageSize)
}

function buildScaleCalibration(
  pageNumber: number,
  realWidthFeet: number,
  pageSize: PageSizeInches | null,
  savedAt: string,
  kind: 'auto-scale' | 'selected-scale',
): CalibrationData {
  return buildSharedScaleCalibration(pageNumber, realWidthFeet, pageSize, savedAt, kind)
}

function buildManualKnownDistanceCalibration(
  pageNumber: number,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  realWorldValue: number,
  realWorldUnit: CalibrationUnit,
  pageSize: PageSizeInches | null,
): CalibrationData {
  return buildSharedManualKnownDistanceCalibration(pageNumber, p1, p2, realWorldValue, realWorldUnit, pageSize)
}

function buildAutoCalibrationForPage(
  pageNumber: number,
  detectedResult: DetectedScaleResult | null,
  pageSize: PageSizeInches | null,
): CalibrationData | null {
  return buildSharedAutoCalibrationForPage(pageNumber, detectedResult, pageSize)
}

function convertMeasuredDistance(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  cal: CalibrationData,
  pageSize: PageSizeInches | null,
): number {
  return convertSharedMeasuredDistance(p1, p2, cal, pageSize)
}

function convertMeasuredPolylineLength(
  points: Array<{ x: number; y: number }>,
  cal: CalibrationData,
  pageSize: PageSizeInches | null,
): number {
  return convertSharedMeasuredPolylineLength(points, cal, pageSize)
}

function convertMeasuredPolygonArea(
  points: Array<{ x: number; y: number }>,
  cal: CalibrationData,
  pageSize: PageSizeInches | null,
): number {
  return convertSharedMeasuredPolygonArea(points, cal, pageSize)
}

// BLUEPRINT-6P — architectural feet/inches formatter for length measurement labels.
// For 'ft'/'in' it converts a decimal length to true feet-inches with a reduced fraction,
// rounded to the nearest 1/16" (with correct carry, e.g. 11 15/16" -> 1'-0"). Metric and any
// unknown unit fall back to the prior decimal formatting so those measurements stay safe.
// This ONLY affects display strings — the underlying measurement math is untouched.
//   10.25 ft -> 10'-3"   ·   9.8333 ft -> 9'-10"   ·   1.375 in -> 1-3/8"   ·   0.25 in -> 1/4"
function formatArchitecturalLength(value: number, unit: string): string {
  return formatSharedArchitecturalLength(value, unit)
}

// Parses common construction-style length input for the Calibrate manual-length field.
// Accepts plain numbers (uses the selected unit dropdown as fallback), explicit unit
// suffixes ("10 ft", "126 in"), and feet-inches notation ("10'", "10' 6\"", "10'-6\"").
// Returns null when the input can't be parsed into a positive length.
function parseCalibrationLength(input: string, fallbackUnit: CalibrationUnit): { value: number; unit: CalibrationUnit } | null {
  const raw = input.trim()
  if (!raw) return null

  // Feet + inches: 10' 6", 10'-6", 10' 6, 10'
  const feetInchesMatch = raw.match(/^(\d+(?:\.\d+)?)\s*'\s*-?\s*(\d+(?:\.\d+)?)?\s*"?$/)
  if (feetInchesMatch) {
    const feet = parseFloat(feetInchesMatch[1])
    const inches = feetInchesMatch[2] ? parseFloat(feetInchesMatch[2]) : 0
    if (!Number.isFinite(feet) || !Number.isFinite(inches)) return null
    const value = feet + inches / 12
    return value > 0 ? { value, unit: 'ft' } : null
  }

  // Inches only: 126", 126 in, 126in
  const inchesMatch = raw.match(/^(\d+(?:\.\d+)?)\s*(?:"|in)$/i)
  if (inchesMatch) {
    const value = parseFloat(inchesMatch[1])
    return Number.isFinite(value) && value > 0 ? { value, unit: 'in' } : null
  }

  // Explicit unit suffix: 10 ft, 10.5 ft, 3 m, 30 cm, 300 mm
  const unitMatch = raw.match(/^(\d+(?:\.\d+)?)\s*(ft|m|cm|mm)$/i)
  if (unitMatch) {
    const value = parseFloat(unitMatch[1])
    const unit = unitMatch[2].toLowerCase() as CalibrationUnit
    return Number.isFinite(value) && value > 0 ? { value, unit } : null
  }

  // Plain number: use the unit selected in the dropdown.
  const plainMatch = raw.match(/^\d+(?:\.\d+)?$/)
  if (plainMatch) {
    const value = parseFloat(raw)
    return Number.isFinite(value) && value > 0 ? { value, unit: fallbackUnit } : null
  }

  return null
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

type ScaleScanPageReason =
  | 'matched'
  | 'ambiguous'
  | 'nts'
  | 'no-text'
  | 'text-no-scale-token'
  | 'scale-token-no-match'
  | 'not-scanned'

interface ScaleScanPageDiagnostic {
  pageNumber: number
  textItemCount: number
  hasText: boolean
  hasScaleWord: boolean
  hasQuarterToken: boolean
  hasNts: boolean
  matched: boolean
  ambiguous: boolean
  reason: ScaleScanPageReason
  normalizedSample: string
}

interface ScaleScanDiagnosticsSummary {
  totalPages: number
  pagesScanned: number
  pagesWithText: number
  pagesWithScaleWord: number
  pagesWithQuarterScaleToken: number
  pagesMatched: number
  pagesAmbiguous: number
  pagesNts: number
  pagesNoText: number
  pagesTextNoMatch: number
  pageByNumber: Record<number, ScaleScanPageDiagnostic>
}

const SCALE_SCAN_TEXT_SAMPLE_MAX = 250

const EMPTY_SCALE_SCAN_DIAGNOSTICS: ScaleScanDiagnosticsSummary = {
  totalPages: 0,
  pagesScanned: 0,
  pagesWithText: 0,
  pagesWithScaleWord: 0,
  pagesWithQuarterScaleToken: 0,
  pagesMatched: 0,
  pagesAmbiguous: 0,
  pagesNts: 0,
  pagesNoText: 0,
  pagesTextNoMatch: 0,
  pageByNumber: {},
}

function classifyScaleScanPageReason(
  hasText: boolean,
  hasNts: boolean,
  result: DetectedScaleResult | null,
  hasScaleWord: boolean,
  hasQuarterToken: boolean,
): ScaleScanPageReason {
  if (result?.ambiguous) return 'ambiguous'
  if (result && result.candidates.length === 1) return 'matched'
  if (hasNts) return 'nts'
  if (!hasText) return 'no-text'
  if (!hasScaleWord && !hasQuarterToken) return 'text-no-scale-token'
  return 'scale-token-no-match'
}

function buildScaleScanDiagnosticsSummary(
  pageByNumber: Record<number, ScaleScanPageDiagnostic>,
  totalPages: number,
): ScaleScanDiagnosticsSummary {
  const pages = Object.values(pageByNumber)
  return {
    totalPages,
    pagesScanned: pages.length,
    pagesWithText: pages.filter((p) => p.hasText).length,
    pagesWithScaleWord: pages.filter((p) => p.hasScaleWord).length,
    pagesWithQuarterScaleToken: pages.filter((p) => p.hasQuarterToken).length,
    pagesMatched: pages.filter((p) => p.matched).length,
    pagesAmbiguous: pages.filter((p) => p.ambiguous).length,
    pagesNts: pages.filter((p) => p.hasNts).length,
    pagesNoText: pages.filter((p) => !p.hasText).length,
    pagesTextNoMatch: pages.filter((p) => p.hasText && !p.matched && !p.ambiguous).length,
    pageByNumber,
  }
}

function getScaleScanPageReasonLabel(reason: ScaleScanPageReason): string {
  switch (reason) {
    case 'matched': return 'matched'
    case 'ambiguous': return 'ambiguous scale candidates'
    case 'nts': return 'N.T.S. / not to scale'
    case 'no-text': return 'no text layer found'
    case 'text-no-scale-token': return 'text found, no SCALE/1/4 token'
    case 'scale-token-no-match': return 'text found, no scale match'
    default: return 'not scanned yet'
  }
}

// BLUEPRINT-6M — line/stroke pattern for the distance measurement line. This is a
// STROKE dash pattern (applied via SVG strokeDasharray), NOT an area fill hatch — a
// distance measurement is a single straight line with no enclosed area.
type MeasurementLinePattern = 'solid' | 'dashed' | 'dotted' | 'dash-dot' | 'long-dash'

interface MeasurementStyle {
  endpointStyle: 'dot' | 'arrow' | 'bar' | 'none'
  lineThickness: number
  lineColor: string
  textSize: number
  fillColor: string
  fillOpacity: number
  fillPattern: 'none' | 'solid' | 'diagonal' | 'cross' | 'crosshatch' | 'dots' | 'horizontal'
  // Optional so annotations saved before BLUEPRINT-6M default to 'solid'.
  linePattern?: MeasurementLinePattern
}

const DEFAULT_MEASUREMENT_STYLE: MeasurementStyle = {
  endpointStyle: 'dot',
  lineThickness: 2,
  lineColor: '#38bdf8',
  textSize: 12,
  fillColor: '#38bdf8',
  fillOpacity: 0.15,
  fillPattern: 'none',
  linePattern: 'solid',
}

// BLUEPRINT-6M — maps a distance-line pattern to an SVG strokeDasharray value.
// 'solid' (and any unknown/legacy value) yields undefined = a continuous line.
function measureLineDashArray(pattern: string | undefined): string | undefined {
  switch (pattern) {
    case 'dashed': return '8 6'
    case 'dotted': return '2 5'
    case 'dash-dot': return '8 4 2 4'
    case 'long-dash': return '14 6'
    case 'solid':
    default: return undefined
  }
}

interface OperationsBlueprintPdfViewerProps {
  blueprint: BlueprintLibraryItem | null
  onAnnotationsChanged?: () => void
  selectedPageNumbers?: number[]
  onSelectedPagesChange?: (pages: number[]) => void
  externalPage?: number | null
  /** Page to show when a document first loads (per-document restore). Applied
   *  once at PDF load and clamped to the page count — unlike externalPage it is
   *  not consumed/nulled and is never overwritten by onPageChange, so it survives
   *  the load-time page reset. */
  initialPage?: number
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

// Guide Assist straight-line snap for measurements. Given an anchor and a raw point (both
// in normalized page coords) plus the page pixel size, lock the raw point to the nearest
// axis from the anchor — horizontal or vertical, whichever the movement is closer to in
// ACTUAL pixels (normalized x/y have different pixel scales, so weight by pageW/pageH).
// Operates purely on already-mapped page coords; it never touches pointer/overlay/zoom
// mapping. Returns the raw point unchanged when the movement is degenerate.
function snapMeasurePointToAxis(
  anchor: { x: number; y: number },
  raw: { x: number; y: number },
  pageW: number,
  pageH: number,
): { x: number; y: number } {
  const adx = Math.abs(raw.x - anchor.x) * Math.max(1, pageW)
  const ady = Math.abs(raw.y - anchor.y) * Math.max(1, pageH)
  if (adx === 0 && ady === 0) return raw
  // Closer to horizontal → lock Y to the anchor; otherwise lock X to the anchor.
  return adx >= ady ? { x: raw.x, y: anchor.y } : { x: anchor.x, y: raw.y }
}

/** Map overlay visual pixels → capped-raster page pixels (single annotation coordinate space). */
function overlayPxToPagePx(
  vx: number,
  vy: number,
  overlayW: number,
  overlayH: number,
  pageW: number,
  pageH: number,
) {
  return {
    x: (vx / Math.max(1, overlayW)) * pageW,
    y: (vy / Math.max(1, overlayH)) * pageH,
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

function normRectFromPlacementPreview(preview: PlacementPreviewRectPx, w: number, h: number) {
  return {
    x: clampNorm(preview.left / Math.max(1, w)),
    y: clampNorm(preview.top / Math.max(1, h)),
    w: clampNorm(preview.w / Math.max(1, w), 0, 1),
    h: clampNorm(preview.h / Math.max(1, h), 0, 1),
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

// Stable circuit topology is materialized only for new circuits or at an explicit save/edit
// boundary. Merely loading a legacy circuit remains read-only and does not rewrite the blueprint.
function withEnsuredCircuitTopologyIds(annotation: BlueprintAnnotation): BlueprintAnnotation {
  const meta = getAnnotationMeta(annotation)
  if (!isCircuitShapeKind(meta.shapeKind) || !Array.isArray(meta.points)) return annotation
  const topology = ensureCircuitTopologyIds(meta)
  if (!topology.changed) return annotation
  return withAnnotationMeta(annotation, {
    pointIds: topology.pointIds,
    segmentIds: topology.segmentIds,
  }) as BlueprintAnnotation
}

// Light-output symbol detection — used for glare/glow overlay and Light Output controls.
const LIGHT_OUTPUT_SHAPE_KINDS = new Set<ShapeKind>([
  'can-light-4',
  'can-light-6',
  'electrical-recessed-light',
  'electrical-pendant-light',
  'electrical-sconce',
  'electrical-emergency-exit-sign',
  'electrical-led-panel-2x2',
  'electrical-led-panel-2x4',
])

export function isLightOutputShapeKind(shapeKind: any): shapeKind is ShapeKind {
  return typeof shapeKind === 'string' && LIGHT_OUTPUT_SHAPE_KINDS.has(shapeKind as ShapeKind)
}

// Stable empty set so "no playback running" never produces a fresh identity and re-renders the
// annotation layer on every pass.
const EMPTY_ANNOTATION_ID_SET: Set<string> = new Set()

// Wall-mounted electrical symbols that support rotation to match wall orientation.
// Light fixtures (can lights, recessed/pendant lights, LED panels) intentionally excluded.
const ROTATABLE_ELECTRICAL_SHAPE_KINDS = new Set<ShapeKind>([
  'electrical-receptacle',
  'electrical-receptacle-240v',
  'electrical-switch',
  'electrical-switch-3way',
  'electrical-switch-4way',
  'electrical-dimmer',
  'electrical-sconce',
  'electrical-emergency-exit-sign',
  'electrical-gfci',
  'electrical-photocell',
  'electrical-timer-control',
  'electrical-wall-occupancy-sensor',
])

export function isRotatableElectricalShapeKind(shapeKind: any): shapeKind is ShapeKind {
  return typeof shapeKind === 'string' && ROTATABLE_ELECTRICAL_SHAPE_KINDS.has(shapeKind as ShapeKind)
}

const ROTATION_STEP_DEG = 90

function getAnnotationRotationDeg(meta: Record<string, any> = {}) {
  const raw = Number(meta?.rotationDeg)
  if (!Number.isFinite(raw)) return 0
  const normalized = ((Math.round(raw / ROTATION_STEP_DEG) * ROTATION_STEP_DEG) % 360 + 360) % 360
  return normalized
}

function isLightOutputShape(annotation: any) {
  if (!annotation || annotation.type !== 'shape') return false
  return isLightOutputShapeKind(getAnnotationMeta(annotation).shapeKind)
}

// Can-light detection — used for can-light-specific body rendering (trim ring, aperture).
function isCanLightShape(annotation: any) {
  if (!annotation || annotation.type !== 'shape') return false
  const kind = getAnnotationMeta(annotation).shapeKind
  return kind === 'can-light-4' || kind === 'can-light-6'
}

// Center point of an annotation/shape's bounding rect, in page-normalized (0-1) coordinates.
// This is the single source of truth for Guide Assist targets — Step 13B-QA2 uses only this
// body/annotation center, never edges, corners, bounding-box sides, or glow/output radius.
function getRectCenterNorm(rect: { x: number; y: number; w: number; h: number }) {
  const safe = clampRectToPage(rect)
  return { x: clampNorm(safe.x + safe.w / 2), y: clampNorm(safe.y + safe.h / 2) }
}

// Minimum rect size clampRectToPage will accept — used to express a single point (e.g. a
// Circuit Arc curvature handle) as a rect whose center IS that point, so it can be fed to
// the center-based Guide Assist machinery without introducing an offset.
const GUIDE_POINT_RECT_NORM = 0.01

function calculateAlignmentGuides(
  draftRect: { x: number; y: number; w: number; h: number },
  candidates: BlueprintAnnotation[],
  threshold = ALIGNMENT_GUIDE_THRESHOLD_NORM
): AlignmentGuideLine[] {
  const draftCenter = getRectCenterNorm(draftRect)
  let closestX: { value: number; delta: number; refId: string } | null = null
  let closestY: { value: number; delta: number; refId: string } | null = null

  for (const annotation of candidates) {
    if (!annotation?.rect) continue
    const center = getRectCenterNorm(annotation.rect as any)
    const deltaX = Math.abs(draftCenter.x - center.x)
    if (deltaX <= threshold && (!closestX || deltaX < closestX.delta)) {
      closestX = { value: center.x, delta: deltaX, refId: annotation.id }
    }
    const deltaY = Math.abs(draftCenter.y - center.y)
    if (deltaY <= threshold && (!closestY || deltaY < closestY.delta)) {
      closestY = { value: center.y, delta: deltaY, refId: annotation.id }
    }
  }

  // At most one vertical (x) and one horizontal (y) guide — the single nearest center match
  // on each axis — so multiple competing lines never render at once. refId records the
  // reference annotation so the canvas can highlight it (visual only).
  return [
    ...(closestX ? [{ axis: 'x' as const, value: clampNorm(closestX.value), refId: closestX.refId }] : []),
    ...(closestY ? [{ axis: 'y' as const, value: clampNorm(closestY.value), refId: closestY.refId }] : []),
  ]
}

// Guide Assist soft mode (Step 13D): Guide Assist is now visual-only. It shows alignment guide
// lines and highlights the reference item, but never moves the edited/placed annotation — the
// user's drop position is final. This intentionally returns the rect unchanged so every existing
// call site (move, new placement, arch control-point carry) becomes a no-op translation while
// the guide-line detection/rendering stays exactly as before. Kept as a single choke point so
// forced center-to-center snapping can be reintroduced behind a setting later if ever wanted.
function applyCenterSnap(
  rect: { x: number; y: number; w: number; h: number },
  _guides: AlignmentGuideLine[],
): { x: number; y: number; w: number; h: number } {
  return rect
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

function getLightFixtureRefRadius(shapeKind: ShapeKind) {
  switch (shapeKind) {
    case 'electrical-led-panel-2x4': return 54
    case 'electrical-led-panel-2x2': return 42
    case 'electrical-pendant-light': return 44
    case 'electrical-sconce': return 38
    case 'electrical-recessed-light': return 40
    default: return 46 // can-light-4, can-light-6
  }
}

function getLightOutputGlowMetrics(shapeKind: ShapeKind, meta: Record<string, any>) {
  const fixtureRefR = getLightFixtureRefRadius(shapeKind)
  const lightIntensity = clampNorm(meta.lightIntensity ?? LIGHT_OUTPUT_BASE, LIGHT_OUTPUT_MIN, LIGHT_OUTPUT_MAX)
  return {
    cx: 50,
    cy: 50,
    outputOverlayR: fixtureRefR * lightIntensity,
    kelvinColor: getLightKelvinColor(meta.lightKelvin ?? DEFAULT_CAN_LIGHT_KELVIN),
  }
}

function renderLightOutputGlowSvg(
  glowId: string,
  metrics: ReturnType<typeof getLightOutputGlowMetrics>,
  visible: boolean,
) {
  if (!visible) return null
  return (
    <>
      <defs>
        <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={metrics.kelvinColor} stopOpacity={0.5} />
          <stop offset="55%" stopColor={metrics.kelvinColor} stopOpacity={0.24} />
          <stop offset="100%" stopColor={metrics.kelvinColor} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle
        cx={metrics.cx}
        cy={metrics.cy}
        r={metrics.outputOverlayR}
        fill={`url(#${glowId})`}
        stroke="none"
        style={{ pointerEvents: 'none' }}
      />
    </>
  )
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

// Compact ink bounds (in the symbol's 0-100 viewBox space) for device-type electrical
// symbols whose glyph occupies only a small fraction of the full placed rect — used to
// draw a selection outline that hugs the visible symbol instead of the full annotation
// box. Deliberately excludes light glow (glow is a separate fixed-radius overlay, not
// part of the body) and external labels/badges (rendered outside this box). Symbol
// kinds not listed here (lights, LED panels, can-lights) keep the existing full-box ring.
const ELECTRICAL_SYMBOL_VISUAL_BOUNDS: Partial<Record<ElectricalSymbolKind, { x: number; y: number; w: number; h: number }>> = {
  'electrical-switch': { x: 30, y: 15, w: 40, h: 68 },
  'electrical-switch-3way': { x: 30, y: 15, w: 40, h: 68 },
  'electrical-switch-4way': { x: 30, y: 15, w: 40, h: 68 },
  'electrical-dimmer': { x: 13, y: 15, w: 74, h: 64 },
  'electrical-receptacle': { x: 25, y: 9, w: 50, h: 74 },
  'electrical-receptacle-240v': { x: 25, y: 9, w: 50, h: 74 },
  'electrical-panel': { x: 8, y: 7, w: 84, h: 86 },
  'electrical-gfci': { x: 25, y: 9, w: 50, h: 74 },
  'electrical-sconce': { x: 15, y: 15, w: 47, h: 68 },
  'electrical-emergency-exit-sign': { x: 12, y: 28, w: 76, h: 38 },
  'electrical-photocell': { x: 14, y: 11, w: 78, h: 68 },
  'electrical-timer-control': { x: 13, y: 13, w: 68, h: 64 },
  'electrical-ceiling-occupancy-sensor': { x: 20, y: 17, w: 56, h: 56 },
  'electrical-wall-occupancy-sensor': { x: 26, y: 15, w: 44, h: 60 },
}

export function getElectricalSymbolVisualBounds(kind: ShapeKind) {
  return isElectricalShapeKind(kind) ? ELECTRICAL_SYMBOL_VISUAL_BOUNDS[kind] ?? null : null
}

function getAnnotationVisualBodyRect(annotation: RouteBuilderAnnotation): RouteBuilderAnnotation['rect'] {
  const rect = annotation.rect
  if (!rect) return undefined
  const bounds = annotation.shapeKind ? getElectricalSymbolVisualBounds(annotation.shapeKind as ShapeKind) : null
  if (!bounds) return { ...rect }
  return clampRectToPage({
    x: rect.x + rect.w * (bounds.x / 100),
    y: rect.y + rect.h * (bounds.y / 100),
    w: rect.w * (bounds.w / 100),
    h: rect.h * (bounds.h / 100),
  })
}

export function renderElectricalSymbolSvg(kind: ShapeKind, meta: Record<string, any>, style: {
  borderColor: string
  borderThickness: number
  borderStyle: BorderStyle
  fillColor: string
  fillOpacity: number
  labelsVisible: boolean
  labelScale?: number
  labelCustomColorsEnabled?: boolean
  labelTextColor?: string
  labelBorderColor?: string
  labelFillColor?: string
}, rotationDeg: number = 0, showCompactSelectionBox: boolean = false) {
  const { borderColor, borderThickness, borderStyle, fillColor, fillOpacity, labelsVisible } = style
  // Label-only scale (Symbols Size control) — affects the external label badge/text size only,
  // never the symbol glyph geometry or the annotation box. Defaults to 1 (100%).
  const labelScale = Number.isFinite(style.labelScale) ? Math.max(0.5, Math.min(5, style.labelScale as number)) : 1
  // Label-only color override (Symbols Size popup "Custom Label Colors" toggle). Applies to the
  // external label badge (text/border/fill) only — never the symbol glyph/body/geometry.
  const labelColorsEnabled = !!style.labelCustomColorsEnabled
  const customLabelTextColor = style.labelTextColor
  const customLabelBorderColor = style.labelBorderColor
  const customLabelFillColor = style.labelFillColor
  const dash = borderStyle === 'dashed' ? '8 5' : borderStyle === 'dotted' ? '2 5' : undefined
  const symbolFill = fillColor === 'transparent' ? 'none' : fillColor
  const textFill = borderColor
  const commonText = {
    textAnchor: 'middle' as const,
    dominantBaseline: 'middle' as const,
    fontFamily: 'monospace',
    fontWeight: 800,
    fill: textFill,
  }
  const fineStroke = Math.max(1.4, borderThickness * 0.7)
  const symbolStroke = Math.max(2, borderThickness)
  // externalLabel is always rendered OUTSIDE the rotated body group so labels stay
  // readable at any rotation angle, matching the existing GFCI label pattern.
  const externalLabel = (label: string) => {
    if (!labelsVisible) return null
    // Label badge scales with labelScale (Symbols Size), anchored to its right edge (x=96) and
    // top (y=78) so growing/shrinking text never shifts the symbol glyph.
    const labelWidth = Math.max(22, label.length * 7 + 8) * labelScale
    const labelHeight = 16 * labelScale
    const labelX = 96 - labelWidth
    const labelTop = 78
    const labelTextFill = labelColorsEnabled && customLabelTextColor ? customLabelTextColor : textFill
    const labelBorder = labelColorsEnabled && customLabelBorderColor ? customLabelBorderColor : borderColor
    const labelFill = labelColorsEnabled && customLabelFillColor ? customLabelFillColor : '#0b1020'
    return (
      <g>
        <rect
          x={labelX}
          y={labelTop}
          width={labelWidth}
          height={labelHeight}
          rx={4 * labelScale}
          fill={labelFill}
          fillOpacity="0.82"
          stroke={labelBorder}
          strokeWidth="1.2"
          opacity="0.95"
        />
        <text x={labelX + labelWidth / 2} y={labelTop + labelHeight / 2} fontSize={9.5 * labelScale} {...commonText} fill={labelTextFill}>{label}</text>
      </g>
    )
  }
  const badge = kind === 'electrical-recessed-light' && meta.emergency ? (
    externalLabel('EM')
  ) : null

  // body = the rotatable symbol glyph. label = fixed external badge, never rotated.
  let body: React.ReactNode = null
  let label: React.ReactNode = null

  const switchBody = (
    <>
      <text x="50" y="52" fontSize="52" {...commonText}>S</text>
      <line x1="50" y1="20" x2="50" y2="78" stroke={borderColor} strokeWidth={symbolStroke} strokeLinecap="round" strokeDasharray={dash} />
    </>
  )

  if (kind === 'electrical-switch') {
    body = switchBody
  } else if (kind === 'electrical-switch-3way') {
    // Body matches the regular switch symbol exactly; S3 is an external label, not a custom body.
    body = switchBody
    label = externalLabel('S3')
  } else if (kind === 'electrical-switch-4way') {
    // Body matches the regular switch symbol exactly; S4 is an external label, not a custom body.
    body = switchBody
    label = externalLabel('S4')
  } else if (kind === 'electrical-dimmer') {
    const dimmerLabel = getElectricalSymbolMetadata(kind, meta)?.shortLabel ?? 'DIM'
    body = (
      <>
        <text x="46" y="50" fontSize="48" {...commonText}>S</text>
        <line x1="46" y1="20" x2="46" y2="74" stroke={borderColor} strokeWidth={symbolStroke} strokeLinecap="round" strokeDasharray={dash} />
        <path d="M72 28 L84 28 M74 37 L84 37 M76 46 L84 46" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeLinecap="round" opacity="0.75" />
      </>
    )
    label = externalLabel(dimmerLabel)
  } else if (kind === 'electrical-recessed-light') {
    body = (
      <>
        <circle cx="48" cy="45" r="34" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <circle cx="48" cy="45" r="17" fill="none" stroke={borderColor} strokeWidth={fineStroke} />
        <line x1="18" y1="45" x2="78" y2="45" stroke={borderColor} strokeWidth={Math.max(1, borderThickness * 0.5)} opacity="0.65" />
        <line x1="48" y1="15" x2="48" y2="75" stroke={borderColor} strokeWidth={Math.max(1, borderThickness * 0.5)} opacity="0.65" />
      </>
    )
    label = badge
  } else if (kind === 'electrical-pendant-light') {
    body = (
      <>
        <circle cx="50" cy="16" r="6" fill={symbolFill} stroke={borderColor} strokeWidth={fineStroke} />
        <line x1="50" y1="22" x2="50" y2="52" stroke={borderColor} strokeWidth={symbolStroke} strokeLinecap="round" />
        <path d="M30 54 Q50 72 70 54" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} strokeLinecap="round" />
        <circle cx="50" cy="62" r="13" fill="none" stroke={borderColor} strokeWidth={fineStroke} />
      </>
    )
  } else if (kind === 'electrical-sconce') {
    body = (
      <>
        <line x1="24" y1="20" x2="24" y2="78" stroke={borderColor} strokeWidth={symbolStroke} strokeLinecap="round" />
        <path d="M26 30 A24 20 0 0 1 26 70" fill="none" stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} strokeLinecap="round" />
        <path d="M26 38 L58 28 M26 62 L58 72" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeLinecap="round" opacity="0.7" />
        <circle cx="42" cy="50" r="7" fill={symbolFill} stroke={borderColor} strokeWidth={fineStroke} />
      </>
    )
  } else if (kind === 'electrical-emergency-exit-sign') {
    body = (
      <>
        <rect x="12" y="28" width="76" height="38" rx="3" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <text x="50" y="48" fontSize="20" letterSpacing="0" {...commonText}>EXIT</text>
      </>
    )
  } else if (kind === 'electrical-led-panel-2x2' || kind === 'electrical-led-panel-2x4') {
    const isLong = kind === 'electrical-led-panel-2x4'
    const panelLabel = getElectricalSymbolMetadata(kind, meta)?.shortLabel ?? (isLong ? '2x4' : '2x2')
    body = (
      <>
        <rect x={isLong ? 10 : 18} y={isLong ? 22 : 14} width={isLong ? 78 : 58} height={isLong ? 40 : 58} rx="3" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <line x1={isLong ? 49 : 18} y1={isLong ? 22 : 43} x2={isLong ? 49 : 76} y2={isLong ? 62 : 43} stroke={borderColor} strokeWidth={fineStroke} opacity="0.65" />
        <line x1={isLong ? 10 : 47} y1={isLong ? 42 : 14} x2={isLong ? 88 : 47} y2={isLong ? 42 : 72} stroke={borderColor} strokeWidth={fineStroke} opacity="0.65" />
        <line x1={isLong ? 14 : 24} y1={isLong ? 26 : 20} x2={isLong ? 84 : 70} y2={isLong ? 58 : 66} stroke={borderColor} strokeWidth={Math.max(1, fineStroke * 0.8)} opacity="0.35" />
        <line x1={isLong ? 84 : 70} y1={isLong ? 26 : 20} x2={isLong ? 14 : 24} y2={isLong ? 58 : 66} stroke={borderColor} strokeWidth={Math.max(1, fineStroke * 0.8)} opacity="0.35" />
      </>
    )
    label = externalLabel(panelLabel)
  } else if (kind === 'electrical-panel') {
    body = (
      <>
        <rect x="8" y="7" width="84" height="86" rx="5" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <rect x="18" y="18" width="64" height="64" rx="3" fill="none" stroke={borderColor} strokeWidth={fineStroke} opacity="0.72" />
        <line x1="28" y1="30" x2="72" y2="30" stroke={borderColor} strokeWidth={Math.max(1, fineStroke * 0.8)} strokeLinecap="round" opacity="0.55" />
        <line x1="28" y1="70" x2="72" y2="70" stroke={borderColor} strokeWidth={Math.max(1, fineStroke * 0.8)} strokeLinecap="round" opacity="0.55" />
        <text x="50" y="52" fontSize="20" letterSpacing="0" {...commonText}>PNL</text>
      </>
    )
  } else if (kind === 'electrical-gfci' || kind === 'electrical-receptacle') {
    const symbolLabel = getElectricalSymbolMetadata(kind, meta)?.shortLabel ?? (kind === 'electrical-gfci' ? 'GFCI' : 'REC')
    body = (
      <>
        <path d="M30 24 Q50 12 70 24 L70 66 Q50 78 30 66 Z" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <circle cx="50" cy="35" r="9" fill="none" stroke={borderColor} strokeWidth={fineStroke} />
        <circle cx="50" cy="58" r="9" fill="none" stroke={borderColor} strokeWidth={fineStroke} />
        <line x1="45" y1="35" x2="55" y2="35" stroke={borderColor} strokeWidth={fineStroke} />
        <line x1="45" y1="58" x2="55" y2="58" stroke={borderColor} strokeWidth={fineStroke} />
        {kind === 'electrical-gfci' && <line x1="39" y1="47" x2="61" y2="47" stroke={borderColor} strokeWidth={fineStroke} opacity="0.75" />}
      </>
    )
    label = externalLabel(symbolLabel)
  } else if (kind === 'electrical-receptacle-240v') {
    const v240Label = getElectricalSymbolMetadata(kind, meta)?.shortLabel ?? '240V'
    // 240V receptacle: same outlet-face silhouette as Standard Receptacle, but with angled
    // (diagonal) blade slots instead of round slots, a round ground hole below, and a thicker
    // outline — reads as a distinct high-voltage outlet at a glance, never touches the
    // Standard Receptacle glyph above.
    const heavyStroke = Math.max(3, borderThickness * 1.4)
    body = (
      <>
        <path d="M28 22 Q50 10 72 22 L72 68 Q50 80 28 68 Z" fill={symbolFill} stroke={borderColor} strokeWidth={heavyStroke} strokeDasharray={dash} />
        <line x1="38" y1="30" x2="48" y2="42" stroke={borderColor} strokeWidth={symbolStroke} strokeLinecap="round" />
        <line x1="62" y1="30" x2="52" y2="42" stroke={borderColor} strokeWidth={symbolStroke} strokeLinecap="round" />
        <circle cx="50" cy="58" r="7" fill="none" stroke={borderColor} strokeWidth={fineStroke} />
      </>
    )
    label = externalLabel(v240Label)
  } else if (kind === 'electrical-timer-control') {
    const timerLabel = getElectricalSymbolMetadata(kind, meta)?.shortLabel ?? 'TMR'
    body = (
      <>
        <rect x="18" y="18" width="58" height="54" rx="5" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <circle cx="47" cy="43" r="15" fill="none" stroke={borderColor} strokeWidth={fineStroke} />
        <line x1="47" y1="43" x2="47" y2="33" stroke={borderColor} strokeWidth={fineStroke} strokeLinecap="round" />
        <line x1="47" y1="43" x2="57" y2="49" stroke={borderColor} strokeWidth={fineStroke} strokeLinecap="round" />
        <circle cx="27" cy="27" r="2.5" fill={borderColor} />
        <circle cx="67" cy="27" r="2.5" fill={borderColor} />
      </>
    )
    label = externalLabel(timerLabel)
  } else if (kind === 'electrical-photocell') {
    const photocellLabel = getElectricalSymbolMetadata(kind, meta)?.shortLabel ?? 'PC'
    body = (
      <>
        <circle cx="46" cy="45" r="27" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <path d="M25 45 Q46 26 67 45 Q46 64 25 45 Z" fill="none" stroke={borderColor} strokeWidth={fineStroke} />
        <circle cx="46" cy="45" r="6" fill={borderColor} />
        <path d="M72 23 L80 15 M76 44 L88 44 M72 65 L80 73" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeLinecap="round" opacity="0.75" />
      </>
    )
    label = externalLabel(photocellLabel)
  } else if (kind === 'electrical-ceiling-occupancy-sensor') {
    const sensorLabel = getElectricalSymbolMetadata(kind, meta)?.shortLabel ?? 'OS-C'
    body = (
      <>
        <circle cx="48" cy="45" r="28" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <path d="M48 26 A19 19 0 0 1 64.5 35.5 M64.5 54.5 A19 19 0 0 1 48 64 M31.5 54.5 A19 19 0 0 1 31.5 35.5" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeLinecap="round" opacity="0.78" />
        <circle cx="48" cy="45" r="7" fill={borderColor} />
        <circle cx="48" cy="45" r="3" fill={symbolFill} />
      </>
    )
    label = externalLabel(sensorLabel)
  } else if (kind === 'electrical-wall-occupancy-sensor') {
    const sensorLabel = getElectricalSymbolMetadata(kind, meta)?.shortLabel ?? 'OS-W'
    body = (
      <>
        <rect x="26" y="15" width="44" height="60" rx="5" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <path d="M34 34 Q48 23 62 34 Q48 45 34 34 Z" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeLinejoin="round" />
        <circle cx="48" cy="34" r="4" fill={borderColor} />
        <path d="M39 52 Q48 59 57 52 M35 57 Q48 68 61 57" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeLinecap="round" opacity="0.78" />
      </>
    )
    label = externalLabel(sensorLabel)
  } else if (kind === 'electrical-smoke-alarm') {
    const smokeLabel = getElectricalSymbolMetadata(kind, meta)?.shortLabel ?? 'SA'
    // Ceiling-mounted smoke detector: circular detector base + inner ring, with stacked wavy
    // "smoke plume" lines inside the body. The wavy plume reads clearly as smoke and keeps it
    // distinct from the CO Alarm (straight horizontal vent slots).
    body = (
      <>
        <circle cx="48" cy="45" r="30" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <circle cx="48" cy="45" r="21" fill="none" stroke={borderColor} strokeWidth={fineStroke} opacity="0.5" />
        <path d="M35 53 q6.5 -7 13 0 t13 0" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeLinecap="round" />
        <path d="M35 45 q6.5 -7 13 0 t13 0" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeLinecap="round" />
        <path d="M35 37 q6.5 -7 13 0 t13 0" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeLinecap="round" opacity="0.8" />
      </>
    )
    label = externalLabel(smokeLabel)
  } else if (kind === 'electrical-co-alarm') {
    const coLabel = getElectricalSymbolMetadata(kind, meta)?.shortLabel ?? 'CO'
    // Ceiling/wall CO detector: outer body, inner ring, horizontal vent slots.
    body = (
      <>
        <circle cx="48" cy="45" r="30" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <circle cx="48" cy="45" r="18" fill="none" stroke={borderColor} strokeWidth={fineStroke} />
        <path d="M40 38 L56 38 M38 45 L58 45 M40 52 L56 52" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeLinecap="round" opacity="0.7" />
      </>
    )
    label = externalLabel(coLabel)
  } else if (kind === 'electrical-hdmi') {
    const hdmiLabel = getElectricalSymbolMetadata(kind, meta)?.shortLabel ?? 'HDMI'
    // HDMI wall plate: trapezoidal HDMI connector mouth inside a plate outline.
    body = (
      <>
        <rect x="22" y="26" width="52" height="38" rx="4" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <path d="M34 40 L62 40 L58 52 L38 52 Z" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeLinejoin="round" />
        <path d="M40 44 L56 44" stroke={borderColor} strokeWidth={Math.max(1, fineStroke * 0.8)} strokeLinecap="round" opacity="0.7" />
      </>
    )
    label = externalLabel(hdmiLabel)
  } else if (kind === 'electrical-data') {
    const dataLabel = getElectricalSymbolMetadata(kind, meta)?.shortLabel ?? 'DATA'
    // Data / network jack: RJ45-style keyed port inside a plate outline.
    body = (
      <>
        <rect x="24" y="26" width="48" height="40" rx="4" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <path d="M36 38 L60 38 L60 52 L54 52 L54 57 L42 57 L42 52 L36 52 Z" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeLinejoin="round" />
        <path d="M41 42 L41 48 M48 42 L48 48 M55 42 L55 48" stroke={borderColor} strokeWidth={Math.max(1, fineStroke * 0.75)} strokeLinecap="round" opacity="0.65" />
      </>
    )
    label = externalLabel(dataLabel)
  }

  if (!body) return null
  const visualBounds = showCompactSelectionBox ? getElectricalSymbolVisualBounds(kind) : null
  const compactSelectionBox = visualBounds ? (
    <rect
      x={visualBounds.x}
      y={visualBounds.y}
      width={visualBounds.w}
      height={visualBounds.h}
      rx="4"
      fill="none"
      stroke="#ffffff"
      strokeWidth="2"
      strokeOpacity="0.85"
      vectorEffect="non-scaling-stroke"
    />
  ) : null
  const bodyWithSelectionBox = compactSelectionBox ? <>{body}{compactSelectionBox}</> : body
  const rotatedBody = rotationDeg
    ? <g transform={`rotate(${rotationDeg} 50 50)`}>{bodyWithSelectionBox}</g>
    : bodyWithSelectionBox
  return (
    <>
      {rotatedBody}
      {label}
    </>
  )
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

const DETECTED_SCALES_STORAGE_VERSION = 2

function getDetectedScalesStorageKey(blueprintId: string) {
  return `blueprint_detected_scales_v${DETECTED_SCALES_STORAGE_VERSION}_${blueprintId}`
}

/** Join PDF text-layer items and normalize common quote/whitespace variants for scale parsing. */
function normalizeBlueprintPdfText(textItems: string[]): string {
  return textItems
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\u2044/g, '/')
    .replace(/[\u2018\u2019\u2032\u0060]/g, "'")
    .replace(/[\u201C\u201D\u2033\u2036]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u00B0/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Compact parser-friendly variant — collapses fragmented CAD/PDF scale extraction. */
function buildBlueprintScaleParserText(displayText: string): string {
  return displayText
    .replace(/\u00BC/g, '1/4')
    .replace(/\u00BD/g, '1/2')
    .replace(/\u00BE/g, '3/4')
    .replace(/(\d+)\s*\/\s*(\d+)/g, '$1/$2')
    .replace(/(\d+\/\d+)\s+(?:"|''|in(?:ch(?:es)?)?)\b/gi, '$1"')
    .replace(/(?<!\d\/)(\d{1,2})\s+(?:"|''|in(?:ch(?:es)?)?)\b/gi, '$1"')
    .replace(/\b1\s*['′]\s*-\s*0\b/gi, "1'-0")
    .replace(/\b1\s*['′]\s+0\b/gi, "1'-0")
    .replace(/\b1\s*-\s*0\b/g, "1'-0")
    .replace(/\b1\s*['′]\b(?!\s*[-\d])/gi, "1'")
    .replace(/\s*=\s*/g, '=')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function isNotToScaleMarker(text: string): boolean {
  return /\bN\.?\s*T\.?\s*S\.?\b/i.test(text)
    || /\bNTS\b/i.test(text)
    || /\bNOT\s+TO\s+SCALE\b/i.test(text)
}

function pushScaleCandidate(
  candidates: DetectedScaleCandidate[],
  parsedScale: string,
  realWidthFeet: number,
  confidence: number,
  sourceText: string,
) {
  const rw = realWidthFeet
  if (!candidates.some((c) => Math.abs(c.realWidthFeet - rw) / Math.max(0.001, rw) < 0.05)) {
    candidates.push({ parsedScale: parsedScale.trim(), realWidthFeet: rw, confidence, sourceText: sourceText.trim() })
  }
}

function collectBlueprintScaleCandidates(text: string, paperWidthInches: number): DetectedScaleCandidate[] {
  const candidates: DetectedScaleCandidate[] = []
  if (!text) return candidates

  const inchUnit = '(?:"|\'\'|in(?:ch(?:es)?)?)?'
  const oneFoot = `(?:1\\s*['′]\\s*-\\s*0|1\\s*-\\s*0|1\\s*['′]\\s+0)\\s*${inchUnit}|1\\s*(?:ft|feet|foot)\\b`
  const oneFootShort = `1\\s*['′](?!\\s*[-\\d])|1\\s*(?:ft|feet|foot)\\b`

  let m: RegExpExecArray | null

  const fracFeetInchesRe = new RegExp(`(\\d+)\\s*\\/\\s*(\\d+)\\s*${inchUnit}?\\s*=\\s*(?:${oneFoot})`, 'gi')
  while ((m = fracFeetInchesRe.exec(text)) !== null) {
    if (isNotToScaleMarker(m[0])) continue
    const num = parseInt(m[1], 10)
    const den = parseInt(m[2], 10)
    if (num > 0 && den > 0) {
      const S = den / num
      pushScaleCandidate(candidates, m[0], paperWidthInches * S, 0.95, m[0])
    }
  }

  const fracFeetOnlyRe = new RegExp(`(\\d+)\\s*\\/\\s*(\\d+)\\s*${inchUnit}?\\s*=\\s*(?:${oneFootShort})`, 'gi')
  while ((m = fracFeetOnlyRe.exec(text)) !== null) {
    if (isNotToScaleMarker(m[0])) continue
    const num = parseInt(m[1], 10)
    const den = parseInt(m[2], 10)
    if (num > 0 && den > 0) {
      const S = den / num
      pushScaleCandidate(candidates, m[0], paperWidthInches * S, 0.9, m[0])
    }
  }

  const intFeetInchesRe = new RegExp(`(?<!\\d\\/)(\\d{1,2})\\s*${inchUnit}\\s*=\\s*(?:${oneFoot})`, 'gi')
  while ((m = intFeetInchesRe.exec(text)) !== null) {
    if (isNotToScaleMarker(m[0])) continue
    const num = parseInt(m[1], 10)
    if (num > 0 && num <= 24) {
      const S = 1 / num
      pushScaleCandidate(candidates, m[0], paperWidthInches * S, 0.85, m[0])
    }
  }

  const intFeetOnlyRe = new RegExp(`(?<!\\d\\/)(\\d{1,2})\\s*${inchUnit}\\s*=\\s*(?:${oneFootShort})`, 'gi')
  while ((m = intFeetOnlyRe.exec(text)) !== null) {
    if (isNotToScaleMarker(m[0])) continue
    const num = parseInt(m[1], 10)
    if (num > 0 && num <= 24) {
      const S = 1 / num
      pushScaleCandidate(candidates, m[0], paperWidthInches * S, 0.8, m[0])
    }
  }

  const ratioRe = /(?:scale\s*[=:]?\s*)?1\s*:\s*(\d+)/gi
  while ((m = ratioRe.exec(text)) !== null) {
    if (isNotToScaleMarker(m[0])) continue
    const ratio = parseInt(m[1], 10)
    if (ratio >= 5 && ratio <= 10000) {
      const rw = paperWidthInches * (ratio / 12)
      pushScaleCandidate(candidates, m[0], rw, 0.75, m[0])
    }
  }

  return candidates
}

// Best-effort blueprint scale text detection from PDF text items.
// Returns null if no recognisable scale found.
function detectBlueprintScaleText(
  textItems: string[],
  pageWidthPts: number,
  pageNumber: number,
): DetectedScaleResult | null {
  const joined = normalizeBlueprintPdfText(textItems)
  if (!joined) return null

  const paperWidthInches = pageWidthPts / 72
  const parserText = buildBlueprintScaleParserText(joined)
  const parseSources = parserText === joined ? [joined] : [joined, parserText]

  const candidates: DetectedScaleCandidate[] = []
  for (const source of parseSources) {
    for (const c of collectBlueprintScaleCandidates(source, paperWidthInches)) {
      pushScaleCandidate(candidates, c.parsedScale, c.realWidthFeet, c.confidence, c.sourceText)
    }
  }

  if (candidates.length === 0) return null

  // Deduplicate within 5% relative tolerance
  const deduped: DetectedScaleCandidate[] = []
  for (const c of candidates) {
    if (!deduped.some((d) => Math.abs(d.realWidthFeet - c.realWidthFeet) / Math.max(0.001, c.realWidthFeet) < 0.05)) {
      deduped.push(c)
    }
  }
  return { pageNumber, candidates: deduped, ambiguous: deduped.length > 1, detectedAt: new Date().toISOString() }
}

function buildNormTextItems(rawItems: any[], pageW: number, pageH: number) {
  return rawItems
    .filter((it: any) => it.str?.trim())
    .map((it: any) => {
      const tx: number = it.transform?.[4] ?? 0
      const ty: number = it.transform?.[5] ?? 0
      const iw: number = Math.abs(it.width ?? 0)
      const ih: number = Math.abs(it.transform?.[3] ?? 12)
      return {
        x: tx / Math.max(1, pageW),
        y: 1 - (ty + ih) / Math.max(1, pageH),
        w: iw / Math.max(1, pageW),
        h: ih / Math.max(1, pageH),
      }
    })
    .filter((it: any) => it.w > 0.001 && it.h > 0.001)
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

// ── Circuit Arc Path (CIRCUITARC) geometry ────────────────────────────────────
// A circuit-arc stores N points plus N-1 quadratic Bezier control points, all in
// absolute page-normalized space (same convention as arch-line's archCtrlX/Y).
//
// Absolute control points -- rather than arch-line's legacy archFactor scalar -- are
// what make this work past 2 points. The renderer maps page space into the
// annotation-local `viewBox="0 0 100 100"` under preserveAspectRatio="none", a
// non-uniform scale. A quadratic Bezier is affine-invariant, so pushing each control
// point through the *same* transform as its endpoints reproduces the curve exactly at
// any point count. A perpendicular-offset scalar would instead be skewed per segment,
// by an amount that varies with each segment's orientation relative to the path bbox.

// A renderer must never emit path/polyline coordinate data containing NaN or Infinity.
// Chrome discards the malformed command and draws nothing visible, but WebKit/Safari has
// historically painted broken geometry as a filled region rather than failing silently —
// so a single bad value shows up as a solid block on iPad and as nothing on desktop.
// Non-finite points reach here the same way non-finite control points do (a partial write
// or a cross-device merge), which getCircuitArcControl already defends against; this is the
// matching guard for the points array and the rect the transform divides by.
function hasFinitePointGeometry(
  points: Array<{ x: number; y: number }>,
  rect: { x: number; y: number; w: number; h: number },
) {
  if (![rect.x, rect.y, rect.w, rect.h].every((v) => Number.isFinite(v))) return false
  return points.length > 0 && points.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
}

// Reads the control point for segment i, falling back to the segment midpoint (which
// makes the quadratic degenerate to a straight line) when arcCtrls is short, missing,
// or holds a non-finite value from a partial write or a cross-device merge.
function getCircuitArcControl(
  arcCtrls: any,
  a: { x: number; y: number },
  b: { x: number; y: number },
  i: number,
): { x: number; y: number } {
  return getSharedCircuitArcControl(arcCtrls, a, b, i)
}

// Seeds one control point per segment with a gentle perpendicular bulge. The offset is
// computed in PIXEL space and converted back once -- deriving it from normalized deltas
// distorts the bulge on non-square pages (same lesson as the arch-line commit path).
function seedCircuitArcControls(
  points: Array<{ x: number; y: number }>,
  displayW: number,
  displayH: number,
): Array<{ x: number; y: number }> {
  const w = Math.max(1, displayW)
  const h = Math.max(1, displayH)
  const ctrls: Array<{ x: number; y: number }> = []
  for (let i = 1; i < points.length; i++) {
    const x1 = points[i - 1].x * w, y1 = points[i - 1].y * h
    const x2 = points[i].x * w, y2 = points[i].y * h
    const cxPx = (x1 + x2) / 2 + CIRCUIT_ARC_DEFAULT_BULGE * (y2 - y1)
    const cyPx = (y1 + y2) / 2 - CIRCUIT_ARC_DEFAULT_BULGE * (x2 - x1)
    ctrls.push({ x: clampNorm(cxPx / w), y: clampNorm(cyPx / h) })
  }
  return ctrls
}

// Flattens the curved path into a dense polyline so the existing polyline-length
// measurement helpers report TRUE arc length rather than the straight chord sum.
function sampleCircuitArcPolyline(
  points: Array<{ x: number; y: number }>,
  arcCtrls: any,
): Array<{ x: number; y: number }> {
  return sampleSharedCircuitArcPolyline(points, arcCtrls)
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

/** Protect in-flight / just-saved annotations from a stale backup reload. */
function mergeVisibleAnnotationsWithLocalPending(
  loadedAnnotations: BlueprintAnnotation[],
  currentAnnotations: BlueprintAnnotation[],
): BlueprintAnnotation[] {
  const parseMs = (value?: string) => {
    const ms = Date.parse(String(value || ''))
    return Number.isFinite(ms) ? ms : 0
  }

  const byId = new Map<string, BlueprintAnnotation>()
  for (const ann of Array.isArray(loadedAnnotations) ? loadedAnnotations : []) {
    const id = String(ann?.id || '').trim()
    if (!id) continue
    byId.set(id, ann)
  }

  for (const local of Array.isArray(currentAnnotations) ? currentAnnotations : []) {
    const id = String(local?.id || '').trim()
    if (!id) continue
    const loaded = byId.get(id)
    if (!loaded) {
      // Local-only id missing from loaded snapshot — keep it.
      byId.set(id, local)
      continue
    }

    const localUpdatedMs = parseMs(local.updatedAt)
    const loadedUpdatedMs = parseMs(loaded.updatedAt)
    const loadedDeletedMs = parseMs((loaded as BlueprintAnnotation & { deletedAt?: string }).deletedAt)
    // Explicit newer tombstone wins over local live edit.
    if (loadedDeletedMs > 0 && loadedDeletedMs > localUpdatedMs) {
      byId.delete(id)
      continue
    }
    // Local/current wins when updatedAt is newer or equal.
    if (localUpdatedMs >= loadedUpdatedMs) {
      byId.set(id, local)
    }
  }

  const out: BlueprintAnnotation[] = []
  const seen = new Set<string>()
  for (const ann of Array.isArray(loadedAnnotations) ? loadedAnnotations : []) {
    const id = String(ann?.id || '').trim()
    if (!id || seen.has(id)) continue
    const winner = byId.get(id)
    if (!winner) continue
    if ((winner as BlueprintAnnotation & { deletedAt?: string }).deletedAt) continue
    out.push(winner)
    seen.add(id)
  }
  for (const local of Array.isArray(currentAnnotations) ? currentAnnotations : []) {
    const id = String(local?.id || '').trim()
    if (!id || seen.has(id)) continue
    const winner = byId.get(id)
    if (!winner) continue
    if ((winner as BlueprintAnnotation & { deletedAt?: string }).deletedAt) continue
    out.push(winner)
    seen.add(id)
  }
  return out
}

function cloneAnnotationForHistory(annotation: BlueprintAnnotation | null | undefined): BlueprintAnnotation | null {
  return annotation ? JSON.parse(JSON.stringify(annotation)) as BlueprintAnnotation : null
}

function annotationHistorySnapshotsEqual(
  left: BlueprintAnnotation | null | undefined,
  right: BlueprintAnnotation | null | undefined,
): boolean {
  return areAnnotationSnapshotsEqual(left, right)
}

function BlueprintPageThumbnail({
  pdfDoc,
  pageNumber,
  isActive,
  onSelect,
}: {
  pdfDoc: any
  pageNumber: number
  isActive: boolean
  onSelect: () => void
}) {
  const hostRef = useRef<HTMLButtonElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [shouldRender, setShouldRender] = useState(isActive)
  const [previewReady, setPreviewReady] = useState(false)

  useEffect(() => {
    if (shouldRender || !hostRef.current || typeof IntersectionObserver === 'undefined') {
      setShouldRender(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldRender(true)
          observer.disconnect()
        }
      },
      { rootMargin: '160px' },
    )
    observer.observe(hostRef.current)
    return () => observer.disconnect()
  }, [shouldRender])

  useEffect(() => {
    if (!shouldRender || !pdfDoc || !canvasRef.current) return
    let cancelled = false
    let renderTask: any = null

    void (async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber)
        if (cancelled || !canvasRef.current) return
        const baseViewport = page.getViewport({ scale: 1 })
        const scale = Math.min(168 / baseViewport.width, 116 / baseViewport.height)
        const viewport = page.getViewport({ scale: Math.max(0.1, scale) })
        const canvas = canvasRef.current
        const context = canvas.getContext('2d')
        if (!context) return
        canvas.width = Math.max(1, Math.ceil(viewport.width))
        canvas.height = Math.max(1, Math.ceil(viewport.height))
        renderTask = page.render({ canvasContext: context, viewport })
        await renderTask.promise
        if (!cancelled) setPreviewReady(true)
      } catch (previewError: any) {
        if (!cancelled && previewError?.name !== 'RenderingCancelledException') {
          setPreviewReady(false)
        }
      }
    })()

    return () => {
      cancelled = true
      try { renderTask?.cancel?.() } catch { /* preview already finished */ }
    }
  }, [pdfDoc, pageNumber, shouldRender])

  return (
    <button
      ref={hostRef}
      type="button"
      onClick={onSelect}
      className={`group flex min-h-[158px] flex-col items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors ${
        isActive
          ? 'border-blue-500 bg-blue-900/30 text-blue-100'
          : 'border-gray-700 bg-gray-900/50 text-gray-300 hover:border-gray-500 hover:bg-gray-800/70 hover:text-white'
      }`}
      aria-current={isActive ? 'page' : undefined}
      title={`Go to page ${pageNumber}`}
    >
      <span className="relative flex h-[116px] w-full items-center justify-center overflow-hidden rounded bg-white/95 shadow-inner">
        {!previewReady && <Loader2 size={16} className="absolute animate-spin text-gray-500" />}
        <canvas
          ref={canvasRef}
          className={`max-h-[116px] max-w-full transition-opacity ${previewReady ? 'opacity-100' : 'opacity-0'}`}
          aria-hidden="true"
        />
      </span>
      <span className="text-xs font-semibold tabular-nums">Page {pageNumber}</span>
    </button>
  )
}

function annotationLabel(annotation: BlueprintAnnotation) {
  if (annotation.type === 'textBox') return 'Insert Text'
  if (annotation.type === 'callout') return 'Callout'
  if (annotation.type === 'generate') return getAnnotationMeta(annotation).questionType === 'rfi' ? 'RFI Question' : 'Coordination Question'
  if (annotation.type === 'pen') return 'Pen'
  if (annotation.type === 'marker') return 'Marker'
  if (annotation.type === 'shape') {
    const meta = getAnnotationMeta(annotation)
    return getShapeKindLabel(meta.shapeKind || 'shape', meta)
  }
  if (annotation.type === 'underline') return 'Underline'
  if (annotation.type === 'measure-distance') return 'Distance'
  if (annotation.type === 'measure-area') return 'Area'
  if (annotation.type === 'measure-perimeter') return 'Perimeter'
  if (annotation.type === 'calibrate') return 'Calibration'
  return String(annotation.type || 'annotation')
}

// BLUEPRINT-6Q — compact measured value shown after the Distance/Perimeter title in the
// annotations panel (e.g. "Distance — 10'-3"", "Perimeter — Total: 32'-6""). Prefers the live
// real-world value + unit, re-formatted with the architectural feet/inches helper, and falls
// back to the stored meta.label (which already carries a "Total:" prefix for perimeter, so we
// never double it). Returns '' for area and any non-length annotation — area is unchanged.
function measurementPanelValue(annotation: BlueprintAnnotation): string {
  const meta = getAnnotationMeta(annotation)
  const unit = meta.unit || 'ft'
  if (annotation.type === 'measure-distance') {
    if (typeof meta.realWorldDistance === 'number' && Number.isFinite(meta.realWorldDistance)) {
      return formatArchitecturalLength(meta.realWorldDistance, unit)
    }
    return typeof meta.label === 'string' ? meta.label : ''
  }
  if (annotation.type === 'measure-perimeter') {
    if (typeof meta.realWorldPerimeter === 'number' && Number.isFinite(meta.realWorldPerimeter)) {
      return `Total: ${formatArchitecturalLength(meta.realWorldPerimeter, unit)}`
    }
    // meta.label already reads "Total: …" (or an uncalibrated hint) — reuse it as-is.
    return typeof meta.label === 'string' ? meta.label : ''
  }
  return ''
}

// Mirrors the exact color-resolution priority used by the canvas renderer
// (see the `a.type === 'shape'` branch: `meta.borderColor || (a.color || default)`)
// so the annotations-list dot always matches what the user sees drawn on the
// page — covers electrical symbols, can lights, generic shapes, lines, arc
// lines, circuit paths, and polylines (all stored as `type: 'shape'`, with
// their live border color in `meta.borderColor` once edited post-placement,
// since the color popover writes edits there rather than back onto `a.color`).
function getAnnotationDisplayColor(annotation: BlueprintAnnotation, fallback = '#facc15') {
  const meta = getAnnotationMeta(annotation)
  if (annotation.type === 'shape' && meta.borderColor) return meta.borderColor
  return annotation.color || fallback
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
  initialPage = 1,
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
  // Mirrors isolatedAnnotationIdSet (Work Package isolate) so Guide Assist can filter targets
  // without depending on a hook declared later in the component (avoids TDZ ordering issues).
  const isolatedAnnotationIdSetRef = useRef<Set<string> | null>(null)
  const inlineTextOriginalRef = useRef<string>('')
  const inlineTextBoxEditorRef = useRef<HTMLDivElement | null>(null)
  const cancelTextBoxEditSessionRef = useRef<() => void>(() => {})
  const focusedAnnotationElRef = useRef<HTMLElement | null>(null)
  const isSavingTextBoxRef = useRef(false)
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve())
  const annotationHistoryRef = useRef(createCommandHistory())
  const persistedAnnotationSnapshotsRef = useRef<Map<string, BlueprintAnnotation>>(new Map())
  const [annotationHistoryRevision, setAnnotationHistoryRevision] = useState(0)
  const [isAnnotationHistoryBusy, setIsAnnotationHistoryBusy] = useState(false)
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
  // Step 13B-QA7-R6: the ONE fullscreen vertical content scroller (from R5) —
  // holds the document work-screen + annotations below it. We attach a custom
  // OVERLAY scroll handle to it so touch users (iOS overlay scrollbars ignore
  // CSS) and mouse users get a big, grabbable affordance to move between the
  // document and the annotations. The overlay is position:absolute so it adds
  // ZERO layout width — the document display size / fit-scale are unaffected,
  // and there is no hover reflow. Native scrollbars are left untouched.
  const fullscreenScrollerRef = useRef<HTMLDivElement>(null)
  const fsThumbDragRef = useRef<{ startY: number; startScrollTop: number } | null>(null)
  const [fsRail, setFsRail] = useState<{ show: boolean; top: number; height: number; thumbTop: number; thumbH: number }>({
    show: false, top: 0, height: 0, thumbTop: 0, thumbH: 0,
  })
  // Draft rect DOM ref Ã¢â‚¬â€ mutated directly during pointer-move for zero-lag
  // visual feedback (bypasses React re-renders entirely during active drag).
  const draftRectDomRef = useRef<HTMLDivElement>(null)
  const draftLineDomRef = useRef<SVGLineElement>(null)
  const draftArchPathDomRef = useRef<SVGPathElement>(null)
  const alignmentGuideSvgRef = useRef<SVGSVGElement>(null)
  const activeAlignmentGuidesRef = useRef<AlignmentGuideLine[]>([])
  const activeAlignmentGuideSignatureRef = useRef('')
  const scopeLayersPanelRef = useRef<HTMLDivElement | null>(null)
  // Point-to-point line placement: stores the first click position (pixel coords within overlay).
  const lineFirstPointRef = useRef<{ x: number; y: number } | null>(null)
  // Tracks how many annotation mutations are in-flight so loadAnnotations() fires only when the queue drains.
  const pendingAnnotationMutationsRef = useRef(0)
  // BLUEPRINT-6Q — render-visible mirror of the in-flight save counter. Feeds isBlueprintDirty so
  // the live/realtime cloud refresh (which silently OVERWRITES local storage with the remote
  // snapshot) is suppressed while an annotation save is still committing. Without this, the
  // realtime event fired by our own push (~1-2s after placement) could apply a remote snapshot
  // that predates the new annotation and wipe it off the canvas.
  const [hasPendingAnnotationSaves, setHasPendingAnnotationSaves] = useState(false)
  // BLUEPRINT-6R — synchronous ref-based guards. State/effect propagation of the dirty
  // scope is too slow to beat the realtime refresh fired by our own annotation push, so the
  // remote-apply reload path is gated directly on these refs (updated synchronously inside
  // persistAnnotation). Timestamps add a short grace window covering the moment right after a
  // save settles, when a racing remote snapshot can still predate the new annotation.
  const lastAnnotationSaveStartedAtRef = useRef(0)
  const lastAnnotationSaveFinishedAtRef = useRef(0)
  // Set when any queued save in the current batch failed, so the drain does not reload from an
  // unchanged backup and wipe the optimistic annotation.
  const annotationSaveErrorRef = useRef(false)
  const pendingScrollResetRef = useRef(false)
  const relativeZoomRef = useRef(1)
  // The relative zoom the CURRENT canvas raster actually represents. Below the
  // raster budget this equals the committed relativeZoom; once the budget caps
  // the canvas, renderedZoom stays at the cap and the remainder of the user's
  // zoom is expressed via the CSS visualScale transform on the page frame.
  const renderedZoomRef = useRef(1)
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
  // Latest requested restore page, read synchronously by loadPdf (which is async)
  // so the freshest per-document page is applied without re-creating the callback.
  const initialPageRef = useRef(1)
  initialPageRef.current = Math.max(1, Math.floor(Number(initialPage) || 1))
  const [pageInput, setPageInput] = useState('1')
  const [pageIndexOpen, setPageIndexOpen] = useState(false)
  const pageIndexRef = useRef<HTMLDivElement>(null)
  const pageIndexTriggerRef = useRef<HTMLDivElement>(null)
  const [relativeZoom, setRelativeZoom] = useState(1)
  // State mirror of renderedZoomRef so the JSX visualScale recomputes when a
  // freshly committed raster changes what zoom the canvas represents.
  const [renderedZoom, setRenderedZoom] = useState(1)
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
  useEffect(() => {
    if (!pageIndexOpen) return
    const closePageIndex = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node
      if (!pageIndexRef.current?.contains(target) && !pageIndexTriggerRef.current?.contains(target)) {
        setPageIndexOpen(false)
      }
    }
    const closePageIndexOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPageIndexOpen(false)
    }
    document.addEventListener('mousedown', closePageIndex)
    document.addEventListener('touchstart', closePageIndex, { passive: true })
    document.addEventListener('keydown', closePageIndexOnEscape)
    return () => {
      document.removeEventListener('mousedown', closePageIndex)
      document.removeEventListener('touchstart', closePageIndex)
      document.removeEventListener('keydown', closePageIndexOnEscape)
    }
  }, [pageIndexOpen])
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
  const [selectedForPackageIds, setSelectedForPackageIds] = useState<Set<string>>(new Set())
  const [scopeLayers, setScopeLayers] = useState<BlueprintScopeLayer[]>([])
  // Canonical scope-layer snapshot for callbacks that must not read a render-stale package
  // (notably opening the animation route builder from a package card). Assigned during render
  // so it is never a commit behind the state it mirrors.
  const scopeLayersRef = useRef<BlueprintScopeLayer[]>(scopeLayers)
  scopeLayersRef.current = scopeLayers
  /** Local UI only — canvas isolate mode; not persisted to avoid noisy cloud saves.
   *  Set-based so multiple work packages can be made visible at once (multi-package
   *  visibility filter). Empty set = no filter = show all annotations. */
  const [isolatedScopeLayerIds, setIsolatedScopeLayerIds] = useState<Set<string>>(new Set())
  /** Local UI only — "Hide from General View" mode. Each work package id in this set has its
   *  selected annotations hidden while in General View (no package scoped/isolated). Independent
   *  per card; multiple packages can be hidden at once. Session-only, never written to annotation
   *  data or the cloud. Scoped/isolate view overrides this (see hiddenAnnotationIdSet precedence). */
  const [hiddenWorkPackageIds, setHiddenWorkPackageIds] = useState<Set<string>>(new Set())
  /** Local UI only — when off (default), the Work Package panel shows only packages whose
   *  pageNumber matches the current page plus unscoped packages; when on, shows every package. */
  const [scopeLayerShowAllPages, setScopeLayerShowAllPages] = useState(false)
  /** Local UI only — Package Pick / Multi Select mode. When on, clicking an annotation on the
   *  canvas toggles it into selectedForPackageIds instead of selecting/moving/editing it. */
  const [isPackagePickMode, setIsPackagePickMode] = useState(false)
  const [animationRouteBuilder, setAnimationRouteBuilder] = useState<{
    sessionId: string
    layerId: string
    pageNumber: number
    draft: PackageAnimationRouteDraft
    saving: boolean
    conflict?: PackageAnimationRouteConflictState
  } | null>(null)
  const animationRouteBuilderRef = useRef(animationRouteBuilder)
  animationRouteBuilderRef.current = animationRouteBuilder
  const blueprintIdentityRef = useRef<{ blueprintSetId?: string | null; projectId?: string | null }>({
    blueprintSetId: blueprint?.id,
    projectId: blueprint?.projectId,
  })
  blueprintIdentityRef.current = {
    blueprintSetId: blueprint?.id,
    projectId: blueprint?.projectId,
  }
  /** Ephemeral only: identifies the one package whose isolated playback component owns the rAF clock. */
  const [animationPlayback, setAnimationPlayback] = useState<{
    blueprintId: string
    layerId: string
    sceneRevision: number
    pageNumber: number
  } | null>(null)
  // ANIM-2B1: React state alone leaves a double-tap window open — the handler closure still
  // reads `saving: false` until the next render commits, so two taps would fire two saves at the
  // same expected revision. This guard closes that window synchronously.
  const animationRouteSaveGuardRef = useRef(createSingleFlightGuard())
  const animationRouteSaveOperationIdRef = useRef(0)
  /** Local UI only — drag-to-reorder state for the Work Package / Scope Layer cards.
   *  Persistent order is sortOrder/orderTouchedAt; scopeLayers is a canonically sorted UI
   *  projection, and arrow/drag requests route through the shared ordering helper. */
  const [draggingScopeLayerId, setDraggingScopeLayerId] = useState<string | null>(null)
  const [dragOverScopeLayerId, setDragOverScopeLayerId] = useState<string | null>(null)
  const [isScopeLayerOrderSaving, setIsScopeLayerOrderSaving] = useState(false)
  const isScopeLayerOrderSavingRef = useRef(false)
  const scopeLayerOrderSaveIdRef = useRef(0)
  const deferredScopeLayerRefreshRef = useRef(false)
  const isViewerMountedRef = useRef(true)
  const [scopeLayerModal, setScopeLayerModal] = useState<{ open: boolean; mode: 'create' | 'edit'; layerId?: string }>({ open: false, mode: 'create' })
  const [scopeLayerDraftIds, setScopeLayerDraftIds] = useState<string[]>([])
  const [scopeLayerForm, setScopeLayerForm] = useState({
    name: '',
    description: '',
    color: DEFAULT_SCOPE_LAYER_COLOR,
    roughInHours: 0,
    trimHours: 0,
    testingHours: 0,
    cleanupHours: 0,
    crewNotes: '',
    proposalSummary: '',
  })
  const [rfiForm, setRfiForm] = useState({ requestedFrom: '', category: 'coordination', dueDate: '' })
  const [cordForm, setCordForm] = useState({ category: 'light', dueDate: '' })
  const [submittingRfi, setSubmittingRfi] = useState(false)
  const [submittingCord, setSubmittingCord] = useState(false)
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'warning' | 'error'; text: string; key?: string } | null>(null)
  const [packageAnimationRouteNotices, setPackageAnimationRouteNotices] = useState<Record<string, PackageAnimationRouteNotice>>({})
  const [animationRouteReviewConflicts, setAnimationRouteReviewConflicts] = useState<Record<string, PackageAnimationRouteConflictState & { operationId?: number }>>({})
  const [syncNotice, setSyncNotice] = useState<string | null>(null)
  const syncNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Step 13B-QA5-R4: gate for the one-time "cloud paused" banner. While the
  // stale-overwrite guard is blocking cloud writes, every local annotation/scope-layer
  // save still succeeds locally and calls showSyncPausedNoticeOnce() -- without this
  // ref, each of those (one per stroke/drag/click) re-triggered the full-width amber
  // banner, making a correctly-working safety guard look like a repeating error.
  const syncBlockedNoticeShownRef = useRef(false)
    const normalBlueprintViewerMinHeight = isDesktopBlueprintLayout
    ? 'calc(100dvh - 120px)'
    : 'clamp(420px, 72dvh, 760px)'

  useEffect(() => {
    setActionMsg(null)
    setPackageAnimationRouteNotices({})
    setAnimationRouteReviewConflicts({})
  }, [blueprint?.id])

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
  // Ref mirrors so drag-time recalculation (measure-distance endpoint editing) reads the
  // freshest calibration without depending on the pointer-handler useCallback closures.
  const savedCalibrationsRef = useRef<Record<number, CalibrationData>>({})
  savedCalibrationsRef.current = savedCalibrations
  // pendingCalibration: drawn but not yet committed (recalibration replaces this)
  const [pendingCalibration, setPendingCalibration] = useState<CalibrationData | null>(null)
  // measurementStyle: shared style options for all measure annotation types
  const [measurementStyle, setMeasurementStyle] = useState<MeasurementStyle>(DEFAULT_MEASUREMENT_STYLE)

  // Ã¢â€â‚¬Ã¢â€â‚¬ Measurement draft state Ã¢â‚¬â€ multi-click accumulation Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const [measureDraftPoints, setMeasureDraftPoints] = useState<Array<{ x: number; y: number }>>([])
  const measureDraftRef = useRef<Array<{ x: number; y: number }>>([])
  const [measureCursorPx, setMeasureCursorPx] = useState<{ x: number; y: number } | null>(null)
  const measureDistanceDragRef = useRef<{
    active: boolean
    pointerId: number | null
    startX: number
    startY: number
    moved: boolean
  }>({ active: false, pointerId: null, startX: 0, startY: 0, moved: false })
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

  // ── Multi-point path draft state — shared by Polyline and Circuit/Switch-Leg Path ──
  // Points accumulate in page-normalized (0-1) coordinates until the user presses
  // the Stop button (or Escape cancels / tool-switch clears). Step 13B-QA5.
  const [pathDraftPoints, setPathDraftPoints] = useState<Array<{ x: number; y: number }>>([])
  const pathDraftRef = useRef<Array<{ x: number; y: number }>>([])
  const [pathCursorPx, setPathCursorPx] = useState<{ x: number; y: number } | null>(null)

  // Ã¢â€â‚¬Ã¢â€â‚¬ Auto-detected scale results Ã¢â‚¬â€ keyed by pageNumber Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const [detectedScales, setDetectedScales] = useState<Record<number, DetectedScaleResult>>({})
  const detectedScalesRef = useRef<Record<number, DetectedScaleResult>>({})
  detectedScalesRef.current = detectedScales
  // Tracks pages successfully scanned this session (failed pages stay eligible for rescan).
  const scannedPagesRef = useRef<Set<number>>(new Set())
  const scaleScanRunRef = useRef(0)
  const [scaleScanStatus, setScaleScanStatus] = useState<'idle' | 'scanning' | 'complete'>('idle')
  const [scaleScanProgress, setScaleScanProgress] = useState({ done: 0, total: 0 })
  const [scaleRescanNonce, setScaleRescanNonce] = useState(0)
  const [scaleScanDiagnostics, setScaleScanDiagnostics] = useState<ScaleScanDiagnosticsSummary>(EMPTY_SCALE_SCAN_DIAGNOSTICS)

  // PDF page physical size in inches — keyed by 1-based page number.
  const [pageSizeInchesCache, setPageSizeInchesCache] = useState<Record<number, PageSizeInches>>({})
  const pageSizeInchesCacheRef = useRef<Record<number, PageSizeInches>>({})

  const getPageSizeInches = useCallback((pageNumber: number): PageSizeInches | null => {
    const cached = pageSizeInchesCacheRef.current[pageNumber] ?? pageSizeInchesCache[pageNumber]
    return cached?.pageWidthInches > 0 && cached?.pageHeightInches > 0 ? cached : null
  }, [pageSizeInchesCache])

  const getEffectiveCalibrationForPage = useCallback((pageNumber: number): CalibrationData | null => {
    const result = resolveSharedEffectiveCalibration({
      pageNumber,
      savedCalibrations,
      detectedScales,
      pageSize: getPageSizeInches(pageNumber),
    })
    return result.status === 'calibrated' ? result.calibration : null
  }, [savedCalibrations, detectedScales, getPageSizeInches])

  const cachePageSizeInches = useCallback((pageNumber: number, pageWidthPts: number, pageHeightPts: number) => {
    if (!Number.isFinite(pageWidthPts) || !Number.isFinite(pageHeightPts) || pageWidthPts <= 0 || pageHeightPts <= 0) return
    const next = getPageSizeInchesFromPts(pageWidthPts, pageHeightPts)
    pageSizeInchesCacheRef.current = { ...pageSizeInchesCacheRef.current, [pageNumber]: next }
    setPageSizeInchesCache((prev) => ({ ...prev, [pageNumber]: next }))
  }, [])

  // Normalized PDF text item positions keyed by page number — used for text-aware textHighlight quads
  type TextItemNorm = { x: number; y: number; w: number; h: number }
  const [textItemsCache, setTextItemsCache] = useState<Record<number, TextItemNorm[]>>({})
  const textItemsCacheRef = useRef<Record<number, TextItemNorm[]>>({})

  // Ã¢â€â‚¬Ã¢â€â‚¬ Derived calibration for current page Ã¢â‚¬â€ precedence: manual > auto > none Ã¢â€â‚¬
  const savedCalibration: CalibrationData | null = savedCalibrations[currentPage] ?? null
  const detectedResult: DetectedScaleResult | null = detectedScales[currentPage] ?? null
  const autoCalibration: CalibrationData | null = buildAutoCalibrationForPage(
    currentPage,
    detectedResult,
    getPageSizeInches(currentPage),
  )
  const effectiveCalibrationResult = resolveSharedEffectiveCalibration({
    pageNumber: currentPage,
    savedCalibrations,
    detectedScales,
    pageSize: getPageSizeInches(currentPage),
  })
  const activeCalibration: CalibrationData | null = effectiveCalibrationResult.status === 'calibrated' ? effectiveCalibrationResult.calibration : null
  const detectedScale: number | null = activeCalibration
    ? activeCalibration.normDistance / Math.max(0.001, activeCalibration.realWorldValue)
    : null
  type CalibrationSource = 'manual' | 'auto' | 'ambiguous' | 'none'
  const calibrationSource: CalibrationSource =
    effectiveCalibrationResult.status === 'calibrated' && effectiveCalibrationResult.source === 'manual' ? 'manual' :
    detectedResult?.ambiguous ? 'ambiguous' :
    effectiveCalibrationResult.status === 'calibrated' && effectiveCalibrationResult.source === 'auto' ? 'auto' : 'none'
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
  // Visual-only toggle for electrical symbol corner labels/badges.
  const [electricalSymbolLabelsVisible, setElectricalSymbolLabelsVisible] = useState(true)
  // Visual-only toggle for Circuit Path and Circuit Arc measurement labels.
  const [showCircuitMeasurementLabels, setShowCircuitMeasurementLabels] = useState(CIRCUIT_MEASUREMENT_LABELS_DEFAULT_VISIBLE)
  // Symbols Size control — scales symbol LABEL text only (not the glyph/box/geometry). Local UI
  // state (0.75x–5.0x, default 1.0). The draggable popup and its position are also local UI only.
  const [symbolLabelScale, setSymbolLabelScale] = useState(1)
  const [isSymbolSizePanelOpen, setIsSymbolSizePanelOpen] = useState(false)
  const [symbolSizePanelPos, setSymbolSizePanelPos] = useState<{ x: number; y: number }>({ x: 24, y: 96 })
  const symbolSizeDragRef = useRef<{ dx: number; dy: number } | null>(null)
  const symbolSizeButtonRef = useRef<HTMLButtonElement | null>(null)
  // Label-only color override (Symbols Size popup "Custom Label Colors" toggle). Applies to the
  // external label badge text/border/fill only — never symbol bodies/geometry/annotation data.
  // Local UI state only; resets on reload.
  const [symbolLabelCustomColorsEnabled, setSymbolLabelCustomColorsEnabled] = useState(false)
  const [symbolLabelTextColor, setSymbolLabelTextColor] = useState('#22d3ee')
  const [symbolLabelBorderColor, setSymbolLabelBorderColor] = useState('#22d3ee')
  const [symbolLabelFillColor, setSymbolLabelFillColor] = useState('#0b1020')
  // ── Measurement label controls (Measure bucket) — visual-only, local UI state.
  // Deliberately SEPARATE from the electrical symbol label controls above. Toggling
  // visibility or changing size never mutates annotation data and never triggers a save.
  const [measurementLabelsVisible, setMeasurementLabelsVisible] = useState(true)
  // Scales measurement LABEL text/badges only (not lines, endpoints, or symbols).
  // 0.75x–5.0x, default 1.0. Local render-only; not persisted to meta or the cloud.
  const [measurementLabelScale, setMeasurementLabelScale] = useState(1)
  const [isMeasurementSizePanelOpen, setIsMeasurementSizePanelOpen] = useState(false)
  // Color for NEW distance / area / multi-point measurements. Kept in sync with
  // measurementStyle.lineColor and the measure toolColors so the committed ann.color and
  // the create popover agree. Does NOT bulk-edit existing annotations.
  const [measurementColor, setMeasurementColor] = useState('#38bdf8')
  const [alignmentGuidesEnabled, setAlignmentGuidesEnabled] = useState(false)
  const [activeAlignmentGuides, setActiveAlignmentGuides] = useState<AlignmentGuideLine[]>([])
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
    // Step 12C — captured only when moving a line-like shape that has free
    // absolute endpoints (meta.lineAbsX1..Y2), so the whole line shifts with
    // the move drag even though rendering no longer derives endpoints from box.
    startLineAbs: { x1: number; y1: number; x2: number; y2: number } | null
    startArchCtrl: { x: number; y: number } | null
    startPoints: Array<{ x: number; y: number }> | null
  } | null>(null)
  // Ref mirror so handleAnnotationLayoutPointerMove reads the latest value before React batches the setState
  const layoutDragRef = useRef<{
    annotationId: string
    mode: 'move' | 'resize'
    pointerId: number
    startClientX: number
    startClientY: number
    startBox: { x: number; y: number; w: number; h: number }
    startLineAbs: { x1: number; y1: number; x2: number; y2: number } | null
    startArchCtrl: { x: number; y: number } | null
    startPoints: Array<{ x: number; y: number }> | null
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

  // BLUEPRINT-6L — dedicated drag ref for measure-distance endpoint editing. Kept separate
  // from endpointDragRef (which drives line/arrow lineAbs endpoints) because measure-distance
  // stores its geometry in meta.points and must recalculate the real-world value on drag.
  const measureEndpointDragRef = useRef<{
    annotationId: string
    endpoint: 0 | 1
    pointerId: number
  } | null>(null)

  // BLUEPRINT-6M — whole-line move for measure-distance. Dragging the line body/label
  // shifts BOTH endpoints by the same page-normalized delta, preserving segment length
  // and angle. Separate from measureEndpointDragRef (single-endpoint edit) and from the
  // generic layout drag (box-based shapes) because distance geometry lives in meta.points.
  const measureLineDragRef = useRef<{
    annotationId: string
    pointerId: number
    startClientX: number
    startClientY: number
    startPoints: Array<{ x: number; y: number }>
  } | null>(null)

  // BLUEPRINT-6N — per-point (per-"axle") drag for measure-perimeter Move mode. Dragging a
  // handle moves only meta.points[pointIndex]; the polyline total + segment labels recompute
  // live. Distinct from the distance refs (which handle a 2-point line and whole-line move).
  const measurePointDragRef = useRef<{
    annotationId: string
    pointIndex: number
    pointerId: number
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

  // CIRCUITARC: same shape as the arch control drag, plus the index of the segment whose
  // curvature is being adjusted — that index is what keeps each segment independent.
  const [circuitArcControlDrag, setCircuitArcControlDrag] = useState<{
    annotationId: string
    segIndex: number
    pointerId: number
  } | null>(null)
  const circuitArcControlDragRef = useRef<{
    annotationId: string
    segIndex: number
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
    fillOpacity: DEFAULT_SHAPE_FILL_OPACITY,
    opacity: 100, // 10-100 for stepper, % display
  })
  const [generateQuestionType, setGenerateQuestionType] = useState<GenerateQuestionType>('coordination')
  const [quickAccessPresets, setQuickAccessPresets] = useState<Array<QuickAccessPreset | null>>(loadQuickAccessPresets)
  const [quickAccessModalSlot, setQuickAccessModalSlot] = useState<number | null>(null)
  const [quickAccessDraft, setQuickAccessDraft] = useState<QuickAccessPreset | null>(null)
  /** Draft Wire Profile binding for the open settings slot (project-scoped BackupData). */
  const [quickAccessDraftWireProfileId, setQuickAccessDraftWireProfileId] = useState<string | null>(null)
  const [quickAccessBindingSaveError, setQuickAccessBindingSaveError] = useState<string | null>(null)
  const [quickAccessBindingSaving, setQuickAccessBindingSaving] = useState(false)
  /**
   * Scoped Quick Access activation for Wire Profile assignment.
   * Visual presets stay in localStorage; this carries the project-scoped binding
   * for the current drawing session only (cleared on manual tool / project switch).
   */
  const [activeQuickAccessSession, setActiveQuickAccessSession] = useState<{
    slotKey: string
    toolType: QuickAccessTool
    toolVariant?: ShapeKind
    projectId: string
    blueprintSetId: string
    wireProfileId: string | null
    activationId: string
  } | null>(null)
  const [isWireProfileManagerOpen, setIsWireProfileManagerOpen] = useState(false)
  const [projectWireTotalsOpen, setProjectWireTotalsOpen] = useState(false)
  const [wireProfileRemoteRefreshVersion, setWireProfileRemoteRefreshVersion] = useState(0)
  const previousWireProfileProjectIdRef = useRef<string | null>(blueprint?.projectId ?? null)

  const clearActiveQuickAccessSession = useCallback(() => {
    setActiveQuickAccessSession(null)
  }, [])

  const readProjectQuickAccessBinding = useCallback((slotIndex: number): string | null => {
    const slotKey = getQuickAccessSlotKey(slotIndex)
    const projectId = String(blueprint?.projectId || '').trim()
    if (!slotKey || !projectId) return null
    try {
      return getOperationsBlueprintQuickAccessWireProfileBinding(getBackupData(), projectId, slotKey)
    } catch {
      return null
    }
  }, [blueprint?.projectId, wireProfileRemoteRefreshVersion])

  const projectWireProfiles = useMemo(() => {
    const projectId = String(blueprint?.projectId || '').trim()
    if (!projectId) return []
    try {
      return getOperationsBlueprintWireProfiles(getBackupData(), projectId)
    } catch {
      return []
    }
  }, [blueprint?.projectId, wireProfileRemoteRefreshVersion])

  const wireQuantityResult = useMemo(() => {
    const projectId = String(blueprint?.projectId || '').trim()
    const blueprintSetId = String(blueprint?.id || '').trim()
    if (!projectId || !blueprintSetId) {
      return buildWireQuantityResult({
        projectId,
        blueprintSetId,
        annotations: [],
        workPackages: [],
        wireProfiles: [],
        savedCalibrations: {},
        detectedScales: {},
        getPageSizeInches: () => null,
      })
    }
    return buildWireQuantityResult({
      projectId,
      blueprintSetId,
      annotations: allAnnotations,
      workPackages: scopeLayers,
      wireProfiles: projectWireProfiles,
      savedCalibrations,
      detectedScales,
      getPageSizeInches,
    })
  }, [
    allAnnotations,
    blueprint?.id,
    blueprint?.projectId,
    detectedScales,
    getPageSizeInches,
    projectWireProfiles,
    savedCalibrations,
    scopeLayers,
  ])

  const buildQuickAccessDraft = (slotIndex: number, preset?: QuickAccessPreset | null): QuickAccessPreset => {
    if (preset) return JSON.parse(JSON.stringify(preset))
    const activeTool = QUICK_ACCESS_TOOL_SET.has(toolMode as QuickAccessTool)
      ? toolMode as QuickAccessTool
      : 'shape'
    const now = new Date().toISOString()
    return {
      id: `quick-access-${slotIndex + 1}`,
      label: `Slot ${slotIndex + 1}`,
      toolType: activeTool,
      toolVariant: shapeKind,
      color: toolColors[activeTool as ToolKey] || toolColors.shape,
      highlightOpacity,
      underlineThickness,
      drawOptions: { ...drawOptions },
      markerOptions: { ...markerOptions },
      shapeOptions: { ...shapeOptions },
      textStyle: { ...textStyle },
      measurementStyle: { ...measurementStyle },
      createdAt: now,
      updatedAt: now,
    }
  }

  const openQuickAccessSettings = (slotIndex = 0) => {
    const safeIndex = Math.max(0, Math.min(QUICK_ACCESS_SLOT_COUNT - 1, slotIndex))
    setQuickAccessModalSlot(safeIndex)
    setQuickAccessDraft(buildQuickAccessDraft(safeIndex, quickAccessPresets[safeIndex]))
    setQuickAccessDraftWireProfileId(readProjectQuickAccessBinding(safeIndex))
    setQuickAccessBindingSaveError(null)
  }

  const selectQuickAccessSlotForEdit = (slotIndex: number) => {
    setQuickAccessModalSlot(slotIndex)
    setQuickAccessDraft(buildQuickAccessDraft(slotIndex, quickAccessPresets[slotIndex]))
    setQuickAccessDraftWireProfileId(readProjectQuickAccessBinding(slotIndex))
    setQuickAccessBindingSaveError(null)
  }

  const persistQuickAccessDraft = async () => {
    if (quickAccessModalSlot == null || !quickAccessDraft) return
    const now = new Date().toISOString()
    const nextPreset: QuickAccessPreset = {
      ...quickAccessDraft,
      id: quickAccessDraft.id || `quick-access-${quickAccessModalSlot + 1}`,
      label: quickAccessDraft.label.trim() || `Slot ${quickAccessModalSlot + 1}`,
      createdAt: quickAccessPresets[quickAccessModalSlot]?.createdAt || quickAccessDraft.createdAt || now,
      updatedAt: now,
    }
    // A) Visual preset — device-local localStorage (existing path).
    setQuickAccessPresets((previous) => {
      const next = [...previous]
      next[quickAccessModalSlot] = nextPreset
      saveQuickAccessPresets(next)
      return next
    })
    setQuickAccessDraft(nextPreset)

    // B) Project Wire Profile binding — BackupData (synced). Clear when saved as non-wire.
    const slotKey = getQuickAccessSlotKey(quickAccessModalSlot)
    const projectId = String(blueprint?.projectId || '').trim()
    if (!slotKey || !projectId) {
      setQuickAccessBindingSaveError(null)
      return
    }
    const bindingSupports = supportsWireProfileAssignment({
      toolType: nextPreset.toolType,
      toolVariant: nextPreset.toolVariant,
    })
    const nextBindingId = bindingSupports ? quickAccessDraftWireProfileId : null
    setQuickAccessBindingSaving(true)
    setQuickAccessBindingSaveError(null)
    try {
      const result = await saveOperationsBlueprintQuickAccessWireProfileBinding(
        getBackupData(),
        projectId,
        slotKey,
        nextBindingId,
      )
      if (!result.localSaved) {
        setQuickAccessBindingSaveError(result.error || QUICK_ACCESS_BINDING_SAVE_FAILURE_MESSAGE)
      } else {
        setQuickAccessDraftWireProfileId(nextBindingId)
        setWireProfileRemoteRefreshVersion((version) => version + 1)
        if (result.warning || result.error) {
          setQuickAccessBindingSaveError(result.warning || result.error || null)
        }
      }
    } catch (error: any) {
      setQuickAccessBindingSaveError(error?.message || QUICK_ACCESS_BINDING_SAVE_FAILURE_MESSAGE)
    } finally {
      setQuickAccessBindingSaving(false)
    }
  }

  const clearQuickAccessSlot = async (slotIndex: number) => {
    setQuickAccessPresets((previous) => {
      const next = [...previous]
      next[slotIndex] = null
      saveQuickAccessPresets(next)
      return next
    })
    if (quickAccessModalSlot === slotIndex) {
      setQuickAccessDraft(buildQuickAccessDraft(slotIndex, null))
      setQuickAccessDraftWireProfileId(null)
    }
    const slotKey = getQuickAccessSlotKey(slotIndex)
    const projectId = String(blueprint?.projectId || '').trim()
    if (slotKey && projectId) {
      try {
        await saveOperationsBlueprintQuickAccessWireProfileBinding(getBackupData(), projectId, slotKey, null)
        setWireProfileRemoteRefreshVersion((version) => version + 1)
      } catch { /* binding clear is best-effort alongside visual clear */ }
    }
    const activeKey = getQuickAccessSlotKey(slotIndex)
    if (activeKey && activeQuickAccessSession?.slotKey === activeKey) clearActiveQuickAccessSession()
  }

  const applyQuickAccessPreset = (preset: QuickAccessPreset, slotIndex: number) => {
    if (!QUICK_ACCESS_TOOL_SET.has(preset.toolType)) return
    const slotKey = getQuickAccessSlotKey(slotIndex)
    const projectId = String(blueprint?.projectId || '').trim()
    const blueprintSetId = String(blueprint?.id || '').trim()
    const supportsBinding = supportsWireProfileAssignment({
      toolType: preset.toolType,
      toolVariant: preset.toolVariant,
    })
    const wireProfileId = supportsBinding ? readProjectQuickAccessBinding(slotIndex) : null
    if (supportsBinding) {
      const decision = decideQuickAccessWireProfileActivation(wireProfileId, projectWireProfiles)
      if (!decision.ok) {
        setActionMsg({ type: 'warning', text: decision.message })
        return
      }
      if (slotKey && projectId && blueprintSetId) {
        setActiveQuickAccessSession({
          slotKey,
          toolType: preset.toolType,
          toolVariant: preset.toolVariant,
          projectId,
          blueprintSetId,
          wireProfileId: decision.wireProfileId,
          activationId: `qa_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        })
      } else {
        clearActiveQuickAccessSession()
      }
    } else {
      clearActiveQuickAccessSession()
    }

    setOpenPopover(null)
    setToolMode(preset.toolType)
    setToolbarBucket(
      preset.toolType === 'shape' || preset.toolType === 'pen' || preset.toolType === 'marker'
        ? 'draw'
        : preset.toolType.startsWith('measure-')
          ? 'measure'
          : 'annotate'
    )
    if (preset.color) setToolColor(preset.toolType, preset.color)
    if (preset.toolType === 'shape') {
      if (preset.toolVariant) setShapeKind(preset.toolVariant)
      if (preset.shapeOptions) setShapeOptions((previous) => ({ ...previous, ...preset.shapeOptions }))
    }
    if (preset.toolType === 'pen' && preset.drawOptions) setDrawOptions((previous) => ({ ...previous, ...preset.drawOptions }))
    if (preset.toolType === 'marker' && preset.markerOptions) setMarkerOptions((previous) => ({ ...previous, ...preset.markerOptions }))
    if ((preset.toolType === 'highlight' || preset.toolType === 'textHighlight') && Number.isFinite(preset.highlightOpacity)) setHighlightOpacity(preset.highlightOpacity!)
    if (preset.toolType === 'underline' && Number.isFinite(preset.underlineThickness)) setUnderlineThickness(preset.underlineThickness!)
    if (preset.toolType === 'textBox' || preset.toolType === 'callout') {
      if (preset.textStyle) setTextStyle((previous) => ({ ...previous, ...preset.textStyle, ...(preset.color ? { color: preset.color } : {}) }))
    }
    if (preset.toolType.startsWith('measure-') && preset.measurementStyle) {
      setMeasurementStyle((previous) => ({ ...previous, ...preset.measurementStyle, ...(preset.color ? { lineColor: preset.color } : {}) }))
      if (preset.color) setMeasurementColor(preset.color)
    }
  }

  const quickAccessIcon = (preset: QuickAccessPreset) => {
    if (preset.toolType === 'shape') return isElectricalShapeKind(preset.toolVariant) ? <Circle size={13} /> : <Shapes size={13} />
    if (preset.toolType.startsWith('measure-')) return <Ruler size={13} />
    if (preset.toolType === 'pen') return <PenLine size={13} />
    if (preset.toolType === 'marker' || preset.toolType.toLowerCase().includes('highlight')) return <Highlighter size={13} />
    if (preset.toolType === 'note') return <StickyNote size={13} />
    return <Type size={13} />
  }

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

  useEffect(() => {
    annotationHistoryRef.current = clearCommandHistory(annotationHistoryRef.current)
    persistedAnnotationSnapshotsRef.current = new Map()
    setAnnotationHistoryRevision((revision) => revision + 1)
  }, [blueprint?.id])

  useEffect(() => {
    // Focus and edit chrome are page-local. Never carry a page-A selection onto page B.
    const cancelledIds = new Set<string>([
      layoutDragRef.current?.annotationId,
      endpointDragRef.current?.annotationId,
      measureEndpointDragRef.current?.annotationId,
      measureLineDragRef.current?.annotationId,
      measurePointDragRef.current?.annotationId,
      archControlDragRef.current?.annotationId,
      circuitArcControlDragRef.current?.annotationId,
    ].filter(Boolean) as string[])
    if (cancelledIds.size > 0) {
      setAllAnnotations((prev) => prev.map((annotation) => (
        cancelledIds.has(annotation.id)
          ? cloneAnnotationForHistory(persistedAnnotationSnapshotsRef.current.get(annotation.id)) || annotation
          : annotation
      )))
    }
    layoutDragRef.current = null
    endpointDragRef.current = null
    measureEndpointDragRef.current = null
    measureLineDragRef.current = null
    measurePointDragRef.current = null
    archControlDragRef.current = null
    circuitArcControlDragRef.current = null
    setFocusedAnnotationId(null)
    setFocusedAnnotationRect(null)
    setLayoutEditId(null)
    setOpenPopover(null)
    setBarDragOffset(null)
  }, [currentPage])

  const renderAlignmentGuideLines = useCallback((guides: AlignmentGuideLine[]) => {
    const svg = alignmentGuideSvgRef.current
    activeAlignmentGuidesRef.current = guides
    if (!svg) return
    const width = displaySizeRef.current.w
    const height = displaySizeRef.current.h
    svg.replaceChildren()
    if (!width || !height || guides.length === 0) return
    for (const guide of guides) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      if (guide.axis === 'x') {
        const x = guide.value * width
        line.setAttribute('x1', String(x))
        line.setAttribute('y1', '0')
        line.setAttribute('x2', String(x))
        line.setAttribute('y2', String(height))
      } else {
        const y = guide.value * height
        line.setAttribute('x1', '0')
        line.setAttribute('y1', String(y))
        line.setAttribute('x2', String(width))
        line.setAttribute('y2', String(y))
      }
      line.setAttribute('stroke', '#22d3ee')
      line.setAttribute('stroke-width', '2')
      line.setAttribute('stroke-dasharray', '6 5')
      line.setAttribute('stroke-linecap', 'round')
      line.setAttribute('opacity', '0.85')
      line.setAttribute('vector-effect', 'non-scaling-stroke')
      svg.appendChild(line)
    }
    // Highlight the reference annotation(s) being lined up against — a cyan ring around each
    // aligned item so the user can see WHAT they're aligning to. Purely visual; drawn in the
    // same imperative guide SVG so it adds no React re-renders and never touches annotation data.
    const highlightedIds = new Set<string>()
    for (const guide of guides) {
      if (!guide.refId || highlightedIds.has(guide.refId)) continue
      highlightedIds.add(guide.refId)
      const refAnn = allAnnotationsRef.current.find((a) => a.id === guide.refId)
      if (!refAnn?.rect) continue
      const r = clampRectToPage(refAnn.rect as any)
      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      ring.setAttribute('x', String(r.x * width - 3))
      ring.setAttribute('y', String(r.y * height - 3))
      ring.setAttribute('width', String(Math.max(0.001, r.w) * width + 6))
      ring.setAttribute('height', String(Math.max(0.001, r.h) * height + 6))
      ring.setAttribute('rx', '5')
      ring.setAttribute('fill', 'rgba(34,211,238,0.10)')
      ring.setAttribute('stroke', '#22d3ee')
      ring.setAttribute('stroke-width', '2.5')
      ring.setAttribute('opacity', '0.9')
      ring.setAttribute('vector-effect', 'non-scaling-stroke')
      svg.appendChild(ring)
    }
  }, [])

  const clearAlignmentGuides = useCallback(() => {
    if (!activeAlignmentGuideSignatureRef.current && activeAlignmentGuidesRef.current.length === 0) {
      alignmentGuideSvgRef.current?.replaceChildren()
      return
    }
    activeAlignmentGuideSignatureRef.current = ''
    renderAlignmentGuideLines([])
    setActiveAlignmentGuides([])
  }, [renderAlignmentGuideLines])

  // Isolated (Work Package) annotations must never act as Guide Assist targets — hidden
  // shapes should not create guide lines or snap the active shape (Step 13B-QA2 Part 6).
  const isGuideTargetVisible = useCallback((annotationId: string) => {
    const isolatedSet = isolatedAnnotationIdSetRef.current
    return !isolatedSet || isolatedSet.has(annotationId)
  }, [])

  // Circuit/Switch-Leg Path: when a click lands near an existing annotation (a symbol,
  // light, or switch) on the current page, snap the new path point to that annotation's
  // center instead of the raw click point — mirrors Guide Assist's center-only model.
  const findNearestAnnotationCenterNorm = useCallback((point: { x: number; y: number }, maxDistNorm: number) => {
    let best: { x: number; y: number } | null = null
    let bestDist = maxDistNorm
    for (const annotation of allAnnotationsRef.current) {
      if (!annotation?.rect) continue
      if (Number(annotation.pageNumber) !== Number(currentPageRef.current)) continue
      if (!isGuideTargetVisible(annotation.id)) continue
      const center = getRectCenterNorm(annotation.rect as any)
      const dist = Math.hypot(point.x - center.x, point.y - center.y)
      if (dist <= bestDist) {
        bestDist = dist
        best = center
      }
    }
    return best
  }, [isGuideTargetVisible])

  const updatePlacementGuideLines = useCallback((nextDraftRect: { x: number; y: number; w: number; h: number } | null) => {
    if (!alignmentGuidesEnabled || !annotationsVisible || !nextDraftRect) {
      clearAlignmentGuides()
      return
    }
    const samePageAnnotations = allAnnotationsRef.current.filter((annotation) => (
      Number(annotation.pageNumber) === Number(currentPageRef.current) &&
      !!annotation?.rect &&
      isGuideTargetVisible(annotation.id)
    ))
    const guides = calculateAlignmentGuides(nextDraftRect, samePageAnnotations)
    const signature = guides.map((guide) => `${guide.axis}:${guide.value.toFixed(4)}`).join('|')
    renderAlignmentGuideLines(guides)
    if (signature !== activeAlignmentGuideSignatureRef.current) {
      activeAlignmentGuideSignatureRef.current = signature
      setActiveAlignmentGuides(guides)
    }
  }, [alignmentGuidesEnabled, annotationsVisible, clearAlignmentGuides, renderAlignmentGuideLines, isGuideTargetVisible])

  // Returns the (possibly center-snapped) moving rect so callers can apply the lock in real
  // time — falls back to the original rect unchanged when no center guide is matched.
  const updateMoveGuideLines = useCallback((movingRect: { x: number; y: number; w: number; h: number } | null, movingAnnotationId: string) => {
    if (!alignmentGuidesEnabled || !annotationsVisible || !movingRect) {
      clearAlignmentGuides()
      return movingRect
    }
    const samePageAnnotations = allAnnotationsRef.current.filter((annotation) => (
      annotation.id !== movingAnnotationId &&
      Number(annotation.pageNumber) === Number(currentPageRef.current) &&
      !!annotation?.rect &&
      isGuideTargetVisible(annotation.id)
    ))
    const guides = calculateAlignmentGuides(movingRect, samePageAnnotations)
    const signature = guides.map((guide) => `${guide.axis}:${guide.value.toFixed(4)}`).join('|')
    renderAlignmentGuideLines(guides)
    if (signature !== activeAlignmentGuideSignatureRef.current) {
      activeAlignmentGuideSignatureRef.current = signature
      setActiveAlignmentGuides(guides)
    }
    return guides.length > 0 ? applyCenterSnap(movingRect, guides) : movingRect
  }, [alignmentGuidesEnabled, annotationsVisible, clearAlignmentGuides, renderAlignmentGuideLines, isGuideTargetVisible])

  // Ã¢â€â‚¬Ã¢â€â‚¬ Keyboard handler for measurement tools Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        measureDraftRef.current = []
        setMeasureDraftPoints([])
        setMeasureCursorPx(null)
        measureDistanceDragRef.current = { active: false, pointerId: null, startX: 0, startY: 0, moved: false }
        setCalibrateInput(null)
        lastMeasureClickRef.current = { time: 0, nx: 0, ny: 0 }
        lineFirstPointRef.current = null
        if (draftLineDomRef.current) draftLineDomRef.current.style.display = 'none'
        if (draftArchPathDomRef.current) draftArchPathDomRef.current.style.display = 'none'
        pathDraftRef.current = []
        setPathDraftPoints([])
        setPathCursorPx(null)
        clearAlignmentGuides()
      }
      // BLUEPRINT-6N — finalize the Multi-Point / Perimeter draft. Enter (existing) and
      // Space (new) both commit when at least 2 points are placed. Space is guarded against
      // firing while typing in a field, and its default page-scroll is suppressed on finalize.
      const finishPerimeter = () => {
        const pts = [...measureDraftRef.current]
        if (pts.length >= 2) {
          setMeasurePendingCommit({ type: 'measure-perimeter', points: pts, pageNumber: currentPageRef.current })
          measureDraftRef.current = []
          setMeasureDraftPoints([])
          setMeasureCursorPx(null)
          lastMeasureClickRef.current = { time: 0, nx: 0, ny: 0 }
        }
      }
      if (effectiveTool === 'measure-perimeter' && !calibrateInput) {
        if (e.key === 'Enter') {
          finishPerimeter()
        } else if (e.key === ' ' || e.code === 'Space') {
          const el = document.activeElement as HTMLElement | null
          const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
          if (!typing) {
            e.preventDefault()
            finishPerimeter()
          }
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [effectiveTool, calibrateInput, clearAlignmentGuides])

  // Declared before the keyboard effect below so it is initialized before that effect's
  // dependency array is evaluated during render (avoids a const temporal-dead-zone crash).
  const togglePackagePickMode = useCallback(() => {
    setIsPackagePickMode((v) => !v)
  }, [])

  // ── Package Pick mode toggle: Left Control (desktop) + Escape ──
  // Left Control alone toggles the mode. We deliberately key off e.code === 'ControlLeft'
  // so Ctrl+S / Ctrl+Z / Ctrl+C (which fire on the letter key, not the modifier) are never
  // intercepted, and we never call preventDefault so browser shortcuts keep working.
  // iPad has no Left Control key — the on-screen button provides the same toggle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (e.code === 'ControlLeft' && !e.repeat && !typing) {
        togglePackagePickMode()
        return
      }
      // Escape leaves Package Pick mode (selection is preserved; use the Clear button to reset it).
      if (e.key === 'Escape' && !typing) {
        setIsPackagePickMode(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePackagePickMode])

  // Ã¢â€â‚¬Ã¢â€â‚¬ Clear measure draft on tool/page change Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  useEffect(() => {
    measureDraftRef.current = []
    setMeasureDraftPoints([])
    setMeasureCursorPx(null)
    measureDistanceDragRef.current = { active: false, pointerId: null, startX: 0, startY: 0, moved: false }
    setCalibrateInput(null)
    lastMeasureClickRef.current = { time: 0, nx: 0, ny: 0 }
    clearAlignmentGuides()
  }, [effectiveTool, currentPage, clearAlignmentGuides])

  // Clear multi-point path draft (Polyline / Circuit Path) on tool/shape/page change so
  // switching tools mid-path safely discards the in-progress draft without persisting it.
  useEffect(() => {
    pathDraftRef.current = []
    setPathDraftPoints([])
    setPathCursorPx(null)
  }, [effectiveTool, shapeKind, currentPage])

  // EST-1C: preset-only Wire Profile state is scoped to the activated Quick Access tool.
  useEffect(() => {
    if (!activeQuickAccessSession) return
    const stillMatches = effectiveTool === activeQuickAccessSession.toolType
      && (
        !activeQuickAccessSession.toolVariant
        || shapeKind === activeQuickAccessSession.toolVariant
      )
    if (!stillMatches) clearActiveQuickAccessSession()
  }, [effectiveTool, shapeKind, activeQuickAccessSession, clearActiveQuickAccessSession])

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

  const clearStaleSyncMessages = useCallback(() => {
    setError((prev) => (isSyncBlockedMessage(prev) ? null : prev))
    setActionMsg((prev) => (prev && isSyncBlockedMessage(prev.text) ? null : prev))
    setSyncNotice(null)
    if (syncNoticeTimerRef.current) {
      clearTimeout(syncNoticeTimerRef.current)
      syncNoticeTimerRef.current = null
    }
    // A real successful save/sync resolves the conflict -- let a future one show
    // its own one-time notice instead of staying suppressed forever.
    syncBlockedNoticeShownRef.current = false
  }, [])

  const showTransientSyncNotice = useCallback((message: string) => {
    setSyncNotice(message)
    if (syncNoticeTimerRef.current) clearTimeout(syncNoticeTimerRef.current)
    syncNoticeTimerRef.current = setTimeout(() => {
      setSyncNotice((prev) => (prev === message ? null : prev))
      syncNoticeTimerRef.current = null
    }, 8000)
  }, [])

  // Step 13B-QA5-R4: dedicated one-time notice for the stale-overwrite safety guard.
  // Local saves keep succeeding while cloud sync is paused, so this uses calm
  // "paused" wording (never "failed") and only surfaces once per unresolved
  // conflict -- syncBlockedNoticeShownRef is reset by clearStaleSyncMessages()
  // the moment a real cloud sync succeeds (or a local-only save event fires).
  const showSyncPausedNoticeOnce = useCallback(() => {
    if (syncBlockedNoticeShownRef.current) return
    syncBlockedNoticeShownRef.current = true
    showTransientSyncNotice('Saved locally — cloud paused until reload.')
  }, [showTransientSyncNotice])

  const loadAnnotations = useCallback(() => {
    if (!blueprint?.id) {
      setAllAnnotations([])
      persistedAnnotationSnapshotsRef.current = new Map()
      return
    }
    try {
      const backup = getBackupData()
      const items = getOperationsBlueprintAnnotations(backup || {}, blueprint.id)
      const pendingDeletes = locallyDeletedIdsRef.current
      let loaded = (Array.isArray(items) ? items : []).filter((item) => !pendingDeletes.has(item.id))
      // While a save is pending or within the grace window, never replace the in-memory
      // list with a stale loaded snapshot that is missing locally-created / locally-newer
      // annotations. Merge by id; local wins on newer-or-equal updatedAt.
      const now = Date.now()
      const savePending = pendingAnnotationMutationsRef.current > 0
      const recentlyStarted = now - lastAnnotationSaveStartedAtRef.current < 10000
      const recentlyFinished = now - lastAnnotationSaveFinishedAtRef.current < 5000
      if (!savePending && !recentlyStarted && !recentlyFinished) {
        persistedAnnotationSnapshotsRef.current = new Map(loaded.map((item) => [item.id, cloneAnnotationForHistory(item)!]))
      } else {
        for (const item of loaded) {
          const previous = persistedAnnotationSnapshotsRef.current.get(item.id)
          if (!previous || Date.parse(item.updatedAt || '') >= Date.parse(previous.updatedAt || '')) {
            persistedAnnotationSnapshotsRef.current.set(item.id, cloneAnnotationForHistory(item)!)
          }
        }
      }
      if (savePending || recentlyStarted || recentlyFinished) {
        loaded = mergeVisibleAnnotationsWithLocalPending(loaded, allAnnotationsRef.current)
          .filter((item) => !pendingDeletes.has(item.id))
      }
      setAllAnnotations(loaded)
    } catch {
      setAllAnnotations([])
    }
  }, [blueprint?.id])

  const loadScopeLayers = useCallback(() => {
    if (!blueprint?.id) {
      setScopeLayers([])
      return
    }
    try {
      const backup = getBackupData()
      const items = getOperationsBlueprintScopeLayers(backup || {}, blueprint.id)
      const orderedItems = sortWorkPackages(Array.isArray(items) ? items : [])
      setScopeLayers(orderedItems)
      const liveIds = new Set(orderedItems.map((item) => item.id))
      setDraggingScopeLayerId((id) => id && liveIds.has(id) ? id : null)
      setDragOverScopeLayerId((id) => id && liveIds.has(id) ? id : null)
    } catch {
      setScopeLayers([])
      setDraggingScopeLayerId(null)
      setDragOverScopeLayerId(null)
    }
  }, [blueprint?.id])

  const persistScopeLayers = useCallback(async (nextLayers: BlueprintScopeLayer[]) => {
    if (!blueprint?.id) return false
    try {
      const backup = getBackupData()
      if (!backup) throw new Error('No local backup data available.')
      const result = await saveOperationsBlueprintScopeLayers(backup, blueprint.id, nextLayers)
      if (result.cloudSynced) {
        clearStaleSyncMessages()
        return true
      }
      if (result.localSaved) {
        if (result.warning) {
          showSyncPausedNoticeOnce()
        }
        return true
      }
      setActionMsg({
        type: 'error',
        text: result.error || SCOPE_LAYER_CLOUD_SYNC_WARNING_MSG,
      })
      loadScopeLayers()
      return false
    } catch (e: any) {
      setActionMsg({
        type: 'error',
        text: e?.message || SCOPE_LAYER_CLOUD_SYNC_WARNING_MSG,
      })
      loadScopeLayers()
      return false
    }
  }, [blueprint?.id, clearStaleSyncMessages, loadScopeLayers, showSyncPausedNoticeOnce])

  // BP-SYNC-FIX-1 Part A: explicit single-package delete. Deliberately separate from
  // persistScopeLayers (which saves the live set) so a delete never travels as an omitted id —
  // it tombstones exactly this id via the service's dedicated delete path. Same result handling
  // as persistScopeLayers; on failure loadScopeLayers() restores the full array.
  const persistScopeLayerDeletion = useCallback(async (layerId: string) => {
    if (!blueprint?.id) return false
    try {
      const backup = getBackupData()
      if (!backup) throw new Error('No local backup data available.')
      const result = await deleteOperationsBlueprintScopeLayer(backup, blueprint.id, layerId)
      if (result.cloudSynced) {
        clearStaleSyncMessages()
        return true
      }
      if (result.localSaved) {
        if (result.warning) {
          showSyncPausedNoticeOnce()
        }
        return true
      }
      setActionMsg({
        type: 'error',
        text: result.error || SCOPE_LAYER_CLOUD_SYNC_WARNING_MSG,
      })
      loadScopeLayers()
      return false
    } catch (e: any) {
      setActionMsg({
        type: 'error',
        text: e?.message || SCOPE_LAYER_CLOUD_SYNC_WARNING_MSG,
      })
      loadScopeLayers()
      return false
    }
  }, [blueprint?.id, clearStaleSyncMessages, loadScopeLayers, showSyncPausedNoticeOnce])

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
      renderedZoomRef.current = 1
      setRenderedZoom(1)
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
      // Restore the per-document last page (clamped to the page count) instead of
      // always jumping to page 1. initialPageRef is not clobbered by the load-time
      // onPageChange, so this reliably reopens where the user left off.
      const restorePage = Math.max(1, Math.min(doc.numPages || 1, Math.floor(Number(initialPageRef.current) || 1)))
      setCurrentPage(restorePage)
      setPageInput(String(restorePage))
      setRelativeZoom(1)
      pendingScrollResetRef.current = true
    } catch (e: any) {
      setError(e?.message || 'Failed to load blueprint PDF.')
    } finally {
      setIsLoading(false)
    }
  }, [blueprint, clearDoc, hasStoragePath])

  useEffect(() => {
    isViewerMountedRef.current = true
    return () => { isViewerMountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!blueprint) {
      clearDoc()
      setError(null)
      setAllAnnotations([])
      setScopeLayers([])
      return
    }
    loadAnnotations()
    loadScopeLayers()
    setIsolatedScopeLayerIds(new Set())
    void loadPdf()
    return () => { void clearDoc() }
  }, [blueprint?.id])

  const isBlueprintDirty =
    !!noteEditor ||
    !!richTextEditor ||
    !!draftRect ||
    !!inkDraft ||
    pasteModeActive ||
    !!inlineTextEditId ||
    !!layoutEditId ||
    // BLUEPRINT-6Q — keep the scope dirty while an annotation save is committing so a
    // realtime/live refresh can't overwrite local storage and drop the new annotation.
    hasPendingAnnotationSaves ||
    // EMERG-PKG-ORDER-1-B — keep remote refresh from replacing optimistic package order while
    // the normalized order save is still resolving.
    isScopeLayerOrderSaving ||
    // ANIM-2B1 — the route builder holds an unsaved draft whose expectedBaseRevision was
    // captured when it opened. A live refresh applying a remote snapshot here rewrites local
    // storage and reloads scopeLayers underneath the builder, leaving the draft behind the
    // stored revision — which the scene-save service then rejects as a stale revision on the
    // very first Save. Treat an open builder as dirty for the same reason annotation saves are.
    !!animationRouteBuilder

  useRemoteDataRefresh({
    scopeId: 'blueprints',
    label: 'Blueprint viewer',
    isDirty: isBlueprintDirty,
    onRemoteDataApplied: () => {
      // BLUEPRINT-6R — a live/realtime refresh just OVERWROTE local storage with a remote
      // snapshot. If an annotation save is in flight or only just settled, that snapshot can
      // predate the new annotation; reloading from it now would wipe the just-placed
      // annotation off the canvas. This is the race the dirty-scope guard alone can lose,
      // because state→effect propagation trails the realtime event from our own push. Keep the
      // current in-memory annotations and let the next post-settle load reconcile. Scope layers
      // are not part of this race, so refresh them normally.
      const now = Date.now()
      const savePending = pendingAnnotationMutationsRef.current > 0
      const recentlyStarted = now - lastAnnotationSaveStartedAtRef.current < 10000
      const recentlyFinished = now - lastAnnotationSaveFinishedAtRef.current < 5000
      const scopeLayerRefresh = decideWorkPackageRemoteRefreshApply(isScopeLayerOrderSavingRef.current)
      if (scopeLayerRefresh.deferScopeLayerRefresh) {
        deferredScopeLayerRefreshRef.current = true
      }
      if (savePending || recentlyStarted || recentlyFinished) {
        if (scopeLayerRefresh.loadScopeLayers) loadScopeLayers()
        return
      }
      loadAnnotations()
      if (scopeLayerRefresh.loadScopeLayers) loadScopeLayers()
      setWireProfileRemoteRefreshVersion((version) => version + 1)
    },
  })

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
        cachePageSizeInches(clampedPage, baseViewport.width, baseViewport.height)
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
        // Raster budget: never raster a canvas the platform can't paint.
        // iOS Safari silently renders blank past ~16.7M px, which was making
        // documents/annotations disappear and the viewport unstable at high
        // zoom. Any zoom beyond this cap is carried by the CSS visualScale
        // transform instead (renderedZoom bookkeeping below).
        const isTouchRasterBudget = isTabletDevice() || isMobileRef.current
        const maxCanvasArea = isTouchRasterBudget ? MAX_CANVAS_AREA_TOUCH : MAX_CANVAS_AREA_DESKTOP
        const maxCanvasDim = isTouchRasterBudget ? MAX_CANVAS_DIM_TOUCH : MAX_CANVAS_DIM_DESKTOP
        const baseArea = Math.max(1, baseViewport.width * baseViewport.height)
        const maxAreaScale = Math.sqrt(maxCanvasArea / baseArea)
        const maxDimScale = maxCanvasDim / Math.max(1, baseViewport.width, baseViewport.height)
        const requestedScale = fitWidthScale * clampRelativeZoom(relativeZoom)
        const actualRenderScale = Math.max(
          0.01,
          Math.min(MAX_RENDER_SCALE, maxAreaScale, maxDimScale, requestedScale)
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
        // Display size is owned by React (visualDisplayWidth/Height on pageFrame).
        // Do NOT set canvas.style.width/height to raster px — above the raster cap
        // pageFrame is larger than displaySize and that mismatch drifted symbols.
        context.drawImage(tempCanvas, 0, 0)
        setDisplaySize({ w: tempCanvas.width, h: tempCanvas.height })

        // Record what relative zoom this raster actually represents. Equals the
        // committed relativeZoom until the raster budget caps the canvas; the
        // gap between the two is rendered via the CSS visualScale transform.
        const committedRenderedZoom = Math.max(
          MIN_RELATIVE_ZOOM,
          actualRenderScale / Math.max(0.0001, fitWidthScale)
        )
        renderedZoomRef.current = committedRenderedZoom
        setRenderedZoom(committedRenderedZoom)

        const pendingAnchor = pendingPinchAnchorRef.current
        if (pendingAnchor && scrollAreaRef.current && pageFrameRef.current && !lockView) {
          const scroll = scrollAreaRef.current
          const scrollRect = scroll.getBoundingClientRect()
          const pageRect = pageFrameRef.current.getBoundingClientRect()
          const pageOffsetX = (pageRect.left - scrollRect.left) + scroll.scrollLeft
          const pageOffsetY = (pageRect.top - scrollRect.top) + scroll.scrollTop
          // Anchor targets must use the VISUAL page size (raster × CSS scale),
          // which is larger than the raster once the budget caps the canvas.
          const commitVisualScale = Math.max(
            1,
            clampRelativeZoom(relativeZoom) / Math.max(0.001, committedRenderedZoom)
          )
          const targetLeft = pageOffsetX + (pendingAnchor.ratioX * tempCanvas.width * commitVisualScale) - pendingAnchor.centerInScrollX
          const targetTop = pageOffsetY + (pendingAnchor.ratioY * tempCanvas.height * commitVisualScale) - pendingAnchor.centerInScrollY
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

  useEffect(() => {
    const handleDataSaved = () => clearStaleSyncMessages()
    window.addEventListener('poweron:data-saved', handleDataSaved)
    // Step 13B-QA5-R4: any real cloud sync succeeding (periodic sync, header save,
    // or one triggered by this viewer's own annotation/scope-layer saves) resolves
    // the stale-overwrite conflict app-wide -- clear the paused banner/gate here too,
    // not just when this viewer's own save happens to be the one that succeeds.
    window.addEventListener('poweron:sync-success', handleDataSaved)
    return () => {
      window.removeEventListener('poweron:data-saved', handleDataSaved)
      window.removeEventListener('poweron:sync-success', handleDataSaved)
    }
  }, [clearStaleSyncMessages])

  useEffect(() => {
    if (isFullScreenView || isTabletImmersiveFullscreen) {
      setTabletAnnotationsOpen(true)
    }
  }, [isFullScreenView, isTabletImmersiveFullscreen])

  const viewerPortalTarget = (isFullScreenView || isTabletImmersiveFullscreen) && viewerRootRef.current
    ? viewerRootRef.current
    : document.body

  useEffect(() => {
    const previousProjectId = previousWireProfileProjectIdRef.current
    const nextProjectId = blueprint?.projectId ?? null
    previousWireProfileProjectIdRef.current = nextProjectId
    if (shouldCloseWireProfileManagerForProjectChange({
      isOpen: isWireProfileManagerOpen,
      previousProjectId,
      nextProjectId,
    })) {
      setIsWireProfileManagerOpen(false)
    }
    // EST-1C: never carry a Project A Quick Access profile into Project B drawing.
    if (previousProjectId && nextProjectId && previousProjectId !== nextProjectId) {
      clearActiveQuickAccessSession()
      pathDraftRef.current = []
      setPathDraftPoints([])
      setPathCursorPx(null)
      if (quickAccessModalSlot != null) {
        setQuickAccessDraftWireProfileId(readProjectQuickAccessBinding(quickAccessModalSlot))
      }
    }
  }, [blueprint?.projectId, isWireProfileManagerOpen, clearActiveQuickAccessSession, quickAccessModalSlot, readProjectQuickAccessBinding])

  useEffect(() => {
    // Blueprint-set identity change also invalidates scoped Quick Access activation.
    clearActiveQuickAccessSession()
    pathDraftRef.current = []
    setPathDraftPoints([])
    setPathCursorPx(null)
  }, [blueprint?.id, clearActiveQuickAccessSession])

  // Escape key handler: closes UI state first, then exits fullscreen if no UI open.
  // This ensures Escape closes annotation editors, measurements, etc. before exiting fullscreen.
  // Fullscreen exit only happens when all annotation UI is closed.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (isWireProfileManagerOpen) {
        // The wire profile manager owns Escape while open so confirmations, busy state,
        // and dirty drafts cannot be bypassed by viewer-level shortcuts.
        return
      }
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
  }, [isFullScreenView, isTabletImmersiveFullscreen, noteEditor, richTextEditor, draftRect, dragStart, inkDraft, focusedAnnotationId, layoutEditId, inlineTextEditId, openPopover, pasteModeActive, isWireProfileManagerOpen])

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

    // displaySize reflects renderedZoom (the raster's zoom), so visual sizes
    // must be derived from renderedZoom — not the committed relativeZoom.
    const baseCommittedZoom = Math.max(0.001, renderedZoomRef.current)
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

  const orderedScopeLayers = useMemo(() => sortWorkPackages(scopeLayers), [scopeLayers])
  const isolatedScopeLayers = useMemo(
    () => orderedScopeLayers.filter((layer) => isolatedScopeLayerIds.has(layer.id)),
    [orderedScopeLayers, isolatedScopeLayerIds],
  )
  const isPackageVisibilityFilterActive = isolatedScopeLayers.length > 0

  // Page-aware Work Package panel list: current-page + unscoped packages by default,
  // everything when "Show All Pages" is on. Eye-toggle/visibility state itself is untouched —
  // this only controls which cards render in the panel.
  const pageFilteredScopeLayers = useMemo(
    () => (
      scopeLayerShowAllPages
        ? orderedScopeLayers
        : orderedScopeLayers.filter((layer) => layer.pageNumber == null || layer.pageNumber === currentPage)
    ),
    [orderedScopeLayers, scopeLayerShowAllPages, currentPage],
  )
  const pageFilteredScopeLayerIds = useMemo(
    () => pageFilteredScopeLayers.map((layer) => layer.id),
    [pageFilteredScopeLayers],
  )

  const isolatedAnnotationIdSet = useMemo(() => {
    // No packages selected for the visibility filter → null → show all annotations.
    if (isolatedScopeLayers.length === 0) return null
    // Union of every annotation id across all packages in the visible set.
    const ids = new Set<string>()
    isolatedScopeLayers.forEach((layer) => {
      (layer.selectedAnnotationIds || []).forEach((id) => {
        const clean = String(id).trim()
        if (clean) ids.add(clean)
      })
    })
    return ids
  }, [isolatedScopeLayers])

  useEffect(() => {
    isolatedAnnotationIdSetRef.current = isolatedAnnotationIdSet
  }, [isolatedAnnotationIdSet])

  // "Hide from General View" filter — union of selected annotation ids across every package
  // currently marked hidden. Only meaningful in General View: when any package is scoped/
  // isolated, scoped view wins and this returns null (so a hidden package can still be inspected
  // by scoping it). Never mutates annotation data — it only filters what renders.
  const hiddenAnnotationIdSet = useMemo(() => {
    if (isolatedScopeLayers.length > 0) return null       // scoped view overrides hidden filter
    // Package Pick and the package modal must use the same view filter as the canvas. Existing
    // package contents still resolve from allAnnotations below, but hidden annotations never
    // reappear or become pickable merely because membership editing is active.
    if (hiddenWorkPackageIds.size === 0) return null
    const ids = new Set<string>()
    scopeLayers.forEach((layer) => {
      if (!hiddenWorkPackageIds.has(layer.id)) return
      ;(layer.selectedAnnotationIds || []).forEach((id) => {
        const clean = String(id).trim()
        if (clean) ids.add(clean)
      })
    })
    return ids.size > 0 ? ids : null
  }, [isolatedScopeLayers.length, hiddenWorkPackageIds, scopeLayers])

  const canvasPageAnnotations = useMemo(() => {
    // Precedence: scoped/isolate view (show only those ids) → else hide hidden-package ids → else all.
    if (isolatedAnnotationIdSet) return pageAnnotations.filter((annotation) => isolatedAnnotationIdSet.has(annotation.id))
    if (hiddenAnnotationIdSet) return pageAnnotations.filter((annotation) => !hiddenAnnotationIdSet.has(annotation.id))
    return pageAnnotations
  }, [pageAnnotations, isolatedAnnotationIdSet, hiddenAnnotationIdSet])

  const animationRouteAnnotations = useMemo<RouteBuilderAnnotation[]>(() => allAnnotations.map((annotation) => {
    const meta = getAnnotationMeta(annotation)
    return {
      id: annotation.id,
      pageNumber: Math.max(1, Math.floor(Number(annotation.pageNumber) || 1)),
      label: annotationLabel(annotation),
      ...(annotation.text ? { text: annotation.text } : {}),
      ...(annotation.color ? { color: annotation.color } : {}),
      ...(meta.borderColor ? { borderColor: meta.borderColor } : {}),
      ...(annotation.type === 'shape' && meta.shapeKind ? { shapeKind: meta.shapeKind } : {}),
      ...(annotation.rect ? { rect: { ...annotation.rect } } : {}),
      ...(Array.isArray(meta.points) ? { points: meta.points.map((point: any) => ({ x: Number(point.x), y: Number(point.y) })) } : {}),
      ...(Array.isArray(meta.arcCtrls) ? { arcCtrls: meta.arcCtrls.map((point: any) => ({ x: Number(point.x), y: Number(point.y) })) } : {}),
      ...(Array.isArray(meta.pointIds) ? { pointIds: [...meta.pointIds] } : {}),
      ...(Array.isArray(meta.segmentIds) ? { segmentIds: [...meta.segmentIds] } : {}),
    }
  }), [allAnnotations])
  const animationRouteOverlay = useMemo(
    () => animationRouteBuilder ? getPackageAnimationRouteOverlay(animationRouteBuilder.draft) : null,
    [animationRouteBuilder]
  )

  // Annotations owned by the active playback run. Their resting Light Output glow is suppressed
  // for the duration so the route can light them from "off" — a render gate only, recomputed just
  // on play/stop rather than per frame. Nothing here writes to an annotation.
  const animationPlaybackAnnotationIds = useMemo<Set<string>>(() => {
    if (!animationPlayback) return EMPTY_ANNOTATION_ID_SET
    const layer = scopeLayers.find((entry) => entry.id === animationPlayback.layerId)
    const parsed = parseBlueprintAnimationScene(layer?.animationScene)
    if (parsed.status !== 'supported') return EMPTY_ANNOTATION_ID_SET
    const ids = new Set<string>()
    parsed.scene.nodes.forEach((node) => {
      if (node.anchor.kind !== 'virtual-point') ids.add(node.anchor.annotationId)
    })
    return ids
  }, [animationPlayback, scopeLayers])

  // Each route fixture's resting appearance, resolved through the same helper the canvas uses so
  // a fully activated fixture lands exactly on its saved Light Output rather than an approximation.
  const animationPlaybackFixtureAppearances = useMemo<Record<string, PlaybackFixtureAppearance>>(() => {
    if (animationPlaybackAnnotationIds.size === 0) return {}
    const appearances: Record<string, PlaybackFixtureAppearance> = {}
    allAnnotations.forEach((annotation) => {
      if (!animationPlaybackAnnotationIds.has(annotation.id) || !annotation.rect) return
      const meta = getAnnotationMeta(annotation)
      if (!isLightOutputShapeKind(meta.shapeKind)) return
      const metrics = getLightOutputGlowMetrics(meta.shapeKind, meta)
      appearances[annotation.id] = {
        rect: clampRectToPage(annotation.rect as any),
        glowRadius: metrics.outputOverlayR,
        glowColor: metrics.kelvinColor,
      }
    })
    return appearances
  }, [allAnnotations, animationPlaybackAnnotationIds])

  const isAnnotationVisibleOnCanvas = useCallback((annotationId: string) => {
    if (isolatedAnnotationIdSet) return isolatedAnnotationIdSet.has(annotationId)
    if (hiddenAnnotationIdSet) return !hiddenAnnotationIdSet.has(annotationId)
    return true
  }, [isolatedAnnotationIdSet, hiddenAnnotationIdSet])

  const activeScopeLayerSelectionIds = scopeLayerModal.open ? scopeLayerDraftIds : Array.from(selectedForPackageIds)
  const selectedPackageAnnotations = useMemo(
    () => {
      const idSet = new Set(activeScopeLayerSelectionIds)
      return allAnnotations.filter((annotation) => idSet.has(annotation.id))
    },
    [activeScopeLayerSelectionIds, allAnnotations]
  )
  const selectedPackageItemRefs = useMemo(
    () => buildBlueprintScopeItemRefs(allAnnotations, activeScopeLayerSelectionIds),
    [activeScopeLayerSelectionIds, allAnnotations]
  )
  const selectedPackageSummary = useMemo(
    () => buildBlueprintScopeItemSummary(selectedPackageItemRefs),
    [selectedPackageItemRefs]
  )
  const scopeLayerDraftWireQuantityResult = useMemo(() => {
    if (!scopeLayerModal.open || !blueprint) return null
    const draftPackage = {
      id: scopeLayerModal.layerId || 'draft-work-package',
      name: scopeLayerForm.name || 'Work Package',
      description: scopeLayerForm.description || '',
      color: scopeLayerForm.color || DEFAULT_SCOPE_LAYER_COLOR,
      selectedAnnotationIds: scopeLayerDraftIds,
      itemRefs: selectedPackageItemRefs,
      pageNumber: currentPage,
      roughInHours: 0,
      trimHours: 0,
      testingHours: 0,
      cleanupHours: 0,
      crewNotes: '',
      proposalSummary: '',
      createdAt: '',
      updatedAt: '',
      visible: true,
      isolated: false,
    }
    const previewPackages = buildEffectiveWorkPackagesForPreview({
      workPackages: scopeLayers,
      draftPackage,
    })
    return buildWireQuantityResult({
      projectId: blueprint.projectId,
      blueprintSetId: blueprint.id,
      annotations: allAnnotations,
      workPackages: previewPackages,
      wireProfiles: projectWireProfiles,
      savedCalibrations,
      detectedScales,
      getPageSizeInches,
    })
  }, [
    allAnnotations,
    blueprint,
    currentPage,
    detectedScales,
    getPageSizeInches,
    projectWireProfiles,
    savedCalibrations,
    scopeLayerDraftIds,
    scopeLayerForm.color,
    scopeLayerForm.description,
    scopeLayerForm.name,
    scopeLayerModal,
    scopeLayers,
    selectedPackageItemRefs,
  ])
  const scopeLayerDraftWireQuantityRollup = scopeLayerDraftWireQuantityResult?.packageRollups.find((rollup) => rollup.packageId === (scopeLayerModal.layerId || 'draft-work-package')) ?? null
  const selectedPackageCount = selectedForPackageIds.size

  // ── Edit/Create Work Package: which Package-Pick selections can still be added ──
  // Source of truth is selectedForPackageIds — the EXACT same set that powers the
  // "Package Pick: N selected" banner. We resolve those ids against the FULL annotation
  // source (allAnnotations) for metadata, then require each new pick to pass the current canvas
  // visibility filter. Existing modal/package contents remain available even when hidden. Ids
  // already in the modal draft are excluded so duplicates are never offered. This single memo drives
  // both the "Add selected items" button's enabled state and its click handler, so the
  // banner count and the button can never disagree.
  const addablePickedAnnotationIds = useMemo(() => {
    if (!scopeLayerModal.open) return [] as string[]
    if (selectedForPackageIds.size === 0) return [] as string[]
    const draftSet = new Set(scopeLayerDraftIds.map((id) => String(id).trim()))
    const validIds = new Set(allAnnotations.map((annotation) => String(annotation.id).trim()))
    const addable: string[] = []
    selectedForPackageIds.forEach((raw) => {
      const id = String(raw).trim()
      if (!id) return
      if (!validIds.has(id)) return   // must resolve to a real annotation in the full source
      if (!isAnnotationVisibleOnCanvas(id)) return // Package Pick adds visible annotations only
      if (draftSet.has(id)) return    // already in this package's draft → skip duplicate
      addable.push(id)
    })
    return addable
  }, [scopeLayerModal.open, selectedForPackageIds, scopeLayerDraftIds, allAnnotations, isAnnotationVisibleOnCanvas])

  useEffect(() => {
    setSelectedForPackageIds((prev) => {
      if (prev.size === 0) return prev
      const validIds = new Set(allAnnotations.map((annotation) => annotation.id))
      const next = new Set(Array.from(prev).filter((id) => validIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [allAnnotations])

  // Package Pick is a visible-canvas operation. If the user enables/changes a hidden or scoped
  // filter while picking, drop only picks that are no longer visible; package visibility state
  // and existing saved package membership are untouched.
  useEffect(() => {
    if (!isPackagePickMode) return
    setSelectedForPackageIds((prev) => {
      const next = new Set(Array.from(prev).filter((id) => isAnnotationVisibleOnCanvas(id)))
      return next.size === prev.size ? prev : next
    })
  }, [isPackagePickMode, isAnnotationVisibleOnCanvas])

  useEffect(() => {
    if (focusedAnnotationId && !isAnnotationVisibleOnCanvas(focusedAnnotationId)) {
      setFocusedAnnotationId(null)
      setFocusedAnnotationRect(null)
      setLayoutEditId(null)
      setOpenPopover(null)
      setBarDragOffset(null)
    }
    if (layoutEditId && !isAnnotationVisibleOnCanvas(layoutEditId)) {
      setLayoutEditId(null)
    }
  }, [isAnnotationVisibleOnCanvas, focusedAnnotationId, layoutEditId])

  const togglePackageSelection = useCallback((annotationId: string, checked: boolean) => {
    if (checked && !isAnnotationVisibleOnCanvas(annotationId)) return
    setSelectedForPackageIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(annotationId)
      else next.delete(annotationId)
      return next
    })
  }, [isAnnotationVisibleOnCanvas])

  // Package Pick canvas toggle — flips a single annotation in/out of the package-pick set.
  // Never mutates annotation geometry; only the local selection set changes.
  const togglePackagePickId = useCallback((annotationId: string) => {
    if (!isAnnotationVisibleOnCanvas(annotationId)) return
    setSelectedForPackageIds((prev) => {
      const next = new Set(prev)
      if (next.has(annotationId)) next.delete(annotationId)
      else next.add(annotationId)
      return next
    })
  }, [isAnnotationVisibleOnCanvas])

  const clearPackagePickSelection = useCallback(() => {
    setSelectedForPackageIds(new Set())
  }, [])

  // Work Package edit — remove one item from the in-progress draft (does NOT delete the annotation).
  const removeScopeDraftItem = useCallback((annotationId: string) => {
    setScopeLayerDraftIds((prev) => prev.filter((id) => id !== annotationId))
  }, [])

  // Work Package edit — append the current Package-Pick selection into the draft. Reads the
  // derived addablePickedAnnotationIds (from selectedForPackageIds, resolved against the full
  // annotation source for metadata and checked against current canvas visibility), preserves every
  // existing draft item untouched, and appends only visible picks not already in the package.
  // Does not close the modal, clear the pick selection, or mutate saved data — Save persists.
  const addPickedItemsToScopeDraft = useCallback(() => {
    if (addablePickedAnnotationIds.length === 0) return
    setScopeLayerDraftIds((prev) => {
      const existing = new Set(prev)
      const additions = addablePickedAnnotationIds.filter((id) => !existing.has(id))
      if (additions.length === 0) return prev
      return [...prev, ...additions]
    })
  }, [addablePickedAnnotationIds])

  const resetScopeLayerForm = useCallback(() => {
    setScopeLayerForm({
      name: '',
      description: '',
      color: DEFAULT_SCOPE_LAYER_COLOR,
      roughInHours: 0,
      trimHours: 0,
      testingHours: 0,
      cleanupHours: 0,
      crewNotes: '',
      proposalSummary: '',
    })
  }, [])

  const openCreateScopeLayerModal = useCallback(() => {
    if (selectedForPackageIds.size === 0) return
    resetScopeLayerForm()
    setScopeLayerDraftIds(Array.from(selectedForPackageIds))
    setActionMsg(null)
    setScopeLayerModal({ open: true, mode: 'create' })
  }, [resetScopeLayerForm, selectedForPackageIds])

  const openEditScopeLayerModal = useCallback((layer: BlueprintScopeLayer) => {
    setScopeLayerForm({
      name: layer.name,
      description: layer.description,
      color: layer.color || DEFAULT_SCOPE_LAYER_COLOR,
      roughInHours: Number(layer.roughInHours || 0),
      trimHours: Number(layer.trimHours || 0),
      testingHours: Number(layer.testingHours || 0),
      cleanupHours: Number(layer.cleanupHours || 0),
      crewNotes: layer.crewNotes,
      proposalSummary: layer.proposalSummary,
    })
    // The editable item list is the draft; the package-pick selection is left intact so the
    // user can add canvas-picked items into this package via "Add selected items".
    setScopeLayerDraftIds([...layer.selectedAnnotationIds])
    setActionMsg(null)
    setScopeLayerModal({ open: true, mode: 'edit', layerId: layer.id })
  }, [])

  const closeScopeLayerModal = useCallback(() => {
    setScopeLayerModal({ open: false, mode: 'create' })
    setScopeLayerDraftIds([])
  }, [])

  const saveScopeLayerFromModal = useCallback(async () => {
    setActionMsg(null)
    const name = scopeLayerForm.name.trim()
    if (!name) {
      setActionMsg({ type: 'error', text: 'Work package name is required.' })
      return
    }
    const now = new Date().toISOString()
    const selectedIds = [...scopeLayerDraftIds]
    const itemRefs = buildBlueprintScopeItemRefs(allAnnotations, selectedIds)
    if (itemRefs.length === 0) {
      setActionMsg({ type: 'error', text: 'Select at least one annotation for this work package.' })
      return
    }
    const payloadBase = {
      name,
      description: scopeLayerForm.description.trim(),
      color: scopeLayerForm.color || DEFAULT_SCOPE_LAYER_COLOR,
      selectedAnnotationIds: itemRefs.map((item) => item.annotationId),
      itemRefs,
      roughInHours: Number(scopeLayerForm.roughInHours || 0),
      trimHours: Number(scopeLayerForm.trimHours || 0),
      testingHours: Number(scopeLayerForm.testingHours || 0),
      cleanupHours: Number(scopeLayerForm.cleanupHours || 0),
      crewNotes: scopeLayerForm.crewNotes.trim(),
      proposalSummary: scopeLayerForm.proposalSummary.trim(),
    }
    let nextLayers: BlueprintScopeLayer[]
    if (scopeLayerModal.mode === 'edit' && scopeLayerModal.layerId) {
      // Preserve the package's existing home page — adding/removing items never moves it.
      nextLayers = sortWorkPackages(scopeLayers.map((layer) => (
        layer.id === scopeLayerModal.layerId
          ? { ...layer, ...payloadBase, updatedAt: now }
          : layer
      )))
    } else {
      const newSortOrder = assignNewWorkPackageOrder(scopeLayers)
      nextLayers = sortWorkPackages([
        ...scopeLayers,
        {
          id: `scope_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          ...payloadBase,
          pageNumber: currentPage,
          createdAt: now,
          updatedAt: now,
          ...(newSortOrder != null ? { sortOrder: newSortOrder } : {}),
          visible: true,
          isolated: false,
        },
      ])
    }

    setScopeLayers(nextLayers)
    const saved = await persistScopeLayers(nextLayers)
    if (!saved) {
      loadScopeLayers()
      return
    }

    setSelectedForPackageIds(new Set())
    setActionMsg({
      type: 'success',
      text: scopeLayerModal.mode === 'edit' ? 'Work package updated.' : 'Work package created.',
    })
    closeScopeLayerModal()
    requestAnimationFrame(() => {
      scopeLayersPanelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }, [
    allAnnotations,
    closeScopeLayerModal,
    currentPage,
    loadScopeLayers,
    persistScopeLayers,
    scopeLayerDraftIds,
    scopeLayerForm,
    scopeLayerModal,
    scopeLayers,
  ])

  const deleteScopeLayer = useCallback(async (layerId: string) => {
    setActionMsg(null)
    setAnimationPlayback((previous) => previous?.layerId === layerId ? null : previous)
    setIsolatedScopeLayerIds((prev) => {
      if (!prev.has(layerId)) return prev
      const next = new Set(prev)
      next.delete(layerId)
      return next
    })
    setHiddenWorkPackageIds((prev) => {
      if (!prev.has(layerId)) return prev
      const next = new Set(prev)
      next.delete(layerId)
      return next
    })
    // Optimistic removal; the explicit single-id delete tombstones exactly this package.
    // On failure persistScopeLayerDeletion → loadScopeLayers() restores the full prior array.
    const nextLayers = scopeLayers.filter((layer) => layer.id !== layerId)
    setScopeLayers(nextLayers)
    const saved = await persistScopeLayerDeletion(layerId)
    if (!saved) {
      loadScopeLayers()
      return
    }
    setActionMsg({ type: 'success', text: 'Work package deleted.' })
  }, [loadScopeLayers, persistScopeLayerDeletion, scopeLayers])

  // Multi-package visibility toggle. Adds/removes a package from the visible set.
  // Empty set = no filter = all annotations shown (handled by isolatedAnnotationIdSet).
  const toggleScopeLayerIsolation = useCallback((layerId: string) => {
    setIsolatedScopeLayerIds((prev) => {
      const next = new Set(prev)
      if (next.has(layerId)) next.delete(layerId)
      else next.add(layerId)
      return next
    })
  }, [])

  const clearScopeLayerVisibilityFilter = useCallback(() => {
    setIsolatedScopeLayerIds(new Set())
  }, [])

  // "Hide from General View" toggle — per package, independent of the isolate/scoped filter.
  // Visual-only session state; never touches annotation data or package membership.
  const toggleScopeLayerHidden = useCallback((layerId: string) => {
    setHiddenWorkPackageIds((prev) => {
      const next = new Set(prev)
      if (next.has(layerId)) next.delete(layerId)
      else next.add(layerId)
      return next
    })
  }, [])

  const clearHiddenScopeLayers = useCallback(() => {
    setHiddenWorkPackageIds(new Set())
  }, [])

  // ── Work Package / Scope Layer reordering ──
  const persistReorderedScopeLayers = useCallback(async (nextLayers: BlueprintScopeLayer[]) => {
    if (!blueprint?.id) return
    const saveId = ++scopeLayerOrderSaveIdRef.current
    isScopeLayerOrderSavingRef.current = true
    setIsScopeLayerOrderSaving(true)
    setScopeLayers(sortWorkPackages(nextLayers))
    let saved = false
    let cloudSynced = false
    try {
      const backup = getBackupData()
      if (!backup) throw new Error('No local backup data available.')
      const result = await saveOperationsBlueprintScopeLayers(backup, blueprint.id, nextLayers)
      saved = result.cloudSynced || result.localSaved
      cloudSynced = result.cloudSynced
      if (result.cloudSynced) {
        clearStaleSyncMessages()
      } else if (result.localSaved) {
        if (result.warning) showSyncPausedNoticeOnce()
      } else {
        setActionMsg({
          type: 'error',
          text: result.error || SCOPE_LAYER_CLOUD_SYNC_WARNING_MSG,
        })
      }
    } catch (e: any) {
      setActionMsg({
        type: 'error',
        text: e?.message || SCOPE_LAYER_CLOUD_SYNC_WARNING_MSG,
      })
    }
    if (!isViewerMountedRef.current) return
    if (!saved) {
      setDraggingScopeLayerId(null)
      setDragOverScopeLayerId(null)
      loadScopeLayers()
    }
    if (scopeLayerOrderSaveIdRef.current === saveId) {
      const runDeferredRefresh = shouldRunDeferredWorkPackageRefresh({
        deferred: deferredScopeLayerRefreshRef.current,
        saved,
        cloudSynced,
        saveId,
        currentSaveId: scopeLayerOrderSaveIdRef.current,
      })
      deferredScopeLayerRefreshRef.current = false
      isScopeLayerOrderSavingRef.current = false
      setIsScopeLayerOrderSaving(false)
      if (runDeferredRefresh) {
        loadScopeLayers()
      }
    }
  }, [
    blueprint?.id,
    clearStaleSyncMessages,
    loadScopeLayers,
    showSyncPausedNoticeOnce,
  ])

  const requestScopeLayerReorder = useCallback((params: {
    movedId: string
    targetId?: string
    direction?: 'up' | 'down'
    placement?: 'before' | 'after'
  }) => {
    if (isScopeLayerOrderSavingRef.current) return
    const orderTouchedAt = new Date().toISOString()
    const result = params.direction
      ? moveWorkPackageById({
        fullOrderedLivePackages: orderedScopeLayers,
        visibleIds: pageFilteredScopeLayerIds,
        movedId: params.movedId,
        direction: params.direction,
        orderTouchedAt,
      })
      : params.targetId
        ? reorderVisibleWorkPackagesById({
          fullOrderedLivePackages: orderedScopeLayers,
          visibleIds: pageFilteredScopeLayerIds,
          movedId: params.movedId,
          targetId: params.targetId,
          placement: params.placement || 'before',
          orderTouchedAt,
        })
        : { changed: false, packages: orderedScopeLayers }
    if (!result.changed) return
    void persistReorderedScopeLayers(result.packages)
  }, [
    isScopeLayerOrderSaving,
    orderedScopeLayers,
    pageFilteredScopeLayerIds,
    persistReorderedScopeLayers,
  ])

  // Drop card `fromId` at the position currently occupied by `toId`.
  const reorderScopeLayer = useCallback((fromId: string, toId: string) => {
    requestScopeLayerReorder({ movedId: fromId, targetId: toId, placement: 'before' })
  }, [requestScopeLayerReorder])

  // Fallback up/down control (reliable on touch where native drag is finicky).
  const moveScopeLayer = useCallback((layerId: string, direction: 'up' | 'down') => {
    requestScopeLayerReorder({ movedId: layerId, direction })
  }, [requestScopeLayerReorder])

  // ── ANIM-2B1: one-source package route builder ──
  const openPackageAnimationRouteBuilder = useCallback((clickedLayer: BlueprintScopeLayer) => {
    // Resolve the package again from the latest canonical scopeLayers at the moment the builder
    // opens. The card callback closes over the layer object from the render that drew it, which
    // can be a revision behind after a save or a live refresh; using it as the authoritative
    // scene source is what opened the builder on a stale revision.
    const layer = scopeLayersRef.current.find((entry) => entry.id === clickedLayer.id) || clickedLayer
    setAnimationPlayback((previous) => previous?.layerId === layer.id ? null : previous)
    const pageNumber = Math.max(1, Math.floor(Number(layer.pageNumber || layer.itemRefs?.[0]?.pageNumber || currentPage) || 1))
    setIsPackagePickMode(false)
    setLayoutEditId(null)
    setFocusedAnnotationId(null)
    setOpenPopover(null)
    if (pageNumber !== currentPage) {
      setCurrentPage(pageNumber)
      setPageInput(String(pageNumber))
    }
    // A fresh session id: any save/clear still in flight from an earlier session can no longer
    // stamp its conflict onto this one.
    setAnimationRouteBuilder(openPackageAnimationRouteSession({
      layer,
      annotations: animationRouteAnnotations,
      pageNumber,
      sessionId: `route_session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    }))
  }, [animationRouteAnnotations, currentPage])

  const closePackageAnimationRouteBuilder = useCallback(() => {
    animationRouteBuilderRef.current = null
    setAnimationRouteBuilder(null)
  }, [])

  const dismissPackageAnimationRouteNotice = useCallback((notice: PackageAnimationRouteNotice) => {
    setPackageAnimationRouteNotices((previous) => clearPackageAnimationRouteNotice(previous, {
      blueprintSetId: notice.blueprintSetId,
      scopeLayerId: notice.scopeLayerId,
      operationId: notice.operationId,
    }))
  }, [])

  const changePackageAnimationRouteDraft = useCallback((draft: PackageAnimationRouteDraft) => {
    const previous = animationRouteBuilderRef.current
    if (!previous) return
    const next = { ...previous, draft, conflict: undefined }
    // Keep pointer dispatch synchronized with panel actions even before React commits a rerender.
    animationRouteBuilderRef.current = next
    setAnimationRouteBuilder(next)
  }, [])

  const savePackageAnimationRoute = useCallback(async () => {
    if (!animationRouteBuilder || animationRouteBuilder.saving || !blueprint?.id) return
    const session = animationRouteBuilder
    const conversion = packageAnimationRouteDraftToScene(animationRouteBuilder.draft)
    if (!conversion.scene || conversion.issues.some((entry) => entry.severity === 'error')) return
    if (!animationRouteSaveGuardRef.current.begin()) return
    const operationId = animationRouteSaveOperationIdRef.current + 1
    animationRouteSaveOperationIdRef.current = operationId
    const saveIdentity = {
      sessionId: session.sessionId,
      layerId: session.layerId,
      blueprintSetId: blueprint.id,
      projectId: blueprint.projectId,
      operationId,
    }
    setAnimationRouteBuilder((previous) => previous && previous.sessionId === session.sessionId && previous.layerId === session.layerId
      ? { ...previous, saving: true, conflict: undefined }
      : previous)
    try {
      const result = await saveOperationsBlueprintScopeLayerAnimationScene({
        blueprintSetId: blueprint.id,
        scopeLayerId: animationRouteBuilder.layerId,
        expectedBaseRevision: animationRouteBuilder.draft.expectedBaseRevision,
        nextScene: JSON.parse(JSON.stringify(conversion.scene)),
      })
      const outcome = reconcilePackageAnimationRouteSave(animationRouteBuilder, result)
      if (outcome.status === 'saved') {
        const completionDecision = decidePackageAnimationRouteCompletion(animationRouteBuilderRef.current, saveIdentity, {
          ...blueprintIdentityRef.current,
          currentOperationId: animationRouteSaveOperationIdRef.current,
        })
        // Reconcile from the verified result only: the saved layer carries the service's final
        // revision, so the package card and any reopen both read the revision that actually
        // landed. Closing clears the draft, overlays, badges and route-pick pointer capture in
        // one step, and never runs the unsaved-changes confirm. The service already dispatched
        // the one verified poweron:sync-success event — do not dispatch another here.
        if (completionDecision.applyToCurrentScopeLayers) {
          setScopeLayers((previous) => sortWorkPackages(applySavedAnimationScopeLayer(previous, outcome.scopeLayer).filter((layer) => !layer.deletedAt)))
        }
        if (completionDecision.applyReviewToCurrentView) {
          setAnimationRouteReviewConflicts((previous) => {
            const key = packageAnimationRouteNoticeKey(saveIdentity.blueprintSetId, outcome.scopeLayer.id)
            const existing = previous[key]
            if (existing?.operationId != null && existing.operationId > operationId) return previous
            if (outcome.reviewConflict) return { ...previous, [key]: { ...outcome.reviewConflict, operationId } }
            const next = { ...previous }
            delete next[key]
            return next
          })
        }
        if (completionDecision.closeCurrentBuilder) {
          setAnimationRouteBuilder((current) => current && current.sessionId === saveIdentity.sessionId && current.layerId === saveIdentity.layerId ? null : current)
        }
        if (completionDecision.applyNoticeToCurrentView) {
          if (outcome.actionMessage.type === 'success') {
            setPackageAnimationRouteNotices((previous) => clearPackageAnimationRouteNotice(previous, {
              blueprintSetId: saveIdentity.blueprintSetId,
              scopeLayerId: outcome.scopeLayer.id,
              operationId,
            }))
          } else {
            setPackageAnimationRouteNotices((previous) => upsertPackageAnimationRouteNotice(previous, {
              ...outcome.actionMessage,
              blueprintSetId: saveIdentity.blueprintSetId,
              scopeLayerId: outcome.scopeLayer.id,
              operationId,
            }))
          }
        }
        return
      }
      // Conflict: keep the builder open, keep the draft and its dirty flag, keep the expected
      // revision untouched, and leave overlays in place. Reload Latest / Keep Draft Open recover.
      // Only the session that issued this save may be marked — a late result must never brand a
      // newly opened (or different) package's builder with a conflict it did not cause.
      const completionDecision = decidePackageAnimationRouteCompletion(animationRouteBuilderRef.current, saveIdentity, {
        ...blueprintIdentityRef.current,
        currentOperationId: animationRouteSaveOperationIdRef.current,
      })
      setAnimationRouteBuilder((previous) => completionDecision.closeCurrentBuilder && previous && previous.sessionId === session.sessionId && previous.layerId === session.layerId
        ? { ...previous, saving: false, conflict: outcome.conflict }
        : previous)
      if (completionDecision.closeCurrentBuilder) {
        setActionMsg({ type: 'error', text: outcome.conflict.message })
      }
    } catch (error: any) {
      const completionDecision = decidePackageAnimationRouteCompletion(animationRouteBuilderRef.current, saveIdentity, {
        ...blueprintIdentityRef.current,
        currentOperationId: animationRouteSaveOperationIdRef.current,
      })
      setAnimationRouteBuilder((previous) => completionDecision.closeCurrentBuilder && previous && previous.sessionId === session.sessionId && previous.layerId === session.layerId ? {
        ...previous,
        saving: false,
        conflict: {
          message: error?.message || 'The route save could not be completed. Your draft is still open.',
          sameDevice: false,
        },
      } : previous)
    } finally {
      // Reset after success, conflict and failure alike so a deliberate retry is always allowed.
      animationRouteSaveGuardRef.current.end()
    }
  }, [animationRouteBuilder, blueprint?.id, blueprint?.projectId])

  const clearSavedPackageAnimationRoute = useCallback(async (clickedLayer: BlueprintScopeLayer) => {
    if (!blueprint?.id || !clickedLayer.animationScene) return
    // Same canonical resolution as open: never send a revision read off a render-stale card.
    const layer = scopeLayersRef.current.find((entry) => entry.id === clickedLayer.id) || clickedLayer
    if (!layer.animationScene) return
    if (typeof window !== 'undefined' && !window.confirm(`Clear the saved animation route for “${layer.name}”? This cannot be undone.`)) return
    const expectedBaseRevision = resolvePackageAnimationRouteBaseRevision(layer)
    if (!animationRouteSaveGuardRef.current.begin()) return
    const operationId = animationRouteSaveOperationIdRef.current + 1
    animationRouteSaveOperationIdRef.current = operationId
    const clearSession = animationRouteBuilderRef.current?.layerId === layer.id ? animationRouteBuilderRef.current : null
    const clearIdentity = {
      sessionId: clearSession?.sessionId || '',
      layerId: layer.id,
      blueprintSetId: blueprint.id,
      projectId: blueprint.projectId,
      operationId,
    }
    try {
      const result = await saveOperationsBlueprintScopeLayerAnimationScene({
        blueprintSetId: blueprint.id,
        scopeLayerId: layer.id,
        expectedBaseRevision,
        nextScene: null,
      })
      const outcome = reconcilePackageAnimationRouteSave(null, result)
      if (outcome.status === 'saved') {
        const completionDecision = decidePackageAnimationRouteCompletion(animationRouteBuilderRef.current, clearIdentity, {
          ...blueprintIdentityRef.current,
          currentOperationId: animationRouteSaveOperationIdRef.current,
        })
        // Same reconciliation as save: adopt the returned scene-less layer so the package card
        // stops showing the removed route, and keep the service's removal revision marker.
        if (completionDecision.applyToCurrentScopeLayers) {
          setScopeLayers((previous) => sortWorkPackages(applySavedAnimationScopeLayer(previous, outcome.scopeLayer).filter((layer) => !layer.deletedAt)))
          setAnimationPlayback((previous) => previous?.layerId === layer.id ? null : previous)
        }
        if (completionDecision.applyReviewToCurrentView) {
          setAnimationRouteReviewConflicts((previous) => {
            const key = packageAnimationRouteNoticeKey(clearIdentity.blueprintSetId, outcome.scopeLayer.id)
            const existing = previous[key]
            if (existing?.operationId != null && existing.operationId > operationId) return previous
            if (outcome.reviewConflict) return { ...previous, [key]: { ...outcome.reviewConflict, operationId } }
            const next = { ...previous }
            delete next[key]
            return next
          })
        }
        if (completionDecision.closeCurrentBuilder) {
          setAnimationRouteBuilder((previous) => previous && previous.sessionId === clearIdentity.sessionId && previous.layerId === clearIdentity.layerId ? null : previous)
        }
        if (completionDecision.applyNoticeToCurrentView) {
          if (outcome.saveStatus === 'verified-success') {
            setPackageAnimationRouteNotices((previous) => clearPackageAnimationRouteNotice(previous, {
              blueprintSetId: clearIdentity.blueprintSetId,
              scopeLayerId: outcome.scopeLayer.id,
              operationId,
            }))
          } else {
            setPackageAnimationRouteNotices((previous) => upsertPackageAnimationRouteNotice(previous, {
              ...outcome.actionMessage,
              blueprintSetId: clearIdentity.blueprintSetId,
              scopeLayerId: outcome.scopeLayer.id,
              operationId,
            }))
          }
        }
        return
      }
      // Conflict-aware removal semantics are unchanged: no local removal, existing scene stays.
      // Only a builder still showing this package may surface the conflict.
      const completionDecision = decidePackageAnimationRouteCompletion(animationRouteBuilderRef.current, clearIdentity, {
        ...blueprintIdentityRef.current,
        currentOperationId: animationRouteSaveOperationIdRef.current,
      })
      setAnimationRouteBuilder((previous) => completionDecision.closeCurrentBuilder && previous && previous.sessionId === clearIdentity.sessionId && previous.layerId === layer.id
        ? { ...previous, saving: false, conflict: outcome.conflict }
        : previous)
      if (completionDecision.closeCurrentBuilder) {
        setActionMsg({ type: 'error', text: outcome.conflict.message })
      }
    } finally {
      animationRouteSaveGuardRef.current.end()
    }
  }, [animationRouteBuilder?.layerId, blueprint?.id, blueprint?.projectId])

  const reloadLatestPackageAnimationRoute = useCallback(() => {
    if (!animationRouteBuilder || !blueprint?.id) return
    let freshLayers: BlueprintScopeLayer[] = []
    try {
      const backup = getBackupData()
      freshLayers = sortWorkPackages(getOperationsBlueprintScopeLayers(backup || {}, blueprint.id))
    } catch {
      freshLayers = []
    }
    const freshLocal = freshLayers.find((entry) => entry.id === animationRouteBuilder.layerId)
    if (freshLayers.length) setScopeLayers(freshLayers)
    if (!freshLocal) {
      loadScopeLayers()
      setActionMsg({ type: 'error', text: 'The work package no longer exists. Your draft is still open.' })
      return
    }
    const reactLayer = scopeLayersRef.current.find((entry) => entry.id === animationRouteBuilder.layerId)
    const conflictScene = animationRouteBuilder.conflict?.currentScene
    const conflictCandidate = conflictScene != null
      ? { ...freshLocal, animationScene: conflictScene, animationSceneRevision: undefined }
      : undefined
    const candidates = [freshLocal, reactLayer, conflictCandidate].filter(Boolean) as BlueprintScopeLayer[]
    const layer = candidates.reduce((best, candidate) => (
      resolvePackageAnimationRouteBaseRevision(candidate) > resolvePackageAnimationRouteBaseRevision(best)
        ? candidate
        : best
    ), freshLocal)
    setAnimationRouteBuilder(openPackageAnimationRouteSession({
      layer,
      annotations: animationRouteAnnotations,
      pageNumber: animationRouteBuilder.pageNumber,
      sessionId: `route_session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    }))
  }, [animationRouteAnnotations, animationRouteBuilder, blueprint?.id, loadScopeLayers])

  const handleAnimationRoutePick = useCallback((event: React.PointerEvent<HTMLDivElement>, targetAnnotationId?: string) => {
    const liveSession = animationRouteBuilderRef.current
    if (!liveSession || !overlayRef.current) return false
    const layer = scopeLayersRef.current.find((entry) => entry.id === liveSession.layerId)
    if (!layer) return false
    const overlayRect = overlayRef.current.getBoundingClientRect()
    const pointer = toNorm(event.clientX - overlayRect.left, event.clientY - overlayRect.top, overlayRect.width, overlayRect.height)
    const packageIds = new Set(layer.selectedAnnotationIds)
    const circuits = animationRouteAnnotations.filter((annotation) => (
      annotation.pageNumber === currentPage
      && packageIds.has(annotation.id)
      && isAnnotationVisibleOnCanvas(annotation.id)
      && isCircuitShapeKind(annotation.shapeKind)
    ))
    const hit = findNearestRouteSegment(pointer, circuits, {
      pageWidth: Math.max(1, overlayRect.width),
      pageHeight: Math.max(1, overlayRect.height),
      tolerancePx: event.pointerType === 'touch' ? 28 : 14,
    })
    const overlappingAnnotationIds: string[] = []
    if (typeof document !== 'undefined') {
      for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
        const annotationElement = element.closest?.('[data-annotation-id]') as HTMLElement | null
        const annotationId = annotationElement?.getAttribute('data-annotation-id')
        if (!annotationId || !overlayRef.current.contains(annotationElement) || overlappingAnnotationIds.includes(annotationId)) continue
        overlappingAnnotationIds.push(annotationId)
      }
    }
    const eligibleDeviceIds = new Set(animationRouteAnnotations.filter((annotation) => (
      annotation.pageNumber === currentPage
      && packageIds.has(annotation.id)
      && isAnnotationVisibleOnCanvas(annotation.id)
      && isRouteBuilderDeviceKind(annotation.shapeKind)
    )).map((annotation) => annotation.id))
    const eligibleSourceDeviceIds = new Set(animationRouteAnnotations.filter((annotation) => (
      annotation.pageNumber === currentPage
      && packageIds.has(annotation.id)
      && isAnnotationVisibleOnCanvas(annotation.id)
      && isRouteBuilderSourceKind(annotation.shapeKind)
    )).map((annotation) => annotation.id))
    const diagnosticSourceIds = new Set(animationRouteAnnotations.filter((annotation) => (
      annotation.pageNumber === currentPage
      && isAnnotationVisibleOnCanvas(annotation.id)
      && isRouteBuilderSourceKind(annotation.shapeKind)
    )).map((annotation) => annotation.id))
    const resolvedRoute = resolvePackageAnimationRouteDraft(liveSession.draft)
    const currentEndpointAnnotationId = resolvedRoute.currentEndpoint?.node.anchor.kind === 'annotation-center'
      ? resolvedRoute.currentEndpoint.node.anchor.annotationId
      : undefined
    const excludedDeviceIds = new Set<string>(currentEndpointAnnotationId ? [currentEndpointAnnotationId] : [])
    const eligibleDevices = animationRouteAnnotations
      .filter((annotation) => (liveSession.draft.source ? eligibleDeviceIds : eligibleSourceDeviceIds).has(annotation.id))
      .map((annotation) => ({
        ...annotation,
        hitRect: getAnnotationVisualBodyRect(annotation),
      }))
    const deviceHit = findFirstRouteDeviceHit(pointer, eligibleDevices, {
        pageWidth: Math.max(1, overlayRect.width),
        pageHeight: Math.max(1, overlayRect.height),
        tolerancePx: event.pointerType === 'touch' ? 7 : 4,
        ...(liveSession.draft.source ? { excludedAnnotationIds: excludedDeviceIds } : {}),
      })
    const activeRouteBranch = liveSession.draft.activeBranchId
      ? liveSession.draft.branches.find((branch) => branch.id === liveSession.draft.activeBranchId)
      : undefined
    const branchOriginIndex = activeRouteBranch?.originSelectionId === 'source'
      ? 0
      : liveSession.draft.transitions.findIndex((entry) => entry.id === activeRouteBranch?.originSelectionId) + 1
    const primaryNodeCandidates = getPackageAnimationPrimaryRouteCandidates(liveSession.draft)
      .filter((candidate) => candidate.pageNumber === currentPage
        && (activeRouteBranch?.transitions.length ? true : candidate.index > branchOriginIndex))
    const primaryNodeHit = !deviceHit && activeRouteBranch?.editing
      ? findNearestRouteNode(pointer, primaryNodeCandidates, {
        pageWidth: Math.max(1, overlayRect.width),
        pageHeight: Math.max(1, overlayRect.height),
        tolerancePx: event.pointerType === 'touch' ? 30 : 18,
      })
      : null
    const intent = primaryNodeHit ? null : resolveRoutePickIntent({
      sourceSelected: !!liveSession.draft.source,
      overlappingAnnotationIds,
      eligibleDeviceIds: liveSession.draft.source ? eligibleDeviceIds : eligibleSourceDeviceIds,
      ...(!liveSession.draft.source ? { diagnosticSourceIds } : {}),
      ...(deviceHit ? { eligibleDeviceHitId: deviceHit.annotationId } : {}),
      ...(currentEndpointAnnotationId ? { currentEndpointAnnotationId } : {}),
      segmentHit: hit,
      fallbackAnnotationId: targetAnnotationId,
    })
    if (!primaryNodeHit && !intent) return false
    const requiresPrimaryDirectConfirmation = intent?.kind === 'annotation'
      && !!liveSession.draft.source
      && !activeRouteBranch?.editing
      && !!animationRouteAnnotations.find((entry) => entry.id === intent.annotationId && isRouteBuilderDeviceKind(entry.shapeKind))
    const allowPrimaryDirectTransition = !requiresPrimaryDirectConfirmation
      || typeof window === 'undefined'
      || window.confirm('This device is not being reached by a visible circuit segment. Add an explicit direct transition with a warning?')
    const action = primaryNodeHit
      ? { kind: 'rejoin-node' as const, nodeId: primaryNodeHit.nodeId, clickedPoint: pointer }
      : intent?.kind === 'segment'
        ? { kind: 'segment' as const, pick: intent.hit }
        : { kind: 'annotation' as const, annotationId: intent!.annotationId, clickedPoint: pointer, allowPrimaryDirectTransition }
    const sessionId = liveSession.sessionId
    setAnimationRouteBuilder((previous) => {
      if (!previous || previous.sessionId !== sessionId) return previous
      const result = dispatchPackageAnimationRoutePick(previous.draft, action)
      if (result.rejoinDiagnostics) console.info('[Animation route branch rejoin]', result.rejoinDiagnostics)
      const next = { ...previous, draft: result.draft, conflict: undefined }
      animationRouteBuilderRef.current = next
      return next
    })
    return true
  }, [animationRouteAnnotations, currentPage, isAnnotationVisibleOnCanvas])

  useEffect(() => {
    if (!animationRouteBuilder) return
    if (currentPage !== animationRouteBuilder.pageNumber || !scopeLayers.some((layer) => layer.id === animationRouteBuilder.layerId)) {
      setAnimationRouteBuilder(null)
    }
  }, [animationRouteBuilder, currentPage, scopeLayers])

  // The canonical local package can legitimately advance while the builder is open (verified
  // save, local refresh, sync reconciliation). A clean builder rebases silently; a dirty one
  // keeps the owner's draft and raises the local banner; a save in flight owns its own handshake.
  useEffect(() => {
    if (!animationRouteBuilder) return
    const canonical = scopeLayers.find((layer) => layer.id === animationRouteBuilder.layerId)
    const outcome = reconcilePackageAnimationRouteLocalRefresh(animationRouteBuilder, canonical, animationRouteAnnotations)
    if (outcome.status === 'unchanged') return
    setAnimationRouteBuilder((previous) => previous && previous.sessionId === animationRouteBuilder.sessionId ? outcome.state : previous)
  }, [animationRouteAnnotations, animationRouteBuilder, scopeLayers])

  // Playback is tied to one immutable scene revision and one visible PDF page. Any canonical
  // replacement, package removal, page navigation or blueprint close unmounts its clock/overlay.
  useEffect(() => {
    if (!animationPlayback) return
    const layer = scopeLayers.find((entry) => entry.id === animationPlayback.layerId)
    if (!layer
      || animationPlayback.blueprintId !== blueprint?.id
      || animationPlayback.pageNumber !== currentPage
      || resolvePackageAnimationRouteBaseRevision(layer) !== animationPlayback.sceneRevision) {
      setAnimationPlayback(null)
    }
  }, [animationPlayback, blueprint?.id, currentPage, scopeLayers])

  // ── Symbols Size popup open — positions the panel just below its toggle button ──
  // Pure UI positioning; never touches annotation data, geometry, or viewer layout.
  const PANEL_W = 224
  const PANEL_H_ESTIMATE = 340
  const openSymbolSizePanel = useCallback(() => {
    const btnRect = symbolSizeButtonRef.current?.getBoundingClientRect()
    if (btnRect) {
      const margin = 8
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
      const vh = typeof window !== 'undefined' ? window.innerHeight : 800
      const x = Math.max(4, Math.min(vw - PANEL_W - 4, btnRect.left))
      const y = Math.max(4, Math.min(vh - PANEL_H_ESTIMATE - 4, btnRect.bottom + margin))
      setSymbolSizePanelPos({ x, y })
    }
    setIsSymbolSizePanelOpen((v) => !v)
  }, [])

  // ── Symbols Size popup drag (label-scale panel) ──
  // Pure UI positioning of the floating panel; never touches annotation data or geometry.
  const handleSymbolSizeDragStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    symbolSizeDragRef.current = { dx: e.clientX - symbolSizePanelPos.x, dy: e.clientY - symbolSizePanelPos.y }
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
  }, [symbolSizePanelPos])
  const handleSymbolSizeDragMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = symbolSizeDragRef.current
    if (!drag) return
    const x = Math.max(4, Math.min((typeof window !== 'undefined' ? window.innerWidth : 1200) - 60, e.clientX - drag.dx))
    const y = Math.max(4, Math.min((typeof window !== 'undefined' ? window.innerHeight : 800) - 40, e.clientY - drag.dy))
    setSymbolSizePanelPos({ x, y })
  }, [])
  const handleSymbolSizeDragEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    symbolSizeDragRef.current = null
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
  }, [])

  useEffect(() => {
    if (!alignmentGuidesEnabled || !annotationsVisible) {
      clearAlignmentGuides()
    }
  }, [alignmentGuidesEnabled, annotationsVisible, clearAlignmentGuides])

  const toggleCurrentPageSelection = useCallback(() => {
    if (!onSelectedPagesChange) return
    const current = Math.max(1, Math.floor(currentPage))
    if (selectedPageNumbers.includes(current)) {
      onSelectedPagesChange(selectedPageNumbers.filter((p) => p !== current))
      return
    }
    onSelectedPagesChange([...selectedPageNumbers, current])
  }, [onSelectedPagesChange, selectedPageNumbers, currentPage])

  const buildAnnotationHistoryScope = useCallback((annotation?: BlueprintAnnotation | null): AnnotationHistoryScope | null => {
    const blueprintSetId = String(annotation?.blueprintSetId || blueprint?.id || '').trim()
    const projectId = String(annotation?.projectId || blueprint?.projectId || '').trim()
    const pageNumber = Math.max(1, Math.floor(Number(annotation?.pageNumber || currentPageRef.current) || 1))
    return blueprintSetId && projectId ? { blueprintSetId, projectId, pageNumber } : null
  }, [blueprint?.id, blueprint?.projectId])

  const recordSuccessfulAnnotationMutation = useCallback((
    before: BlueprintAnnotation | null,
    after: BlueprintAnnotation | null,
    options: { label?: string; transactionId?: string; coalesceKey?: string; selectionBefore?: string | null; selectionAfter?: string | null } = {},
  ) => {
    if (annotationHistorySnapshotsEqual(before, after)) return
    const subject = after || before
    const scope = buildAnnotationHistoryScope(subject)
    if (!subject || !scope) return
    const id = subject.id
    const transactionId = options.transactionId || `annotation_tx_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const defaultLabel = before == null
      ? `Create ${annotationLabel(subject)}`
      : after == null
        ? `Delete ${annotationLabel(subject)}`
        : `Edit ${annotationLabel(subject)}`
    const command = buildAnnotationMutationCommand({
      transactionId,
      label: options.label || defaultLabel,
      scope,
      before: { [id]: cloneAnnotationForHistory(before) },
      after: { [id]: cloneAnnotationForHistory(after) },
      selectionBefore: options.selectionBefore !== undefined ? options.selectionBefore : (before ? id : null),
      selectionAfter: options.selectionAfter !== undefined ? options.selectionAfter : (after ? id : null),
      timestamp: Date.now(),
      ...(options.coalesceKey ? { coalesceKey: options.coalesceKey } : {}),
    })
    if (!command) return
    annotationHistoryRef.current = pushCommand(annotationHistoryRef.current, command, { coalesce: !!options.coalesceKey })
    setAnnotationHistoryRevision((revision) => revision + 1)
  }, [buildAnnotationHistoryScope])

  const persistAnnotation = useCallback(async (
    annotation: BlueprintAnnotation,
    historyOptions: {
      recordHistory?: boolean
      label?: string
      transactionId?: string
      coalesceKey?: string
      selectionBefore?: string | null
      selectionAfter?: string | null
    } = {},
  ): Promise<boolean> => {
    const annotationToPersist = withEnsuredCircuitTopologyIds(annotation)
    if (annotationToPersist !== annotation) {
      // Keep the optimistic copy aligned with the queued save so overlapping explicit edits
      // cannot mint another topology before the persisted annotation is reloaded.
      allAnnotationsRef.current = allAnnotationsRef.current.map((item) => (
        item.id === annotationToPersist.id ? annotationToPersist : item
      ))
      setAllAnnotations((prev) => prev.map((item) => (
        item.id === annotationToPersist.id ? annotationToPersist : item
      )))
    }
    // Increment before queuing so the counter is accurate when mutations overlap.
    pendingAnnotationMutationsRef.current += 1
    // BLUEPRINT-6Q — mark the blueprint scope dirty for the duration of the save so the
    // live/realtime cloud refresh can't silently overwrite local storage and wipe the
    // just-created annotation while its push is still in flight.
    setHasPendingAnnotationSaves(true)
    // Register dirty scope synchronously — React state→effect for useRemoteDataRefresh
    // lags one frame, which left a window where realtime could apply a stale remote row
    // before local-first persist + hasPendingLocalSave were visible to the guard.
    setDirtyScope('blueprints', true, 'Blueprint annotation save')
    // BLUEPRINT-6R — synchronous start stamp for the remote-apply reload guard (runs before
    // any state update propagates, so it protects the immediate realtime-refresh race).
    lastAnnotationSaveStartedAtRef.current = Date.now()
    const op = async (): Promise<boolean> => {
      const before = cloneAnnotationForHistory(persistedAnnotationSnapshotsRef.current.get(annotationToPersist.id))
      try {
        const backup = getBackupData()
        if (!backup) throw new Error('No local backup data available.')
        const saveResult = await upsertOperationsBlueprintAnnotation(backup, annotationToPersist)
        if (saveResult.cloudSynced) {
          clearStaleSyncMessages()
        } else if (saveResult.localSaved) {
          // Always surface local-only — never silently claim success when cloud push
          // failed, was blocked, or returned without a warning payload.
          showSyncPausedNoticeOnce()
        } else if (!saveResult.localSaved) {
          throw new Error(saveResult.error || 'Failed to save annotation.')
        }
        persistedAnnotationSnapshotsRef.current.set(annotationToPersist.id, cloneAnnotationForHistory(annotationToPersist)!)
        locallyDeletedIdsRef.current.delete(annotationToPersist.id)
        if (historyOptions.recordHistory !== false) {
          recordSuccessfulAnnotationMutation(before, annotationToPersist, historyOptions)
        }
        onAnnotationsChanged?.()
        return true
      } catch (e: any) {
        // BLUEPRINT-6R — record the failure so the drain below does NOT reload from the
        // unchanged backup and wipe the optimistic annotation the user just placed.
        annotationSaveErrorRef.current = true
        const msg = e?.message || 'Failed to save annotation.'
        if (isSyncBlockedMessage(msg)) {
          showSyncPausedNoticeOnce()
        } else {
          console.error('[Blueprint] Annotation save failed — keeping optimistic annotation:', msg)
          setError(msg)
        }
        // A failed local save never advances history and cannot leave an untracked optimistic edit.
        setAllAnnotations((prev) => applyAnnotationSnapshotsToList(
          prev,
          [annotationToPersist.id],
          { [annotationToPersist.id]: before },
        ))
        return false
      } finally {
        pendingAnnotationMutationsRef.current = Math.max(0, pendingAnnotationMutationsRef.current - 1)
        // Only refresh annotations from backup once the entire queue has drained.
        // Calling loadAnnotations() after every individual save was overwriting the
        // optimistic setAllAnnotations updates that the UI had already applied, causing
        // the opacity/color to snap back to the pre-click value mid-sequence.
        if (pendingAnnotationMutationsRef.current === 0) {
          // BLUEPRINT-6Q/6R — clear the React dirty flag after the queue drains. Do NOT
          // call setDirtyScope(false) here: open editors (note/text/draft) may still need
          // the guard, and useRemoteDataRefresh clears the scope when isDirty is false.
          setHasPendingAnnotationSaves(false)
          lastAnnotationSaveFinishedAtRef.current = Date.now()
          const hadError = annotationSaveErrorRef.current
          annotationSaveErrorRef.current = false
          // Reconcile from the backup only on success. On failure the backup never received the
          // new annotation, so reloading would silently delete the user's just-placed work.
          if (!hadError) {
            loadAnnotations()
          }
        }
      }
    }
    mutationQueueRef.current = mutationQueueRef.current.then(op)
    return mutationQueueRef.current
  }, [clearStaleSyncMessages, loadAnnotations, onAnnotationsChanged, recordSuccessfulAnnotationMutation, showSyncPausedNoticeOnce])

  // ─── Copy / Paste for placed annotations & shapes (Fix 1) ─────────────────────
  // Builds a paste-ready template that preserves the full design (type, rect,
  // color, path and ALL meta — shapeKind, border/fill/hatch, line/arrow/arch
  // endpoints, text content, can-light lightIntensity) while dropping anything
  // that would corrupt a fresh row (id, createdAt, updatedAt, pageNumber).
  const cloneAnnotationForPaste = useCallback(cloneBlueprintAnnotationForPaste, [])

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
      nextMeta.points = translateNormalizedPoints(nextMeta.points, dx, dy)
    }
    if (nextMeta.shapeKind === 'circuit-arc' && Array.isArray(nextMeta.arcCtrls)) {
      // Arc controls use the same absolute page-normalized coordinate system as points.
      // Moving both arrays preserves the copied curve instead of bending it toward the source.
      nextMeta.arcCtrls = translateNormalizedPoints(nextMeta.arcCtrls, dx, dy)
    }
    if (isCircuitShapeKind(nextMeta.shapeKind) && Array.isArray(nextMeta.points)) {
      // The copy is a distinct circuit topology even though its design and geometry are cloned.
      const topology = regenerateCircuitTopologyIds(nextMeta.points)
      nextMeta.pointIds = topology.pointIds
      nextMeta.segmentIds = topology.segmentIds
    }
    if (nextMeta.lineAbsX1 !== undefined && nextMeta.lineAbsY1 !== undefined && nextMeta.lineAbsX2 !== undefined && nextMeta.lineAbsY2 !== undefined) {
      // Step 12C — edited line-like shapes may store endpoints as absolute
      // page-normalized coords. Paste should move those endpoints with the copy.
      nextMeta.lineAbsX1 = clampNorm(Number(nextMeta.lineAbsX1) + dx)
      nextMeta.lineAbsY1 = clampNorm(Number(nextMeta.lineAbsY1) + dy)
      nextMeta.lineAbsX2 = clampNorm(Number(nextMeta.lineAbsX2) + dx)
      nextMeta.lineAbsY2 = clampNorm(Number(nextMeta.lineAbsY2) + dy)
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
      // Phase 5G: keep the id stable. The placement id (Phase 5G) is already the final
      // `ann_` id, so committing a draft must NOT mint a new id — reuse current.id so the
      // persisted row matches the id held by selection/DOM/focus. isDraft is still used
      // below for the empty-draft discard and the in-place state swap.
      const persistedId = current.id
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

  // Finalize Polyline / Circuit Path draft — Stop Drawing / Stop Circuit Path.
  // Commits the accumulated points as a single shape annotation (meta.points), or
  // silently discards the draft if fewer than 2 points were placed.
  const finalizePathDraft = useCallback(() => {
    const points = [...pathDraftRef.current]
    pathDraftRef.current = []
    setPathDraftPoints([])
    setPathCursorPx(null)
    if (points.length < 2 || !blueprint) {
      setToolMode('select')
      return
    }
    const now = new Date().toISOString()
    const isArc = shapeKind === 'circuit-arc'
    const isCircuit = isCircuitShapeKind(shapeKind)
    const topology = isCircuit ? regenerateCircuitTopologyIds(points) : null

    // Circuit Arc: seed one Bezier control point per segment so the path renders as
    // curves immediately; each is independently draggable afterwards.
    const arcCtrls = isArc ? seedCircuitArcControls(points, displaySize.w, displaySize.h) : null
    // Control points must be inside the bounding rect. Beyond keeping the curve from
    // being visually clipped, this is what stops a straight horizontal run from producing
    // a near-zero-height rect — the renderer divides by rect.h to reach local viewBox
    // space, and an off-axis control point in a flat box explodes to absurd coordinates.
    const bounds = clampRectToPage(getPointsBounds(arcCtrls ? [...points, ...arcCtrls] : points))

    // Circuit Path total distance (Step 13B-QA5-R Part 3) -- same manual-over-auto
    // calibration precedence used by the measure tools. Calibration is never
    // required to create the path; it only unlocks a real-world length label.
    let totalDistance: number | null = null
    let distanceUnit: string | null = null
    let distanceLabel: string | null = null
    if (isCircuit) {
      const pageSize = getPageSizeInches(currentPage)
      const calForPage = getEffectiveCalibrationForPage(currentPage)
      if (calForPage) {
        // For an arc path the straight chord sum would understate the run. Flatten the
        // curves into a dense polyline first so the label reports true arc length.
        const lengthPoints = arcCtrls ? sampleCircuitArcPolyline(points, arcCtrls) : points
        totalDistance = convertMeasuredPolylineLength(lengthPoints, calForPage, pageSize)
        distanceUnit = calForPage.realWorldUnit
        distanceLabel = `Total: ${totalDistance.toFixed(2)} ${distanceUnit}`
      } else {
        distanceLabel = 'Circuit path saved — calibrate measure to show distance.'
        showTransientSyncNotice(distanceLabel)
      }
    }

    let meta: Record<string, any> = {
      shapeKind,
      points,
      ...(topology ? { pointIds: topology.pointIds, segmentIds: topology.segmentIds } : {}),
      ...(arcCtrls ? { arcCtrls } : {}),
      pathType: isArc ? 'circuit-arc' : isCircuit ? 'circuit' : 'polyline',
      closed: false,
      borderColor: shapeOptions.borderColor,
      borderThickness: shapeOptions.borderThickness,
      borderStyle: shapeOptions.borderStyle,
      fillOpacity: shapeOptions.fillOpacity,
      ...(isCircuit ? { totalDistance, distanceUnit, distanceLabel } : {}),
    }

    // EST-1C: copy validated Quick Access Wire Profile binding once at commit.
    // Appearance remains from shapeOptions; segmentWireProfileIds stays absent.
    if (isCircuit && activeQuickAccessSession) {
      const identity = validateQuickAccessActivationIdentity({
        activationProjectId: activeQuickAccessSession.projectId,
        activationBlueprintSetId: activeQuickAccessSession.blueprintSetId,
        currentProjectId: blueprint.projectId,
        currentBlueprintSetId: blueprint.id,
      })
      const toolMatches = supportsWireProfileAssignment({
        toolType: 'shape',
        toolVariant: shapeKind,
      }) && (
        !activeQuickAccessSession.toolVariant
        || activeQuickAccessSession.toolVariant === shapeKind
      )
      if (!identity.ok || !toolMatches) {
        showTransientSyncNotice(
          identity.ok
            ? 'Quick Access Wire Profile binding no longer matches this drawing tool.'
            : 'Quick Access Wire Profile binding expired after a project or blueprint change.',
        )
        clearActiveQuickAccessSession()
        setToolMode('select')
        return
      }
      const decision = decideQuickAccessWireProfileActivation(
        activeQuickAccessSession.wireProfileId,
        getOperationsBlueprintWireProfiles(getBackupData(), blueprint.projectId),
      )
      if (!decision.ok) {
        showTransientSyncNotice(decision.message)
        clearActiveQuickAccessSession()
        setToolMode('select')
        return
      }
      meta = applyQuickAccessWireProfileToAnnotationMeta(meta, decision.wireProfileId)
    }

    const ann: BlueprintAnnotation = {
      id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      blueprintSetId: blueprint.id,
      projectId: blueprint.projectId,
      pageNumber: currentPage,
      type: 'shape',
      rect: bounds,
      color: shapeOptions.borderColor,
      meta,
      metadata: meta,
      createdAt: now,
      updatedAt: now,
    } as BlueprintAnnotation
    setAllAnnotations((prev) => [...prev, ann])
    setFocusedAnnotationId(ann.id)
    setToolMode('select')
    clearActiveQuickAccessSession()
    void persistAnnotation(ann)
  }, [blueprint, currentPage, shapeKind, shapeOptions, persistAnnotation, showTransientSyncNotice, getPageSizeInches, getEffectiveCalibrationForPage, displaySize.w, displaySize.h, activeQuickAccessSession, clearActiveQuickAccessSession])

  // ── Spacebar finishes a multi-point shape draft (CIRCUITSPACE) ──────────────
  // Additive third finish gesture for Polyline / Circuit Path / Circuit Arc, mirroring the
  // Multi-Point Measure tool's Space handler. The Stop/Cancel pill and Escape are unchanged.
  //
  // This lives in its own effect AFTER finalizePathDraft rather than joining the measurement
  // keyboard effect above: finalizePathDraft is a const declared later in the component, and
  // referencing it from that effect's dependency array would be evaluated during render and
  // hit the temporal dead zone (the same hazard already flagged on the measure-commit effect).
  useEffect(() => {
    if (effectiveTool !== 'shape' || !isMultiPointShapeKind(shapeKind)) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.code !== 'Space') return
      const el = document.activeElement as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      if (typing) return
      // Mirrors the Stop pill's disabled={pathDraftPoints.length < 2}: under 2 points the
      // gesture is inert rather than silently discarding the draft, so Space and Stop agree.
      if (pathDraftRef.current.length < 2) return
      // Suppresses page scroll AND native Space-activation of whatever button still holds
      // focus (the toolbar button or the Stop pill), which would otherwise double-fire.
      e.preventDefault()
      finalizePathDraft()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [effectiveTool, shapeKind, finalizePathDraft])

  // Recomputes a Circuit Arc's true arc length after its curvature changed, so the label
  // tracks the curve rather than the chords it was first created from. Returns the
  // annotation unchanged when it is not a circuit-arc or the page has no calibration.
  const withRecomputedCircuitArcDistance = useCallback((ann: BlueprintAnnotation): BlueprintAnnotation => {
    const m = getAnnotationMeta(ann)
    if (m.shapeKind !== 'circuit-arc') return ann
    const points: Array<{ x: number; y: number }> = Array.isArray(m.points) ? m.points : []
    if (points.length < 2) return ann
    const page = ann.pageNumber
    const calForPage = getEffectiveCalibrationForPage(page)
    if (!calForPage) return ann
    const totalDistance = convertMeasuredPolylineLength(
      sampleCircuitArcPolyline(points, m.arcCtrls),
      calForPage,
      getPageSizeInches(page),
    )
    return withAnnotationMeta(ann, {
      ...m,
      totalDistance,
      distanceUnit: calForPage.realWorldUnit,
      distanceLabel: `Total: ${totalDistance.toFixed(2)} ${calForPage.realWorldUnit}`,
    }) as BlueprintAnnotation
  }, [getEffectiveCalibrationForPage, getPageSizeInches])

  useEffect(() => {
    if (!measurePendingCommit) return
    const { type, points, pageNumber } = measurePendingCommit
    setMeasurePendingCommit(null)
    if (!blueprint) return
    // Shared effective calibration: valid manual, then usable auto, else uncalibrated.
    const calForPage = getEffectiveCalibrationForPage(pageNumber)
    const pageSize = getPageSizeInches(pageNumber)
    const hasCalibration = !!calForPage
    // Multi-point measure (measure-perimeter) still finalizes and keeps its path
    // visible without calibration -- it just can't show a real-world distance yet.
    // Single-point distance/area measures keep the prior behavior: discard silently
    // and prompt to calibrate first.
    const isMultiPointMeasure = type === 'measure-perimeter'
    if (!hasCalibration && !isMultiPointMeasure) {
      showTransientSyncNotice('Calibrate measure first.')
      return
    }
    const now = new Date().toISOString()
    const id = `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const color = toolColors[type as ToolKey] || '#38bdf8'
    let label = ''
    let meta: Record<string, any> = {}
    if (type === 'measure-distance' && points.length >= 2) {
      const normDist = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
      const realDist = convertMeasuredDistance(points[0], points[1], calForPage!, pageSize)
      label = formatArchitecturalLength(realDist, calForPage!.realWorldUnit)
      meta = { points, label, normDistance: normDist, realWorldDistance: realDist, unit: calForPage!.realWorldUnit, style: measurementStyle }
    } else if (type === 'measure-area' && points.length >= 3) {
      let normArea = 0
      for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length
        normArea += points[i].x * points[j].y - points[j].x * points[i].y
      }
      normArea = Math.abs(normArea) / 2
      const realArea = convertMeasuredPolygonArea(points, calForPage!, pageSize)
      label = `${realArea.toFixed(2)} ${calForPage!.realWorldUnit}\u00b2`
      meta = { points, label, normArea, realWorldArea: realArea, unit: calForPage!.realWorldUnit, style: measurementStyle }
    } else if (type === 'measure-perimeter' && points.length >= 2) {
      let normPerim = 0
      for (let i = 1; i < points.length; i++) {
        normPerim += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
      }
      if (hasCalibration) {
        const realPerim = convertMeasuredPolylineLength(points, calForPage!, pageSize)
        label = `Total: ${formatArchitecturalLength(realPerim, calForPage!.realWorldUnit)}`
        meta = {
          points, label, normPerimeter: normPerim, realWorldPerimeter: realPerim,
          totalDistance: realPerim, unit: calForPage!.realWorldUnit, style: measurementStyle,
          measureType: 'multi-point', calibrated: true, closed: false,
        }
      } else {
        label = 'Calibrate measure first.'
        meta = {
          points, label, normPerimeter: normPerim, unit: null, style: measurementStyle,
          measureType: 'multi-point', calibrated: false, closed: false,
        }
        showTransientSyncNotice('Calibrate measure first.')
      }
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
    // Optimistically render the finalized measurement immediately -- persistAnnotation
    // is async (local save + cloud sync round trip), and without this the just-placed
    // path would flash empty until loadAnnotations() re-syncs from the backup.
    setAllAnnotations((prev) => [...prev, ann])
    void persistAnnotation(ann)
    setFocusedAnnotationId(ann.id)
    setToolMode('select')
  }, [measurePendingCommit, blueprint, persistAnnotation, getEffectiveCalibrationForPage, toolColors, measurementStyle, showTransientSyncNotice, getPageSizeInches])

  // Ã¢â€â‚¬Ã¢â€â‚¬ Persist manual calibrations to localStorage Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  useEffect(() => {
    if (!blueprint?.id) return
    try { localStorage.setItem(`blueprint_calibrations_${blueprint.id}`, JSON.stringify(savedCalibrations)) } catch {}
  }, [savedCalibrations, blueprint?.id])

  // Ã¢â€â‚¬Ã¢â€â‚¬ Persist detected scales to localStorage Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  useEffect(() => {
    if (!blueprint?.id) return
    try { localStorage.setItem(getDetectedScalesStorageKey(blueprint.id), JSON.stringify(detectedScales)) } catch {}
  }, [detectedScales, blueprint?.id])

  const handleRescanScales = useCallback(() => {
    if (!blueprint?.id) return
    try { localStorage.removeItem(getDetectedScalesStorageKey(blueprint.id)) } catch {}
    scannedPagesRef.current = new Set()
    setDetectedScales({})
    pageSizeInchesCacheRef.current = {}
    setPageSizeInchesCache({})
    setScaleScanDiagnostics(EMPTY_SCALE_SCAN_DIAGNOSTICS)
    setScaleScanStatus('idle')
    setScaleScanProgress({ done: 0, total: 0 })
    setScaleRescanNonce((n) => n + 1)
  }, [blueprint?.id])

  // Ã¢â€â‚¬Ã¢â€â‚¬ Rehydrate calibration and detection state when blueprint changes Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  useEffect(() => {
    if (!blueprint?.id) return
    scannedPagesRef.current = new Set()
    setScaleScanStatus('idle')
    setScaleScanProgress({ done: 0, total: 0 })
    setScaleScanDiagnostics(EMPTY_SCALE_SCAN_DIAGNOSTICS)
    pageSizeInchesCacheRef.current = {}
    setPageSizeInchesCache({})
    try {
      const cal = localStorage.getItem(`blueprint_calibrations_${blueprint.id}`)
      setSavedCalibrations(cal ? JSON.parse(cal) : {})
      const det = localStorage.getItem(getDetectedScalesStorageKey(blueprint.id))
      setDetectedScales(det ? JSON.parse(det) : {})
    } catch {
      setSavedCalibrations({})
      setDetectedScales({})
    }
  }, [blueprint?.id])

  // Ã¢â€â‚¬Ã¢â€â‚¬ Auto-detect blueprint scale from PDF text content Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  // Scans every page after the PDF loads. Does not overwrite manual calibration.
  useEffect(() => {
    if (!pdfDoc || !numPages) return
    const doc = getLoadedPdfDoc()
    if (!doc) return

    const runId = ++scaleScanRunRef.current
    const totalPages = Math.max(1, numPages)
    let cancelled = false

    setScaleScanStatus('scanning')
    setScaleScanProgress({ done: 0, total: totalPages })
    setScaleScanDiagnostics({ ...EMPTY_SCALE_SCAN_DIAGNOSTICS, totalPages })

    void (async () => {
      const scaleUpdates: Record<number, DetectedScaleResult> = {}
      const textUpdates: Record<number, TextItemNorm[]> = {}
      const pageDiagnostics: Record<number, ScaleScanPageDiagnostic> = {}
      const pageSizeUpdates: Record<number, PageSizeInches> = {}

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        if (cancelled || runId !== scaleScanRunRef.current) return
        try {
          const safePageNumber = getSafePdfPageNumber(pageNum)
          const page = await doc.getPage(safePageNumber)
          const pageW: number = page.view?.[2] ?? 612
          const pageH: number = page.view?.[3] ?? 792
          const scanViewport = page.getViewport({ scale: 1 })
          pageSizeUpdates[safePageNumber] = getPageSizeInchesFromPts(scanViewport.width, scanViewport.height)
          const textContent = await page.getTextContent()
          const rawItems: any[] = textContent.items || []
          const strItems: string[] = rawItems.map((it: any) => it.str || '')
          const normalizedText = normalizeBlueprintPdfText(strItems)
          const textItemCount = rawItems.length
          const hasText = textItemCount > 0 && normalizedText.length > 0
          const hasScaleWord = /scale/i.test(normalizedText)
          const hasQuarterToken = normalizedText.includes('1/4') || normalizedText.includes('\u00BC')
          const hasNts = isNotToScaleMarker(normalizedText)
          const result = detectBlueprintScaleText(strItems, pageW, safePageNumber)
          const matched = !!result && !result.ambiguous && result.candidates.length === 1
          const ambiguous = !!result?.ambiguous
          const reason = classifyScaleScanPageReason(hasText, hasNts, result, hasScaleWord, hasQuarterToken)

          pageDiagnostics[safePageNumber] = {
            pageNumber: safePageNumber,
            textItemCount,
            hasText,
            hasScaleWord,
            hasQuarterToken,
            hasNts,
            matched,
            ambiguous,
            reason,
            normalizedSample: normalizedText.slice(0, SCALE_SCAN_TEXT_SAMPLE_MAX),
          }

          if (result) {
            scaleUpdates[safePageNumber] = result
            scannedPagesRef.current.add(safePageNumber)
          }
          textUpdates[safePageNumber] = buildNormTextItems(rawItems, pageW, pageH)
        } catch {
          // Leave page unscanned so Rescan can retry it.
        }

        if (cancelled || runId !== scaleScanRunRef.current) return
        setScaleScanProgress({ done: pageNum, total: totalPages })
        if (pageNum % 3 === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
      }

      if (cancelled || runId !== scaleScanRunRef.current) return
      setDetectedScales(scaleUpdates)
      setScaleScanDiagnostics(buildScaleScanDiagnosticsSummary(pageDiagnostics, totalPages))
      if (Object.keys(pageSizeUpdates).length > 0) {
        pageSizeInchesCacheRef.current = { ...pageSizeInchesCacheRef.current, ...pageSizeUpdates }
        setPageSizeInchesCache((prev) => ({ ...prev, ...pageSizeUpdates }))
      }
      if (Object.keys(textUpdates).length > 0) {
        textItemsCacheRef.current = { ...textItemsCacheRef.current, ...textUpdates }
        setTextItemsCache((prev) => ({ ...prev, ...textUpdates }))
      }
      setScaleScanStatus('complete')
    })()

    return () => { cancelled = true }
  }, [pdfDoc, numPages, getLoadedPdfDoc, getSafePdfPageNumber, scaleRescanNonce])

  const removeAnnotation = useCallback(async (
    annotationId: string,
    historyOptions: { recordHistory?: boolean; label?: string; transactionId?: string; selectionBefore?: string | null; selectionAfter?: string | null } = {},
  ): Promise<boolean> => {
    if (!blueprint?.id) return false
    const before = cloneAnnotationForHistory(
      persistedAnnotationSnapshotsRef.current.get(annotationId)
      || allAnnotationsRef.current.find((annotation) => annotation.id === annotationId),
    )
    if (!before) return false
    // Guard loadAnnotations from re-surfacing this ID before storage commits the delete.
    locallyDeletedIdsRef.current.add(annotationId)
    setAllAnnotations((prev) => prev.filter((a) => a.id !== annotationId))
    setFocusedAnnotationId((prev) => (prev === annotationId ? null : prev))
    const bpId = blueprint.id
    const op = async (): Promise<boolean> => {
      try {
        const backup = getBackupData()
        if (!backup) throw new Error('No local backup data available.')
        const saveResult = await deleteOperationsBlueprintAnnotation(backup, bpId, annotationId)
        if (saveResult.cloudSynced) {
          clearStaleSyncMessages()
        } else if (saveResult.localSaved && saveResult.warning) {
          showSyncPausedNoticeOnce()
        } else if (!saveResult.localSaved) {
          throw new Error(saveResult.error || 'Failed to delete annotation.')
        }
        persistedAnnotationSnapshotsRef.current.delete(annotationId)
        if (historyOptions.recordHistory !== false) {
          recordSuccessfulAnnotationMutation(before, null, {
            ...historyOptions,
            selectionBefore: historyOptions.selectionBefore !== undefined ? historyOptions.selectionBefore : annotationId,
            selectionAfter: historyOptions.selectionAfter !== undefined ? historyOptions.selectionAfter : null,
          })
        }
        // Keep ID in locallyDeletedIdsRef so any concurrent loadAnnotations
        // triggered by onAnnotationsChanged cannot re-surface a deleted item.
        onAnnotationsChanged?.()
        return true
      } catch (e: any) {
        locallyDeletedIdsRef.current.delete(annotationId)
        const msg = e?.message || 'Failed to delete annotation.'
        if (isSyncBlockedMessage(msg)) {
          showSyncPausedNoticeOnce()
        } else {
          setError(msg)
        }
        loadAnnotations()
        return false
      }
    }
    mutationQueueRef.current = mutationQueueRef.current.then(op)
    return mutationQueueRef.current
  }, [blueprint?.id, clearStaleSyncMessages, loadAnnotations, onAnnotationsChanged, recordSuccessfulAnnotationMutation, showSyncPausedNoticeOnce])

  const removeAnnotationsAsSingleHistoryCommand = useCallback(async (
    annotationIds: string[],
    label: string,
  ): Promise<boolean> => {
    const uniqueIds = Array.from(new Set(annotationIds.map((id) => String(id).trim()).filter(Boolean)))
    const before: Record<string, AnnotationSnapshot> = {}
    for (const id of uniqueIds) {
      before[id] = cloneAnnotationForHistory(
        persistedAnnotationSnapshotsRef.current.get(id)
        || allAnnotationsRef.current.find((annotation) => annotation.id === id),
      )
    }
    const affectedIds = uniqueIds.filter((id) => before[id] != null)
    if (affectedIds.length === 0) return false

    const scope = buildAnnotationHistoryScope(before[affectedIds[0]])
    if (!scope) return false
    const sameScopeIds = affectedIds.filter((id) => {
      const candidateScope = buildAnnotationHistoryScope(before[id])
      return candidateScope
        && candidateScope.blueprintSetId === scope.blueprintSetId
        && candidateScope.projectId === scope.projectId
        && candidateScope.pageNumber === scope.pageNumber
    })
    if (sameScopeIds.length !== affectedIds.length) {
      setError('Grouped annotation deletion cannot span blueprint pages.')
      return false
    }

    const removedIds: string[] = []
    setIsAnnotationHistoryBusy(true)
    try {
      for (const id of affectedIds) {
        const removed = await removeAnnotation(id, { recordHistory: false })
        if (!removed) {
          // The storage API is single-row, so compensate earlier successful deletes before
          // returning. History stays untouched unless the entire eraser gesture succeeds.
          for (const removedId of [...removedIds].reverse()) {
            const snapshot = before[removedId]
            if (!snapshot) continue
            const restored = buildAnnotationRestorePayload(snapshot, new Date().toISOString())
            locallyDeletedIdsRef.current.delete(removedId)
            setAllAnnotations((prev) => applyAnnotationSnapshotsToList(prev, [removedId], { [removedId]: restored }))
            await persistAnnotation(restored, { recordHistory: false })
          }
          return false
        }
        removedIds.push(id)
      }

      const after = Object.fromEntries(affectedIds.map((id) => [id, null])) as Record<string, AnnotationSnapshot>
      const command = buildAnnotationMutationCommand({
        transactionId: `annotation_batch_delete_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        label,
        scope,
        before,
        after,
        selectionBefore: affectedIds[0] ?? null,
        selectionAfter: null,
      })
      if (command) {
        annotationHistoryRef.current = pushCommand(annotationHistoryRef.current, command)
        setAnnotationHistoryRevision((revision) => revision + 1)
      }
      return true
    } finally {
      setIsAnnotationHistoryBusy(false)
    }
  }, [buildAnnotationHistoryScope, persistAnnotation, removeAnnotation])

  const currentAnnotationHistoryScope = useMemo<AnnotationHistoryScope | null>(() => {
    if (!blueprint?.id || !blueprint?.projectId) return null
    return {
      blueprintSetId: blueprint.id,
      projectId: blueprint.projectId,
      pageNumber: Math.max(1, Math.floor(Number(currentPage) || 1)),
    }
  }, [blueprint?.id, blueprint?.projectId, currentPage])

  const hasActiveAnnotationHistoryInteraction = useCallback(() => (
    !!layoutDragRef.current
    || !!endpointDragRef.current
    || !!measureEndpointDragRef.current
    || !!measureLineDragRef.current
    || !!measurePointDragRef.current
    || !!archControlDragRef.current
    || !!circuitArcControlDragRef.current
    || !!inlineTextEditId
    || isEditorOpen
    || !!dragStartRef.current
    || !!inkDraftRef.current
    || pathDraftRef.current.length > 0
    || measureDraftRef.current.length > 0
    || isAnnotationHistoryBusy
    || hasPendingAnnotationSaves
    || !!animationRouteBuilder
    || !!animationPlayback
  ), [animationPlayback, animationRouteBuilder, hasPendingAnnotationSaves, inlineTextEditId, isAnnotationHistoryBusy, isEditorOpen])

  const applyAnnotationHistory = useCallback(async (direction: 'undo' | 'redo') => {
    const scope = currentAnnotationHistoryScope
    if (!scope || hasActiveAnnotationHistoryInteraction()) return
    const command = direction === 'undo'
      ? peekUndo(annotationHistoryRef.current, scope)
      : peekRedo(annotationHistoryRef.current, scope)
    if (!command) return

    const target = direction === 'undo' ? command.before : command.after
    if (!isHistoryCommandSourceCurrent(command, direction, allAnnotationsRef.current)) {
      annotationHistoryRef.current = clearHistoryScope(annotationHistoryRef.current, scope)
      setAnnotationHistoryRevision((revision) => revision + 1)
      showTransientSyncNotice('Annotation history reset because this page changed outside the current history.')
      return
    }

    setIsAnnotationHistoryBusy(true)
    try {
      const source = direction === 'undo' ? command.after : command.before
      const appliedIds: string[] = []
      for (const id of command.affectedAnnotationIds) {
        const targetSnapshot = cloneAnnotationForHistory(target[id])
        let saved = false
        if (!targetSnapshot) {
          saved = await removeAnnotation(id, { recordHistory: false })
        } else {
          const replayAnnotation = buildAnnotationRestorePayload(targetSnapshot, new Date().toISOString())
          locallyDeletedIdsRef.current.delete(id)
          setAllAnnotations((prev) => {
            const existingIndex = prev.findIndex((annotation) => annotation.id === id)
            if (existingIndex < 0) return [...prev, replayAnnotation]
            return prev.map((annotation) => annotation.id === id ? replayAnnotation : annotation)
          })
          saved = await persistAnnotation(replayAnnotation, { recordHistory: false })
        }
        if (!saved) {
          // A multi-annotation command is one user gesture even though storage writes are
          // single-row. Compensate prior replay writes so a failed undo/redo remains atomic
          // and the history cursor can safely stay where it was.
          for (const appliedId of [...appliedIds].reverse()) {
            const sourceSnapshot = cloneAnnotationForHistory(source[appliedId])
            if (!sourceSnapshot) {
              await removeAnnotation(appliedId, { recordHistory: false })
              continue
            }
            const replaySource = buildAnnotationRestorePayload(sourceSnapshot, new Date().toISOString())
            locallyDeletedIdsRef.current.delete(appliedId)
            setAllAnnotations((prev) => applyAnnotationSnapshotsToList(
              prev,
              [appliedId],
              { [appliedId]: replaySource },
            ))
            await persistAnnotation(replaySource, { recordHistory: false })
          }
          return
        }
        appliedIds.push(id)
      }

      annotationHistoryRef.current = direction === 'undo'
        ? commitUndo(annotationHistoryRef.current, scope, command.transactionId)
        : commitRedo(annotationHistoryRef.current, scope, command.transactionId)
      const requestedSelection = direction === 'undo' ? command.selectionBefore : command.selectionAfter
      const selectedSnapshot = requestedSelection ? target[requestedSelection] : null
      setFocusedAnnotationId(selectedSnapshot ? requestedSelection : null)
      setLayoutEditId(null)
      setOpenPopover(null)
      setAnnotationHistoryRevision((revision) => revision + 1)
    } finally {
      setIsAnnotationHistoryBusy(false)
    }
  }, [currentAnnotationHistoryScope, hasActiveAnnotationHistoryInteraction, persistAnnotation, removeAnnotation, showTransientSyncNotice])

  useEffect(() => {
    const onHistoryKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const activeElement = document.activeElement as HTMLElement | null
      const typing = !!activeElement && (
        activeElement.tagName === 'INPUT'
        || activeElement.tagName === 'TEXTAREA'
        || activeElement.tagName === 'SELECT'
        || activeElement.isContentEditable
      )
      if (typing || hasActiveAnnotationHistoryInteraction()) return
      const key = event.key.toLowerCase()
      const direction = key === 'y' || (key === 'z' && event.shiftKey)
        ? 'redo'
        : key === 'z' && !event.shiftKey
          ? 'undo'
          : null
      if (!direction || !currentAnnotationHistoryScope) return
      const command = direction === 'undo'
        ? peekUndo(annotationHistoryRef.current, currentAnnotationHistoryScope)
        : peekRedo(annotationHistoryRef.current, currentAnnotationHistoryScope)
      if (!command) return
      event.preventDefault()
      void applyAnnotationHistory(direction)
    }
    window.addEventListener('keydown', onHistoryKeyDown)
    return () => window.removeEventListener('keydown', onHistoryKeyDown)
  }, [applyAnnotationHistory, currentAnnotationHistoryScope, hasActiveAnnotationHistoryInteraction])

  // Cycles a rotatable electrical symbol's rotationDeg 0deg -> 90deg -> 180deg -> 270deg -> 0deg.
  // Stored additively on meta so copy/paste, persistence, and Work Package isolate view all
  // pick it up for free via the existing meta plumbing.
  const rotateAnnotationSymbol = useCallback((annotation: BlueprintAnnotation) => {
    const meta = getAnnotationMeta(annotation)
    const current = getAnnotationRotationDeg(meta)
    const next = (current + ROTATION_STEP_DEG) % 360
    const updated = withAnnotationMeta(
      { ...annotation, updatedAt: new Date().toISOString() },
      { rotationDeg: next }
    ) as BlueprintAnnotation
    setAllAnnotations((prev) => prev.map((ann) => (ann.id === annotation.id ? updated : ann)))
    void persistAnnotation(updated)
  }, [persistAnnotation])

  const handleAnnotationSelectCapture = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
  const target = e.target as Element | null
  const annEl = target?.closest?.('[data-annotation-id]') as HTMLElement | null
  const annotationId = annEl?.getAttribute('data-annotation-id')

  // Route Builder has its own pick state and takes precedence over Package Pick and normal
  // annotation focus/editing. Bare-canvas route badges and junctions must reach the same exact
  // pointer hit-test even when there is no underlying annotation DOM element.
  if (animationRouteBuilder) {
    e.preventDefault()
    e.stopPropagation()
    handleAnimationRoutePick(e, annotationId || undefined)
    return
  }

  if (!annEl || !annotationId) return

  // Package Pick mode takes precedence over all normal interactions. A pointerdown on an
  // annotation toggles it in/out of the package-pick set and stops here — no focus, move,
  // edit, draw or delete is triggered, and annotation geometry is never touched. This fires
  // once per click (pointerdown capture); the inner selectAnnotation click handler is also
  // guarded so it does nothing while in this mode.
  if (isPackagePickMode) {
    e.preventDefault()
    e.stopPropagation()
    togglePackagePickId(annotationId)
    return
  }

  // If the user is already moving/resizing this annotation, let the edit handles work.
  if (layoutEditId === annotationId) return

  // Arc Line / Polyline / Circuit Path placement must be able to draw on top of existing
  // annotations — bypass hit-testing entirely so the pointer event bubbles through to the
  // canvas draw handlers instead of selecting/blocking on the item underneath. Circuit Path
  // additionally relies on this to click directly on symbols so its center-snap logic runs.
  if (effectiveTool === 'shape' && (shapeKind === 'arch-line' || isMultiPointShapeKind(shapeKind))) return

  // BLUEPRINT-6L — while a measure or calibrate tool is active the user is drawing a NEW
  // measurement; a tap on an existing measurement line must fall through to the draw handlers
  // (never select). Selection of saved measurements only happens in View/Select mode.
  if (effectiveTool === 'measure-distance' || effectiveTool === 'measure-area' || effectiveTool === 'measure-perimeter' || effectiveTool === 'calibrate') return

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
}, [animationRouteBuilder, effectiveTool, handleAnimationRoutePick, layoutEditId, removeAnnotation, shapeKind, isPackagePickMode, togglePackagePickId])

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
      // Phase 5G: assign the FINAL stable annotation id at placement (no `ann_draft_`
      // prefix). Draft status is tracked via draftTextBoxIdRef, not the id, so the id no
      // longer swaps at inline commit — placement → edit → commit → persist → select →
      // delete all use this same id, preventing the stale-id delete no-op.
      const draftId = `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
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

  // Single source of truth for "this placed annotation moved to a new bounding box". Both the
  // mouse-drag move handler and the keyboard nudge go through here, so the absolute-geometry
  // carry rules (line endpoints, arch control point, path points, arc control points) can
  // never drift apart between the two input methods. `safeBox` must already be clamped.
  const applyAnnotationMove = useCallback((
    annotationId: string,
    startBox: { x: number; y: number; w: number; h: number },
    geom: AnnotationMoveGeometry,
    safeBox: { x: number; y: number; w: number; h: number },
  ) => {
    const moveDx = safeBox.x - startBox.x
    const moveDy = safeBox.y - startBox.y
    if (geom.lineAbs) {
      const x1 = clampNorm(geom.lineAbs.x1 + moveDx)
      const y1 = clampNorm(geom.lineAbs.y1 + moveDy)
      const x2 = clampNorm(geom.lineAbs.x2 + moveDx)
      const y2 = clampNorm(geom.lineAbs.y2 + moveDy)
      const bw = Math.max(safeBox.w, 0.0001)
      const bh = Math.max(safeBox.h, 0.0001)
      setAllAnnotations((prev) => prev.map((ann) => {
        if (ann.id !== annotationId) return ann
        const m = getAnnotationMeta(ann)
        const nextMeta: Record<string, any> = {
          ...m,
          lineAbsX1: x1,
          lineAbsY1: y1,
          lineAbsX2: x2,
          lineAbsY2: y2,
          // Keep relative endpoint fields as a compatibility fallback.
          lineX1: (x1 - safeBox.x) / bw,
          lineY1: (y1 - safeBox.y) / bh,
          lineX2: (x2 - safeBox.x) / bw,
          lineY2: (y2 - safeBox.y) / bh,
        }
        if (geom.archCtrl) {
          nextMeta.archCtrlX = clampNorm(geom.archCtrl.x + moveDx)
          nextMeta.archCtrlY = clampNorm(geom.archCtrl.y + moveDy)
        }
        return withAnnotationMeta({ ...ann, rect: safeBox, updatedAt: new Date().toISOString() }, nextMeta) as BlueprintAnnotation
      }))
      return
    }
    if (geom.points) {
      const nextPoints = geom.points.map((p) => ({ x: clampNorm(p.x + moveDx), y: clampNorm(p.y + moveDy) }))
      const nextArcCtrls = geom.arcCtrls
        ? geom.arcCtrls.map((p) => ({ x: clampNorm(p.x + moveDx), y: clampNorm(p.y + moveDy) }))
        : null
      // Derive the rect from the moved geometry rather than from the translated box. The points
      // and control points above are clamped INDIVIDUALLY, so at a page edge they stop while the
      // box keeps travelling — leaving a rect that no longer encloses the curve it is the
      // page→local divisor for. Matches how creation and curvature-handle drags build the rect.
      const nextRect = clampRectToPage(getPointsBounds(nextArcCtrls ? [...nextPoints, ...nextArcCtrls] : nextPoints))
      setAllAnnotations((prev) => prev.map((ann) => {
        if (ann.id !== annotationId) return ann
        const m = getAnnotationMeta(ann)
        return withAnnotationMeta(
          { ...ann, rect: nextRect, updatedAt: new Date().toISOString() },
          { ...m, points: nextPoints, ...(nextArcCtrls ? { arcCtrls: nextArcCtrls } : {}) },
        ) as BlueprintAnnotation
      }))
      return
    }
    updateAnnotationLayout(annotationId, safeBox)
  }, [updateAnnotationLayout])

  const commitAnnotationLayout = useCallback(async (
    annotationId: string,
    historyOptions: { label?: string; transactionId?: string; coalesceKey?: string } = {},
  ) => {
    const ann = allAnnotationsRef.current.find((item) => item.id === annotationId)
    if (!ann) return
    await persistAnnotation({ ...ann, updatedAt: new Date().toISOString() }, historyOptions)
  }, [persistAnnotation])

  // KEYNUDGE — arrow-key fine positioning. Mouse drag is for large moves; the keyboard is for
  // the last couple of pixels. Goes through applyAnnotationMove (the same path a drag uses), so
  // a whole multi-point path translates as one shape rather than a single point moving.
  // Repeated presses are coalesced into one save by the debounce below.
  const nudgeCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const nudgeAnnotation = useCallback((annotationId: string, dxNorm: number, dyNorm: number) => {
    const annotation = allAnnotationsRef.current.find((item) => item.id === annotationId)
    if (!annotation) return
    const meta = getAnnotationMeta(annotation)
    const startBox = clampRectToPage(meta.box || annotation.rect || { x: 0.02, y: 0.02, w: DEFAULT_TEXT_BOX.w, h: DEFAULT_TEXT_BOX.h })
    const safeBox = clampRectToPage({ ...startBox, x: startBox.x + dxNorm, y: startBox.y + dyNorm })
    applyAnnotationMove(annotationId, startBox, getAnnotationMoveGeometry(meta), safeBox)
    // Deferred so the persist reads the post-render annotation from allAnnotationsRef, and so
    // holding an arrow key writes once at the end instead of on every key repeat.
    if (nudgeCommitTimerRef.current) clearTimeout(nudgeCommitTimerRef.current)
    nudgeCommitTimerRef.current = setTimeout(() => {
      nudgeCommitTimerRef.current = null
      void commitAnnotationLayout(annotationId, { label: `Move ${annotationLabel(annotation)}` })
    }, 300)
  }, [applyAnnotationMove, commitAnnotationLayout])

  useEffect(() => () => { if (nudgeCommitTimerRef.current) clearTimeout(nudgeCommitTimerRef.current) }, [])

  useEffect(() => {
    if (!focusedAnnotationId) return
    const onKey = (e: KeyboardEvent) => {
      const delta = e.key === 'ArrowUp' ? { x: 0, y: -1 }
        : e.key === 'ArrowDown' ? { x: 0, y: 1 }
        : e.key === 'ArrowLeft' ? { x: -1, y: 0 }
        : e.key === 'ArrowRight' ? { x: 1, y: 0 }
        : null
      if (!delta) return
      // Leave browser/OS shortcuts (and any future modifier bindings) alone.
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      const el = document.activeElement as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      if (typing) return
      if (isEditorOpen || inlineTextEditId) return
      if (!annotationsVisible || !isAnnotationVisibleOnCanvas(focusedAnnotationId)) return
      // Stop the page from scrolling under the nudge.
      e.preventDefault()
      nudgeAnnotation(focusedAnnotationId, delta.x * NUDGE_STEP_NORM, delta.y * NUDGE_STEP_NORM)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusedAnnotationId, isEditorOpen, inlineTextEditId, annotationsVisible, isAnnotationVisibleOnCanvas, nudgeAnnotation])

  const startAnnotationLayoutDrag = useCallback((e: React.PointerEvent<HTMLElement>, annotation: BlueprintAnnotation, mode: 'move' | 'resize') => {
    const meta = getAnnotationMeta(annotation)
    const box = clampRectToPage(meta.box || annotation.rect || { x: 0.02, y: 0.02, w: DEFAULT_TEXT_BOX.w, h: DEFAULT_TEXT_BOX.h })
    setFocusedAnnotationId(annotation.id)
    setLayoutEditId(annotation.id)
    // Step 12C — moving a line-like shape with free absolute endpoints must shift
    // those endpoints by the same delta, since rendering no longer derives them
    // from `box`.
    // Absolute geometry (line endpoints, arch control point, multi-point path points, Circuit
    // Arc control points) is captured up front and translated by the same delta as the box —
    // see getAnnotationMoveGeometry. Resize does not carry it, hence the mode gate.
    const startGeom = mode === 'move' ? getAnnotationMoveGeometry(meta) : EMPTY_MOVE_GEOMETRY
    const startLineAbs = startGeom.lineAbs
    const startArchCtrl = startGeom.archCtrl
    const startPoints = startGeom.points
    const startArcCtrls = startGeom.arcCtrls
    const drag = {
      annotationId: annotation.id,
      mode,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startBox: box,
      startLineAbs,
      startArchCtrl,
      startPoints,
      startArcCtrls,
      historyTransactionId: `annotation_drag_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
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
    // Step 12C — line-like shapes with free absolute endpoints (meta.lineAbsX1..Y2)
    // start the drag from those exact page-normalized coordinates. Older saved
    // lines without abs endpoints fall back to the original box-relative model.
    const isLineLike = meta.shapeKind === 'line' || meta.shapeKind === 'arrow' || meta.shapeKind === 'arch-line'
    const hasAbs = isLineLike && meta.lineAbsX1 != null && meta.lineAbsY1 != null && meta.lineAbsX2 != null && meta.lineAbsY2 != null
    let startAbsX: number, startAbsY: number, endAbsX: number, endAbsY: number
    if (hasAbs) {
      startAbsX = meta.lineAbsX1
      startAbsY = meta.lineAbsY1
      endAbsX = meta.lineAbsX2
      endAbsY = meta.lineAbsY2
    } else {
      const rect = annotation.rect || { x: 0, y: 0, w: 0.1, h: 0.1 }
      const lx1 = meta.lineX1 ?? 0
      const ly1 = meta.lineY1 ?? 0
      const lx2 = meta.lineX2 ?? 1
      const ly2 = meta.lineY2 ?? 1
      startAbsX = rect.x + lx1 * (rect.w || 0)
      startAbsY = rect.y + ly1 * (rect.h || 0)
      endAbsX = rect.x + lx2 * (rect.w || 0)
      endAbsY = rect.y + ly2 * (rect.h || 0)
    }
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

  // BLUEPRINT-6L — begin dragging one endpoint of a measure-distance line. The pointer is
  // captured on the overlay so handlePointerMove / handlePointerUp drive the live update and
  // final persist (same capture pattern as startAnnotationEndpointDrag).
  const startMeasureEndpointDrag = useCallback((e: React.PointerEvent<SVGElement>, annotation: BlueprintAnnotation, endpoint: 0 | 1) => {
    measureEndpointDragRef.current = { annotationId: annotation.id, endpoint, pointerId: e.pointerId }
    setFocusedAnnotationId(annotation.id)
    setLayoutEditId(annotation.id)
    try { overlayRef.current?.setPointerCapture(e.pointerId) } catch {}
    e.preventDefault()
    e.stopPropagation()
  }, [])

  // BLUEPRINT-6M — begin a whole-line move for a measure-distance line. Captures the two
  // starting endpoints so handlePointerMove can translate them together by the pointer
  // delta (rigid move: length + angle preserved). Same capture pattern as endpoint drag.
  const startMeasureLineDrag = useCallback((e: React.PointerEvent<SVGElement>, annotation: BlueprintAnnotation) => {
    const meta = getAnnotationMeta(annotation)
    const startPoints = Array.isArray(meta.points) ? meta.points.map((p: any) => ({ x: p.x, y: p.y })) : []
    if (startPoints.length < 2) return
    measureLineDragRef.current = {
      annotationId: annotation.id,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPoints,
    }
    setFocusedAnnotationId(annotation.id)
    setLayoutEditId(annotation.id)
    try { overlayRef.current?.setPointerCapture(e.pointerId) } catch {}
    e.preventDefault()
    e.stopPropagation()
  }, [])

  // BLUEPRINT-6N — begin dragging a single perimeter point/axle. handlePointerMove updates
  // only that vertex and recomputes the polyline total; handlePointerUp persists. Captured
  // to the overlay like the distance endpoint/line drags.
  const startMeasurePointDrag = useCallback((e: React.PointerEvent<SVGElement>, annotation: BlueprintAnnotation, pointIndex: number) => {
    measurePointDragRef.current = { annotationId: annotation.id, pointIndex, pointerId: e.pointerId }
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

  const startCircuitArcControlDrag = useCallback((e: React.PointerEvent<HTMLElement>, annotation: BlueprintAnnotation, segIndex: number) => {
    const drag = { annotationId: annotation.id, segIndex, pointerId: e.pointerId }
    circuitArcControlDragRef.current = drag
    setCircuitArcControlDrag(drag)
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
    if (drag.mode === 'move') {
      const rawSafeBox = clampRectToPage(next)
      const safeBox = updateMoveGuideLines(rawSafeBox, drag.annotationId) || rawSafeBox
      applyAnnotationMove(
        drag.annotationId,
        start,
        { lineAbs: drag.startLineAbs, archCtrl: drag.startArchCtrl, points: drag.startPoints, arcCtrls: drag.startArcCtrls },
        safeBox,
      )
      e.preventDefault()
      e.stopPropagation()
      return
    }
    updateAnnotationLayout(drag.annotationId, next)
    e.preventDefault()
    e.stopPropagation()
  }, [layoutDrag, updateAnnotationLayout, updateMoveGuideLines, applyAnnotationMove])

  const handleAnnotationLayoutPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const drag = layoutDragRef.current || layoutDrag
    if (!drag || drag.pointerId !== e.pointerId) return
    const id = drag.annotationId
    clearAlignmentGuides()
    layoutDragRef.current = null
    setLayoutDrag(null)
    const annotation = allAnnotationsRef.current.find((item) => item.id === id)
    void commitAnnotationLayout(id, {
      label: `${drag.mode === 'resize' ? 'Resize' : 'Move'} ${annotation ? annotationLabel(annotation) : 'annotation'}`,
      transactionId: drag.historyTransactionId,
    })
    e.preventDefault()
    e.stopPropagation()
  }, [layoutDrag, commitAnnotationLayout, clearAlignmentGuides])

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
        const baseCommittedZoom = Math.max(0.001, renderedZoomRef.current)
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
            const baseCommittedZoom = Math.max(0.001, renderedZoomRef.current)
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
      // displaySize reflects renderedZoom, so the on-screen preview scale is
      // finalZoom relative to the raster's zoom, not the committed relativeZoom.
      const currentZoom = Math.max(0.001, renderedZoomRef.current)
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
        clearAlignmentGuides()
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
      // Touch drag-release for distance second point — begin placement on pointerdown, commit on pointerup.
      if (effectiveTool === 'measure-distance' && measureDraftRef.current.length === 1 && e.pointerType === 'touch') {
        measureDistanceDragRef.current = {
          active: true,
          pointerId: e.pointerId,
          startX: x,
          startY: y,
          moved: false,
        }
        setMeasureCursorPx({
          x: x / Math.max(1, rect.width) * displaySize.w,
          y: y / Math.max(1, rect.height) * displaySize.h,
        })
        try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId) } catch { }
        e.preventDefault()
        return
      }
      // Guide Assist: when ON, lock the point being committed to a clean straight axis from
      // the previous draft point (measure-distance / perimeter / area only). When OFF, the raw
      // mapped point `n` is used exactly as before. Snapping happens on the already-mapped page
      // point — pointer/overlay/zoom mapping is untouched.
      const measureAnchor = measureDraftRef.current.length > 0 ? measureDraftRef.current[measureDraftRef.current.length - 1] : null
      const commitPoint = (alignmentGuidesEnabled && measureAnchor && (effectiveTool === 'measure-distance' || effectiveTool === 'measure-perimeter' || effectiveTool === 'measure-area'))
        ? snapMeasurePointToAxis(measureAnchor, n, displaySize.w, displaySize.h)
        : n
      const next = [...measureDraftRef.current, commitPoint]
      measureDraftRef.current = next
      setMeasureDraftPoints([...next])
      // BLUEPRINT-6N — snap the live cursor to the point just placed so the perimeter rubber-band
      // segment starts from the NEW point (zero-length) and then follows the pointer, instead of
      // pointing at the previous stale cursor location (the diagonal-across-screen bug on tap-place).
      if (effectiveTool === 'measure-perimeter') {
        setMeasureCursorPx({ x: commitPoint.x * displaySize.w, y: commitPoint.y * displaySize.h })
      }
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
        const pageW = displaySizeRef.current.w
        const pageH = displaySizeRef.current.h
        const pagePt = overlayPxToPagePx(x, y, rect.width, rect.height, pageW, pageH)
        if (shapeKind === 'arch-line') {
          const archEl = draftArchPathDomRef.current
          if (archEl) {
            archEl.setAttribute('d', `M ${pagePt.x} ${pagePt.y} Q ${pagePt.x} ${pagePt.y} ${pagePt.x} ${pagePt.y}`)
            archEl.style.display = ''
          }
        } else {
          const lineEl = draftLineDomRef.current
          if (lineEl) {
            lineEl.setAttribute('x1', String(pagePt.x))
            lineEl.setAttribute('y1', String(pagePt.y))
            lineEl.setAttribute('x2', String(pagePt.x))
            lineEl.setAttribute('y2', String(pagePt.y))
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

    // Multi-point Polyline / Circuit Path: every click adds one more point to the same
    // open path. Finishing only happens via the explicit Stop button (or Escape/tool
    // switch cancels) — never an implicit double-click or point-count cap.
    if (effectiveTool === 'shape' && isMultiPointShapeKind(shapeKind)) {
      const n = toNorm(x, y, rect.width, rect.height)
      // Fixture snap takes precedence over Guide Assist. Circuit Path/Arc exist to run
      // fixture to fixture, so a click landing on a symbol must use that symbol's exact
      // center; Guide Assist's axis lock is the fallback for open space where there is
      // nothing more specific to snap to. When Guide Assist is OFF this is byte-identical
      // to the previous behavior (fixture center, else the raw mapped point).
      const fixtureCenter = isCircuitShapeKind(shapeKind)
        ? findNearestAnnotationCenterNorm(n, CIRCUIT_PATH_SNAP_RADIUS_NORM)
        : null
      const pathAnchor = pathDraftRef.current.length > 0 ? pathDraftRef.current[pathDraftRef.current.length - 1] : null
      const point = fixtureCenter
        ?? ((alignmentGuidesEnabled && pathAnchor)
          ? snapMeasurePointToAxis(pathAnchor, n, displaySize.w, displaySize.h)
          : n)
      const next = [...pathDraftRef.current, point]
      pathDraftRef.current = next
      setPathDraftPoints([...next])
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
  }, [effectiveTool, isEditorOpen, handleTwoFingerGesture, lockView, shapeKind, clearAlignmentGuides, findNearestAnnotationCenterNorm, displaySize.w, displaySize.h, alignmentGuidesEnabled])

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
        clearAlignmentGuides()
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
      const safeBox = clampRectToPage({ x: nx, y: ny, w: nw, h: nh })
      const bw = Math.max(safeBox.w, 0.0001)
      const bh = Math.max(safeBox.h, 0.0001)
      setAllAnnotations((prev) => prev.map((ann) => {
        if (ann.id !== epDrag.annotationId) return ann
        const m = getAnnotationMeta(ann)
        return withAnnotationMeta(
          { ...ann, rect: safeBox, updatedAt: new Date().toISOString() },
          {
            ...m,
            // Step 12C source of truth for edited line endpoints.
            lineAbsX1: x1,
            lineAbsY1: y1,
            lineAbsX2: x2,
            lineAbsY2: y2,
            // Preserve the old relative fields as a no-migration fallback.
            lineX1: (x1 - safeBox.x) / bw,
            lineY1: (y1 - safeBox.y) / bh,
            lineX2: (x2 - safeBox.x) / bw,
            lineY2: (y2 - safeBox.y) / bh,
          }
        ) as BlueprintAnnotation
      }))
      e.preventDefault()
      e.stopPropagation()
      return
    }

    // BLUEPRINT-6L — measure-distance endpoint drag: move endpoint to the cursor and
    // recalculate the real-world distance live using the BLUEPRINT-6I aspect-aware math.
    const meDrag = measureEndpointDragRef.current
    if (meDrag && meDrag.pointerId === e.pointerId && overlayRef.current) {
      const overlayRect = overlayRef.current.getBoundingClientRect()
      const nx = clampNorm((e.clientX - overlayRect.left) / Math.max(1, overlayRect.width))
      const ny = clampNorm((e.clientY - overlayRect.top) / Math.max(1, overlayRect.height))
      setAllAnnotations((prev) => prev.map((ann) => {
        if (ann.id !== meDrag.annotationId) return ann
        const m = getAnnotationMeta(ann)
        const pts = Array.isArray(m.points) ? m.points.map((p: any) => ({ x: p.x, y: p.y })) : []
        if (pts.length < 2) return ann
        pts[meDrag.endpoint] = { x: nx, y: ny }
        const pageSize = getPageSizeInches(ann.pageNumber)
        const effective = resolveSharedEffectiveCalibration({
          pageNumber: ann.pageNumber,
          savedCalibrations: savedCalibrationsRef.current,
          detectedScales: detectedScalesRef.current,
          pageSize,
        })
        const calForPage = effective.status === 'calibrated' ? effective.calibration : null
        const normDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
        const nextMeta: Record<string, any> = { ...m, points: pts, normDistance: normDist }
        if (calForPage) {
          const realDist = convertMeasuredDistance(pts[0], pts[1], calForPage, pageSize)
          nextMeta.realWorldDistance = realDist
          nextMeta.unit = calForPage.realWorldUnit
          nextMeta.label = formatArchitecturalLength(realDist, calForPage.realWorldUnit)
        }
        const bounds = clampRectToPage(getPointsBounds(pts))
        return withAnnotationMeta({ ...ann, rect: bounds, updatedAt: new Date().toISOString() }, nextMeta) as BlueprintAnnotation
      }))
      e.preventDefault()
      e.stopPropagation()
      return
    }

    // BLUEPRINT-6M — measure-distance whole-line move: shift both endpoints by the same
    // page-normalized delta (rigid move — segment length and angle unchanged). The delta
    // is clamped so neither endpoint leaves the page. Distance does not change, but the
    // label/normDistance are recalculated with the aspect-aware helper for consistency.
    const mlDrag = measureLineDragRef.current
    if (mlDrag && mlDrag.pointerId === e.pointerId && overlayRef.current) {
      const overlayRect = overlayRef.current.getBoundingClientRect()
      let adjDx = (e.clientX - mlDrag.startClientX) / Math.max(1, overlayRect.width)
      let adjDy = (e.clientY - mlDrag.startClientY) / Math.max(1, overlayRect.height)
      for (const p of mlDrag.startPoints) {
        adjDx = Math.max(-p.x, Math.min(1 - p.x, adjDx))
        adjDy = Math.max(-p.y, Math.min(1 - p.y, adjDy))
      }
      const pts = mlDrag.startPoints.map((p) => ({ x: p.x + adjDx, y: p.y + adjDy }))
      setAllAnnotations((prev) => prev.map((ann) => {
        if (ann.id !== mlDrag.annotationId) return ann
        const m = getAnnotationMeta(ann)
        if (pts.length < 2) return ann
        const pageSize = getPageSizeInches(ann.pageNumber)
        const effective = resolveSharedEffectiveCalibration({
          pageNumber: ann.pageNumber,
          savedCalibrations: savedCalibrationsRef.current,
          detectedScales: detectedScalesRef.current,
          pageSize,
        })
        const calForPage = effective.status === 'calibrated' ? effective.calibration : null
        // BLUEPRINT-6O — a rigid whole-object move keeps every segment length, so the total is
        // unchanged; we still recompute with the aspect-aware helper for consistency. Perimeter
        // and distance store their geometry differently, so recalc the matching meta fields.
        let nextMeta: Record<string, any>
        if (ann.type === 'measure-perimeter') {
          let normPerim = 0
          for (let i = 1; i < pts.length; i++) normPerim += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
          nextMeta = { ...m, points: pts, normPerimeter: normPerim }
          if (calForPage) {
            const realPerim = convertMeasuredPolylineLength(pts, calForPage, pageSize)
            nextMeta.realWorldPerimeter = realPerim
            nextMeta.totalDistance = realPerim
            nextMeta.unit = calForPage.realWorldUnit
            nextMeta.label = `Total: ${formatArchitecturalLength(realPerim, calForPage.realWorldUnit)}`
            nextMeta.calibrated = true
          }
        } else {
          const normDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
          nextMeta = { ...m, points: pts, normDistance: normDist }
          if (calForPage) {
            const realDist = convertMeasuredDistance(pts[0], pts[1], calForPage, pageSize)
            nextMeta.realWorldDistance = realDist
            nextMeta.unit = calForPage.realWorldUnit
            nextMeta.label = formatArchitecturalLength(realDist, calForPage.realWorldUnit)
          }
        }
        const bounds = clampRectToPage(getPointsBounds(pts))
        return withAnnotationMeta({ ...ann, rect: bounds, updatedAt: new Date().toISOString() }, nextMeta) as BlueprintAnnotation
      }))
      e.preventDefault()
      e.stopPropagation()
      return
    }

    // BLUEPRINT-6N — measure-perimeter point/axle drag: move a single vertex to the cursor and
    // recompute the whole-path total live with BLUEPRINT-6I aspect-aware math. Segment labels
    // recompute automatically since they derive from meta.points at render.
    const mpDrag = measurePointDragRef.current
    if (mpDrag && mpDrag.pointerId === e.pointerId && overlayRef.current) {
      const overlayRect = overlayRef.current.getBoundingClientRect()
      const nx = clampNorm((e.clientX - overlayRect.left) / Math.max(1, overlayRect.width))
      const ny = clampNorm((e.clientY - overlayRect.top) / Math.max(1, overlayRect.height))
      setAllAnnotations((prev) => prev.map((ann) => {
        if (ann.id !== mpDrag.annotationId) return ann
        const m = getAnnotationMeta(ann)
        const pts = Array.isArray(m.points) ? m.points.map((p: any) => ({ x: p.x, y: p.y })) : []
        if (mpDrag.pointIndex < 0 || mpDrag.pointIndex >= pts.length) return ann
        pts[mpDrag.pointIndex] = { x: nx, y: ny }
        const pageSize = getPageSizeInches(ann.pageNumber)
        const effective = resolveSharedEffectiveCalibration({
          pageNumber: ann.pageNumber,
          savedCalibrations: savedCalibrationsRef.current,
          detectedScales: detectedScalesRef.current,
          pageSize,
        })
        const calForPage = effective.status === 'calibrated' ? effective.calibration : null
        let normPerim = 0
        for (let i = 1; i < pts.length; i++) normPerim += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
        const nextMeta: Record<string, any> = { ...m, points: pts, normPerimeter: normPerim }
        if (calForPage) {
          const realPerim = convertMeasuredPolylineLength(pts, calForPage, pageSize)
          nextMeta.realWorldPerimeter = realPerim
          nextMeta.totalDistance = realPerim
          nextMeta.unit = calForPage.realWorldUnit
          nextMeta.label = `Total: ${formatArchitecturalLength(realPerim, calForPage.realWorldUnit)}`
          nextMeta.calibrated = true
        }
        const bounds = clampRectToPage(getPointsBounds(pts))
        return withAnnotationMeta({ ...ann, rect: bounds, updatedAt: new Date().toISOString() }, nextMeta) as BlueprintAnnotation
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

    const caDrag = circuitArcControlDragRef.current
    if (caDrag && caDrag.pointerId === e.pointerId && overlayRef.current) {
      const overlayRect = overlayRef.current.getBoundingClientRect()
      // Same freeform mapping as the arch handle — the cursor position IS the control
      // point — but written only at segIndex, so sibling segments keep their curvature.
      const nhx = clampNorm((e.clientX - overlayRect.left) / Math.max(1, overlayRect.width))
      const nhy = clampNorm((e.clientY - overlayRect.top) / Math.max(1, overlayRect.height))
      // CIRCUITTOOLS2 — Guide Assist during curvature-handle drags. The guide machinery
      // compares rect CENTERS, so the handle is fed in as a minimum-size rect centred on it
      // (clampRectToPage floors w/h at 0.01, hence the half-size offset). Lines only: the
      // return value is deliberately discarded so the control point stays free-form.
      updateMoveGuideLines(
        { x: nhx - GUIDE_POINT_RECT_NORM / 2, y: nhy - GUIDE_POINT_RECT_NORM / 2, w: GUIDE_POINT_RECT_NORM, h: GUIDE_POINT_RECT_NORM },
        caDrag.annotationId,
      )
      setAllAnnotations((prev) => prev.map((ann) => {
        if (ann.id !== caDrag.annotationId) return ann
        const m = getAnnotationMeta(ann)
        const pts: Array<{ x: number; y: number }> = Array.isArray(m.points) ? m.points : []
        if (caDrag.segIndex < 0 || caDrag.segIndex >= Math.max(0, pts.length - 1)) return ann
        // Rebuild the full array from the effective (fallback-resolved) control points so a
        // sparse or short arcCtrls never leaves holes once one segment has been dragged.
        const nextCtrls = pts.slice(1).map((p, i) =>
          i === caDrag.segIndex ? { x: nhx, y: nhy } : getCircuitArcControl(m.arcCtrls, pts[i], p, i),
        )
        // Keep the bounding rect enclosing points and control points, so the curve is not
        // clipped and the page→local divisor can never collapse toward zero.
        const nextRect = clampRectToPage(getPointsBounds([...pts, ...nextCtrls]))
        return withAnnotationMeta(
          { ...ann, rect: nextRect, updatedAt: new Date().toISOString() },
          { ...m, arcCtrls: nextCtrls },
        ) as BlueprintAnnotation
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
      const distDrag = measureDistanceDragRef.current
      if (distDrag.active && distDrag.pointerId === e.pointerId && effectiveTool === 'measure-distance') {
        if (!distDrag.moved && (Math.abs(x - distDrag.startX) > 2 || Math.abs(y - distDrag.startY) > 2)) {
          distDrag.moved = true
        }
        e.preventDefault()
      }
      if (measureDraftRef.current.length > 0) {
        // Guide Assist: snap the live rubber-band endpoint to a clean straight axis from the
        // last placed point so the preview shows exactly what a click will commit. OFF path is
        // byte-identical to before (raw mapped cursor).
        if (alignmentGuidesEnabled && (effectiveTool === 'measure-distance' || effectiveTool === 'measure-perimeter' || effectiveTool === 'measure-area')) {
          const rawN = { x: x / Math.max(1, rect.width), y: y / Math.max(1, rect.height) }
          const anchor = measureDraftRef.current[measureDraftRef.current.length - 1]
          const cursorN = snapMeasurePointToAxis(anchor, rawN, displaySize.w, displaySize.h)
          setMeasureCursorPx({ x: cursorN.x * displaySize.w, y: cursorN.y * displaySize.h })
        } else {
          setMeasureCursorPx({
            x: x / Math.max(1, rect.width) * displaySize.w,
            y: y / Math.max(1, rect.height) * displaySize.h,
          })
        }
      }
      return
    }

    if (effectiveTool === 'shape' && isMultiPointShapeKind(shapeKind)) {
      if (pathDraftRef.current.length > 0) {
        // Guide Assist: preview the rubber-band endpoint through the SAME precedence the
        // click will use (fixture center first, then axis lock), so what is drawn is exactly
        // what a click commits. OFF path is byte-identical to before (raw mapped cursor).
        if (alignmentGuidesEnabled) {
          const rawN = { x: x / Math.max(1, rect.width), y: y / Math.max(1, rect.height) }
          const fixtureCenter = isCircuitShapeKind(shapeKind)
            ? findNearestAnnotationCenterNorm(rawN, CIRCUIT_PATH_SNAP_RADIUS_NORM)
            : null
          const anchor = pathDraftRef.current[pathDraftRef.current.length - 1]
          const cursorN = fixtureCenter ?? snapMeasurePointToAxis(anchor, rawN, displaySize.w, displaySize.h)
          setPathCursorPx({ x: cursorN.x * displaySize.w, y: cursorN.y * displaySize.h })
        } else {
          setPathCursorPx({
            x: x / Math.max(1, rect.width) * displaySize.w,
            y: y / Math.max(1, rect.height) * displaySize.h,
          })
        }
      }
      return
    }

    // Update live-preview line while waiting for the second click in point-to-point mode.
    if (effectiveTool === 'shape' && (shapeKind === 'line' || shapeKind === 'arrow') && lineFirstPointRef.current) {
      const lineEl = draftLineDomRef.current
      const pageW = displaySizeRef.current.w
      const pageH = displaySizeRef.current.h
      const pagePt = overlayPxToPagePx(x, y, rect.width, rect.height, pageW, pageH)
      if (lineEl) {
        lineEl.setAttribute('x2', String(pagePt.x))
        lineEl.setAttribute('y2', String(pagePt.y))
      }
      updatePlacementGuideLines(normRectFromDrag(lineFirstPointRef.current, { x, y }, rect.width, rect.height))
      return
    }
    if (effectiveTool === 'shape' && shapeKind === 'arch-line' && lineFirstPointRef.current) {
      const archEl = draftArchPathDomRef.current
      const p1 = lineFirstPointRef.current
      const pageW = displaySizeRef.current.w
      const pageH = displaySizeRef.current.h
      const p1Page = overlayPxToPagePx(p1.x, p1.y, rect.width, rect.height, pageW, pageH)
      const pagePt = overlayPxToPagePx(x, y, rect.width, rect.height, pageW, pageH)
      if (archEl) {
        const cpx = (p1Page.x + pagePt.x) / 2 + 0.5 * (pagePt.y - p1Page.y)
        const cpy = (p1Page.y + pagePt.y) / 2 - 0.5 * (pagePt.x - p1Page.x)
        archEl.setAttribute('d', `M ${p1Page.x} ${p1Page.y} Q ${cpx} ${cpy} ${pagePt.x} ${pagePt.y}`)
        archEl.style.display = ''
      }
      updatePlacementGuideLines(normRectFromDrag(p1, { x, y }, rect.width, rect.height))
      return
    }

    const activeDragStart = dragStartRef.current || dragStart
    if (!(effectiveTool === 'highlight' || effectiveTool === 'textHighlight' || effectiveTool === 'underline' || effectiveTool === 'shape' || effectiveTool === 'eraser' || effectiveTool === 'callout' || effectiveTool === 'generate') || !activeDragStart) return

    const previewRect = {
      left: Math.min(activeDragStart.x, x),
      top: Math.min(activeDragStart.y, y),
      w: Math.abs(x - activeDragStart.x),
      h: Math.abs(y - activeDragStart.y),
    }

    // Direct DOM mutation Ã¢â‚¬â€ zero React re-renders during drag for smooth preview.
    const domEl = draftRectDomRef.current
    if (domEl) {
      domEl.style.display = 'block'
      domEl.style.left = `${previewRect.left}px`
      domEl.style.top = `${previewRect.top}px`
      domEl.style.width = `${previewRect.w}px`
      domEl.style.height = `${previewRect.h}px`
    }
    updatePlacementGuideLines(normRectFromPlacementPreview(previewRect, rect.width, rect.height))
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
  }, [effectiveTool, dragStart, inkDraft, isEditorOpen, handleTwoFingerGesture, lockView, shapeKind, clearAlignmentGuides, updatePlacementGuideLines, updateMoveGuideLines, alignmentGuidesEnabled, findNearestAnnotationCenterNorm, displaySize.w, displaySize.h])

  const handlePointerUp = useCallback(async (e: React.PointerEvent<HTMLDivElement>) => {
    // Snapshot the last live guide match before clearing — used to center-snap a newly
    // placed shape below (Step 13B-QA2).
    const pendingAlignmentGuides = activeAlignmentGuidesRef.current
    clearAlignmentGuides()
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

    const distDragUp = measureDistanceDragRef.current
    if (
      distDragUp.active &&
      distDragUp.pointerId === e.pointerId &&
      effectiveTool === 'measure-distance' &&
      measureDraftRef.current.length === 1 &&
      overlayRef.current
    ) {
      measureDistanceDragRef.current = { active: false, pointerId: null, startX: 0, startY: 0, moved: false }
      try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId) } catch { }
      const overlayRect = overlayRef.current.getBoundingClientRect()
      const releaseX = e.clientX - overlayRect.left
      const releaseY = e.clientY - overlayRect.top
      const rawP2 = toNorm(releaseX, releaseY, overlayRect.width, overlayRect.height)
      const p1 = measureDraftRef.current[0]
      // Guide Assist: lock the distance endpoint to a straight axis from the first point when ON.
      const p2 = alignmentGuidesEnabled
        ? snapMeasurePointToAxis(p1, rawP2, displaySizeRef.current.w || displaySize.w, displaySizeRef.current.h || displaySize.h)
        : rawP2
      const normDist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
      if (normDist >= 0.003) {
        setMeasurePendingCommit({ type: 'measure-distance', points: [p1, p2], pageNumber: currentPageRef.current })
      }
      measureDraftRef.current = []
      setMeasureDraftPoints([])
      setMeasureCursorPx(null)
      lastMeasureClickRef.current = { time: 0, nx: 0, ny: 0 }
      e.preventDefault()
      e.stopPropagation()
      return
    }

    const epDragUp = endpointDragRef.current
    if (epDragUp && epDragUp.pointerId === e.pointerId) {
      endpointDragRef.current = null
      setEndpointDrag(null)
      const ann = allAnnotationsRef.current.find((a) => a.id === epDragUp.annotationId)
      if (ann) void persistAnnotation({ ...ann, updatedAt: new Date().toISOString() }, { label: `Edit points for ${annotationLabel(ann)}` })
      e.preventDefault()
      e.stopPropagation()
      return
    }

    // BLUEPRINT-6L — commit the edited measure-distance geometry (points, normDistance,
    // realWorldDistance, label and bounds were updated live in handlePointerMove).
    const meDragUp = measureEndpointDragRef.current
    if (meDragUp && meDragUp.pointerId === e.pointerId) {
      measureEndpointDragRef.current = null
      const ann = allAnnotationsRef.current.find((a) => a.id === meDragUp.annotationId)
      if (ann) void persistAnnotation({ ...ann, updatedAt: new Date().toISOString() }, { label: `Edit points for ${annotationLabel(ann)}` })
      e.preventDefault()
      e.stopPropagation()
      return
    }

    // BLUEPRINT-6M — commit the moved measure-distance line (points/label/bounds were
    // updated live in handlePointerMove) through the same persist path as endpoint edits.
    const mlDragUp = measureLineDragRef.current
    if (mlDragUp && mlDragUp.pointerId === e.pointerId) {
      measureLineDragRef.current = null
      const ann = allAnnotationsRef.current.find((a) => a.id === mlDragUp.annotationId)
      if (ann) void persistAnnotation({ ...ann, updatedAt: new Date().toISOString() }, { label: `Move ${annotationLabel(ann)}` })
      e.preventDefault()
      e.stopPropagation()
      return
    }

    // BLUEPRINT-6N — commit the moved perimeter point (points/total/label/bounds updated live).
    const mpDragUp = measurePointDragRef.current
    if (mpDragUp && mpDragUp.pointerId === e.pointerId) {
      measurePointDragRef.current = null
      const ann = allAnnotationsRef.current.find((a) => a.id === mpDragUp.annotationId)
      if (ann) void persistAnnotation({ ...ann, updatedAt: new Date().toISOString() }, { label: `Edit points for ${annotationLabel(ann)}` })
      e.preventDefault()
      e.stopPropagation()
      return
    }

    const acDragUp = archControlDragRef.current
    if (acDragUp && acDragUp.pointerId === e.pointerId) {
      archControlDragRef.current = null
      setArchControlDrag(null)
      const ann = allAnnotationsRef.current.find((a) => a.id === acDragUp.annotationId)
      if (ann) void persistAnnotation({ ...ann, updatedAt: new Date().toISOString() }, { label: `Edit curve for ${annotationLabel(ann)}` })
      e.preventDefault()
      e.stopPropagation()
      return
    }

    // CIRCUITARC — commit the adjusted segment curvature. The arcCtrls array and bounding
    // rect were updated live during the drag; the arc-length label is refreshed here.
    const caDragUp = circuitArcControlDragRef.current
    if (caDragUp && caDragUp.pointerId === e.pointerId) {
      circuitArcControlDragRef.current = null
      setCircuitArcControlDrag(null)
      const ann = allAnnotationsRef.current.find((a) => a.id === caDragUp.annotationId)
      if (ann) {
        const updated = withRecomputedCircuitArcDistance({ ...ann, updatedAt: new Date().toISOString() })
        setAllAnnotations((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
        void persistAnnotation(updated, { label: `Edit circuit segment for ${annotationLabel(updated)}` })
      }
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
      if (toDelete.length > 0) {
        const label = toDelete.length === 1
          ? `Erase ${annotationLabel(toDelete[0])}`
          : `Erase ${toDelete.length} annotations`
        void removeAnnotationsAsSingleHistoryCommand(toDelete.map((annotation) => annotation.id), label)
      }
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
    // Center-snap newly placed shapes/symbols onto the last matched Guide Assist center
    // (Step 13B-QA2 Part 4) — only translates x/y, so line/arch endpoint math below (which
    // derives from this box's origin) stays consistent with the final placed position.
    const finalNorm = (effectiveTool === 'shape' && pendingAlignmentGuides.length > 0)
      ? applyCenterSnap(norm, pendingAlignmentGuides)
      : norm
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
          const bw = Math.max(finalNorm.w, 0.0001)
          const bh = Math.max(finalNorm.h, 0.0001)
          const base = {
            lineX1: (normStart.x - finalNorm.x) / bw,
            lineY1: (normStart.y - finalNorm.y) / bh,
            lineX2: (normEnd.x - finalNorm.x) / bw,
            lineY2: (normEnd.y - finalNorm.y) / bh,
          }
          if (shapeKind === 'arch-line') {
            // Compute the control point with the exact same pixel-space formula used by the
            // live preview (draftArchPathDomRef update above) — deriving it from normalized
            // x/y deltas independently (old approach) distorted the bulge whenever the page
            // isn't square, since a fraction of page height ≠ the same fraction of page width.
            // Working in screen pixels first (isotropic) then converting once with toNorm
            // keeps the placed arc identical to what was previewed.
            const defaultFactor = 0.5
            const cpxPx = (activeDragStart.x + x) / 2 + defaultFactor * (y - activeDragStart.y)
            const cpyPx = (activeDragStart.y + y) / 2 - defaultFactor * (x - activeDragStart.x)
            const cpNormRaw = toNorm(cpxPx, cpyPx, rect.width, rect.height)
            // Carry the same Guide Assist center-snap translation applied to the bounding box
            // (if any) so the control point stays attached to the endpoints after snapping.
            const snapDx = finalNorm.x - norm.x
            const snapDy = finalNorm.y - norm.y
            const archCtrlX = clampNorm(cpNormRaw.x + snapDx)
            const archCtrlY = clampNorm(cpNormRaw.y + snapDy)
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
      ? { shapeKind, ...shapeOptions, ...lineDirectionMeta, ...getElectricalSymbolMetadataStamp(shapeKind) }
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
      rect: finalNorm,
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
  }, [effectiveTool, dragStart, inkDraft, blueprint, currentPage, persistAnnotation, toolColors, isEditorOpen, endTouchPointer, openCreateRichTextEditor, shapeKind, shapeOptions, drawOptions, markerOptions, clearAlignmentGuides, alignmentGuidesEnabled, displaySize.w, displaySize.h, withRecomputedCircuitArcDistance, removeAnnotationsAsSingleHistoryCommand])

  const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    clearAlignmentGuides()
    const cancelledIds = new Set<string>([
      layoutDragRef.current?.pointerId === e.pointerId ? layoutDragRef.current.annotationId : null,
      endpointDragRef.current?.pointerId === e.pointerId ? endpointDragRef.current.annotationId : null,
      measureEndpointDragRef.current?.pointerId === e.pointerId ? measureEndpointDragRef.current.annotationId : null,
      measureLineDragRef.current?.pointerId === e.pointerId ? measureLineDragRef.current.annotationId : null,
      measurePointDragRef.current?.pointerId === e.pointerId ? measurePointDragRef.current.annotationId : null,
      archControlDragRef.current?.pointerId === e.pointerId ? archControlDragRef.current.annotationId : null,
      circuitArcControlDragRef.current?.pointerId === e.pointerId ? circuitArcControlDragRef.current.annotationId : null,
    ].filter(Boolean) as string[])
    if (cancelledIds.size > 0) {
      setAllAnnotations((prev) => prev.map((annotation) => (
        cancelledIds.has(annotation.id)
          ? cloneAnnotationForHistory(persistedAnnotationSnapshotsRef.current.get(annotation.id)) || annotation
          : annotation
      )))
    }
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
      measureDistanceDragRef.current = { active: false, pointerId: null, startX: 0, startY: 0, moved: false }
      dragStartRef.current = null
      inkDraftRef.current = null
      setDragStart(null)
      setDraftRect(null)
      setInkDraft(null)
    }
    endpointDragRef.current = null
    setEndpointDrag(null)
    // BLUEPRINT-6M — clear the whole-line move ref on cancel so a stuck drag can't linger.
    if (measureLineDragRef.current?.pointerId === e.pointerId) measureLineDragRef.current = null
    // BLUEPRINT-6N — clear the perimeter point-drag ref on cancel.
    if (measurePointDragRef.current?.pointerId === e.pointerId) measurePointDragRef.current = null
    archControlDragRef.current = null
    setArchControlDrag(null)
    circuitArcControlDragRef.current = null
    setCircuitArcControlDrag(null)
    if (layoutDragRef.current?.pointerId === e.pointerId) {
      layoutDragRef.current = null
      setLayoutDrag(null)
    }
  }, [endTouchPointer, clearAlignmentGuides])

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

  void annotationHistoryRevision
  const activeUndoCommand = currentAnnotationHistoryScope
    ? peekUndo(annotationHistoryRef.current, currentAnnotationHistoryScope)
    : null
  const activeRedoCommand = currentAnnotationHistoryScope
    ? peekRedo(annotationHistoryRef.current, currentAnnotationHistoryScope)
    : null
  const annotationHistoryInteractionBlocked = hasActiveAnnotationHistoryInteraction()

  // Multi-Point Measure (Perimeter tool) live running total — updates as points are
  // added, including a live rubber-band segment to the current cursor position.
  // Requires calibration; shows null (handled by the "Calibrate measure first" toast
  // already fired on commit) when no scale is available for the page.
  const measurePathLiveTotal = (() => {
    if (effectiveTool !== 'measure-perimeter' || measureDraftPoints.length < 1) return null
    const allPts = measureCursorPx && displaySize.w > 0 && displaySize.h > 0
      ? [...measureDraftPoints, { x: measureCursorPx.x / displaySize.w, y: measureCursorPx.y / displaySize.h }]
      : measureDraftPoints
    return {
      pointCount: measureDraftPoints.length,
      realLength: activeCalibration
        ? convertMeasuredPolylineLength(allPts, activeCalibration, getPageSizeInches(currentPage))
        : null,
      unit: activeCalibration?.realWorldUnit ?? 'ft',
    }
  })()

  // Distance measurement live preview — rubber-band endpoint + centered label while placing point 2.
  const measureDistanceLivePreview = (() => {
    if (effectiveTool !== 'measure-distance' || measureDraftPoints.length !== 1 || !measureCursorPx || displaySize.w <= 0) return null
    const p1 = measureDraftPoints[0]
    const p2 = { x: measureCursorPx.x / displaySize.w, y: measureCursorPx.y / displaySize.h }
    const midpointPx = {
      px: (p1.x * displaySize.w + measureCursorPx.x) / 2,
      py: (p1.y * displaySize.h + measureCursorPx.y) / 2,
    }
    if (!activeCalibration) {
      return { label: 'Calibrate first', midpointPx, calibrated: false }
    }
    const realDist = convertMeasuredDistance(p1, p2, activeCalibration, getPageSizeInches(currentPage))
    const unit = activeCalibration.realWorldUnit ?? 'ft'
    return { label: formatArchitecturalLength(realDist, unit), midpointPx, calibrated: true }
  })()

  // BLUEPRINT-6N — Multi-Point / Perimeter live segment labels while drafting: a per-segment
  // length at each segment midpoint (aspect-aware), including the live rubber-band segment from
  // the last placed point to the cursor. The bottom pill remains the primary running total.
  const measurePerimeterLivePreview = (() => {
    if (effectiveTool !== 'measure-perimeter' || measureDraftPoints.length < 1 || displaySize.w <= 0) return null
    const pageSize = getPageSizeInches(currentPage)
    const unit = activeCalibration?.realWorldUnit ?? 'ft'
    const segLabel = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      activeCalibration ? formatArchitecturalLength(convertMeasuredDistance(a, b, activeCalibration, pageSize), unit) : null
    const segments: Array<{ midPx: { px: number; py: number }; label: string }> = []
    // Completed segments between already-placed points.
    for (let i = 1; i < measureDraftPoints.length; i++) {
      const a = measureDraftPoints[i - 1], b = measureDraftPoints[i]
      const label = segLabel(a, b)
      if (label) segments.push({ midPx: { px: (a.x + b.x) / 2 * displaySize.w, py: (a.y + b.y) / 2 * displaySize.h }, label })
    }
    // Live rubber-band segment from the last placed point to the cursor.
    if (measureCursorPx) {
      const a = measureDraftPoints[measureDraftPoints.length - 1]
      const b = { x: measureCursorPx.x / displaySize.w, y: measureCursorPx.y / displaySize.h }
      const label = segLabel(a, b)
      if (label) segments.push({ midPx: { px: (a.x * displaySize.w + measureCursorPx.x) / 2, py: (a.y * displaySize.h + measureCursorPx.y) / 2 }, label })
    }
    return { segments }
  })()

  const livePinchZoom = pinchPreviewZoom ?? relativeZoom
  // Divide by renderedZoom (what the raster actually represents), not by the
  // committed relativeZoom: once the raster budget caps the canvas, the CSS
  // transform persistently carries the zoom remainder up to the full 1000%.
  const visualScale = Math.max(1, livePinchZoom / Math.max(0.001, renderedZoom))
  const visualDisplayWidth = displaySize.w ? Math.ceil(displaySize.w * visualScale) : 0
  const visualDisplayHeight = displaySize.h ? Math.ceil(displaySize.h * visualScale) : 0
  // Single overlay coordinate system: viewBox = capped raster (displaySize),
  // SVG pixel size = visual page (visualDisplay*). Pointer input converts
  // overlay visual px → page px via overlayPxToPagePx; rect annotations use %.
  const overlayPageW = displaySize.w
  const overlayPageH = displaySize.h
  const overlayVisualW = visualDisplayWidth
  const overlayVisualH = visualDisplayHeight
  const pageOverlaySvgProps =
    overlayPageW > 0 && overlayVisualW > 0
      ? {
          width: overlayVisualW,
          height: overlayVisualH,
          viewBox: `0 0 ${overlayPageW} ${overlayPageH}`,
        }
      : null
  // HARD OVERRIDE (Step 13B-QA7-R3): the desktop three-pane (left tool column /
  // right annotations column) is NEVER allowed while tablet immersive
  // fullscreen is active, and never on a tablet/touch-first device in any
  // mode — regardless of viewport width. iPad fullscreen is always the
  // stacked layout: tools top, document middle, annotations bottom drawer.
  const useDesktopThreePaneLayout =
    isDesktopBlueprintLayout && !isTabletImmersiveFullscreen && !isTabletDevice()

  // ── Fullscreen overlay scroll handle (Step 13B-QA7-R6) ─────────────────────
  // Only active in stacked fullscreen (immersive or non-desktop native). Reads
  // the fullscreen scroller's scroll metrics + viewport rect (the fullscreen
  // root is fixed at 0,0, so rect.top is the offset within the root) and
  // derives an overlay thumb: min 44px tall for a finger, positioned by scroll
  // ratio. Never touches the inner PDF zoom/pan scroller (scrollAreaRef).
  const fsStackedFullscreen =
    (isFullScreenView || isTabletImmersiveFullscreen) && !useDesktopThreePaneLayout
  const updateFsRail = useCallback(() => {
    const el = fullscreenScrollerRef.current
    if (!el || !fsStackedFullscreen) {
      setFsRail((prev) => (prev.show ? { ...prev, show: false } : prev))
      return
    }
    const { scrollTop, scrollHeight, clientHeight } = el
    if (scrollHeight <= clientHeight + 4) {
      setFsRail((prev) => (prev.show ? { ...prev, show: false } : prev))
      return
    }
    const rect = el.getBoundingClientRect()
    const railTop = rect.top + 8
    const railHeight = Math.max(0, rect.height - 16)
    const thumbH = Math.max(44, (clientHeight / scrollHeight) * railHeight)
    const maxScroll = scrollHeight - clientHeight
    const travel = Math.max(0, railHeight - thumbH)
    const thumbTop = railTop + (maxScroll > 0 ? (scrollTop / maxScroll) * travel : 0)
    setFsRail({ show: true, top: railTop, height: railHeight, thumbTop, thumbH })
  }, [fsStackedFullscreen])

  useEffect(() => {
    if (!fsStackedFullscreen) {
      setFsRail((prev) => (prev.show ? { ...prev, show: false } : prev))
      return
    }
    const el = fullscreenScrollerRef.current
    if (!el) return
    // Initial + observe size changes (annotations expand/collapse, rotation).
    const raf = requestAnimationFrame(updateFsRail)
    const ro = new ResizeObserver(() => updateFsRail())
    ro.observe(el)
    window.addEventListener('resize', updateFsRail, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', updateFsRail)
    }
  }, [fsStackedFullscreen, updateFsRail, tabletAnnotationsOpen, currentPage, allAnnotations.length])

  const handleFsThumbPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = fullscreenScrollerRef.current
    if (!el) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    fsThumbDragRef.current = { startY: e.clientY, startScrollTop: el.scrollTop }
  }, [])

  const handleFsThumbPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = fsThumbDragRef.current
    const el = fullscreenScrollerRef.current
    if (!drag || !el) return
    e.preventDefault()
    e.stopPropagation()
    const { scrollHeight, clientHeight } = el
    const railHeight = Math.max(0, el.getBoundingClientRect().height - 16)
    const thumbH = Math.max(44, (clientHeight / scrollHeight) * railHeight)
    const travel = Math.max(1, railHeight - thumbH)
    const maxScroll = scrollHeight - clientHeight
    const dy = e.clientY - drag.startY
    el.scrollTop = Math.max(0, Math.min(maxScroll, drag.startScrollTop + (dy / travel) * maxScroll))
    updateFsRail()
  }, [updateFsRail])

  const handleFsThumbPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    fsThumbDragRef.current = null
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  }, [])

  // Default / embedded (non-fullscreen) iPad-or-narrow mode: the annotations
  // panel is a normal block below the document — NOT the collapsible fullscreen
  // drawer. It is always expanded and grows naturally (the app page scrolls).
  const isDefaultEmbeddedLayout =
    !useDesktopThreePaneLayout && !isFullScreenView && !isTabletImmersiveFullscreen
  const annotationPanelExpanded =
  // Expanded in every non-fullscreen mode (desktop three-pane AND default
  // embedded). Only the fullscreen drawer stays collapsible via the chevron.
  (!isFullScreenView && !isTabletImmersiveFullscreen)
    ? true
    : tabletAnnotationsOpen

const annotationPanelSizeClass =
  (isFullScreenView || isTabletImmersiveFullscreen) && !useDesktopThreePaneLayout
    ? annotationPanelExpanded
      // Fullscreen (QA7-R5): panel sits BELOW the full-height document work
      // screen inside the vertical scroller — natural height, reached by
      // scrolling down. No max-h cap: it no longer shares the visible
      // viewport with the document, so it cannot shrink it.
      ? 'mt-2 min-h-0'
      : 'mt-2 h-10 max-h-10 min-h-0 overflow-hidden'
    : !useDesktopThreePaneLayout
      // Default embedded (QA7-R7): expand NATURALLY below the document — no
      // max-h cap and no internal scroll, so the annotation list is fully
      // readable and the normal app page scrolls. The old 'max-h-56' (224px)
      // internal-scroll cap was a fullscreen-drawer rule leaking into default
      // mode, making the panel look clipped/compressed.
      ? 'h-auto min-h-[240px]'
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

  const [panelLabelDraft, setPanelLabelDraft] = useState<{ annotationId: string | null; value: string; dirty: boolean }>({
    annotationId: null,
    value: '',
    dirty: false,
  })
  const panelLabelSuppressBlurRef = useRef(false)

  const activePanelLabelAnnotationId = editingAnnotation?.type === 'shape' && getAnnotationMeta(editingAnnotation).shapeKind === 'electrical-panel'
    ? editingAnnotation.id
    : null
  const activePanelLabelText = activePanelLabelAnnotationId ? (editingAnnotation?.text || '') : ''

  useEffect(() => {
    setPanelLabelDraft((previous) => {
      if (!activePanelLabelAnnotationId) {
        return previous.annotationId === null && previous.value === '' && !previous.dirty
          ? previous
          : { annotationId: null, value: '', dirty: false }
      }
      if (previous.annotationId !== activePanelLabelAnnotationId) {
        return { annotationId: activePanelLabelAnnotationId, value: activePanelLabelText, dirty: false }
      }
      if (previous.dirty) return previous
      return previous.value === activePanelLabelText
        ? previous
        : { annotationId: activePanelLabelAnnotationId, value: activePanelLabelText, dirty: false }
    })
  }, [activePanelLabelAnnotationId, activePanelLabelText])

  const persistEditAnnotationForId = (annotationId: string, changes: Partial<BlueprintAnnotation>) => {
    const editId = annotationId
    // BLUEPRINT-6M — read the latest in-flight annotation (not the stale closure) and apply
    // the change optimistically to local state first, so top-level edits like color swap
    // instantly instead of waiting for the persist round-trip. Mirrors persistEditAnnotationMeta.
    const latest = allAnnotationsRef.current.find((ann) => ann.id === editId)
    if (!latest) return
    const updated = { ...latest, ...changes, updatedAt: new Date().toISOString() } as BlueprintAnnotation
    setAllAnnotations((prev) => prev.map((ann) => ann.id === editId ? updated : ann))
    void persistAnnotation(updated)
  }

  const openWireProfileManager = () => {
    if (!blueprint?.projectId) {
      showTransientSyncNotice('Wire Profiles need a project-scoped blueprint before they can open.')
      return
    }
    setIsWireProfileManagerOpen(true)
  }

  const forceCloseWireProfileManager = () => {
    setIsWireProfileManagerOpen(false)
  }

  const persistEditAnnotation = (changes: Partial<BlueprintAnnotation>) => {
    if (!editingAnnotation) return
    persistEditAnnotationForId(editingAnnotation.id, changes)
  }

  const commitElectricalPanelLabelDraft = (annotationId: string | null, rawDraft: string) => {
    const latest = annotationId ? allAnnotationsRef.current.find((ann) => ann.id === annotationId) : null
    const outcome = buildElectricalPanelLabelCommit(annotationId, rawDraft, latest?.text)
    if (!outcome.annotationId) return
    if (outcome.changed && outcome.patch) {
      persistEditAnnotationForId(outcome.annotationId, outcome.patch)
    }
    setPanelLabelDraft({ annotationId: outcome.annotationId, value: normalizeElectricalPanelLabel(rawDraft) || '', dirty: false })
  }

  const cancelElectricalPanelLabelDraft = (annotationId: string | null) => {
    const latest = annotationId ? allAnnotationsRef.current.find((ann) => ann.id === annotationId) : null
    setPanelLabelDraft({ annotationId, value: latest?.text || '', dirty: false })
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

  // BLUEPRINT-6P — freshest-read helpers for text-style edits. The edit popover handlers
  // must build patches on the LATEST in-flight annotation (allAnnotationsRef.current), not
  // the render-closure copy, so rapid multi-field edits deep-merge instead of clobbering a
  // just-applied field. Returns null / {} when nothing is being edited.
  const getLatestEditingAnnotation = (): BlueprintAnnotation | null => {
    if (!editingAnnotation) return null
    return allAnnotationsRef.current.find((ann) => ann.id === editingAnnotation.id) ?? editingAnnotation
  }
  const getLatestEditingTextStyle = (): Record<string, any> => {
    const latest = getLatestEditingAnnotation()
    return latest ? (getAnnotationMeta(latest).textStyle ?? {}) : {}
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
          // BLUEPRINT-6P — persist textBox style edits through the real save path so
          // text color / font / size / bold survive reloads. Previously this called
          // updateEditingTextBoxLocally, which only touched React state and was wiped
          // by the next loadAnnotations() drain or a page reload. Deep-merge onto the
          // freshest textStyle so a rapid follow-up edit never drops a prior field.
          const nextTextStyle = { ...getLatestEditingTextStyle(), ...patch }
          persistEditAnnotationMeta({ textStyle: nextTextStyle })
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
      const opacityPct = isEdit
        ? Math.round((eMeta.fillOpacity ?? LEGACY_SHAPE_FILL_OPACITY) * 100)
        : Math.round(shapeOptions.fillOpacity * 100)
      const currentKind = isEdit ? (eMeta.shapeKind ?? shapeKind) : shapeKind
      const electricalMetadata = getElectricalSymbolMetadata(currentKind, eMeta)
      return {
        title: 'Shape',
        primary: (
          <>
            {isEdit && electricalMetadata && (
              <div style={{ marginBottom: 6, border: '1px solid rgba(148,163,184,0.16)', borderRadius: 8, background: 'rgba(15,23,42,0.35)', padding: '6px 8px' }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.78)', fontWeight: 600 }}>
                  Symbol: {getElectricalSymbolDisplayName(currentKind, eMeta)}
                </div>
                <div style={{ marginTop: 2, fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>
                  Category: {formatElectricalSymbolCategory(electricalMetadata.category)} · Count: {getElectricalSymbolCountValue(currentKind, eMeta)}
                </div>
              </div>
            )}
            {isEdit && isLightOutputShapeKind(currentKind) && (
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
            {isEdit && isLightOutputShapeKind(currentKind) && (
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
            {isEdit && currentKind === 'electrical-recessed-light' && (
              <div style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Recessed Light Settings</div>
                <ToggleRow buttons={[
                  {
                    label: 'Emergency / Title 24',
                    active: !!eMeta.emergency,
                    onClick: () => persistEditAnnotationMeta({ emergency: !eMeta.emergency }),
                  },
                ]} />
              </div>
            )}
            {isEdit && currentKind === 'electrical-panel' && (
              <ElectricalPanelLabelControl
                value={panelLabelDraft.annotationId === editingAnnotation?.id ? panelLabelDraft.value : (editingAnnotation?.text || '')}
                onChange={(value) => setPanelLabelDraft({ annotationId: editingAnnotation?.id || null, value, dirty: true })}
                onBlur={() => {
                  if (panelLabelSuppressBlurRef.current) {
                    panelLabelSuppressBlurRef.current = false
                    return
                  }
                  commitElectricalPanelLabelDraft(panelLabelDraft.annotationId, panelLabelDraft.value)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitElectricalPanelLabelDraft(panelLabelDraft.annotationId, panelLabelDraft.value)
                    event.currentTarget.blur()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    panelLabelSuppressBlurRef.current = true
                    cancelElectricalPanelLabelDraft(panelLabelDraft.annotationId)
                    event.currentTarget.blur()
                  }
                }}
              />
            )}
            <LabeledSelect label="Shape" value={currentKind}
              options={
                isEdit && (isElectricalShapeKind(currentKind) || currentKind === 'can-light-4' || currentKind === 'can-light-6')
                  ? [
                    ...ELECTRICAL_SYMBOL_OPTIONS.map((option) => ({ label: option.label, value: option.value })),
                    ...CAN_LIGHT_TOOL_OPTIONS.map((option) => ({ label: option.label, value: option.value })),
                  ]
                  : GENERIC_SHAPE_KIND_OPTIONS
              }
              onChange={(v) => {
                if (isEdit) persistEditAnnotationMeta({ shapeKind: v, ...getElectricalSymbolMetadataStamp(v) })
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
    // ── DISTANCE + MULTI-POINT/PERIMETER MEASUREMENT (BLUEPRINT-6L/6N) ────
    // Both are open stroked paths with no enclosed area, so hatch/fill patterns do
    // not apply — we expose line color/width, endpoint style, and a stroke line
    // pattern, all of which the measurement renderer supports. Area is not handled here.
    if (tool === 'measure-distance' || tool === 'measure-perimeter') {
      const toolColorKey = tool as 'measure-distance' | 'measure-perimeter'
      const mStyle = isEdit ? (eMeta.style ?? {}) : measurementStyle
      const color = isEdit
        ? (editingAnnotation?.color ?? mStyle.lineColor ?? toolColors[toolColorKey])
        : (measurementStyle.lineColor ?? toolColors[toolColorKey])
      const lineWidth = mStyle.lineThickness ?? 2
      const endStyle = mStyle.endpointStyle ?? 'dot'
      const linePattern = mStyle.linePattern ?? 'solid'
      const patchStyle = (patch: Record<string, any>) => {
        if (isEdit) {
          const latest = allAnnotationsRef.current.find((ann) => ann.id === editingAnnotation?.id) ?? editingAnnotation
          const curStyle = (latest ? getAnnotationMeta(latest).style : null) || {}
          persistEditAnnotationMeta({ style: { ...curStyle, ...patch } })
        } else {
          setMeasurementStyle((p) => ({ ...p, ...patch }))
        }
      }
      return {
        title: tool === 'measure-perimeter' ? 'Multi-Point Measurement' : 'Distance Measurement',
        primary: (
          <>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Line Color</div>
            <ColorRow value={color} onChange={(c) => {
              // BLUEPRINT-6M — persistEditAnnotation now applies the change optimistically,
              // so the color swap is instant instead of waiting for the persist round-trip.
              if (isEdit) persistEditAnnotation({ color: c })
              else {
                // Keep measurementStyle.lineColor and the measure toolColors in sync so the
                // committed ann.color (read from toolColors) matches the popover selection.
                setMeasurementStyle((p) => ({ ...p, lineColor: c }))
                setToolColors((prev) => ({ ...prev, [toolColorKey]: c }))
              }
            }} />
            <Stepper label="Line Width" value={lineWidth} min={1} max={12} step={0.5} unit="px"
              onChange={(v) => patchStyle({ lineThickness: v })} />
          </>
        ),
        additional: (
          <>
            <LabeledSelect label="Endpoints" value={endStyle}
              options={[
                { label: 'Dot', value: 'dot' },
                { label: 'Arrow', value: 'arrow' },
                { label: 'Bar', value: 'bar' },
                { label: 'None', value: 'none' },
              ]}
              onChange={(v) => patchStyle({ endpointStyle: v })} />
            {/* BLUEPRINT-6M — line/stroke pattern (dash), directly below the endpoint control. */}
            <LabeledSelect label="Line pattern" value={linePattern}
              options={[
                { label: 'Solid', value: 'solid' },
                { label: 'Dashed', value: 'dashed' },
                { label: 'Dotted', value: 'dotted' },
                { label: 'Dash-dot', value: 'dash-dot' },
                { label: 'Long dash', value: 'long-dash' },
              ]}
              onChange={(v) => patchStyle({ linePattern: v })} />
          </>
        ),
      }
    }

    if (tool === 'callout') {
      const color = isEdit ? (editingAnnotation?.color ?? toolColors.callout) : toolColors.callout
      const tsMeta = isEdit ? (eMeta.textStyle ?? {}) : {}
      const ts = isEdit ? { ...textStyle, ...tsMeta } : textStyle
      const updateTs = (patch: Partial<typeof textStyle>) => {
        // BLUEPRINT-6P — read the freshest textStyle from allAnnotationsRef (not the
        // render-closure tsMeta) so a rapid multi-field edit deep-merges instead of
        // reverting to a stale base and dropping a just-applied field.
        if (isEdit) persistEditAnnotationMeta({ textStyle: { ...getLatestEditingTextStyle(), ...patch } })
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
        // BLUEPRINT-6P — read the freshest textStyle from allAnnotationsRef (not the
        // render-closure tsMeta) so a rapid multi-field edit deep-merges instead of
        // reverting to a stale base and dropping a just-applied field.
        if (isEdit) persistEditAnnotationMeta({ textStyle: { ...getLatestEditingTextStyle(), ...patch } })
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
      className={isFullScreenView || isTabletImmersiveFullscreen
        ? 'z-[9999] bg-[#0d0e14] flex flex-col isolate'
        : 'rounded-xl border overflow-hidden w-full relative'
      }
      style={isFullScreenView || isTabletImmersiveFullscreen
        ? {
            // HARD FULLSCREEN CONTAINMENT (Step 13B-QA7-R4). Inline styles, not
            // Tailwind classes: the previous class list combined `fixed` with
            // `relative`, and Tailwind emits `.relative` AFTER `.fixed`, so the
            // cascade resolved the "fullscreen" root to position:relative —
            // an in-flow element whose height came from its content. The zoomed
            // document therefore sized the app page (infinite page growth in
            // fullscreen). Inline position:fixed cannot lose that fight, and
            // the explicit viewport width/height + overflow hidden guarantee no
            // child can ever size this shell.
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100dvh',
            maxWidth: '100vw',
            maxHeight: '100dvh',
            overflow: 'hidden',
          }
        : { borderColor: '#1e2128', backgroundColor: '#0d0e14' }}
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
        .bv-left-toolbar button {
          min-height: 2.5rem;
        }
        /* Step 13B-QA7-R6: fullscreen overlay scroll thumb. Overlay only —
           adds no layout width, so document size never changes and there is
           no hover reflow. Widens on hover/active for an easier grab target. */
        .bv-fs-scroll-thumb {
          width: 8px;
          background: rgba(148,163,184,0.55);
          border-radius: 9999px;
          transition: width 0.12s ease, background-color 0.12s ease;
          cursor: grab;
          touch-action: none;
        }
        .bv-fs-scroll-thumb:hover,
        .bv-fs-scroll-thumb:active {
          width: 14px;
          background: rgba(191,206,224,0.9);
          cursor: grabbing;
        }
      `}</style>

      {syncNotice && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-[100050] w-[min(92vw,640px)] -translate-x-1/2 rounded-md border border-amber-500/40 bg-amber-950/90 px-3 py-2 text-xs text-amber-100 shadow-lg">
          {syncNotice}
        </div>
      )}

      {/* Step 13B-QA7-R6: fullscreen overlay scroll handle. Absolute overlay on
          the fixed fullscreen root (so it never affects document width / fit
          scale and never reflows on hover). Controls ONLY the fullscreen
          vertical content scroller (document work-screen ⇄ annotations below),
          never the inner PDF zoom/pan scroller. Hidden unless that content
          overflows. Right edge, so it stays clear of the top tools and the
          bottom-centered Move/Edit/Copy/Delete toolbar. */}
      {fsRail.show && (
        <div
          className="absolute z-[100045]"
          style={{ top: fsRail.top, right: 4, height: fsRail.height, width: 16, display: 'flex', justifyContent: 'flex-end' }}
        >
          <div
            role="scrollbar"
            aria-orientation="vertical"
            aria-label="Scroll between document and annotations"
            className="bv-fs-scroll-thumb absolute"
            style={{ top: fsRail.thumbTop - fsRail.top, height: fsRail.thumbH, right: 0 }}
            onPointerDown={handleFsThumbPointerDown}
            onPointerMove={handleFsThumbPointerMove}
            onPointerUp={handleFsThumbPointerUp}
            onPointerCancel={handleFsThumbPointerUp}
          />
        </div>
      )}

      {/* Circuit Path / Polyline active-mode Stop button — viewport-fixed (not page-anchored)
          so it stays reachable at any zoom/pan level, including 1000%, and is easy to tap on
          iPad. Step 13B-QA5 Part 4. */}
      {effectiveTool === 'shape' && isMultiPointShapeKind(shapeKind) && (
        <div className="pointer-events-none absolute left-1/2 bottom-4 z-[100050] -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-cyan-500/50 bg-[#0f1624]/95 px-4 py-2 shadow-2xl">
            <span className="text-xs text-cyan-200">
              {shapeKind === 'circuit-arc' ? 'Circuit Arc Path' : shapeKind === 'circuit-path' ? 'Circuit Path' : 'Polyline'} — {pathDraftPoints.length} point{pathDraftPoints.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={finalizePathDraft}
              disabled={pathDraftPoints.length < 2}
              title="Or press Spacebar"
              className="inline-flex items-center gap-1.5 rounded-full bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check size={12} /> {shapeKind === 'circuit-arc' ? 'Stop Circuit Arc' : shapeKind === 'circuit-path' ? 'Stop Circuit Path' : 'Stop Drawing'}
            </button>
            <button
              type="button"
              onClick={() => {
                pathDraftRef.current = []
                setPathDraftPoints([])
                setPathCursorPx(null)
              }}
              className="inline-flex items-center gap-1 rounded-full border border-gray-600 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-white/5"
            >
              <X size={12} /> Cancel
            </button>
          </div>
        </div>
      )}

      {/* Multi-Point Measure (Perimeter) active-mode Stop button + live running total.
          Step 13B-QA5 Part 3/4. */}
      {effectiveTool === 'measure-perimeter' && !calibrateInput && measureDraftPoints.length > 0 && (
        <div className="pointer-events-none absolute left-1/2 bottom-4 z-[100050] -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-orange-500/50 bg-[#0f1624]/95 px-4 py-2 shadow-2xl">
            <span className="text-xs text-orange-200">
              {measurePathLiveTotal?.realLength != null
                ? `Total: ${formatArchitecturalLength(measurePathLiveTotal.realLength, measurePathLiveTotal.unit)}`
                : `${measureDraftPoints.length} point${measureDraftPoints.length === 1 ? '' : 's'} — not calibrated`}
            </span>
            <button
              type="button"
              onClick={() => {
                const pts = [...measureDraftRef.current]
                if (pts.length >= 2) {
                  setMeasurePendingCommit({ type: 'measure-perimeter', points: pts, pageNumber: currentPageRef.current })
                }
                measureDraftRef.current = []
                setMeasureDraftPoints([])
                setMeasureCursorPx(null)
                lastMeasureClickRef.current = { time: 0, nx: 0, ny: 0 }
              }}
              disabled={measureDraftPoints.length < 2}
              className="inline-flex items-center gap-1.5 rounded-full bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check size={12} /> Stop Measuring
            </button>
            <button
              type="button"
              onClick={() => {
                measureDraftRef.current = []
                setMeasureDraftPoints([])
                setMeasureCursorPx(null)
                lastMeasureClickRef.current = { time: 0, nx: 0, ny: 0 }
              }}
              className="inline-flex items-center gap-1 rounded-full border border-gray-600 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-white/5"
            >
              <X size={12} /> Cancel
            </button>
          </div>
        </div>
      )}

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
            <button
              type="button"
              onClick={openWireProfileManager}
              disabled={!blueprint?.projectId}
              className="shrink-0 inline-flex min-h-10 items-center justify-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-700 text-gray-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              title={blueprint?.projectId ? 'Manage wire profiles' : 'Wire Profiles need a project id'}
              aria-label="Manage wire profiles"
            >
              <Cable size={12} />
              <span className="hidden sm:inline">Wire Profiles</span>
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
                <button
                  type="button"
                  onClick={openWireProfileManager}
                  disabled={!blueprint?.projectId}
                  className="shrink-0 inline-flex min-h-10 items-center justify-center gap-1 rounded-md border border-gray-700 px-2 text-xs text-gray-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  title={blueprint?.projectId ? 'Manage wire profiles' : 'Wire Profiles need a project id'}
                  aria-label="Manage wire profiles"
                >
                  <Cable size={12} />
                  <span className="hidden sm:inline">Wire Profiles</span>
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
            className={useDesktopThreePaneLayout ? `grid grid-rows-[auto_auto_minmax(0,1fr)] p-4${draggingDivider ? ' select-none' : ''}` : isTabletImmersiveFullscreen || isFullScreenView ? 'flex-1 flex flex-col min-h-0' : ''}
            style={useDesktopThreePaneLayout ? {
              gridTemplateColumns: `${leftPaneWidth}px 6px 1fr 6px ${rightPaneWidth}px`,
              columnGap: 0,
              rowGap: 16,
              minHeight: isFullScreenView && isDesktopBlueprintLayout ? 'calc(100vh - 52px)' : isTabletImmersiveFullscreen ? 'calc(100vh - 40px)' : normalBlueprintViewerMinHeight,
              height: isFullScreenView && isDesktopBlueprintLayout ? 'calc(100vh - 52px)' : isTabletImmersiveFullscreen ? 'calc(100vh - 40px)' : 'auto',
            } : undefined}
          >
            {useDesktopThreePaneLayout && (
              <div ref={pageIndexRef} className="col-start-1 row-start-2 self-start rounded-xl border border-gray-800 bg-[#10131c] p-4 space-y-3">
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
                <button
                  type="button"
                  disabled={!canRender}
                  onClick={() => setPageIndexOpen((open) => !open)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50 ${pageIndexOpen ? 'border-blue-500/60 bg-blue-900/20' : 'border-gray-700/50 bg-gray-900/40 hover:border-gray-600 hover:bg-gray-900/70'}`}
                  title="Open visual page index"
                  aria-haspopup="dialog"
                  aria-expanded={pageIndexOpen}
                >
                  <span className="text-xs text-gray-400">Page</span>
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-200">
                    {pageLabel}
                    <ChevronDown size={14} className={pageIndexOpen ? 'rotate-180 text-blue-300 transition-transform' : 'text-gray-500 transition-transform'} />
                  </span>
                </button>

                {pageIndexOpen && (
                  <div
                    role="dialog"
                    aria-label="Document page index"
                    className="rounded-xl border border-gray-700 bg-[#111621] p-3 shadow-xl"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-100">Pages</p>
                        <p className="text-[11px] text-gray-500">Select a preview to jump</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPageIndexOpen(false)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white"
                        aria-label="Close page index"
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <div className="grid max-h-[min(62vh,560px)] grid-cols-1 gap-3 overflow-y-auto pr-1">
                      {Array.from({ length: numPages || 0 }, (_, index) => index + 1).map((pageNumber) => (
                        <BlueprintPageThumbnail
                          key={pageNumber}
                          pdfDoc={pdfDocRef.current || pdfDoc}
                          pageNumber={pageNumber}
                          isActive={pageNumber === currentPage}
                          onSelect={() => {
                            setCurrentPage(pageNumber)
                            setPageInput(String(pageNumber))
                            setPageIndexOpen(false)
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}

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
              ? 'bv-left-toolbar col-start-1 row-start-3 self-start rounded-xl border border-gray-800 bg-[#10131c] p-4 space-y-2'
              : 'px-3 sm:px-4 py-1 border-b border-gray-800 space-y-1 flex-shrink-0'}
          >
            <div className={`flex items-center gap-1.5 ${useDesktopThreePaneLayout ? 'border-b border-gray-800 pb-2' : 'overflow-x-auto'}`}>
              <button
                type="button"
                disabled={!activeUndoCommand || annotationHistoryInteractionBlocked}
                onClick={() => void applyAnnotationHistory('undo')}
                className="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border border-gray-700 px-2 text-xs text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                title={activeUndoCommand ? `Undo: ${activeUndoCommand.label} (Ctrl+Z)` : 'Nothing to undo'}
                aria-label={activeUndoCommand ? `Undo ${activeUndoCommand.label}` : 'Nothing to undo'}
              >
                <Undo2 size={13} /> Undo
              </button>
              <button
                type="button"
                disabled={!activeRedoCommand || annotationHistoryInteractionBlocked}
                onClick={() => void applyAnnotationHistory('redo')}
                className="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border border-gray-700 px-2 text-xs text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                title={activeRedoCommand ? `Redo: ${activeRedoCommand.label} (Ctrl+Y / Ctrl+Shift+Z)` : 'Nothing to redo'}
                aria-label={activeRedoCommand ? `Redo ${activeRedoCommand.label}` : 'Nothing to redo'}
              >
                <Redo2 size={13} /> Redo
              </button>
            </div>

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
              <div className="flex flex-col gap-2 pt-0.5">
                <div className={`${useDesktopThreePaneLayout ? 'grid grid-cols-2' : `flex flex-nowrap overflow-x-auto bv-tool-bucket${isTabletImmersiveFullscreen ? ' justify-center' : ''}`} gap-1.5`}>
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
                  ><Shapes size={12} /> Shapes{toolMode === 'shape' && <span className="text-gray-400 text-[10px] ml-0.5">({getShapeKindLabel(shapeKind)})</span>}</button>
                  <button
                    onClick={() => {
                      // Manual tool selection remains Unassigned — clear preset-only binding.
                      clearActiveQuickAccessSession()
                      setToolMode('shape')
                      setShapeKind('circuit-path')
                      setOpenPopover(null)
                    }}
                    className={`w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${toolMode === 'shape' && shapeKind === 'circuit-path' ? 'border-cyan-500 text-cyan-300 bg-cyan-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                    title="Click multiple symbols/points to connect them, then Stop Circuit Path"
                  ><Waypoints size={12} /> Circuit Path</button>
                  <button
                    onClick={() => {
                      clearActiveQuickAccessSession()
                      setToolMode('shape')
                      setShapeKind('circuit-arc')
                      setOpenPopover(null)
                    }}
                    className={`w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${toolMode === 'shape' && shapeKind === 'circuit-arc' ? 'border-cyan-500 text-cyan-300 bg-cyan-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                    title="Like Circuit Path, but each run is drawn as a curve with its own draggable curvature handle"
                  ><Spline size={12} /> Circuit Arc</button>
                  <button
                    type="button"
                    onClick={() => setShowCircuitMeasurementLabels((v) => !v)}
                    aria-pressed={showCircuitMeasurementLabels}
                    className={`w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${showCircuitMeasurementLabels ? 'border-gray-700 text-gray-300 hover:text-white' : 'border-amber-500 text-amber-300 bg-amber-900/20'}`}
                    title={showCircuitMeasurementLabels ? 'Hide Circuit Path and Circuit Arc measurement labels' : 'Show Circuit Path and Circuit Arc measurement labels'}
                  >
                    {showCircuitMeasurementLabels ? <Eye size={12} /> : <EyeOff size={12} />}
                    Circuit Labels {showCircuitMeasurementLabels ? 'On' : 'Off'}
                  </button>
                </div>
                <div className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">Electrical Symbols</div>
                  <div className={`${useDesktopThreePaneLayout ? 'grid grid-cols-2' : `flex flex-nowrap overflow-x-auto bv-tool-bucket${isTabletImmersiveFullscreen ? ' justify-center' : ''}`} gap-1.5`}>
                    {CAN_LIGHT_TOOL_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setToolMode('shape')
                          setShapeKind(option.value)
                          setOpenPopover(null)
                        }}
                        className={`w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${toolMode === 'shape' && shapeKind === option.value ? 'border-cyan-500 text-cyan-300 bg-cyan-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                        title={`Place ${option.label}`}
                      >
                        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-current px-1 text-[9px] font-semibold leading-none">{option.shortLabel}</span>
                        <span className="truncate">{option.label}</span>
                      </button>
                    ))}
                    {ELECTRICAL_SYMBOL_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setToolMode('shape')
                          setShapeKind(option.value)
                          setOpenPopover(null)
                        }}
                        className={`w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${toolMode === 'shape' && shapeKind === option.value ? 'border-cyan-500 text-cyan-300 bg-cyan-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                        title={`Place ${option.label}`}
                      >
                        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-current px-1 text-[9px] font-semibold leading-none">{option.shortLabel}</span>
                        <span className="truncate">{option.label}</span>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setElectricalSymbolLabelsVisible((v) => !v)}
                    className={`w-full inline-flex items-center justify-center gap-1.5 h-8 text-xs px-2 rounded-md border ${electricalSymbolLabelsVisible ? 'border-gray-700 text-gray-300 hover:text-white' : 'border-amber-500 text-amber-300 bg-amber-900/20'}`}
                    title={electricalSymbolLabelsVisible ? 'Hide electrical symbol corner labels' : 'Show electrical symbol corner labels'}
                  >
                    {electricalSymbolLabelsVisible ? <EyeOff size={12} /> : <Eye size={12} />}
                    {electricalSymbolLabelsVisible ? 'Hide Labels' : 'Show Labels'}
                  </button>
                  <button
                    ref={symbolSizeButtonRef}
                    type="button"
                    onClick={openSymbolSizePanel}
                    className={`w-full inline-flex items-center justify-center gap-1.5 h-8 text-xs px-2 rounded-md border ${isSymbolSizePanelOpen ? 'border-cyan-500 text-cyan-300 bg-cyan-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                    title="Adjust symbol LABEL text size (does not resize symbols)"
                  >
                    <Type size={12} /> Symbols Size ({Math.round(symbolLabelScale * 100)}%)
                  </button>
                </div>
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
                  onClick={() => {
                    setAlignmentGuidesEnabled((v) => {
                      const next = !v
                      if (!next) clearAlignmentGuides()
                      return next
                    })
                  }}
                  className={`w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${alignmentGuidesEnabled ? 'border-cyan-500 text-cyan-300 bg-cyan-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                  title={alignmentGuidesEnabled ? 'Turn off visual placement guide lines' : 'Turn on visual placement guide lines'}
                >
                  <Crosshair size={12} />
                  {alignmentGuidesEnabled ? 'Guide Assist On' : 'Guide Assist'}
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
                      <div className="text-[10px] text-orange-300/70">Multiple scales found — pick one or calibrate manually:</div>
                      {detectedResult.candidates.map((c, i) => (
                        <button key={i} type="button"
                          onClick={() => setSavedCalibrations(prev => ({
                            ...prev,
                            [currentPage]: buildScaleCalibration(
                              currentPage,
                              c.realWidthFeet,
                              getPageSizeInches(currentPage),
                              new Date().toISOString(),
                              'selected-scale',
                            ),
                          }))}
                          className="text-left text-[10px] px-2 py-0.5 rounded border border-orange-700/60 text-orange-300 hover:bg-orange-900/20 truncate"
                        >{c.parsedScale}</button>
                      ))}
                    </div>
                  )}
                  {scaleScanStatus === 'scanning' && (
                    <div className="mt-0.5 text-[10px] text-gray-500">
                      Scanning scales… {scaleScanProgress.done}/{scaleScanProgress.total}
                    </div>
                  )}
                  {scaleScanStatus === 'complete' && scaleScanProgress.total > 0 && (
                    <div className="mt-0.5 text-[10px] text-gray-600">
                      Scale scan complete — {scaleScanDiagnostics.pagesMatched} of {scaleScanProgress.total} pages matched
                    </div>
                  )}
                  <div className="mt-0.5 text-[10px] text-gray-500">
                    Current page scale scan: {getScaleScanPageReasonLabel(
                      scaleScanDiagnostics.pageByNumber[currentPage]?.reason ?? 'not-scanned'
                    )}
                  </div>
                </div>

                {/* Calibrate tool */}
                <button
                  onClick={() => { setToolMode('calibrate'); setOpenPopover(null) }}
                  className={`${useDesktopThreePaneLayout ? 'col-span-2' : 'w-full'} w-full inline-flex items-center gap-1.5 h-8 text-xs px-2 rounded-md border ${toolMode === 'calibrate' ? 'border-sky-500 text-sky-300 bg-sky-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                ><Crosshair size={12} /> Calibrate known distance</button>

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
                  title="Click multiple points to measure total path distance, then Stop Measuring"
                ><Shapes size={12} /> Multi-Point / Perimeter</button>

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

                {/* ── Measurement Labels (visual-only): hide/show, size, and color for NEW
                    measurements. Separate from electrical symbol label controls. None of
                    these persist or trigger an annotation save. ── */}
                <div className={`${useDesktopThreePaneLayout ? 'col-span-2' : 'w-full'} rounded-md border border-gray-800 bg-gray-900/30 px-2 py-2 space-y-1.5`}>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">Measurement Labels</div>
                  <button
                    type="button"
                    onClick={() => setMeasurementLabelsVisible((v) => !v)}
                    className={`w-full inline-flex items-center justify-center gap-1.5 h-8 text-xs px-2 rounded-md border ${measurementLabelsVisible ? 'border-gray-700 text-gray-300 hover:text-white' : 'border-amber-500 text-amber-300 bg-amber-900/20'}`}
                    title={measurementLabelsVisible ? 'Hide measurement labels (lines and endpoints stay visible)' : 'Show measurement labels'}
                  >
                    {measurementLabelsVisible ? <EyeOff size={12} /> : <Eye size={12} />}
                    {measurementLabelsVisible ? 'Hide Labels' : 'Show Labels'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsMeasurementSizePanelOpen((v) => !v)}
                    className={`w-full inline-flex items-center justify-center gap-1.5 h-8 text-xs px-2 rounded-md border ${isMeasurementSizePanelOpen ? 'border-cyan-500 text-cyan-300 bg-cyan-900/20' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                    title="Adjust measurement LABEL text size (does not resize lines, endpoints, or symbols)"
                  >
                    <Type size={12} /> Measurement Labels Size ({Math.round(measurementLabelScale * 100)}%)
                  </button>
                  {isMeasurementSizePanelOpen && (
                    <div className="px-0.5 pt-0.5">
                      <input
                        type="range"
                        min={0.75}
                        max={5}
                        step={0.05}
                        value={measurementLabelScale}
                        onChange={(e) => setMeasurementLabelScale(Number(e.target.value))}
                        className="w-full accent-cyan-400"
                        aria-label="Measurement label size"
                      />
                      <div className="flex items-center justify-between text-[10px] text-gray-500">
                        <span>75%</span>
                        <span className="text-gray-300">{Math.round(measurementLabelScale * 100)}%</span>
                        <span>500%</span>
                      </div>
                    </div>
                  )}
                  <label className="w-full inline-flex items-center justify-between gap-2 h-8 px-2 rounded-md border border-gray-700 text-xs text-gray-300">
                    <span>Measurement Color</span>
                    <input
                      type="color"
                      value={measurementColor}
                      onChange={(e) => {
                        const c = e.target.value
                        // Scoped to measurement tools only; affects NEW measurements. Existing
                        // annotations are not touched (they change only via the edit popover).
                        setMeasurementColor(c)
                        setMeasurementStyle((p) => ({ ...p, lineColor: c }))
                        setToolColors((prev) => ({ ...prev, 'measure-distance': c, 'measure-area': c, 'measure-perimeter': c }))
                      }}
                      className="h-5 w-8 cursor-pointer rounded border border-gray-600 bg-transparent p-0"
                      title="Color for NEW distance / multi-point measurements"
                    />
                  </label>
                </div>

                <button
                  type="button"
                  onClick={handleRescanScales}
                  disabled={scaleScanStatus === 'scanning'}
                  className={`${useDesktopThreePaneLayout ? 'col-span-2' : 'w-full'} w-full inline-flex items-center justify-center gap-1.5 h-8 text-xs px-2 rounded-md border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600 disabled:opacity-50`}
                >Rescan scales</button>

                <details className={`${useDesktopThreePaneLayout ? 'col-span-2' : 'w-full'} rounded-md border border-gray-800 bg-gray-900/30 px-2 py-1.5 text-[10px] text-gray-500`}>
                  <summary className="cursor-pointer text-gray-400 hover:text-gray-300 select-none">Scale scan details</summary>
                  <div className="mt-1.5 space-y-0.5 leading-snug">
                    <div>Scanned: {scaleScanDiagnostics.pagesScanned} / {scaleScanDiagnostics.totalPages || scaleScanProgress.total || numPages || 0}</div>
                    <div>Text layer found: {scaleScanDiagnostics.pagesWithText}</div>
                    <div>Contains &quot;SCALE&quot;: {scaleScanDiagnostics.pagesWithScaleWord}</div>
                    <div>Contains &quot;1/4&quot;: {scaleScanDiagnostics.pagesWithQuarterScaleToken}</div>
                    <div>Matched: {scaleScanDiagnostics.pagesMatched}</div>
                    <div>Ambiguous: {scaleScanDiagnostics.pagesAmbiguous}</div>
                    <div>N.T.S.: {scaleScanDiagnostics.pagesNts}</div>
                    <div>No text: {scaleScanDiagnostics.pagesNoText}</div>
                    <div>Text but no match: {scaleScanDiagnostics.pagesTextNoMatch}</div>
                    {scaleScanDiagnostics.pageByNumber[currentPage] && (
                      <div className="mt-1 pt-1 border-t border-gray-800 space-y-0.5">
                        <div className="text-gray-400">Page {currentPage}</div>
                        <div>Text items: {scaleScanDiagnostics.pageByNumber[currentPage].textItemCount}</div>
                        <div>Contains SCALE: {scaleScanDiagnostics.pageByNumber[currentPage].hasScaleWord ? 'yes' : 'no'}</div>
                        <div>Contains 1/4: {scaleScanDiagnostics.pageByNumber[currentPage].hasQuarterToken ? 'yes' : 'no'}</div>
                        {scaleScanDiagnostics.pageByNumber[currentPage].normalizedSample && (
                          <div className="break-all text-gray-600">
                            Sample: {scaleScanDiagnostics.pageByNumber[currentPage].normalizedSample}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </details>

                <p className={`${useDesktopThreePaneLayout ? 'col-span-2' : 'w-full'} text-[11px] text-gray-500 leading-snug`}>
                  Calibrate first, then draw measurements. Calibration is per-page.
                </p>
              </div>
            )}

            {useDesktopThreePaneLayout && (
              <div className="mt-3 border-t border-gray-800 pt-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-gray-100">Quick Access</div>
                    <div className="text-[10px] text-gray-500">Tool presets for the next placement</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openQuickAccessSettings(quickAccessPresets.findIndex(Boolean) >= 0 ? quickAccessPresets.findIndex(Boolean) : 0)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-700 text-gray-400 transition-colors hover:border-gray-500 hover:text-white"
                    title="Quick Access settings"
                    aria-label="Quick Access settings"
                  >
                    <Settings size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={openWireProfileManager}
                    disabled={!blueprint?.projectId}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-gray-700 px-2.5 text-xs font-medium text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    title={blueprint?.projectId ? 'Manage wire profiles' : 'Wire Profiles need a project id'}
                    aria-label="Manage wire profiles"
                  >
                    <Cable size={14} />
                    Wire Profiles
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {quickAccessPresets.map((preset, index) => (
                    <button
                      key={`quick-access-slot-${index + 1}`}
                      type="button"
                      onClick={() => preset ? applyQuickAccessPreset(preset, index) : openQuickAccessSettings(index)}
                      className={`relative flex min-h-11 min-w-0 items-center gap-2 rounded-md border px-2 py-2 text-left transition-colors ${preset ? 'border-gray-700 bg-gray-900/40 text-gray-200 hover:border-blue-500/60 hover:bg-blue-900/15' : 'border-dashed border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300'}`}
                      title={(() => {
                        if (!preset) return `Configure Slot ${index + 1}`
                        if (!supportsWireProfileAssignment({ toolType: preset.toolType, toolVariant: preset.toolVariant })) {
                          return `Activate ${preset.label}`
                        }
                        const display = resolveQuickAccessWireProfileDisplay(readProjectQuickAccessBinding(index), projectWireProfiles)
                        return `Activate ${preset.label} — ${display.label}`
                      })()}
                    >
                      {preset ? (
                        <>
                          <span className="shrink-0 text-gray-400">{quickAccessIcon(preset)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[9px] uppercase tracking-wide text-gray-500">Slot {index + 1}</span>
                            <span className="block truncate text-[11px] font-medium">{preset.label}</span>
                            {supportsWireProfileAssignment({ toolType: preset.toolType, toolVariant: preset.toolVariant }) && (
                              <span className="block truncate text-[10px] text-gray-500">
                                {resolveQuickAccessWireProfileDisplay(readProjectQuickAccessBinding(index), projectWireProfiles).label}
                              </span>
                            )}
                          </span>
                          {preset.color && (
                            <span className="h-3 w-3 shrink-0 rounded-full border border-white/30" style={{ backgroundColor: preset.color }} />
                          )}
                        </>
                      ) : (
                        <span className="truncate text-[11px]">+ Slot {index + 1}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {useDesktopThreePaneLayout && (
          <div className="col-start-1 row-start-1 self-start rounded-xl border border-gray-800 bg-[#10131c] p-4 space-y-3">
            {/* Row 1: page navigation, visual page index, and page selection only. */}
            <div className="flex items-center gap-2">
              <button
                disabled={!canRender || currentPage <= 1 || isRendering}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-700 bg-gray-900/40 text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:opacity-40"
                title="Previous page"
                aria-label="Previous page"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                disabled={!canRender || currentPage >= numPages || isRendering}
                onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-700 bg-gray-900/40 text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:opacity-40"
                title="Next page"
                aria-label="Next page"
              >
                <ChevronRight size={18} />
              </button>

              <div ref={pageIndexTriggerRef} className="min-w-0 flex-1">
                <div className="flex h-10 items-center rounded-lg border border-gray-700 bg-gray-900/40 focus-within:border-blue-500/70">
                  <input
                    value={pageInput}
                    onChange={(e) => setPageInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { jumpToPage(); setPageIndexOpen(false) } }}
                    className="min-w-0 w-full bg-transparent px-2 text-center text-sm font-semibold tabular-nums text-gray-100 outline-none"
                    placeholder="1"
                    title="Enter page number"
                    aria-label="Page number"
                  />
                  <span className="shrink-0 text-xs text-gray-500">/ {numPages || 1}</span>
                  <button
                    type="button"
                    disabled={!canRender}
                    onClick={() => setPageIndexOpen((open) => !open)}
                    className="inline-flex h-full w-9 shrink-0 items-center justify-center rounded-r-lg text-gray-400 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40"
                    title="Open visual page index"
                    aria-label="Open visual page index"
                    aria-haspopup="dialog"
                    aria-expanded={pageIndexOpen}
                  >
                    <ChevronDown size={16} className={pageIndexOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
                  </button>
                </div>
              </div>

              <button
                disabled={!canRender}
                onClick={toggleCurrentPageSelection}
                className={`inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${isCurrentPageSelected ? 'border-amber-500/60 text-amber-300 bg-amber-900/20' : 'border-gray-700 text-gray-300 hover:border-gray-500 hover:text-white'}`}
                title={isCurrentPageSelected ? 'Remove from selection' : 'Add to selection'}
              >
                {isCurrentPageSelected ? <Check size={14} /> : <span className="text-base leading-none">+</span>}
                <span>{isCurrentPageSelected ? 'Selected' : 'Add'}</span>
                <span className="text-[10px] text-gray-500">{selectedPageNumbers.length}</span>
              </button>
            </div>

            {/* Row 2: zoom, fit, lock, and fullscreen only. */}
            <div className="flex items-center gap-2">
              {/* Zoom & View */}
              <div className="inline-flex h-11 min-w-0 flex-1 items-center justify-between rounded-lg border border-gray-700/50 bg-gray-900/40 p-1">
                <button
                  disabled={!canRender || relativeZoom <= MIN_RELATIVE_ZOOM}
                  onClick={() => applyRelativeZoomDelta(-0.1)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-transparent text-gray-300 hover:border-gray-600 hover:text-white disabled:opacity-40 transition-colors"
                  title="Zoom out"
                  aria-label="Zoom out"
                >
                  <ZoomOut size={16} />
                </button>
                <span className="px-1 text-xs font-semibold tabular-nums text-gray-300">{Math.round(clampRelativeZoom(relativeZoom) * 100)}%</span>
                <button
                  disabled={!canRender || relativeZoom >= maxRelativeZoom}
                  onClick={() => applyRelativeZoomDelta(0.1)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-transparent text-gray-300 hover:border-gray-600 hover:text-white disabled:opacity-40 transition-colors"
                  title="Zoom in"
                  aria-label="Zoom in"
                >
                  <ZoomIn size={16} />
                </button>
              </div>

              {/* Fit & Lock */}
              <button
                onClick={() => {
                  pendingScrollResetRef.current = true
                  setRelativeZoom(1)
                }}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-blue-500/60 bg-blue-900/20 text-blue-300 transition-colors hover:border-blue-500 hover:bg-blue-900/30"
                title="Fit page to view"
                aria-label="Fit page to view"
              >
                <ArrowUpRight size={16} />
              </button>

              <button
                onClick={() => setLockView((v) => !v)}
                className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition-colors ${lockView ? 'border-blue-500/60 text-blue-300 bg-blue-900/20 hover:border-blue-500 hover:bg-blue-900/30' : 'border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white'}`}
                title={lockView ? 'Unlock view' : 'Lock view'}
                aria-label={lockView ? 'Unlock view' : 'Lock view'}
              >
                {lockView ? <Lock size={16} /> : <Unlock size={16} />}
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
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-gray-700 text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
                title={isFullScreenView || isTabletImmersiveFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                aria-label={isFullScreenView || isTabletImmersiveFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              >
                {isFullScreenView || isTabletImmersiveFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
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

          {/* Fullscreen (Step 13B-QA7-R5): this wrapper is the ONE internal
              vertical scroller inside the fixed fullscreen shell. The first
              "screen" of its content is the document scroll area at exactly
              100% of the scroller's height (tools pinned above, document
              filling everything else); the annotations panel flows BELOW that
              first screen, reached by scrolling down — it never steals height
              from the document. The zoomed PDF spacer stays trapped inside the
              inner operations-pdf-scroll area only. */}
          <div
            ref={fullscreenScrollerRef}
            onScroll={fsStackedFullscreen ? updateFsRail : undefined}
            className={useDesktopThreePaneLayout ? 'contents' : isTabletImmersiveFullscreen ? 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden' : isFullScreenView ? 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2 sm:p-4' : 'p-2'}
            style={!useDesktopThreePaneLayout && (isTabletImmersiveFullscreen || isFullScreenView) ? { overscrollBehavior: 'contain' } : undefined}
          >
            {/* Default (non-fullscreen, non-desktop-three-pane) mode is a single
                column: tools on top, document in the middle, annotations panel at
                the BOTTOM. The previous xl: side-column variant here was only
                reachable on iPad-Pro-landscape widths (every non-iPad browser
                >=1280px takes the desktop three-pane branch instead), so it moved
                annotations to a right sidebar on exactly those iPads — breaking
                the accepted iPad layout. Removed per Step 13B-QA7-R. */}
            {/* Fullscreen: 'contents' — the PDF scroll area and annotations
                panel must be box-children of the vertical scroller above, so
                the scroll area's height:100% resolves against the scroller's
                definite height (one full work screen) and annotations flow
                below it. The old 'flex flex-col' here made document +
                annotations SPLIT the same visible height, shrinking the
                document by up to 38vh when the drawer was open. */}
            <div className={useDesktopThreePaneLayout ? 'contents' : isTabletImmersiveFullscreen || isFullScreenView ? 'contents' : 'grid grid-cols-1 gap-3 sm:gap-4'}>
              <style>{`
                .operations-pdf-scroll::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
              `}</style>
              <div
                ref={scrollAreaRef}
                className={`${useDesktopThreePaneLayout ? 'col-start-3 row-start-1 row-span-3 min-h-0 min-w-0 bg-[#0d0e14]' : ''} operations-pdf-scroll ${lockView ? 'overflow-hidden' : 'overflow-scroll'} ${(isFullScreenView || isTabletImmersiveFullscreen) && !useDesktopThreePaneLayout ? 'h-full w-full max-w-full min-h-0 min-w-0 max-h-none' : !useDesktopThreePaneLayout ? 'min-h-[320px] sm:min-h-[360px] lg:min-h-[400px]' : ''} rounded border border-gray-800`}
                style={{
                  // Dynamic height: fills from bottom of toolbar to bottom of viewport.
                  // Falls back to calc(100vh-300px) until toolbarAreaRef is measured.
                  ...(useDesktopThreePaneLayout
                    ? { height: isFullScreenView && isDesktopBlueprintLayout ? 'calc(100dvh - 52px - 32px - 16px)' : isTabletImmersiveFullscreen ? 'calc(100dvh - 40px - 32px - 16px)' : normalBlueprintViewerMinHeight }
                    : isFullScreenView || isTabletImmersiveFullscreen
                      ? {}
                      : {
                        // scrollAreaHeight is measured as innerHeight - toolbar
                        // bottom; if the page was scrolled past the toolbar at
                        // measure time that value EXCEEDS the viewport, growing
                        // the page (and iOS URL-bar resize events re-trigger the
                        // measurement — runaway growth). min()/maxHeight clamp
                        // the document viewport to the visible viewport so only
                        // the scroll area ever scrolls, never the app page.
                        height: scrollAreaHeight > 100
                          ? `min(${scrollAreaHeight - 16}px, calc(100dvh - 140px))`
                          : 'calc(100dvh - 300px)',
                        maxHeight: 'calc(100dvh - 140px)',
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
                    width: visualDisplayWidth ? Math.max(visualDisplayWidth, viewportWidth || 0) : '100%',
                    minHeight: visualDisplayHeight || '100%',
                  }}
                >
                  <div
                    ref={pageFrameRef}
                    className="relative"
                    style={{
                      width: visualDisplayWidth || undefined,
                      height: visualDisplayHeight || undefined,
                    }}
                  >
                    <canvas
                      ref={canvasRef}
                      className="absolute left-0 top-0 border border-gray-800 bg-white shadow-lg block"
                      style={{
                        width: overlayVisualW || '100%',
                        height: overlayVisualH || '100%',
                      }}
                    />
                    <div
                    ref={overlayRef}
                    className={`absolute left-0 top-0 ${cursorClass}`}
                    style={{
                      width: overlayVisualW || undefined,
                      height: overlayVisualH || undefined,
                    }}
                    onPointerDownCapture={handleAnnotationSelectCapture}
                    onClick={handleOverlayClick}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerCancel}
                  >
                      {canvasPageAnnotations.map((a) => {
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
                          if (animationRouteBuilder) {
                            e.preventDefault()
                            e.stopPropagation()
                            return
                          }
                          // Package Pick mode: selection toggling is handled once on pointerdown by
                          // handleAnnotationSelectCapture. Here we only block the normal click-select /
                          // move / edit behaviour so the item is never accidentally focused or moved.
                          if (isPackagePickMode) {
                            e.preventDefault()
                            e.stopPropagation()
                            return
                          }

                          // Arc Line / Polyline / Circuit Path placement must be able to draw on top of
                          // existing annotations — let the event bubble through untouched to the canvas
                          // draw handlers.
                          if (effectiveTool === 'shape' && (shapeKind === 'arch-line' || isMultiPointShapeKind(shapeKind))) return

                          // BLUEPRINT-6L — measure/calibrate tools are in draw mode: let taps on
                          // existing measurements pass through to the canvas draw handlers.
                          if (effectiveTool === 'measure-distance' || effectiveTool === 'measure-area' || effectiveTool === 'measure-perimeter' || effectiveTool === 'calibrate') return

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
                              <svg className="absolute inset-0 overflow-visible" {...pageOverlaySvgProps}>
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
                          const fillOpacity = meta.fillOpacity ?? LEGACY_SHAPE_FILL_OPACITY
                          const hatchPattern = meta.hatchPattern || 'none'
                          if (kind === 'line' || kind === 'arrow') {
                            // Clamped rect, matching the layout box — see circuit-arc below.
                            const lineRect = rect
                            const hasAbs = meta.lineAbsX1 != null && meta.lineAbsY1 != null && meta.lineAbsX2 != null && meta.lineAbsY2 != null
                            // Step 12C: edited lines render from absolute page-normalized
                            // endpoints. Legacy lines fall back to relative endpoints.
                            const l1x = hasAbs ? (Number(meta.lineAbsX1) - lineRect.x) / Math.max(lineRect.w, 0.0001) : (meta.lineX1 ?? 0)
                            const l1y = hasAbs ? (Number(meta.lineAbsY1) - lineRect.y) / Math.max(lineRect.h, 0.0001) : (meta.lineY1 ?? 0)
                            const l2x = hasAbs ? (Number(meta.lineAbsX2) - lineRect.x) / Math.max(lineRect.w, 0.0001) : (meta.lineX2 ?? 1)
                            const l2y = hasAbs ? (Number(meta.lineAbsY2) - lineRect.y) / Math.max(lineRect.h, 0.0001) : (meta.lineY2 ?? 1)
                            const lx1 = `${l1x * 100}%`
                            const ly1 = `${l1y * 100}%`
                            const lx2 = `${l2x * 100}%`
                            const ly2 = `${l2y * 100}%`
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
                            // Clamped rect, matching the layout box — see circuit-arc below.
                            const arect = rect
                            const hasAbs = meta.lineAbsX1 != null && meta.lineAbsY1 != null && meta.lineAbsX2 != null && meta.lineAbsY2 != null
                            const alx1f = hasAbs ? (Number(meta.lineAbsX1) - arect.x) / Math.max(arect.w, 0.0001) : (meta.lineX1 ?? 0)
                            const aly1f = hasAbs ? (Number(meta.lineAbsY1) - arect.y) / Math.max(arect.h, 0.0001) : (meta.lineY1 ?? 0)
                            const alx2f = hasAbs ? (Number(meta.lineAbsX2) - arect.x) / Math.max(arect.w, 0.0001) : (meta.lineX2 ?? 1)
                            const aly2f = hasAbs ? (Number(meta.lineAbsY2) - arect.y) / Math.max(arect.h, 0.0001) : (meta.lineY2 ?? 1)
                            const avx1 = alx1f * 100, avy1 = aly1f * 100
                            const avx2 = alx2f * 100, avy2 = aly2f * 100
                            // Freeform control point: stored as absolute page-normalized coords (archCtrlX/Y).
                            // Legacy fallback: derive control point from archFactor scalar on perpendicular bisector.
                            let avcx: number, avcy: number
                            if (meta.archCtrlX !== undefined && meta.archCtrlY !== undefined) {
                              // Convert page-normalized control point → annotation-local viewBox (0-100) coords
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
                          if (kind === 'circuit-arc') {
                            // CIRCUITARC: one quadratic Bezier per consecutive point pair.
                            // Points AND control points go through the identical page→local
                            // transform; because a quadratic Bezier is affine-invariant, the
                            // curve stays exact under this viewBox's non-uniform scale at any
                            // point count. See the geometry helpers near getPointsBounds.
                            // Must divide by the SAME clamped rect the layout box above is sized
                            // from. Reading the raw a.rect let a near-flat run (a straight ceiling
                            // row, where the stored height rounds toward zero) divide by a height
                            // far smaller than the box's floored 0.01, blowing the local viewBox
                            // coordinates up by orders of magnitude on an overflow-visible SVG.
                            const crect = rect
                            const rawPoints: Array<{ x: number; y: number }> = Array.isArray(meta.points) ? meta.points : []
                            const points = hasFinitePointGeometry(rawPoints, crect) ? rawPoints : []
                            const cw = Math.max(crect.w, 0.0001)
                            const ch = Math.max(crect.h, 0.0001)
                            const toLocal = (p: { x: number; y: number }) => ({
                              vx: ((p.x - crect.x) / cw) * 100,
                              vy: ((p.y - crect.y) / ch) * 100,
                            })
                            const localPts = points.map(toLocal)
                            let arcD = ''
                            if (localPts.length >= 2) {
                              arcD = `M ${localPts[0].vx} ${localPts[0].vy}`
                              for (let i = 1; i < points.length; i++) {
                                const c = toLocal(getCircuitArcControl(meta.arcCtrls, points[i - 1], points[i], i - 1))
                                arcD += ` Q ${c.vx} ${c.vy} ${localPts[i].vx} ${localPts[i].vy}`
                              }
                            }
                            return (
                              <div key={a.id} data-annotation-id={a.id} className={`absolute group ${isFocused ? 'ring-2 ring-white/80' : ''}`} style={{ left, top, width, height }} onPointerDown={selectAnnotation} onClick={selectAnnotation}>
                                <svg className="absolute inset-0 overflow-visible" viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">
                                  {arcD && (
                                    <path
                                      d={arcD}
                                      fill="none"
                                      stroke={borderColor}
                                      strokeWidth={borderThickness}
                                      strokeDasharray={borderStyle === 'dashed' ? '8 5' : borderStyle === 'dotted' ? '2 5' : undefined}
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      opacity={fillOpacity}
                                      vectorEffect="non-scaling-stroke"
                                    />
                                  )}
                                </svg>
                                {localPts.map((p, i) => (
                                  <div
                                    key={i}
                                    className="absolute rounded-full pointer-events-none"
                                    style={{
                                      left: `${p.vx}%`,
                                      top: `${p.vy}%`,
                                      width: 3,
                                      height: 3,
                                      transform: 'translate(-50%, -50%)',
                                      backgroundColor: borderColor,
                                      opacity: fillOpacity * 0.7,
                                    }}
                                  />
                                ))}
                                {/* Total-distance label — plain HTML for the same reason as Circuit
                                    Path's: the SVG above uses preserveAspectRatio="none" and would
                                    non-uniformly stretch any text drawn inside it. */}
                                {shouldRenderCircuitMeasurementLabel({
                                  labelsVisible: showCircuitMeasurementLabels,
                                  shapeKind: kind,
                                  distanceLabel: meta.distanceLabel,
                                  localPointCount: localPts.length,
                                }) && (
                                  <div
                                    className="absolute rounded px-1.5 py-0.5 text-[10px] font-mono pointer-events-none"
                                    style={{
                                      left: `${localPts.reduce((s, p) => s + p.vx, 0) / localPts.length}%`,
                                      top: `${localPts.reduce((s, p) => s + p.vy, 0) / localPts.length}%`,
                                      transform: 'translate(-50%, -50%)',
                                      backgroundColor: '#0a0d16',
                                      opacity: 0.9,
                                      color: meta.totalDistance != null ? borderColor : '#fbbf24',
                                      whiteSpace: meta.totalDistance != null ? 'nowrap' : 'normal',
                                      maxWidth: meta.totalDistance != null ? undefined : 170,
                                      textAlign: 'center',
                                      zIndex: 2,
                                    }}
                                  >
                                    {meta.distanceLabel}
                                  </div>
                                )}
                                {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'move')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute inset-0 cursor-move" style={{ zIndex: 1 }} />}
                              </div>
                            )
                          }
                          if (kind === 'polyline' || kind === 'circuit-path') {
                            // Same clamped-rect and finite-geometry rules as circuit-arc below.
                            const prect = rect
                            const rawPoints: Array<{ x: number; y: number }> = Array.isArray(meta.points) ? meta.points : []
                            const points = hasFinitePointGeometry(rawPoints, prect) ? rawPoints : []
                            const pw = Math.max(prect.w, 0.0001)
                            const ph = Math.max(prect.h, 0.0001)
                            const localPts = points.map((p) => ({
                              vx: ((p.x - prect.x) / pw) * 100,
                              vy: ((p.y - prect.y) / ph) * 100,
                            }))
                            const svgPts = localPts.map((p) => `${p.vx},${p.vy}`).join(' ')
                            const isCircuit = kind === 'circuit-path'
                            return (
                              <div key={a.id} data-annotation-id={a.id} className={`absolute group ${isFocused ? 'ring-2 ring-white/80' : ''}`} style={{ left, top, width, height }} onPointerDown={selectAnnotation} onClick={selectAnnotation}>
                                <svg className="absolute inset-0 overflow-visible" viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">
                                  <polyline
                                    points={svgPts}
                                    fill="none"
                                    stroke={borderColor}
                                    strokeWidth={borderThickness}
                                    strokeDasharray={borderStyle === 'dashed' ? '8 5' : borderStyle === 'dotted' ? '2 5' : undefined}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    opacity={fillOpacity}
                                    vectorEffect="non-scaling-stroke"
                                  />
                                </svg>
                                {isCircuit && localPts.map((p, i) => (
                                  <div
                                    key={i}
                                    className="absolute rounded-full pointer-events-none"
                                    style={{
                                      left: `${p.vx}%`,
                                      top: `${p.vy}%`,
                                      width: 3,
                                      height: 3,
                                      transform: 'translate(-50%, -50%)',
                                      backgroundColor: borderColor,
                                      opacity: fillOpacity * 0.7,
                                    }}
                                  />
                                ))}
                                {/* Circuit Path total-distance label (Step 13B-QA5-R Part 3/4).
                                    Rendered as plain HTML positioned by percentage -- NOT inside the
                                    0-100 viewBox SVG above, which uses preserveAspectRatio="none" and
                                    would non-uniformly stretch/distort any text drawn inside it. */}
                                {shouldRenderCircuitMeasurementLabel({
                                  labelsVisible: showCircuitMeasurementLabels,
                                  shapeKind: kind,
                                  distanceLabel: meta.distanceLabel,
                                  localPointCount: localPts.length,
                                }) && (
                                  <div
                                    className="absolute rounded px-1.5 py-0.5 text-[10px] font-mono pointer-events-none"
                                    style={{
                                      left: `${localPts.reduce((s, p) => s + p.vx, 0) / localPts.length}%`,
                                      top: `${localPts.reduce((s, p) => s + p.vy, 0) / localPts.length}%`,
                                      transform: 'translate(-50%, -50%)',
                                      backgroundColor: '#0a0d16',
                                      opacity: 0.9,
                                      color: meta.totalDistance != null ? borderColor : '#fbbf24',
                                      whiteSpace: meta.totalDistance != null ? 'nowrap' : 'normal',
                                      maxWidth: meta.totalDistance != null ? undefined : 170,
                                      textAlign: 'center',
                                      zIndex: 2,
                                    }}
                                  >
                                    {meta.distanceLabel}
                                  </div>
                                )}
                                {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'move')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute inset-0 cursor-move" style={{ zIndex: 1 }} />}
                              </div>
                            )
                          }
                          if (isElectricalShapeKind(kind)) {
                            const glowMetrics = isLightOutputShapeKind(kind)
                              ? getLightOutputGlowMetrics(kind, meta)
                              : null
                            const glowId = `light-glow-${a.id}`
                            // Symbols with a defined compact ink bounds render their own tight
                            // in-SVG selection outline (rotates correctly with the body) instead
                            // of the full-rect CSS ring, so the highlight hugs the visible glyph
                            // rather than the whole (often much larger) placed touch target.
                            const hasCompactBounds = !!getElectricalSymbolVisualBounds(kind)
                            return (
                              <div key={a.id} data-annotation-id={a.id} className={`absolute group ${isFocused && !hasCompactBounds ? 'ring-2 ring-white/80 rounded-sm' : ''}`} style={{ left, top, width, height }} onPointerDown={selectAnnotation} onClick={selectAnnotation}>
                                <svg
                                  className="absolute inset-0 overflow-visible"
                                  viewBox="0 0 100 100"
                                  width="100%"
                                  height="100%"
                                  preserveAspectRatio="xMidYMid meet"
                                >
                                  {glowMetrics && renderLightOutputGlowSvg(glowId, glowMetrics, lightingEffectsVisible && !animationPlaybackAnnotationIds.has(a.id))}
                                  <g opacity={fillOpacity}>
                                    {renderElectricalSymbolSvg(kind, meta, { borderColor, borderThickness, borderStyle, fillColor, fillOpacity, labelsVisible: electricalSymbolLabelsVisible, labelScale: symbolLabelScale, labelCustomColorsEnabled: symbolLabelCustomColorsEnabled, labelTextColor: symbolLabelTextColor, labelBorderColor: symbolLabelBorderColor, labelFillColor: symbolLabelFillColor }, getAnnotationRotationDeg(meta), isFocused)}
                                  </g>
                                </svg>
                                {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'move')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute inset-0 cursor-move" />}
                                {isLayoutEditing && <div onPointerDown={(e) => startAnnotationLayoutDrag(e, a, 'resize')} onPointerMove={handleAnnotationLayoutPointerMove} onPointerUp={handleAnnotationLayoutPointerUp} className="absolute -right-1 -bottom-1 h-3 w-3 cursor-nwse-resize rounded-sm bg-blue-400" />}
                              </div>
                            )
                          }
                          if (isCanLightShape(a)) {
                            // Can-light symbol: outer trim ring + crosshair + aperture circle + size label.
                            // If blueprint calibration is active, the user sizes the marker to match scale via drag.
                            // Without calibration the symbol is still clear — 4" vs 6" distinguished by aperture radius + label.
                            const trimRadius = 24
                            const aperture = kind === 'can-light-4' ? 10 : 13
                            const ringStrokeWidth = Math.max(0.8, borderThickness * 0.65)
                            const label = kind === 'can-light-4' ? '4"' : '6"'
                            const glowMetrics = getLightOutputGlowMetrics(kind, meta)
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
                                  {renderLightOutputGlowSvg(glowId, glowMetrics, lightingEffectsVisible && !animationPlaybackAnnotationIds.has(a.id))}
                                  {/* Outer trim ring */}
                                  <circle cx="50" cy="50" r={trimRadius} fill="none" stroke={borderColor} strokeWidth={ringStrokeWidth} strokeDasharray={borderStyle === 'dashed' ? '8 5' : borderStyle === 'dotted' ? '2 5' : undefined} opacity={fillOpacity} />
                                  {/* Crosshair — horizontal */}
                                  <line x1="4" y1="50" x2="96" y2="50" stroke={borderColor} strokeWidth={Math.max(0.8, borderThickness * 0.55)} opacity={fillOpacity * 0.65} />
                                  {/* Crosshair — vertical */}
                                  <line x1="50" y1="4" x2="50" y2="96" stroke={borderColor} strokeWidth={Math.max(0.8, borderThickness * 0.55)} opacity={fillOpacity * 0.65} />
                                  {/* Aperture circle — filled by fillColor so the color swatch is reflected */}
                                  <circle cx="50" cy="50" r={aperture} fill={fillColor === 'transparent' ? 'none' : hexWithAlpha(fillColor, Math.max(fillOpacity, 0.6))} stroke={borderColor} strokeWidth={ringStrokeWidth} />
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
                              <svg className="pointer-events-none absolute inset-0 overflow-visible" {...pageOverlaySvgProps}>
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
                          // BLUEPRINT-6M/6N — stroke dash pattern for measure-distance and measure-perimeter
                          // (area keeps its fill hatch; its stroke stays solid). Legacy annotations default to solid.
                          const lineDash: string | undefined = (a.type === 'measure-distance' || a.type === 'measure-perimeter') ? measureLineDashArray(mStyle.linePattern) : undefined
                          const pxPts = pts.map((p: any) => ({ px: clampNorm(p.x) * displaySize.w, py: clampNorm(p.y) * displaySize.h }))
                          const midPx = pxPts.reduce((acc, p) => ({ px: acc.px + p.px / pxPts.length, py: acc.py + p.py / pxPts.length }), { px: 0, py: 0 })
                          const distanceLabelMidPx = a.type === 'measure-distance' && pxPts.length === 2
                            ? { px: (pxPts[0].px + pxPts[1].px) / 2, py: (pxPts[0].py + pxPts[1].py) / 2 }
                            : midPx
                          const lastPt = pts[pts.length - 1]
                          // BLUEPRINT-6N/6P — per-segment length labels + a separate total for saved perimeter
                          // paths, using the annotation page's calibration (saved first, then auto-detected) +
                          // aspect-aware math, formatted as architectural feet/inches. The total is re-derived at
                          // render (not read from meta.label) so legacy decimal annotations also show ft/in, and
                          // is anchored BELOW the path bounds so it never overlaps the segment labels.
                          const perimeterLabelData = (() => {
                            const empty = { segments: [] as Array<{ midPx: { px: number; py: number }; label: string }>, total: null as null | { anchor: { px: number; py: number }; text: string } }
                            if (a.type !== 'measure-perimeter' || pxPts.length < 2) return empty
                            const segPageSize = getPageSizeInches(a.pageNumber)
                            const effective = resolveSharedEffectiveCalibration({
                              pageNumber: a.pageNumber,
                              savedCalibrations: savedCalibrationsRef.current,
                              detectedScales: detectedScalesRef.current,
                              pageSize: segPageSize,
                            })
                            const segCal = effective.status === 'calibrated' ? effective.calibration : null
                            // Below-path anchor: horizontal center of the point bounds, offset ~26px under the
                            // lowest point, clamped inside the page so it stays visible near the bottom edge.
                            const minX = Math.min(...pxPts.map((p) => p.px)), maxX = Math.max(...pxPts.map((p) => p.px))
                            const maxY = Math.max(...pxPts.map((p) => p.py))
                            const anchor = { px: (minX + maxX) / 2, py: Math.min(maxY + 26, Math.max(12, displaySize.h - 12)) }
                            if (!segCal) {
                              // Uncalibrated: fall back to whatever is stored (e.g. the "Calibrate…" hint).
                              return { segments: [], total: lbl ? { anchor, text: lbl } : null }
                            }
                            const unit = segCal.realWorldUnit ?? 'ft'
                            const segments: Array<{ midPx: { px: number; py: number }; label: string }> = []
                            for (let i = 1; i < pts.length; i++) {
                              const d = convertMeasuredDistance(pts[i - 1], pts[i], segCal, segPageSize)
                              segments.push({
                                midPx: { px: (pxPts[i - 1].px + pxPts[i].px) / 2, py: (pxPts[i - 1].py + pxPts[i].py) / 2 },
                                label: formatArchitecturalLength(d, unit),
                              })
                            }
                            const realPerim = convertMeasuredPolylineLength(pts, segCal, segPageSize)
                            return { segments, total: { anchor, text: `Total: ${formatArchitecturalLength(realPerim, unit)}` } }
                          })()
                          const perimeterSegmentLabels = perimeterLabelData.segments
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
                              <svg className="absolute inset-0 overflow-visible" {...pageOverlaySvgProps}>
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
                                  <line x1={pxPts[0].px} y1={pxPts[0].py} x2={pxPts[1].px} y2={pxPts[1].py} stroke={col} strokeWidth={lineW} strokeDasharray={lineDash} opacity={0.9} strokeLinecap="round" markerStart={arrowMarkStart} markerEnd={arrowMarkEnd} style={{ pointerEvents: 'none' }} />
                                ) : a.type === 'measure-perimeter' ? (
                                  // Multi-Point Measure is an OPEN path -- do not close point N back to point 1
                                  // (a <polygon> would implicitly draw that closing segment). Use <polyline>.
                                  <polyline points={pxPts.map(p => `${p.px},${p.py}`).join(' ')} fill="none" stroke={col} strokeWidth={lineW} strokeDasharray={lineDash} opacity={0.9} strokeLinejoin="round" markerStart={arrowMarkStart} markerEnd={arrowMarkEnd} style={{ pointerEvents: 'none' }} />
                                ) : (
                                  <polygon points={pxPts.map(p => `${p.px},${p.py}`).join(' ')} fill={areaFill} stroke={col} strokeWidth={lineW} opacity={0.9} strokeLinejoin="round" style={{ pointerEvents: 'none' }} />
                                )}
                                {renderEndpoints()}
                                {/* Distance = centered on the line; Area = centroid. Perimeter's total is drawn
                                    separately below (BLUEPRINT-6P) so it never overlaps the segment labels. */}
                                {measurementLabelsVisible && lbl && a.type !== 'measure-perimeter' && (
                                  a.type === 'measure-distance' ? (
                                    <>
                                      <rect x={distanceLabelMidPx.px - (lbl.length * 3.5 + 5) * measurementLabelScale} y={distanceLabelMidPx.py - 8 * measurementLabelScale} width={(lbl.length * 7 + 10) * measurementLabelScale} height={16 * measurementLabelScale} rx={3} fill="#0a0d16" opacity={0.88} style={{ pointerEvents: 'none' }} />
                                      <text x={distanceLabelMidPx.px} y={distanceLabelMidPx.py} fontSize={11 * measurementLabelScale} fill={col} fontFamily="monospace" dominantBaseline="middle" textAnchor="middle" style={{ pointerEvents: 'none' }}>{lbl}</text>
                                    </>
                                  ) : (
                                    <>
                                      <rect x={midPx.px - 2 * measurementLabelScale} y={midPx.py - 10 * measurementLabelScale} width={(lbl.length * 7 + 10) * measurementLabelScale} height={16 * measurementLabelScale} rx={3} fill="#0a0d16" opacity={0.88} style={{ pointerEvents: 'none' }} />
                                      <text x={midPx.px + 3 * measurementLabelScale} y={midPx.py} fontSize={11 * measurementLabelScale} fill={col} fontFamily="monospace" dominantBaseline="middle" textAnchor="start" style={{ pointerEvents: 'none' }}>{lbl}</text>
                                    </>
                                  )
                                )}
                                {/* BLUEPRINT-6N — per-segment length labels between each perimeter point/axle,
                                    centered on each segment midpoint, in the line color. */}
                                {measurementLabelsVisible && perimeterSegmentLabels.map((seg, si) => (
                                  <g key={`seglbl-${si}`} style={{ pointerEvents: 'none' }}>
                                    <rect x={seg.midPx.px - (seg.label.length * 3.5 + 5) * measurementLabelScale} y={seg.midPx.py - 8 * measurementLabelScale} width={(seg.label.length * 7 + 10) * measurementLabelScale} height={16 * measurementLabelScale} rx={3} fill="#0a0d16" opacity={0.85} />
                                    <text x={seg.midPx.px} y={seg.midPx.py} fontSize={10 * measurementLabelScale} fill={col} fontFamily="monospace" dominantBaseline="middle" textAnchor="middle">{seg.label}</text>
                                  </g>
                                ))}
                                {/* BLUEPRINT-6P — perimeter TOTAL label: distinct accent color (amber), centered
                                    below the path bounds so it is visually separate from the segment labels. */}
                                {measurementLabelsVisible && perimeterLabelData.total && (
                                  <g style={{ pointerEvents: 'none' }}>
                                    <rect x={perimeterLabelData.total.anchor.px - (perimeterLabelData.total.text.length * 3.6 + 6) * measurementLabelScale} y={perimeterLabelData.total.anchor.py - 9 * measurementLabelScale} width={(perimeterLabelData.total.text.length * 7.2 + 12) * measurementLabelScale} height={18 * measurementLabelScale} rx={4} fill="#1c1206" stroke="#f59e0b" strokeWidth={1} opacity={0.95} />
                                    <text x={perimeterLabelData.total.anchor.px} y={perimeterLabelData.total.anchor.py} fontSize={11 * measurementLabelScale} fill="#fbbf24" fontFamily="monospace" fontWeight={700} dominantBaseline="middle" textAnchor="middle">{perimeterLabelData.total.text}</text>
                                  </g>
                                )}
                                {/* BLUEPRINT-6L — transparent hit target carries data-annotation-id so
                                    the line is selectable directly from the document (pointerdown-capture
                                    and click both resolve to this element, giving a tight anchor rect for
                                    the floating action bar near the line instead of the full-page wrapper). */}
                                {/* BLUEPRINT-6M/6O — in Move mode the line/path body drags the WHOLE object
                                    (all points shift together): distance = both endpoints, perimeter = every
                                    point/axle. Outside Move mode it stays a selection hit target. The point
                                    handles render AFTER this element so tapping a point captures point-drag,
                                    while tapping the body between points captures whole-object move. */}
                                {isLayoutEditing && (a.type === 'measure-distance' || a.type === 'measure-perimeter') && pxPts.length >= 2 ? (
                                  <polyline data-annotation-id={a.id} points={pxPts.map(p => `${p.px},${p.py}`).join(' ')} fill="none" stroke="transparent" strokeWidth={16} style={{ pointerEvents: 'stroke', cursor: 'move', touchAction: 'none' }} onPointerDown={(e) => startMeasureLineDrag(e as any, a)} />
                                ) : (
                                  <polyline data-annotation-id={a.id} points={pxPts.map(p => `${p.px},${p.py}`).join(' ')} fill="none" stroke="transparent" strokeWidth={16} style={{ pointerEvents: 'stroke', cursor: 'pointer', touchAction: 'none' }} onPointerDown={selectAnnotation as any} onClick={selectAnnotation as any} />
                                )}
                                {/* BLUEPRINT-6L — Move mode: draggable endpoint handles for distance lines only. */}
                                {isLayoutEditing && a.type === 'measure-distance' && pxPts.length === 2 && (
                                  <>
                                    <circle cx={pxPts[0].px} cy={pxPts[0].py} r={7} fill="#3b82f6" stroke="#ffffff" strokeWidth={2} style={{ pointerEvents: 'all', cursor: 'crosshair', touchAction: 'none' }} onPointerDown={(e) => startMeasureEndpointDrag(e, a, 0)} />
                                    <circle cx={pxPts[1].px} cy={pxPts[1].py} r={7} fill="#22c55e" stroke="#ffffff" strokeWidth={2} style={{ pointerEvents: 'all', cursor: 'crosshair', touchAction: 'none' }} onPointerDown={(e) => startMeasureEndpointDrag(e, a, 1)} />
                                  </>
                                )}
                                {/* BLUEPRINT-6N — Move mode: a draggable handle at every perimeter point/axle.
                                    Dragging one updates only that vertex; the total + segment labels recompute. */}
                                {isLayoutEditing && a.type === 'measure-perimeter' && pxPts.length >= 2 && pxPts.map((p, i) => (
                                  <circle key={`axle-${i}`} cx={p.px} cy={p.py} r={7} fill={i === 0 ? '#3b82f6' : i === pxPts.length - 1 ? '#22c55e' : '#f59e0b'} stroke="#ffffff" strokeWidth={2} style={{ pointerEvents: 'all', cursor: 'crosshair', touchAction: 'none' }} onPointerDown={(e) => startMeasurePointDrag(e, a, i)} />
                                ))}
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
                      {/* ── Package Pick on-canvas highlight ──
                          A non-interactive halo drawn around every annotation currently in the
                          package-pick set, so picked items are obvious on the plan itself without
                          opening the annotation list. Deliberately distinct from the white
                          single-selection ring (emerald dashed ring + glow + check badge).
                          Reuses the exact same rect->percentage positioning as the annotation map;
                          pointer-events:none guarantees it never intercepts clicks / movement /
                          editing, and it never mutates annotation data. */}
                      {annotationsVisible && selectedForPackageIds.size > 0 && canvasPageAnnotations.map((a) => {
                        if (!a?.rect || !selectedForPackageIds.has(a.id)) return null
                        const rect = clampRectToPage(a.rect as any)
                        return (
                          <div
                            key={`pkgpick-${a.id}`}
                            className="absolute pointer-events-none z-[6] rounded-md"
                            style={{
                              left: `${(rect.x || 0) * 100}%`,
                              top: `${(rect.y || 0) * 100}%`,
                              width: `${Math.max(0.01, (rect.w || 0)) * 100}%`,
                              height: `${Math.max(0.01, (rect.h || 0)) * 100}%`,
                              outline: '2px dashed rgba(16,185,129,0.95)',
                              outlineOffset: '2px',
                              boxShadow: '0 0 0 2px rgba(16,185,129,0.35), 0 0 10px 2px rgba(16,185,129,0.45)',
                              background: 'rgba(16,185,129,0.10)',
                            }}
                          >
                            <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-400 text-emerald-950 shadow ring-1 ring-emerald-900/40">
                              <Check size={10} strokeWidth={3} />
                            </span>
                          </div>
                        )
                      })}

                      {/* ANIM-2B1 builder-only overlays. These never write annotation styling or
                          metadata and disappear with the dedicated builder state. */}
                      {animationRouteOverlay && pageOverlaySvgProps && (
                        <svg
                          className="absolute inset-0 pointer-events-none overflow-visible"
                          {...pageOverlaySvgProps}
                          style={{ zIndex: 24 }}
                          aria-hidden="true"
                        >
                          {animationRouteOverlay.segments.filter((segment) => segment.pageNumber === currentPage).map((segment) => {
                            const startX = segment.start.x * displaySize.w
                            const startY = segment.start.y * displaySize.h
                            const endX = segment.end.x * displaySize.w
                            const endY = segment.end.y * displaySize.h
                            return segment.kind === 'quadratic' && segment.control
                              ? <path key={segment.id} d={`M ${startX} ${startY} Q ${segment.control.x * displaySize.w} ${segment.control.y * displaySize.h} ${endX} ${endY}`} fill="none" stroke="#22d3ee" strokeWidth={5} strokeLinecap="round" opacity={0.82} vectorEffect="non-scaling-stroke" />
                              : <line key={segment.id} x1={startX} y1={startY} x2={endX} y2={endY} stroke="#22d3ee" strokeWidth={5} strokeLinecap="round" opacity={0.82} vectorEffect="non-scaling-stroke" />
                          })}
                        </svg>
                      )}
                      {animationRouteOverlay?.badges.filter((badge) => badge.pageNumber === currentPage).map((badge) => (
                        <div
                          key={badge.id}
                          role="img"
                          aria-label={badge.ariaLabel}
                          className={`absolute pointer-events-none flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white font-bold shadow-[0_0_0_2px_rgba(8,145,178,0.8),0_2px_8px_rgba(0,0,0,0.7)] ${badge.junction ? 'h-3 w-3 bg-cyan-300' : 'h-6 w-6 bg-cyan-500 text-[11px] text-cyan-950'}`}
                          style={{ left: `${badge.point.x * 100}%`, top: `${badge.point.y * 100}%`, zIndex: 25 }}
                        >
                          {!badge.junction ? badge.label : null}
                        </div>
                      ))}

                      {isPackageVisibilityFilterActive && isolatedAnnotationIdSet && isolatedAnnotationIdSet.size === 0 && annotationsVisible && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[5]">
                          <div className="rounded-lg border border-amber-500/40 bg-black/70 px-3 py-2 text-xs text-amber-200 shadow-lg">
                            {isolatedScopeLayers.length === 1 ? 'This package has no linked annotations.' : 'These packages have no linked annotations.'}
                          </div>
                        </div>
                      )}

                      {/* Arch control handle — yellow draggable handle at bezier control point for selected arch-line */}
                      {!animationRouteBuilder && layoutEditId && (() => {
                        const archAnn = canvasPageAnnotations.find(a => a.id === layoutEditId)
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

                      {/* CIRCUITARC — one yellow curvature handle per segment on the selected
                          circuit-arc. Positioned in absolute page-normalized space (like the arch
                          handle above) rather than inside the annotation's local viewBox, so the
                          handle sits exactly where the control point is stored. */}
                      {!animationRouteBuilder && layoutEditId && (() => {
                        const arcAnn = canvasPageAnnotations.find(a => a.id === layoutEditId)
                        if (!arcAnn) return null
                        const arcMeta = getAnnotationMeta(arcAnn)
                        if (arcMeta.shapeKind !== 'circuit-arc') return null
                        const pts: Array<{ x: number; y: number }> = Array.isArray(arcMeta.points) ? arcMeta.points : []
                        if (pts.length < 2) return null
                        return pts.slice(1).map((p, i) => {
                          const c = getCircuitArcControl(arcMeta.arcCtrls, pts[i], p, i)
                          return (
                            <div
                              key={`circuit-arc-control-${i}`}
                              style={{ position: 'absolute', left: `${c.x * 100}%`, top: `${c.y * 100}%`, transform: 'translate(-50%,-50%)', zIndex: 4, touchAction: 'none' }}
                              className="w-3 h-3 rounded-full bg-yellow-400 border border-white shadow cursor-move"
                              title={`Drag to adjust the curve of segment ${i + 1} of ${pts.length - 1}`}
                              onPointerDown={(e) => { e.stopPropagation(); startCircuitArcControlDrag(e, arcAnn, i) }}
                            />
                          )
                        })
                      })()}

                      <svg
                        ref={alignmentGuideSvgRef}
                        className="absolute inset-0 pointer-events-none overflow-visible"
                        {...pageOverlaySvgProps}
                        style={{ zIndex: 30, filter: 'drop-shadow(0 0 3px rgba(34, 211, 238, 0.85))' }}
                        aria-hidden="true"
                      />

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
                        {...pageOverlaySvgProps}
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

                      {inkDraft && (effectiveTool === 'pen' || effectiveTool === 'marker') && pageOverlaySvgProps && (
                        <svg className="absolute inset-0 pointer-events-none overflow-visible" {...pageOverlaySvgProps}>
                          <polyline
                            points={inkDraft.map((p) => {
                              const pg = overlayPxToPagePx(p.x, p.y, overlayVisualW, overlayVisualH, overlayPageW, overlayPageH)
                              return `${pg.x},${pg.y}`
                            }).join(' ')}
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
                      {displaySize.w > 0 && measureDraftPoints.length > 0 && (effectiveTool === 'calibrate' || effectiveTool === 'measure-distance' || effectiveTool === 'measure-area' || effectiveTool === 'measure-perimeter') && pageOverlaySvgProps && (
                        <svg className="absolute inset-0 pointer-events-none overflow-visible" {...pageOverlaySvgProps}>
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
                                {measurementLabelsVisible && effectiveTool === 'measure-distance' && measureDistanceLivePreview && !calibrateInput && (
                                  <>
                                    <rect
                                      x={measureDistanceLivePreview.midpointPx.px - (measureDistanceLivePreview.label.length * 3.5 + 5) * measurementLabelScale}
                                      y={measureDistanceLivePreview.midpointPx.py - 8 * measurementLabelScale}
                                      width={(measureDistanceLivePreview.label.length * 7 + 10) * measurementLabelScale}
                                      height={16 * measurementLabelScale}
                                      rx={3}
                                      fill="#0a0d16"
                                      opacity={0.88}
                                    />
                                    <text
                                      x={measureDistanceLivePreview.midpointPx.px}
                                      y={measureDistanceLivePreview.midpointPx.py}
                                      fontSize={11 * measurementLabelScale}
                                      fill={col}
                                      fontFamily="monospace"
                                      dominantBaseline="middle"
                                      textAnchor="middle"
                                    >
                                      {measureDistanceLivePreview.label}
                                    </text>
                                  </>
                                )}
                                {/* BLUEPRINT-6N — live per-segment length labels while drafting a perimeter. */}
                                {measurementLabelsVisible && effectiveTool === 'measure-perimeter' && measurePerimeterLivePreview && !calibrateInput &&
                                  measurePerimeterLivePreview.segments.map((seg, si) => (
                                    <g key={`pseg-${si}`}>
                                      <rect
                                        x={seg.midPx.px - (seg.label.length * 3.5 + 5) * measurementLabelScale}
                                        y={seg.midPx.py - 8 * measurementLabelScale}
                                        width={(seg.label.length * 7 + 10) * measurementLabelScale}
                                        height={16 * measurementLabelScale}
                                        rx={3}
                                        fill="#0a0d16"
                                        opacity={0.88}
                                      />
                                      <text
                                        x={seg.midPx.px}
                                        y={seg.midPx.py}
                                        fontSize={11 * measurementLabelScale}
                                        fill={col}
                                        fontFamily="monospace"
                                        dominantBaseline="middle"
                                        textAnchor="middle"
                                      >
                                        {seg.label}
                                      </text>
                                    </g>
                                  ))}
                              </>
                            )
                          })()}
                        </svg>
                      )}

                      {/* Multi-point path draft SVG — placed points + rubber-band to cursor,
                          shared by Polyline and Circuit/Switch-Leg Path (Step 13B-QA5) */}
                      {displaySize.w > 0 && pathDraftPoints.length > 0 && effectiveTool === 'shape' && isMultiPointShapeKind(shapeKind) && pageOverlaySvgProps && (
                        <svg className="absolute inset-0 pointer-events-none overflow-visible" {...pageOverlaySvgProps}>
                          {(() => {
                            const col = shapeOptions.borderColor || '#facc15'
                            const pxPts = pathDraftPoints.map(p => ({ px: p.x * displaySize.w, py: p.y * displaySize.h }))
                            return (
                              <>
                                {pxPts.length >= 2 && (
                                  <polyline points={pxPts.map(p => `${p.px},${p.py}`).join(' ')} fill="none" stroke={col} strokeWidth={shapeOptions.borderThickness || 2} strokeDasharray="5,3" opacity={0.85} />
                                )}
                                {pxPts.map((p, i) => <circle key={i} cx={p.px} cy={p.py} r={4} fill={col} opacity={0.9} />)}
                                {pathCursorPx && pxPts.length >= 1 && (
                                  <line
                                    x1={pxPts[pxPts.length - 1].px} y1={pxPts[pxPts.length - 1].py}
                                    x2={pathCursorPx.x} y2={pathCursorPx.y}
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
                            Enter known distance
                          </div>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={calibrateInput.value}
                              onChange={(e) => setCalibrateInput((prev) => prev ? { ...prev, value: e.target.value } : prev)}
                              className="w-24 rounded border border-gray-600 bg-gray-900/80 px-2 py-1 text-sm text-white outline-none focus:border-sky-500"
                              placeholder={`e.g. 10' 6"`}
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const parsed = parseCalibrationLength(calibrateInput.value, calibrateInput.unit)
                                  if (!parsed) return
                                  setSavedCalibrations((prev) => ({
                                    ...prev,
                                    [currentPage]: buildManualKnownDistanceCalibration(
                                      currentPage,
                                      calibrateInput.p1,
                                      calibrateInput.p2,
                                      parsed.value,
                                      parsed.unit,
                                      getPageSizeInches(currentPage),
                                    ),
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
                          <div className="mt-1 text-[10px] text-gray-500">
                            Also accepts 10, 10 ft, 10', 10' 6", 126 in
                          </div>
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const parsed = parseCalibrationLength(calibrateInput.value, calibrateInput.unit)
                                if (!parsed) return
                                setSavedCalibrations((prev) => ({
                                  ...prev,
                                  [currentPage]: buildManualKnownDistanceCalibration(
                                    currentPage,
                                    calibrateInput.p1,
                                    calibrateInput.p2,
                                    parsed.value,
                                    parsed.unit,
                                    getPageSizeInches(currentPage),
                                  ),
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
                  // Default embedded (QA7-R7): the shared operations-pdf-scroll
                  // class sets touch-action:none (needed for PDF pan/zoom), but
                  // on this natural-height annotations block it would block the
                  // app page from scrolling under a finger. Restore normal
                  // touch scrolling here only.
                  ...(isDefaultEmbeddedLayout ? { touchAction: 'auto' as any, overscrollBehavior: 'auto' as any } : {}),
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
                    {/* Collapse chevron only in fullscreen (the drawer). In
                        default embedded mode the panel is always expanded and
                        grows naturally, so the toggle would be a dead control
                        (QA7-R7). */}
                    {(isFullScreenView || isTabletImmersiveFullscreen) && (
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
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[11px] font-semibold text-gray-300">Current Page Annotations</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          Page {currentPage} · {pageAnnotations.length} {pageAnnotations.length === 1 ? 'annotation' : 'annotations'} · <span className={selectedPackageCount > 0 ? 'font-semibold text-sky-300' : ''}>{selectedPackageCount} selected</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={selectedPackageCount === 0}
                        onClick={openCreateScopeLayerModal}
                        className="rounded border border-sky-500/50 bg-sky-500/10 px-2 py-1 text-[10px] font-semibold text-sky-200 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-900/40 disabled:text-gray-600"
                      >
                        Create Work Package
                      </button>
                    </div>
                    {/* ── Package Pick / Multi Select controls ── */}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={togglePackagePickMode}
                        className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-semibold ${isPackagePickMode ? 'border-emerald-400/70 bg-emerald-500/15 text-emerald-200' : 'border-gray-700 text-gray-300 hover:bg-white/5'}`}
                        title="Toggle Package Pick mode — click symbols/shapes on the canvas to add them to a work package. Desktop: press Left Control."
                      >
                        <MousePointer2 size={11} />
                        {isPackagePickMode ? 'Package Pick: On' : 'Package Pick'}
                      </button>
                      <span className={`text-[10px] ${selectedPackageCount > 0 ? 'font-semibold text-emerald-300' : 'text-gray-500'}`}>
                        Package Pick: {selectedPackageCount} selected
                      </span>
                      {selectedPackageCount > 0 && (
                        <button
                          type="button"
                          onClick={clearPackagePickSelection}
                          className="inline-flex items-center gap-1 rounded border border-gray-700 px-2 py-1 text-[10px] text-gray-300 hover:bg-white/5"
                          title="Clear the package-pick selection"
                        >
                          <X size={10} /> Clear
                        </button>
                      )}
                      {isPackagePickMode && (
                        <span className="text-[9px] text-emerald-300/70">Picking visible annotations only · Tap canvas items to add/remove · Left Ctrl or Esc to exit</span>
                      )}
                    </div>
                  </div>
                )}

                {annotationPanelExpanded && scopeLayers.length > 0 && (
                  <div ref={scopeLayersPanelRef} className="border-b border-sky-900/40 bg-sky-950/10">
                    <div className="px-3 py-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-100">
                          <Layers size={12} /> Scope Layers / Work Packages
                        </div>
                        <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-200">{pageFilteredScopeLayers.length}{!scopeLayerShowAllPages && pageFilteredScopeLayers.length !== scopeLayers.length ? ` / ${scopeLayers.length}` : ''}</span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <div className="text-[10px] text-sky-200/60">{isScopeLayerOrderSaving ? 'Saving package order...' : 'Saved work packages for this viewer session. Drag the handle or use ↑/↓ to reorder.'}</div>
                        <div className="flex flex-shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setProjectWireTotalsOpen(true)}
                            className="rounded border border-cyan-500/50 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-100 hover:bg-cyan-500/20"
                            title="Open read-only wire totals for the current blueprint set"
                          >
                            Project Wire Totals
                          </button>
                          <button
                            type="button"
                            onClick={() => setScopeLayerShowAllPages((prev) => !prev)}
                            className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold ${scopeLayerShowAllPages ? 'border-sky-400/60 bg-sky-500/20 text-sky-100' : 'border-gray-700 text-gray-300 hover:bg-white/5'}`}
                            title={scopeLayerShowAllPages ? 'Showing packages from all pages — click to show only this page' : 'Showing only this page\'s packages — click to show all pages'}
                          >
                            {scopeLayerShowAllPages ? 'Showing: All Pages' : 'Showing: Current Page'}
                          </button>
                        </div>
                      </div>
                      {isPackageVisibilityFilterActive && (
                        <div className="mt-1.5 flex items-center justify-between gap-2 rounded border border-amber-500/40 bg-amber-950/25 px-2 py-1 text-[10px] font-medium text-amber-200">
                          <span>
                            Showing {isolatedScopeLayers.length} {isolatedScopeLayers.length === 1 ? 'package' : 'packages'}
                            {isolatedScopeLayers.length === 1 && <> — <span className="font-semibold">{isolatedScopeLayers[0].name}</span></>}
                          </span>
                          <button
                            type="button"
                            onClick={clearScopeLayerVisibilityFilter}
                            className="rounded border border-amber-400/50 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-100 hover:bg-amber-500/25"
                            title="Clear the package visibility filter and show all annotations"
                          >
                            Show All
                          </button>
                        </div>
                      )}
                      {hiddenWorkPackageIds.size > 0 && (
                        <div className="mt-1.5 flex items-center justify-between gap-2 rounded border border-rose-500/40 bg-rose-950/25 px-2 py-1 text-[10px] font-medium text-rose-200">
                          <span>
                            Hiding {hiddenWorkPackageIds.size} {hiddenWorkPackageIds.size === 1 ? 'package' : 'packages'} from general view
                            {isPackageVisibilityFilterActive && <> — <span className="italic text-rose-300/80">paused while scoped</span></>}
                          </span>
                          <button
                            type="button"
                            onClick={clearHiddenScopeLayers}
                            className="rounded border border-rose-400/50 bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-rose-100 hover:bg-rose-500/25"
                            title="Clear all hidden packages and show their annotations in general view"
                          >
                            Clear Hidden
                          </button>
                        </div>
                      )}
                      {actionMsg && (
                        <div className={`mt-1.5 rounded px-2 py-1.5 text-[10px] font-medium ${packageAnimationRouteActionMessageClass(actionMsg.type)}`}>
                          {actionMsg.text}
                        </div>
                      )}
                    </div>
                    {pageFilteredScopeLayers.length === 0 && (
                      <div className="px-3 pb-3 text-[10px] text-gray-500 italic">No work packages on this page. Turn on "Show All Pages" to see packages from other pages.</div>
                    )}
                    <div className="space-y-2 px-3 pb-3">
                      {pageFilteredScopeLayers.map((layer) => {
                        const totalHours = getBlueprintScopeLayerLaborTotal(layer)
                        const summary = buildBlueprintScopeItemSummary(layer.itemRefs)
                        const isLayerIsolated = isolatedScopeLayerIds.has(layer.id)
                        const isLayerHidden = hiddenWorkPackageIds.has(layer.id)
                        const isDragging = draggingScopeLayerId === layer.id
                        const isDropTarget = dragOverScopeLayerId === layer.id && draggingScopeLayerId !== layer.id
                        const moveState = getVisibleWorkPackageMoveState({
                          visibleIds: pageFilteredScopeLayerIds,
                          packageId: layer.id,
                          busy: isScopeLayerOrderSaving,
                        })
                        const distinctPageCount = getBlueprintScopeLayerDistinctPageCount(layer)
                        const pageBadgeLabel = layer.pageNumber != null ? `Page ${layer.pageNumber}` : 'Unscoped'
                        const animationSummary = summarizePackageAnimationScene(layer.animationScene, animationRouteAnnotations, layer.selectedAnnotationIds)
                        const animationSceneParse = parseBlueprintAnimationScene(layer.animationScene)
                        const animationReviewKey = blueprint?.id ? packageAnimationRouteNoticeKey(blueprint.id, layer.id) : ''
                        const animationReviewConflict = animationReviewKey ? animationRouteReviewConflicts[animationReviewKey] : undefined
                        const animationRouteNotice = animationReviewKey ? packageAnimationRouteNotices[animationReviewKey] : undefined
                        const playbackPageNumber = Math.max(1, Math.floor(Number(layer.pageNumber || layer.itemRefs?.[0]?.pageNumber || currentPage) || 1))
                        return (
                          <div
                            key={layer.id}
                            onDragOver={(e) => { e.preventDefault(); if (draggingScopeLayerId) setDragOverScopeLayerId(layer.id) }}
                            onDragEnter={(e) => { e.preventDefault(); if (draggingScopeLayerId) setDragOverScopeLayerId(layer.id) }}
                            onDrop={(e) => {
                              e.preventDefault()
                              if (!isScopeLayerOrderSaving && draggingScopeLayerId) reorderScopeLayer(draggingScopeLayerId, layer.id)
                              setDraggingScopeLayerId(null)
                              setDragOverScopeLayerId(null)
                            }}
                            className={`rounded-lg border p-2 shadow-sm transition-opacity ${isDragging ? 'opacity-40' : ''} ${isDropTarget ? 'border-emerald-400/80 ring-2 ring-emerald-400/40' : isLayerIsolated ? 'border-amber-400/60 bg-amber-950/30 ring-1 ring-amber-400/25' : `border-sky-500/35 bg-gray-950/50 ${layer.visible ? '' : 'opacity-55'}`}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex min-w-0 items-start gap-1.5">
                                <span
                                  draggable={!isScopeLayerOrderSaving}
                                  onDragStart={(e) => {
                                    if (isScopeLayerOrderSaving) {
                                      e.preventDefault()
                                      return
                                    }
                                    setDraggingScopeLayerId(layer.id); setDragOverScopeLayerId(null); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', layer.id) } catch {}
                                  }}
                                  onDragEnd={() => { setDraggingScopeLayerId(null); setDragOverScopeLayerId(null) }}
                                  className={`mt-0.5 flex-shrink-0 touch-none text-gray-500 hover:text-gray-300 ${isScopeLayerOrderSaving ? 'cursor-not-allowed opacity-50' : 'cursor-grab active:cursor-grabbing'}`}
                                  title="Drag to reorder this work package"
                                  aria-label="Drag to reorder"
                                >
                                  <GripVertical size={12} />
                                </span>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: layer.color || DEFAULT_SCOPE_LAYER_COLOR }} />
                                    <div className="truncate text-xs font-semibold text-gray-100">{layer.name}</div>
                                    {isLayerIsolated && (
                                      <span className="rounded-full border border-amber-400/40 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-200">{isLayerHidden ? 'Scoped View' : 'Visible'}</span>
                                    )}
                                    {isLayerHidden && !isLayerIsolated && (
                                      <span className="rounded-full border border-rose-400/40 bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-rose-200">Hidden</span>
                                    )}
                                  </div>
                                  <div className="mt-1 text-[10px] text-gray-400">
                                    {layer.itemRefs.length} {layer.itemRefs.length === 1 ? 'item' : 'items'} · {totalHours.toFixed(1)} labor hrs
                                  </div>
                                  <div className="mt-1 flex flex-wrap items-center gap-1">
                                    <span className="rounded-full border border-gray-700 bg-gray-900/60 px-1.5 py-0.5 text-[9px] text-gray-400">{pageBadgeLabel}</span>
                                    {distinctPageCount > 1 && (
                                      <span className="rounded-full border border-indigo-500/40 bg-indigo-950/40 px-1.5 py-0.5 text-[9px] text-indigo-300">Spans {distinctPageCount} pages</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="flex flex-shrink-0 items-center gap-1">
                                <div className="flex flex-col">
                                  <button
                                    type="button"
                                    onClick={() => moveScopeLayer(layer.id, 'up')}
                                    disabled={!moveState.canMoveUp}
                                    className="rounded border border-gray-700 px-1 leading-none text-gray-300 hover:bg-white/5 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-700"
                                    title="Move package up"
                                    aria-label="Move package up"
                                  >
                                    <ChevronUp size={10} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => moveScopeLayer(layer.id, 'down')}
                                    disabled={!moveState.canMoveDown}
                                    className="mt-0.5 rounded border border-gray-700 px-1 leading-none text-gray-300 hover:bg-white/5 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-700"
                                    title="Move package down"
                                    aria-label="Move package down"
                                  >
                                    <ChevronDown size={10} />
                                  </button>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => toggleScopeLayerIsolation(layer.id)}
                                  className={`rounded border px-1 py-0.5 text-[10px] ${isLayerIsolated ? 'border-amber-400/50 bg-amber-500/15 text-amber-200' : 'border-gray-700 text-gray-300 hover:bg-white/5'}`}
                                  title={isLayerIsolated ? 'Remove this package from the visible set' : 'Show this package on canvas (add to visible set)'}
                                >
                                  <Eye size={10} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleScopeLayerHidden(layer.id)}
                                  className={`rounded border px-1 py-0.5 text-[10px] ${isLayerHidden ? 'border-rose-400/50 bg-rose-500/15 text-rose-200' : 'border-gray-700 text-gray-300 hover:bg-white/5'}`}
                                  title={isLayerHidden ? 'Show this package annotations in general view' : 'Hide this package annotations from general view'}
                                >
                                  <EyeOff size={10} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditScopeLayerModal(layer)}
                                  className="rounded border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-300 hover:bg-white/5"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteScopeLayer(layer.id)}
                                  className="rounded border border-red-900/50 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-950/30"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                            {layer.description && <div className="mt-1 text-[10px] text-gray-400 line-clamp-2">{layer.description}</div>}
                            {animationRouteNotice && (
                              <div className={`mt-1.5 flex items-start justify-between gap-2 rounded px-2 py-1.5 text-[10px] font-medium ${packageAnimationRouteActionMessageClass(animationRouteNotice.type)}`}>
                                <span className="min-w-0">{animationRouteNotice.text}</span>
                                <button
                                  type="button"
                                  onClick={() => dismissPackageAnimationRouteNotice(animationRouteNotice)}
                                  className="mt-0.5 flex-shrink-0 rounded p-0.5 text-current opacity-70 hover:bg-white/10 hover:opacity-100"
                                  title="Dismiss route notice"
                                  aria-label="Dismiss route notice"
                                >
                                  <X size={10} />
                                </button>
                              </div>
                            )}
                            {summary.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {summary.slice(0, 4).map((item) => (
                                  <span key={item} className="rounded-full border border-gray-800 bg-gray-900/60 px-1.5 py-0.5 text-[9px] text-gray-400">{item}</span>
                                ))}
                                {summary.length > 4 && <span className="text-[9px] text-gray-500">+{summary.length - 4} more</span>}
                              </div>
                            )}
                            <div className="mt-2 border-t border-cyan-900/35 pt-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-300"><Waypoints size={11} /> Animation</div>
                                {animationSummary.state === 'supported' && (
                                  <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${animationSummary.valid ? 'border-emerald-500/40 bg-emerald-950/35 text-emerald-300' : 'border-amber-500/40 bg-amber-950/35 text-amber-300'}`}>
                                    {animationSummary.valid ? 'Valid' : 'Needs attention'}
                                  </span>
                                )}
                              </div>
                              {animationSummary.state === 'unsupported' ? (
                                <div className="mt-1.5 rounded border border-amber-700/40 bg-amber-950/30 px-2 py-1 text-[10px] text-amber-200">Animation created by a newer app version</div>
                              ) : animationSummary.state === 'malformed' ? (
                                <div className="mt-1.5 rounded border border-red-800/40 bg-red-950/25 px-2 py-1 text-[10px] text-red-200">Saved animation data needs attention and is read-only.</div>
                              ) : (
                                <>
                                  {animationSummary.state === 'supported' && (
                                    <div className="mt-1 text-[10px] text-gray-400">{animationSummary.sourceCount} {animationSummary.sourceCount === 1 ? 'source' : 'sources'} • {animationSummary.routeStepCount} route {animationSummary.routeStepCount === 1 ? 'step' : 'steps'}</div>
                                  )}
                                  {animationSceneParse.status === 'supported' && animationSummary.valid && !animationSummary.advanced && (
                                    <div className="mt-1.5">
                                      <PackageAnimationPlaybackControls
                                        scene={layer.animationScene}
                                        annotations={animationRouteAnnotations}
                                        active={animationPlayback?.layerId === layer.id}
                                        currentPage={currentPage}
                                        pageWidth={displaySize.w}
                                        pageHeight={displaySize.h}
                                        overlayWidth={overlayVisualW}
                                        overlayHeight={overlayVisualH}
                                        overlayTarget={overlayRef.current}
                                        fixtureAppearances={animationPlaybackFixtureAppearances}
                                        lightingEffectsVisible={lightingEffectsVisible || animationPlayback?.layerId === layer.id}
                                        onActivate={() => {
                                          if (!blueprint?.id) return
                                          if (playbackPageNumber !== currentPage) {
                                            setCurrentPage(playbackPageNumber)
                                            setPageInput(String(playbackPageNumber))
                                          }
                                          setAnimationPlayback({
                                            blueprintId: blueprint.id,
                                            layerId: layer.id,
                                            sceneRevision: resolvePackageAnimationRouteBaseRevision(layer),
                                            pageNumber: playbackPageNumber,
                                          })
                                        }}
                                        onDeactivate={() => setAnimationPlayback((previous) => previous?.layerId === layer.id ? null : previous)}
                                      />
                                    </div>
                                  )}
                                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => openPackageAnimationRouteBuilder(layer)}
                                      className="min-h-7 rounded border border-cyan-500/50 bg-cyan-500/10 px-2 text-[10px] font-semibold text-cyan-200 hover:bg-cyan-500/20"
                                    >
                                      {animationSummary.state === 'supported' ? 'Edit Animation Route' : 'Build Animation Route'}
                                    </button>
                                    {animationSummary.state === 'supported' && (
                                      <button
                                        type="button"
                                        onClick={() => void clearSavedPackageAnimationRoute(layer)}
                                        className="min-h-7 rounded border border-red-900/60 px-2 text-[10px] text-red-300 hover:bg-red-950/35"
                                      >
                                      Clear Animation Route
                                      </button>
                                    )}
                                    {animationReviewConflict?.currentScene != null && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const localSession = openPackageAnimationRouteSession({
                                            layer,
                                            annotations: animationRouteAnnotations,
                                            pageNumber: playbackPageNumber,
                                            sessionId: `route_session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                                          })
                                          setAnimationPlayback((previous) => previous?.layerId === layer.id ? null : previous)
                                          setAnimationRouteBuilder({
                                            ...localSession,
                                            conflict: animationReviewConflict,
                                          })
                                        }}
                                        className="min-h-7 rounded border border-amber-500/50 bg-amber-500/10 px-2 text-[10px] font-semibold text-amber-200 hover:bg-amber-500/20"
                                      >
                                        Review Cloud Copy
                                      </button>
                                    )}
                                  </div>
                                  {animationReviewConflict?.currentScene != null && (
                                    <div className="mt-1.5 rounded border border-amber-700/40 bg-amber-950/25 px-2 py-1 text-[9px] text-amber-200">
                                      Cloud copy differs from this device's saved route.
                                    </div>
                                  )}
                                  {animationSummary.advanced && animationSummary.message && <div className="mt-1 text-[9px] text-amber-300/80">{animationSummary.message}</div>}
                                </>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
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

                  const AnnotationRow = ({ a }: { a: BlueprintAnnotation }) => {
                    const isPackageSelected = selectedForPackageIds.has(a.id)
                    const isVisibleForPick = isAnnotationVisibleOnCanvas(a.id)
                    return (
                      <div
                        key={a.id}
                        className={`mx-2 my-0.5 flex w-auto items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                          isPackageSelected
                            ? 'border-sky-400/70 bg-sky-500/15 shadow-[inset_3px_0_0_rgba(56,189,248,0.9)]'
                            : focusedAnnotationId === a.id
                              ? 'border-white/10 bg-white/5'
                              : 'border-transparent hover:bg-white/5'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isPackageSelected}
                          disabled={!isVisibleForPick}
                          onChange={(e) => togglePackageSelection(a.id, e.currentTarget.checked)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 flex-shrink-0 cursor-pointer rounded border-gray-500 bg-gray-950 accent-sky-400 disabled:cursor-not-allowed disabled:opacity-35"
                          title={isVisibleForPick ? 'Add to work package' : 'Hidden by the current work package visibility filter'}
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            if (isPackagePickMode && !isVisibleForPick) return
                            setFocusedAnnotationId(a.id)
                            setLayoutEditId(null)
                            if (a.type === 'note') { openEditNoteEditor(a); return }
                            const toolKey = annotationTypeToToolKey(a.type)
                            if (toolKey && a.type !== 'textBox') {
                              setOpenPopover({ tool: toolKey as ToolMode, anchorEl: e.currentTarget as HTMLElement, mode: 'edit', editingAnnotationId: a.id })
                            }
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: getAnnotationDisplayColor(a) }} />
                            <span className={`${isPackageSelected ? 'text-sky-100' : 'text-gray-400'} truncate`}>{a.text?.trim() ? shortText(a.text, 28) : annotationLabel(a)}</span>
                            {/* BLUEPRINT-6Q — Distance/Perimeter measured value after the title (accent, non-truncating so the number stays visible). */}
                            {(() => { const mv = measurementPanelValue(a); return mv ? <span className="flex-shrink-0 whitespace-nowrap text-[11px] text-sky-300/80">— {mv}</span> : null })()}
                            {isPackageSelected && <span className="rounded-full bg-sky-400/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-200">Selected</span>}
                          </div>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); void removeAnnotation(a.id) }}
                          className="text-red-400/60 hover:text-red-300 flex-shrink-0"
                          title="Delete annotation"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )
                  }

                  const GeneratedRow = ({ a }: { a: BlueprintAnnotation }) => {
                    const meta = getAnnotationMeta(a)
                    const isPackageSelected = selectedForPackageIds.has(a.id)
                    const isVisibleForPick = isAnnotationVisibleOnCanvas(a.id)
                    return (
                      <div
                        className={`mx-2 my-0.5 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                          isPackageSelected
                            ? 'border-sky-400/70 bg-sky-500/15 shadow-[inset_3px_0_0_rgba(56,189,248,0.9)]'
                            : focusedAnnotationId === a.id
                              ? 'border-white/10 bg-white/5'
                              : 'border-transparent hover:bg-white/5'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={isPackageSelected}
                            disabled={!isVisibleForPick}
                            onChange={(e) => togglePackageSelection(a.id, e.currentTarget.checked)}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer rounded border-gray-500 bg-gray-950 accent-sky-400 disabled:cursor-not-allowed disabled:opacity-35"
                            title={isVisibleForPick ? 'Add to work package' : 'Hidden by the current work package visibility filter'}
                          />
                          <button
                            className="min-w-0 flex-1 text-left"
                            onClick={(e) => {
                              if (isPackagePickMode && !isVisibleForPick) return
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
                              {isPackageSelected && <span className="rounded-full bg-sky-400/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-200">Selected</span>}
                            </div>
                            <div className={`${isPackageSelected ? 'text-sky-100' : 'text-gray-400'} truncate mb-1.5`}>{shortText(a.text, 32)}</div>
                          </button>
                        </div>
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
                {annotationPanelExpanded && scopeLayers.length === 0 && (
                  <div className="border-t border-gray-800">
                    <div className="px-3 py-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-100">
                          <Layers size={12} /> Scope Layers
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setProjectWireTotalsOpen(true)}
                            className="rounded border border-cyan-500/50 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-100 hover:bg-cyan-500/20"
                            title="Open read-only wire totals for the current blueprint set"
                          >
                            Project Wire Totals
                          </button>
                          <span className="text-[10px] text-gray-500">{scopeLayers.length}</span>
                        </div>
                      </div>
                      <div className="mt-0.5 text-[10px] text-gray-500">V1 work packages are local to this viewer session.</div>
                    </div>
                    {pageFilteredScopeLayers.length === 0 ? (
                      <div className="px-3 pb-3 text-[10px] text-gray-600 italic">No work packages yet. Check annotations above, then create one.</div>
                    ) : (
                      <div className="space-y-2 px-3 pb-3">
                        {pageFilteredScopeLayers.map((layer) => {
                          const totalHours = getBlueprintScopeLayerLaborTotal(layer)
                          const summary = buildBlueprintScopeItemSummary(layer.itemRefs)
                          const isLayerIsolated = isolatedScopeLayerIds.has(layer.id)
                          const isLayerHidden = hiddenWorkPackageIds.has(layer.id)
                          const distinctPageCount = getBlueprintScopeLayerDistinctPageCount(layer)
                          const pageBadgeLabel = layer.pageNumber != null ? `Page ${layer.pageNumber}` : 'Unscoped'
                          return (
                            <div key={layer.id} className={`rounded-lg border bg-gray-950/30 p-2 ${isLayerIsolated ? 'border-amber-400/60 ring-1 ring-amber-400/25' : `border-gray-800 ${layer.visible ? '' : 'opacity-55'}`}`}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: layer.color || DEFAULT_SCOPE_LAYER_COLOR }} />
                                    <div className="truncate text-xs font-semibold text-gray-100">{layer.name}</div>
                                    {isLayerIsolated && (
                                      <span className="rounded-full border border-amber-400/40 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-200">{isLayerHidden ? 'Scoped View' : 'Isolated'}</span>
                                    )}
                                    {isLayerHidden && !isLayerIsolated && (
                                      <span className="rounded-full border border-rose-400/40 bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-rose-200">Hidden</span>
                                    )}
                                  </div>
                                  <div className="mt-1 text-[10px] text-gray-500">
                                    {layer.itemRefs.length} {layer.itemRefs.length === 1 ? 'item' : 'items'} · {totalHours.toFixed(1)} labor hrs
                                  </div>
                                  <div className="mt-1 flex flex-wrap items-center gap-1">
                                    <span className="rounded-full border border-gray-700 bg-gray-900/60 px-1.5 py-0.5 text-[9px] text-gray-400">{pageBadgeLabel}</span>
                                    {distinctPageCount > 1 && (
                                      <span className="rounded-full border border-indigo-500/40 bg-indigo-950/40 px-1.5 py-0.5 text-[9px] text-indigo-300">Spans {distinctPageCount} pages</span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex flex-shrink-0 items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => toggleScopeLayerIsolation(layer.id)}
                                    className={`rounded border px-1 py-0.5 text-[10px] ${isLayerIsolated ? 'border-amber-400/50 bg-amber-500/15 text-amber-200' : 'border-gray-700 text-gray-300 hover:bg-white/5'}`}
                                    title={isLayerIsolated ? 'Show all annotations' : 'Isolate this package on canvas'}
                                  >
                                    <Eye size={10} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => toggleScopeLayerHidden(layer.id)}
                                    className={`rounded border px-1 py-0.5 text-[10px] ${isLayerHidden ? 'border-rose-400/50 bg-rose-500/15 text-rose-200' : 'border-gray-700 text-gray-300 hover:bg-white/5'}`}
                                    title={isLayerHidden ? 'Show this package annotations in general view' : 'Hide this package annotations from general view'}
                                  >
                                    <EyeOff size={10} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openEditScopeLayerModal(layer)}
                                    className="rounded border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-300 hover:bg-white/5"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteScopeLayer(layer.id)}
                                    className="rounded border border-red-900/50 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-950/30"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                              {layer.description && <div className="mt-1 text-[10px] text-gray-400 line-clamp-2">{layer.description}</div>}
                              {summary.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {summary.slice(0, 4).map((item) => (
                                    <span key={item} className="rounded-full border border-gray-800 bg-gray-900/60 px-1.5 py-0.5 text-[9px] text-gray-400">{item}</span>
                                  ))}
                                  {summary.length > 4 && <span className="text-[9px] text-gray-500">+{summary.length - 4} more</span>}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
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

      <WireProfileManagerDialog
        open={isWireProfileManagerOpen}
        projectId={blueprint?.projectId}
        projectName={blueprint?.projectName}
        portalTarget={viewerPortalTarget}
        remoteRefreshVersion={wireProfileRemoteRefreshVersion}
        onForceClose={forceCloseWireProfileManager}
      />

      {projectWireTotalsOpen && createPortal(
        <ProjectWireTotalsDialog
          result={wireQuantityResult}
          onClose={() => setProjectWireTotalsOpen(false)}
        />,
        viewerPortalTarget
      )}

      {/* Ã¢â€â‚¬Ã¢â€â‚¬ Floating tool popover (portal) Ã¢â€â‚¬Ã¢â€â‚¬ */}
      {_popoverContent && openPopover && (
        <ToolPopover
          open
          anchorEl={openPopover.anchorEl}
          onClose={() => setOpenPopover(null)}
          title={_popoverContent.title}
          additionalChildren={_popoverContent.additional}
          portalContainer={viewerPortalTarget}
        >
          {_popoverContent.primary}
        </ToolPopover>
      )}

      {quickAccessModalSlot != null && quickAccessDraft && createPortal(
        <div
          className="fixed inset-0 z-[100060] flex items-center justify-center bg-black/70 p-4"
          onMouseDown={() => { setQuickAccessModalSlot(null); setQuickAccessDraft(null) }}
        >
          <div
            className="flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-gray-700 bg-[#111827] shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-gray-800 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-100">Quick Access Settings</h3>
                <p className="mt-0.5 text-xs text-gray-500">Configure local presets for the next blueprint tool placement.</p>
              </div>
              <button
                type="button"
                onClick={() => { setQuickAccessModalSlot(null); setQuickAccessDraft(null) }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white"
                aria-label="Close Quick Access settings"
              >
                <X size={15} />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 md:grid-cols-[220px_minmax(0,1fr)]">
              <div className="overflow-y-auto border-b border-gray-800 p-3 md:border-b-0 md:border-r">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">10 preset slots</div>
                <div className="grid grid-cols-2 gap-1.5 md:grid-cols-1">
                  {quickAccessPresets.map((preset, index) => (
                    <button
                      key={`quick-access-editor-slot-${index + 1}`}
                      type="button"
                      onClick={() => selectQuickAccessSlotForEdit(index)}
                      className={`flex min-h-10 items-center gap-2 rounded-md border px-2 py-1.5 text-left ${quickAccessModalSlot === index ? 'border-blue-500 bg-blue-900/25 text-blue-100' : 'border-gray-700 text-gray-300 hover:border-gray-500 hover:bg-white/5'}`}
                    >
                      <span className="w-5 shrink-0 text-[10px] font-semibold text-gray-500">{index + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-xs">{preset?.label || `+ Slot ${index + 1}`}</span>
                      {preset?.color && <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/30" style={{ backgroundColor: preset.color }} />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="min-h-0 overflow-y-auto p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-gray-100">Edit Slot {quickAccessModalSlot + 1}</div>
                  <span className="rounded-full border border-gray-700 bg-gray-900/50 px-2 py-1 text-[10px] text-gray-500">local only</span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs text-gray-400 sm:col-span-2">
                    Preset label
                    <input
                      value={quickAccessDraft.label}
                      onChange={(event) => setQuickAccessDraft((previous) => previous ? ({ ...previous, label: event.target.value }) : previous)}
                      className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500"
                      placeholder={`Slot ${quickAccessModalSlot + 1}`}
                    />
                  </label>

                  <label className="block text-xs text-gray-400 sm:col-span-2">
                    Tool / category
                    <select
                      value={quickAccessDraft.toolType}
                      onChange={(event) => {
                        const toolType = event.target.value as QuickAccessTool
                        setQuickAccessDraft((previous) => previous ? ({
                          ...previous,
                          toolType,
                          color: toolColors[toolType as ToolKey] || previous.color,
                        }) : previous)
                        if (toolType !== 'shape') setQuickAccessDraftWireProfileId(null)
                      }}
                      className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500"
                    >
                      {QUICK_ACCESS_TOOL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>

                  {quickAccessDraft.toolType === 'shape' && (
                    <label className="block text-xs text-gray-400 sm:col-span-2">
                      Shape / electrical symbol variation
                      <select
                        value={quickAccessDraft.toolVariant || 'square'}
                        onChange={(event) => {
                          const toolVariant = event.target.value as ShapeKind
                          setQuickAccessDraft((previous) => previous ? ({ ...previous, toolVariant }) : previous)
                          // Path ↔ Arc retains binding; leaving wire tools clears the draft selection display.
                          if (!supportsWireProfileAssignment({ toolType: 'shape', toolVariant })) {
                            setQuickAccessDraftWireProfileId(null)
                          }
                        }}
                        className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500"
                      >
                        <optgroup label="Shapes">
                          {GENERIC_SHAPE_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </optgroup>
                        <optgroup label="Can Lights">
                          {CAN_LIGHT_TOOL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </optgroup>
                        <optgroup label="Electrical Symbols">
                          {ELECTRICAL_SYMBOL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </optgroup>
                      </select>
                    </label>
                  )}

                  {supportsWireProfileAssignment({
                    toolType: quickAccessDraft.toolType,
                    toolVariant: quickAccessDraft.toolVariant,
                  }) && (
                    <label className="block text-xs text-gray-400 sm:col-span-2">
                      Wire Profile
                      <select
                        value={quickAccessDraftWireProfileId ?? ''}
                        onChange={(event) => {
                          const value = event.target.value
                          setQuickAccessDraftWireProfileId(value ? value : null)
                        }}
                        disabled={!blueprint?.projectId || quickAccessBindingSaving}
                        className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500 disabled:opacity-50"
                      >
                        {listSelectableQuickAccessWireProfiles(projectWireProfiles, quickAccessDraftWireProfileId).map((option) => (
                          <option key={option.profileId ?? 'unassigned'} value={option.profileId ?? ''}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <span className="mt-1 block text-[11px] leading-snug text-gray-500">
                        Assigned to new Circuit Path and Circuit Arc annotations. Visual line settings remain independent.
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-gray-600">
                        Labor remains in the Work Package.
                      </span>
                    </label>
                  )}

                  {quickAccessBindingSaveError && (
                    <div className="sm:col-span-2 rounded-md border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200">
                      {quickAccessBindingSaveError === QUICK_ACCESS_BINDING_SAVE_FAILURE_MESSAGE
                        || /could not be saved|failed/i.test(quickAccessBindingSaveError)
                        ? QUICK_ACCESS_BINDING_SAVE_FAILURE_MESSAGE
                        : quickAccessBindingSaveError}
                    </div>
                  )}

                  <label className="block text-xs text-gray-400">
                    Primary color
                    <input
                      type="color"
                      value={quickAccessDraft.color || '#facc15'}
                      onChange={(event) => setQuickAccessDraft((previous) => previous ? ({ ...previous, color: event.target.value }) : previous)}
                      className="mt-1 h-10 w-full rounded-md border border-gray-700 bg-gray-950/60 p-1"
                    />
                  </label>

                  {quickAccessDraft.toolType === 'shape' && quickAccessDraft.shapeOptions && (
                    <>
                      <label className="block text-xs text-gray-400">
                        Border color
                        <input type="color" value={quickAccessDraft.shapeOptions.borderColor}
                          onChange={(event) => setQuickAccessDraft((previous) => previous ? ({ ...previous, shapeOptions: { ...previous.shapeOptions!, borderColor: event.target.value } }) : previous)}
                          className="mt-1 h-10 w-full rounded-md border border-gray-700 bg-gray-950/60 p-1" />
                      </label>
                      <label className="block text-xs text-gray-400">
                        Fill color
                        <input type="color" value={quickAccessDraft.shapeOptions.fillColor === 'transparent' ? '#111827' : quickAccessDraft.shapeOptions.fillColor}
                          onChange={(event) => setQuickAccessDraft((previous) => previous ? ({ ...previous, shapeOptions: { ...previous.shapeOptions!, fillColor: event.target.value } }) : previous)}
                          className="mt-1 h-10 w-full rounded-md border border-gray-700 bg-gray-950/60 p-1" />
                      </label>
                      <label className="block text-xs text-gray-400">
                        Border width
                        <input type="number" min="0.5" max="20" step="0.5" value={quickAccessDraft.shapeOptions.borderThickness}
                          onChange={(event) => setQuickAccessDraft((previous) => previous ? ({ ...previous, shapeOptions: { ...previous.shapeOptions!, borderThickness: Number(event.target.value) } }) : previous)}
                          className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100" />
                      </label>
                      <label className="block text-xs text-gray-400">
                        Border style
                        <select value={quickAccessDraft.shapeOptions.borderStyle}
                          onChange={(event) => setQuickAccessDraft((previous) => previous ? ({ ...previous, shapeOptions: { ...previous.shapeOptions!, borderStyle: event.target.value as BorderStyle } }) : previous)}
                          className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100">
                          <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
                        </select>
                      </label>
                      <label className="block text-xs text-gray-400">
                        Fill opacity ({Math.round(quickAccessDraft.shapeOptions.fillOpacity * 100)}%)
                        <input type="range" min="0" max="1" step="0.05" value={quickAccessDraft.shapeOptions.fillOpacity}
                          onChange={(event) => setQuickAccessDraft((previous) => previous ? ({ ...previous, shapeOptions: { ...previous.shapeOptions!, fillOpacity: Number(event.target.value) } }) : previous)}
                          className="mt-2 w-full accent-blue-500" />
                      </label>
                      <label className="block text-xs text-gray-400">
                        Hatch
                        <select value={quickAccessDraft.shapeOptions.hatchPattern}
                          onChange={(event) => setQuickAccessDraft((previous) => previous ? ({ ...previous, shapeOptions: { ...previous.shapeOptions!, hatchPattern: event.target.value as HatchPattern } }) : previous)}
                          className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100">
                          <option value="none">None</option><option value="diagonal">Diagonal</option><option value="cross">Cross</option><option value="dots">Dots</option>
                        </select>
                      </label>
                    </>
                  )}

                  {(quickAccessDraft.toolType === 'pen' || quickAccessDraft.toolType === 'marker') && (
                    <>
                      <label className="block text-xs text-gray-400">
                        Line width
                        <input type="number" min="1" max="40" step="1"
                          value={quickAccessDraft.toolType === 'pen' ? quickAccessDraft.drawOptions?.thickness : quickAccessDraft.markerOptions?.thickness}
                          onChange={(event) => {
                            const thickness = Number(event.target.value)
                            setQuickAccessDraft((previous) => !previous ? previous : previous.toolType === 'pen'
                              ? ({ ...previous, drawOptions: { ...(previous.drawOptions || drawOptions), thickness } })
                              : ({ ...previous, markerOptions: { ...(previous.markerOptions || markerOptions), thickness } }))
                          }}
                          className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100" />
                      </label>
                      <label className="block text-xs text-gray-400">
                        Opacity
                        <input type="range" min="0.1" max="1" step="0.05"
                          value={quickAccessDraft.toolType === 'pen' ? quickAccessDraft.drawOptions?.opacity : quickAccessDraft.markerOptions?.opacity}
                          onChange={(event) => {
                            const opacity = Number(event.target.value)
                            setQuickAccessDraft((previous) => !previous ? previous : previous.toolType === 'pen'
                              ? ({ ...previous, drawOptions: { ...(previous.drawOptions || drawOptions), opacity } })
                              : ({ ...previous, markerOptions: { ...(previous.markerOptions || markerOptions), opacity } }))
                          }}
                          className="mt-2 w-full accent-blue-500" />
                      </label>
                    </>
                  )}

                  {(quickAccessDraft.toolType === 'highlight' || quickAccessDraft.toolType === 'textHighlight') && (
                    <label className="block text-xs text-gray-400 sm:col-span-2">
                      Highlight opacity ({quickAccessDraft.highlightOpacity ?? 35}%)
                      <input type="range" min="10" max="100" step="5" value={quickAccessDraft.highlightOpacity ?? 35}
                        onChange={(event) => setQuickAccessDraft((previous) => previous ? ({ ...previous, highlightOpacity: Number(event.target.value) }) : previous)}
                        className="mt-2 w-full accent-yellow-400" />
                    </label>
                  )}

                  {quickAccessDraft.toolType === 'underline' && (
                    <label className="block text-xs text-gray-400 sm:col-span-2">
                      Underline width
                      <input type="number" min="1" max="12" step="1" value={quickAccessDraft.underlineThickness ?? 2}
                        onChange={(event) => setQuickAccessDraft((previous) => previous ? ({ ...previous, underlineThickness: Number(event.target.value) }) : previous)}
                        className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100" />
                    </label>
                  )}

                  {(quickAccessDraft.toolType === 'textBox' || quickAccessDraft.toolType === 'callout') && quickAccessDraft.textStyle && (
                    <>
                      <label className="block text-xs text-gray-400">
                        Font
                        <select value={quickAccessDraft.textStyle.fontFamily || 'Helvetica'}
                          onChange={(event) => setQuickAccessDraft((previous) => previous ? ({ ...previous, textStyle: { ...previous.textStyle, fontFamily: event.target.value } }) : previous)}
                          className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100">
                          <option value="Helvetica">Helvetica</option><option value="Arial">Arial</option><option value="Times New Roman">Times New Roman</option><option value="Courier New">Courier New</option>
                        </select>
                      </label>
                      <label className="block text-xs text-gray-400">
                        Font size
                        <input type="number" min="6" max="144" step="1" value={quickAccessDraft.textStyle.fontSize || 14}
                          onChange={(event) => setQuickAccessDraft((previous) => previous ? ({ ...previous, textStyle: { ...previous.textStyle, fontSize: Number(event.target.value) } }) : previous)}
                          className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100" />
                      </label>
                      <label className="block text-xs text-gray-400">
                        Box fill
                        <input type="color" value={quickAccessDraft.textStyle.boxFill === 'transparent' ? '#ffffff' : (quickAccessDraft.textStyle.boxFill || '#ffffff')}
                          onChange={(event) => setQuickAccessDraft((previous) => previous ? ({ ...previous, textStyle: { ...previous.textStyle, boxFill: event.target.value } }) : previous)}
                          className="mt-1 h-10 w-full rounded-md border border-gray-700 bg-gray-950/60 p-1" />
                      </label>
                      <label className="block text-xs text-gray-400">
                        Border width
                        <input type="number" min="0" max="20" step="0.5" value={quickAccessDraft.textStyle.borderWidth ?? 1}
                          onChange={(event) => setQuickAccessDraft((previous) => previous ? ({ ...previous, textStyle: { ...previous.textStyle, borderWidth: Number(event.target.value) } }) : previous)}
                          className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100" />
                      </label>
                      <label className="block text-xs text-gray-400 sm:col-span-2">
                        Alignment
                        <select value={quickAccessDraft.textStyle.align || 'left'}
                          onChange={(event) => setQuickAccessDraft((previous) => previous ? ({ ...previous, textStyle: { ...previous.textStyle, align: event.target.value } }) : previous)}
                          className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100">
                          <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-xs text-gray-300">
                        <input type="checkbox" checked={!!quickAccessDraft.textStyle.bold}
                          onChange={(event) => setQuickAccessDraft((previous) => previous ? ({ ...previous, textStyle: { ...previous.textStyle, bold: event.target.checked } }) : previous)} /> Bold
                      </label>
                      <label className="flex items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-xs text-gray-300">
                        <input type="checkbox" checked={!!quickAccessDraft.textStyle.italic}
                          onChange={(event) => setQuickAccessDraft((previous) => previous ? ({ ...previous, textStyle: { ...previous.textStyle, italic: event.target.checked } }) : previous)} /> Italic
                      </label>
                    </>
                  )}

                  {quickAccessDraft.toolType.startsWith('measure-') && quickAccessDraft.measurementStyle && (
                    <>
                      <label className="block text-xs text-gray-400">
                        Line width
                        <input type="number" min="1" max="12" step="0.5" value={quickAccessDraft.measurementStyle.lineThickness || 2}
                          onChange={(event) => setQuickAccessDraft((previous) => previous ? ({ ...previous, measurementStyle: { ...previous.measurementStyle, lineThickness: Number(event.target.value) } }) : previous)}
                          className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100" />
                      </label>
                      <label className="block text-xs text-gray-400">
                        Line pattern
                        <select value={quickAccessDraft.measurementStyle.linePattern || 'solid'}
                          onChange={(event) => setQuickAccessDraft((previous) => previous ? ({ ...previous, measurementStyle: { ...previous.measurementStyle, linePattern: event.target.value } }) : previous)}
                          className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100">
                          <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option><option value="dash-dot">Dash-dot</option><option value="long-dash">Long dash</option>
                        </select>
                      </label>
                      <label className="block text-xs text-gray-400">
                        Endpoint style
                        <select value={quickAccessDraft.measurementStyle.endpointStyle || 'dot'}
                          onChange={(event) => setQuickAccessDraft((previous) => previous ? ({ ...previous, measurementStyle: { ...previous.measurementStyle, endpointStyle: event.target.value } }) : previous)}
                          className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100">
                          <option value="dot">Dot</option><option value="arrow">Arrow</option><option value="bar">Bar</option><option value="none">None</option>
                        </select>
                      </label>
                      <label className="block text-xs text-gray-400">
                        Text size
                        <input type="number" min="8" max="48" step="1" value={quickAccessDraft.measurementStyle.textSize || 12}
                          onChange={(event) => setQuickAccessDraft((previous) => previous ? ({ ...previous, measurementStyle: { ...previous.measurementStyle, textSize: Number(event.target.value) } }) : previous)}
                          className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100" />
                      </label>
                      {quickAccessDraft.toolType === 'measure-area' && (
                        <>
                          <label className="block text-xs text-gray-400">
                            Area fill color
                            <input type="color" value={quickAccessDraft.measurementStyle.fillColor || '#38bdf8'}
                              onChange={(event) => setQuickAccessDraft((previous) => previous ? ({ ...previous, measurementStyle: { ...previous.measurementStyle, fillColor: event.target.value } }) : previous)}
                              className="mt-1 h-10 w-full rounded-md border border-gray-700 bg-gray-950/60 p-1" />
                          </label>
                          <label className="block text-xs text-gray-400">
                            Fill opacity ({Math.round((quickAccessDraft.measurementStyle.fillOpacity ?? 0.15) * 100)}%)
                            <input type="range" min="0" max="1" step="0.05" value={quickAccessDraft.measurementStyle.fillOpacity ?? 0.15}
                              onChange={(event) => setQuickAccessDraft((previous) => previous ? ({ ...previous, measurementStyle: { ...previous.measurementStyle, fillOpacity: Number(event.target.value) } }) : previous)}
                              className="mt-2 w-full accent-blue-500" />
                          </label>
                        </>
                      )}
                    </>
                  )}
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-gray-800 pt-4">
                  <button
                    type="button"
                    onClick={() => { void clearQuickAccessSlot(quickAccessModalSlot) }}
                    disabled={!quickAccessPresets[quickAccessModalSlot] || quickAccessBindingSaving}
                    className="rounded-md border border-red-900/60 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Clear Slot
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setQuickAccessModalSlot(null); setQuickAccessDraft(null) }}
                      className="rounded-md border border-gray-700 px-3 py-2 text-xs text-gray-300 hover:bg-white/5"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => { void persistQuickAccessDraft() }}
                      disabled={quickAccessBindingSaving}
                      className="rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                    >
                      {quickAccessBindingSaving ? 'Saving…' : 'Save Preset'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>,
        viewerPortalTarget
      )}

      {animationRouteBuilder && createPortal(
        <PackageAnimationRouteBuilder
          draft={animationRouteBuilder.draft}
          saving={animationRouteBuilder.saving}
          conflict={animationRouteBuilder.conflict}
          onDraftChange={changePackageAnimationRouteDraft}
          onCancel={closePackageAnimationRouteBuilder}
          onSave={() => void savePackageAnimationRoute()}
          onReloadLatest={reloadLatestPackageAnimationRoute}
          onKeepDraftOpen={() => setAnimationRouteBuilder((previous) => previous ? { ...previous, conflict: undefined } : previous)}
        />,
        viewerPortalTarget
      )}

      {scopeLayerModal.open && createPortal(
        // While Package Pick mode is on, let pointer events fall THROUGH the dimmed backdrop to the
        // canvas so the user can keep tapping annotations into selectedForPackageIds with the Edit
        // modal open (in pick mode a canvas tap only toggles selection — no move/edit/geometry
        // change). The modal card re-enables pointer events so its form stays fully interactive.
        // Outside pick mode the backdrop blocks canvas interaction exactly as before.
        <div
          className={`fixed inset-0 z-[100001] flex items-center justify-center bg-black/60 px-4 ${isPackagePickMode ? 'pointer-events-none' : ''}`}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            className={`w-full max-w-2xl rounded-xl border border-gray-700 bg-[#111827] p-4 shadow-2xl ${isPackagePickMode ? 'pointer-events-auto' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-100">
                  {scopeLayerModal.mode === 'edit' ? 'Edit Work Package' : 'Create Work Package'}
                </div>
                <div className="mt-0.5 text-xs text-gray-500">
                  {selectedPackageAnnotations.length} selected {selectedPackageAnnotations.length === 1 ? 'annotation' : 'annotations'}
                </div>
              </div>
              <button
                type="button"
                onClick={closeScopeLayerModal}
                className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-gray-200"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>

            {actionMsg?.type === 'error' && (
              <div className="mb-3 rounded border border-red-900/50 bg-red-950/35 px-2 py-1.5 text-xs text-red-200">
                {actionMsg.text}
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
              <div className="space-y-2">
                <label className="block text-[11px] text-gray-400">
                  Work Package Name
                  <input
                    value={scopeLayerForm.name}
                    onChange={(e) => setScopeLayerForm((prev) => ({ ...prev, name: e.target.value }))}
                    className="mt-1 w-full rounded border border-gray-700 bg-gray-950/60 px-2 py-1.5 text-xs text-gray-100 outline-none focus:border-sky-500"
                    placeholder="Bedroom 1 Lighting"
                  />
                </label>
                <label className="block text-[11px] text-gray-400">
                  Description / Scope Summary
                  <textarea
                    value={scopeLayerForm.description}
                    onChange={(e) => setScopeLayerForm((prev) => ({ ...prev, description: e.target.value }))}
                    className="mt-1 h-16 w-full resize-none rounded border border-gray-700 bg-gray-950/60 px-2 py-1.5 text-xs text-gray-100 outline-none focus:border-sky-500"
                    placeholder="Brief scope summary..."
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-[11px] text-gray-400">
                    Color
                    <input
                      type="color"
                      value={scopeLayerForm.color}
                      onChange={(e) => setScopeLayerForm((prev) => ({ ...prev, color: e.target.value }))}
                      className="mt-1 h-8 w-full rounded border border-gray-700 bg-gray-950/60 p-1"
                    />
                  </label>
                  {[
                    ['roughInHours', 'Rough-in hours'],
                    ['trimHours', 'Trim hours'],
                    ['testingHours', 'Testing hours'],
                    ['cleanupHours', 'Cleanup hours'],
                  ].map(([key, label]) => (
                    <label key={key} className="block text-[11px] text-gray-400">
                      {label}
                      <input
                        type="number"
                        min="0"
                        step="0.25"
                        value={(scopeLayerForm as any)[key]}
                        onChange={(e) => setScopeLayerForm((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                        className="mt-1 w-full rounded border border-gray-700 bg-gray-950/60 px-2 py-1.5 text-xs text-gray-100 outline-none focus:border-sky-500"
                      />
                    </label>
                  ))}
                </div>
                <label className="block text-[11px] text-gray-400">
                  Crew Notes
                  <textarea
                    value={scopeLayerForm.crewNotes}
                    onChange={(e) => setScopeLayerForm((prev) => ({ ...prev, crewNotes: e.target.value }))}
                    className="mt-1 h-14 w-full resize-none rounded border border-gray-700 bg-gray-950/60 px-2 py-1.5 text-xs text-gray-100 outline-none focus:border-sky-500"
                    placeholder="Crew notes..."
                  />
                </label>
                <label className="block text-[11px] text-gray-400">
                  Customer Proposal Summary
                  <textarea
                    value={scopeLayerForm.proposalSummary}
                    onChange={(e) => setScopeLayerForm((prev) => ({ ...prev, proposalSummary: e.target.value }))}
                    className="mt-1 h-14 w-full resize-none rounded border border-gray-700 bg-gray-950/60 px-2 py-1.5 text-xs text-gray-100 outline-none focus:border-sky-500"
                    placeholder="Customer-facing summary..."
                  />
                </label>
              </div>

              <div className="rounded-lg border border-gray-800 bg-gray-950/30 p-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-semibold text-gray-300">Items</div>
                  <span className="rounded-full bg-gray-800 px-1.5 py-0.5 text-[9px] font-semibold text-gray-300">{selectedPackageItemRefs.length}</span>
                </div>
                <div className="mt-0.5 text-[10px] text-gray-500">Items in this work package. Remove is package-only — the annotation stays on the plan.</div>
                {selectedPackageSummary.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {selectedPackageSummary.map((item) => (
                      <span key={item} className="rounded-full border border-gray-800 bg-gray-900/50 px-1.5 py-0.5 text-[9px] text-gray-300">{item}</span>
                    ))}
                  </div>
                )}
                {/* Add items collected in Package Pick mode (skips items already in the package).
                    Enabled whenever Package Pick has at least one selected annotation that is not
                    already in this package — driven by the same selectedForPackageIds source as the
                    "Package Pick: N selected" banner, resolved against the full annotation list. */}
                <button
                  type="button"
                  onClick={addPickedItemsToScopeDraft}
                  disabled={addablePickedAnnotationIds.length === 0}
                  className="mt-2 w-full rounded border border-emerald-500/50 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-900/40 disabled:text-gray-600"
                  title="Add items selected with Package Pick to this work package"
                >
                  Add selected items{addablePickedAnnotationIds.length > 0 ? ` (${addablePickedAnnotationIds.length})` : ''}
                </button>
                <div className="mt-2 max-h-48 overflow-auto border-t border-gray-800 pt-2">
                  {selectedPackageItemRefs.length === 0 && (
                    <div className="py-2 text-[10px] italic text-gray-600">No items yet. Turn on Package Pick, tap items on the canvas, then Add selected items.</div>
                  )}
                  {selectedPackageItemRefs.map((item) => {
                    const itemAnnotation = selectedPackageAnnotations.find((annotation) => annotation.id === item.annotationId)
                    return (
                      <div key={item.annotationId} className="mb-1 flex items-center gap-1.5 text-[10px] text-gray-400">
                        <span
                          className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: itemAnnotation ? getAnnotationDisplayColor(itemAnnotation) : '#facc15' }}
                        />
                        <span className="min-w-0 flex-1 truncate">Pg {item.pageNumber}: {item.label}</span>
                        <button
                          type="button"
                          onClick={() => removeScopeDraftItem(item.annotationId)}
                          className="flex-shrink-0 rounded p-0.5 text-red-400/70 hover:bg-red-950/40 hover:text-red-300"
                          title="Remove this item from the work package (does not delete the annotation)"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-2 rounded border border-sky-900/40 bg-sky-950/20 px-2 py-1 text-[10px] text-sky-200">
                  Labor total: {getBlueprintScopeLayerLaborTotal(scopeLayerForm as any).toFixed(1)} hrs
                </div>
                {scopeLayerDraftWireQuantityRollup && (
                  <div className="mt-2">
                    <WireQuantitySummary
                      totals={scopeLayerDraftWireQuantityRollup.totals}
                      contributions={scopeLayerDraftWireQuantityResult?.contributions || []}
                      diagnostics={scopeLayerDraftWireQuantityRollup.diagnostics}
                      emptyText="No measurable circuit routes in this Work Package."
                      compact
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeScopeLayerModal}
                className="rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveScopeLayerFromModal}
                className="rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
              >
                Save Work Package
              </button>
            </div>
          </div>
        </div>,
        viewerPortalTarget
      )}

      {/* ── Symbols Size — draggable label-scale popup ──
          Adjusts symbol LABEL text size only (via symbolLabelScale → renderElectricalSymbolSvg's
          externalLabel). Never resizes symbol glyphs, boxes, or annotation geometry, and never
          writes annotation data. Local UI state only. */}
      {isSymbolSizePanelOpen && createPortal(
        <div
          className="fixed z-[100000] w-56 rounded-lg border border-gray-700 bg-[#111827] shadow-2xl"
          style={{ left: symbolSizePanelPos.x, top: symbolSizePanelPos.y }}
        >
          <div
            onPointerDown={handleSymbolSizeDragStart}
            onPointerMove={handleSymbolSizeDragMove}
            onPointerUp={handleSymbolSizeDragEnd}
            onPointerCancel={handleSymbolSizeDragEnd}
            className="flex touch-none cursor-move select-none items-center justify-between gap-2 rounded-t-lg border-b border-gray-700 bg-gray-800/60 px-2.5 py-1.5"
          >
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-100"><Type size={12} /> Symbols Size</span>
            <button
              type="button"
              onClick={() => setIsSymbolSizePanelOpen(false)}
              className="rounded p-0.5 text-gray-400 hover:bg-white/10 hover:text-gray-200"
              title="Close"
            >
              <X size={13} />
            </button>
          </div>
          <div className="px-3 py-2.5">
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-gray-400">
              <span>Label text size</span>
              <span className="font-semibold text-cyan-300">{Math.round(symbolLabelScale * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.75}
              max={5}
              step={0.05}
              value={symbolLabelScale}
              onChange={(e) => setSymbolLabelScale(Number(e.target.value))}
              className="w-full accent-cyan-400"
            />
            <div className="mt-1 flex items-center justify-between text-[9px] text-gray-500">
              <span>75%</span>
              <button
                type="button"
                onClick={() => setSymbolLabelScale(1)}
                className="rounded border border-gray-700 px-1.5 py-0.5 text-[9px] text-gray-300 hover:bg-white/5"
              >
                Reset 100%
              </button>
              <span>500%</span>
            </div>
            <div className="mt-2 text-[9px] text-gray-500">Adjusts symbol label text only — symbol shapes and positions are unchanged.</div>

            <div className="mt-3 border-t border-gray-700 pt-2.5">
              <button
                type="button"
                onClick={() => setSymbolLabelCustomColorsEnabled((v) => !v)}
                className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-[11px] ${symbolLabelCustomColorsEnabled ? 'border-cyan-500 bg-cyan-900/20 text-cyan-300' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                title="Override label text/border/fill colors (labels only, not symbol bodies)"
              >
                <span>Custom Label Colors</span>
                <span className={`inline-flex h-4 w-7 items-center rounded-full px-0.5 ${symbolLabelCustomColorsEnabled ? 'bg-cyan-500 justify-end' : 'bg-gray-600 justify-start'}`}>
                  <span className="h-3 w-3 rounded-full bg-white" />
                </span>
              </button>

              {symbolLabelCustomColorsEnabled && (
                <div className="mt-2 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-gray-400">
                    <span>Text</span>
                    <input
                      type="color"
                      value={symbolLabelTextColor}
                      onChange={(e) => setSymbolLabelTextColor(e.target.value)}
                      className="h-5 w-8 cursor-pointer rounded border border-gray-700 bg-transparent p-0"
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-gray-400">
                    <span>Border</span>
                    <input
                      type="color"
                      value={symbolLabelBorderColor}
                      onChange={(e) => setSymbolLabelBorderColor(e.target.value)}
                      className="h-5 w-8 cursor-pointer rounded border border-gray-700 bg-transparent p-0"
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-gray-400">
                    <span>Fill</span>
                    <input
                      type="color"
                      value={symbolLabelFillColor}
                      onChange={(e) => setSymbolLabelFillColor(e.target.value)}
                      className="h-5 w-8 cursor-pointer rounded border border-gray-700 bg-transparent p-0"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSymbolLabelTextColor('#22d3ee')
                      setSymbolLabelBorderColor('#22d3ee')
                      setSymbolLabelFillColor('#0b1020')
                    }}
                    className="w-full rounded border border-gray-700 px-1.5 py-0.5 text-[9px] text-gray-300 hover:bg-white/5"
                  >
                    Reset Colors
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>,
        viewerPortalTarget
      )}

      {/* ── Floating action bar — portal to body so it is never clipped by the scroll container ── */}
      {focusedAnnotationId && !inlineTextEditId && annotationsVisible && isAnnotationVisibleOnCanvas(focusedAnnotationId) && (() => {
        const focusedAnn = allAnnotations.find(ann => ann.id === focusedAnnotationId)
        if (!focusedAnn) return null
        const isLayoutEditingFocused = layoutEditId === focusedAnnotationId
        // BLUEPRINT-6L/6N — measure-distance moves (endpoint editing) and styles like other shapes;
        // BLUEPRINT-6N adds measure-perimeter (Move = per-point/axle editing, Edit = color/width/pattern).
        // measure-area is intentionally left unchanged.
        const fCanMove = focusedAnn.type === 'callout' || focusedAnn.type === 'generate' || focusedAnn.type === 'textBox' || focusedAnn.type === 'shape' || focusedAnn.type === 'highlight' || focusedAnn.type === 'textHighlight' || focusedAnn.type === 'underline' || focusedAnn.type === 'note' || focusedAnn.type === 'measure-distance' || focusedAnn.type === 'measure-perimeter'
        const fCanStyle = focusedAnn.type === 'highlight' || focusedAnn.type === 'textHighlight' || focusedAnn.type === 'underline' || focusedAnn.type === 'shape' || focusedAnn.type === 'pen' || focusedAnn.type === 'marker' || focusedAnn.type === 'callout' || focusedAnn.type === 'generate' || focusedAnn.type === 'textBox' || focusedAnn.type === 'measure-distance' || focusedAnn.type === 'measure-perimeter'
        const fCanRotate = focusedAnn.type === 'shape' && isRotatableElectricalShapeKind(getAnnotationMeta(focusedAnn).shapeKind)
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
              zIndex: 100050,
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
            {fCanRotate && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  rotateAnnotationSymbol(focusedAnn)
                }}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white hover:bg-white/10"
                title="Rotate symbol 90°"
              >
                <RotateCw size={10} /> Rotate
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
        return createPortal(bar, viewerPortalTarget)
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
        viewerPortalTarget
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
        viewerPortalTarget
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
                <div className={`text-xs px-2 py-1.5 rounded ${packageAnimationRouteActionMessageClass(actionMsg.type)}`}>
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
        viewerPortalTarget
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
                <div className={`text-xs px-2 py-1.5 rounded ${packageAnimationRouteActionMessageClass(actionMsg.type)}`}>
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
        viewerPortalTarget
      )}
    </div>
  )
}
