/**
 * src/features/blueprint-vr/blueprintPlanScanner.ts
 *
 * Deterministic blueprint plan scanner — first foundation for the Generate VR
 * pipeline that walks "active blueprint → traced floor plan → 3D dollhouse".
 *
 * Today this module focuses on the architecture seam and a deterministic
 * "scan-ready fallback" so the rest of the Generate VR experience can stop
 * stacking generic 40×30 boxes. When real PDF vector trace data arrives
 * upstream (see blueprintTraceAdapter.ts), the scanner consumes it through the
 * exact same contract and returns a higher-confidence model.
 *
 * Behavior:
 *  - Never calls OCR, AI, cloud, or external services.
 *  - Never pretends recognition succeeded when no data is available.
 *  - Always returns deterministic output for the same input.
 *  - When no trace lines are available, it returns a "scan-ready fallback" with
 *    plain-language warnings, plus a project-context aware suite layout (e.g.
 *    a long/narrow Beauty Salon tenant-improvement plan).
 */

import type {
  BlueprintBuildingModel,
  BuildingLevelModel,
  BuildingRoomModel,
  BuildingWallModel,
  BuildingOpeningModel,
  Point2D,
  Rectangle,
  Bounds2D,
  MeasurementValue,
} from './buildingModel'
import { createMeasurement } from './dimensionModel'
import type {
  AdaptedTrace,
  PlanTraceLine,
} from './blueprintTraceAdapter'
import { adaptPdfTraceToPlanLines } from './blueprintTraceAdapter'
import type { PdfTracePagePayload } from './pdfTraceTypes'

// ---------------------------------------------------------------------------
// Scanner input / output contracts
// ---------------------------------------------------------------------------

/**
 * Per-sheet hint that the scanner uses for context (titles, labels, page).
 */
export interface BlueprintPlanScanSheetHint {
  pageNumber: number
  sheetNumber?: string
  sheetTitle?: string
  sheetLabel?: string
  discipline?: string
}

/**
 * Input shape consumed by scanBlueprintPlan().
 *
 * Anything optional may be omitted — the scanner degrades gracefully.
 */
export interface BlueprintPlanScanInput {
  /** Project / customer name (e.g. "Beauty Salon"). */
  projectName?: string
  /** Active blueprint title (e.g. "BEAUTY SALON FINAL"). */
  blueprintTitle?: string
  /** File name of the active blueprint. */
  fileName?: string
  /** Currently active page in the PDF viewer, 1-based. */
  activePageNumber?: number
  /** Total pages in the active PDF, if known. */
  totalPages?: number
  /** Free-form extracted text (any side-channel). */
  extractedText?: string
  /** Annotation summary text. */
  annotationsSummary?: string
  /** Sheet index rows associated with this set. */
  sheetIndex?: BlueprintPlanScanSheetHint[]
  /** Vector trace payload for the active page, if available. */
  tracePayload?: PdfTracePagePayload | null
  /** Any known dimension strings already parsed elsewhere. */
  knownDimensionsFt?: { width?: number; depth?: number }
}

/**
 * A wall the scanner believes is part of the final building plan.
 */
export interface PlanWallCandidate {
  id: string
  start: Point2D
  end: Point2D
  thicknessFt: number
  exterior: boolean
  confidence: number
}

/**
 * A wall opening (door or window) the scanner believes is part of the plan.
 */
export interface PlanOpeningCandidate {
  id: string
  /** Wall id this opening lives on. */
  wallId: string
  type: 'door' | 'window'
  /** Distance from wall start, in feet. */
  positionFt: number
  widthFt: number
  heightFt: number
  confidence: number
}

/**
 * An enclosed room region.
 */
export interface PlanRoomCandidate {
  id: string
  label: string
  bounds: Bounds2D
  type: 'reception' | 'waiting' | 'styling' | 'hallway' | 'bath' | 'utility' |
        'storage' | 'service' | 'office' | 'living' | 'bedroom' | 'kitchen' |
        'garage' | 'other'
  confidence: number
}

/**
 * Dimension annotation discovered or inferred by the scanner.
 */
export interface PlanDimensionCandidate {
  id: string
  start: Point2D
  end: Point2D
  valueFt: number
  label: string
  confidence: number
}

export type PlanScanWarningCode =
  | 'NO_TRACE_INPUT'
  | 'NO_SHEET_CONTEXT'
  | 'AMBIGUOUS_SUITE_SHAPE'
  | 'FALLBACK_LAYOUT_USED'
  | 'LOW_CONFIDENCE'
  | 'NARROW_SUITE_ASSUMED'
  | 'SALON_CONTEXT_DETECTED'
  | 'COMMERCIAL_CONTEXT_DETECTED'
  | 'RESIDENTIAL_CONTEXT_DETECTED'

export interface PlanScanWarning {
  code: PlanScanWarningCode
  message: string
}

export interface BlueprintPlanScanResult {
  /** Building footprint in feet (axis-aligned). */
  footprint: Rectangle
  /** Wall candidates that close the footprint. */
  walls: PlanWallCandidate[]
  /** Door / window candidates positioned along walls. */
  openings: PlanOpeningCandidate[]
  /** Room candidates that tile the suite without overlap. */
  rooms: PlanRoomCandidate[]
  /** Dimension annotations. */
  dimensions: PlanDimensionCandidate[]
  /** Warning messages for the UI. */
  warnings: PlanScanWarning[]
  /** Adapted plan trace lines (empty when no upstream trace was supplied). */
  traceLines: PlanTraceLine[]
  /** True when the scan came from fallback / context inference. */
  isFallback: boolean
  /** Overall confidence in the scan result, 0–1. */
  confidence: number
  /** Snapshot of the suite "character" the scanner picked. */
  layoutContext:
    | 'salon-tenant-suite'
    | 'commercial-suite'
    | 'residential'
    | 'electrical-room'
    | 'generic'
  /** Metadata snapshot for diagnostics / display. */
  metadata: {
    projectName?: string
    blueprintTitle?: string
    activePageNumber?: number
    totalPages?: number
    generatedAt: string
  }
}

// ---------------------------------------------------------------------------
// Footprint and wall inference helpers (used by future real-trace path)
// ---------------------------------------------------------------------------

/**
 * Compute a tight axis-aligned bounding box around all trace lines.
 */
export function inferBuildingFootprintFromTraceLines(
  lines: PlanTraceLine[],
): Rectangle | null {
  if (!lines || lines.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const l of lines) {
    minX = Math.min(minX, l.start.x, l.end.x)
    minY = Math.min(minY, l.start.y, l.end.y)
    maxX = Math.max(maxX, l.start.x, l.end.x)
    maxY = Math.max(maxY, l.start.y, l.end.y)
  }
  if (!isFinite(minX) || !isFinite(maxX)) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Keep orthogonal lines longer than a minimum length as walls.
 */
export function inferWallsFromOrthogonalLines(
  lines: PlanTraceLine[],
  minLengthFt = 3,
): PlanWallCandidate[] {
  if (!lines || lines.length === 0) return []
  return lines
    .filter((l) => l.orthogonal && l.lengthFt >= minLengthFt)
    .map((l, i) => ({
      id: `wall-trace-${i}`,
      start: l.start,
      end: l.end,
      thicknessFt: 0.5,
      exterior: l.role === 'exterior-wall',
      confidence: l.confidence ?? 0.5,
    }))
}

/**
 * Place opening candidates where short collinear gaps appear in wall runs.
 *
 * Today this is intentionally simple: it produces no openings when the trace
 * line set is empty (fallback path supplies its own openings).
 */
export function inferOpeningsFromGaps(
  walls: PlanWallCandidate[],
  lines: PlanTraceLine[],
): PlanOpeningCandidate[] {
  if (!walls.length || !lines.length) return []
  const openings: PlanOpeningCandidate[] = []
  let id = 0
  for (const line of lines) {
    if (line.role !== 'door' && line.role !== 'window') continue
    // Find the closest wall this opening belongs to.
    let best: PlanWallCandidate | null = null
    let bestDist = Infinity
    for (const wall of walls) {
      const dx = (wall.start.x + wall.end.x) / 2 - (line.start.x + line.end.x) / 2
      const dy = (wall.start.y + wall.end.y) / 2 - (line.start.y + line.end.y) / 2
      const d = Math.hypot(dx, dy)
      if (d < bestDist) {
        best = wall
        bestDist = d
      }
    }
    if (!best) continue
    const wallLen = Math.hypot(best.end.x - best.start.x, best.end.y - best.start.y) || 1
    const mid = {
      x: (line.start.x + line.end.x) / 2,
      y: (line.start.y + line.end.y) / 2,
    }
    const t = Math.max(
      0,
      Math.min(
        1,
        ((mid.x - best.start.x) * (best.end.x - best.start.x) +
          (mid.y - best.start.y) * (best.end.y - best.start.y)) /
          (wallLen * wallLen),
      ),
    )
    openings.push({
      id: `opening-trace-${id++}`,
      wallId: best.id,
      type: line.role === 'window' ? 'window' : 'door',
      positionFt: t * wallLen,
      widthFt: Math.min(4, Math.max(2, line.lengthFt)),
      heightFt: line.role === 'window' ? 4 : 7,
      confidence: line.confidence ?? 0.4,
    })
  }
  return openings
}

/**
 * Very lightweight room inference from a trace set.
 *
 * Today, when no enclosed regions can be derived, this returns an empty array
 * and the scanner falls through to the context-aware suite generator.
 */
export function inferRoomsFromEnclosedOrGridLayout(
  walls: PlanWallCandidate[],
  footprint: Rectangle | null,
): PlanRoomCandidate[] {
  if (!walls.length || !footprint) return []
  // The deterministic "trace path" room solver is intentionally stubbed for
  // now. Returning an empty array signals to scanBlueprintPlan() that it should
  // hand off to the context fallback.
  return []
}

// ---------------------------------------------------------------------------
// Context detection
// ---------------------------------------------------------------------------

function detectLayoutContext(
  input: BlueprintPlanScanInput,
): BlueprintPlanScanResult['layoutContext'] {
  const combined = [
    input.projectName,
    input.blueprintTitle,
    input.fileName,
    input.extractedText,
    input.annotationsSummary,
    ...(input.sheetIndex || []).map((s) =>
      [s.sheetNumber, s.sheetTitle, s.sheetLabel, s.discipline].join(' '),
    ),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (
    combined.includes('salon') ||
    combined.includes('spa') ||
    combined.includes('beauty') ||
    combined.includes('barber') ||
    combined.includes('nail')
  ) {
    return 'salon-tenant-suite'
  }
  if (
    combined.includes('panel room') ||
    combined.includes('electrical room') ||
    combined.includes('mep')
  ) {
    return 'electrical-room'
  }
  if (
    combined.includes('office') ||
    combined.includes('suite') ||
    combined.includes('tenant') ||
    combined.includes('commercial')
  ) {
    return 'commercial-suite'
  }
  if (
    combined.includes('residential') ||
    combined.includes('house') ||
    combined.includes('apartment') ||
    combined.includes('home')
  ) {
    return 'residential'
  }
  return 'generic'
}

// ---------------------------------------------------------------------------
// Long / narrow Beauty Salon fallback layout
// ---------------------------------------------------------------------------

interface RawRoom {
  id: string
  label: string
  type: PlanRoomCandidate['type']
  bounds: Bounds2D
}

function buildSalonSuiteLayoutRaw(): { footprint: Rectangle; rooms: RawRoom[] } {
  // Long vertical tenant suite: 18 ft wide × 50 ft deep.
  // y = depth (long axis, 0 = front entry, 50 = back of suite).
  // x = width across the suite.
  const W = 18
  const D = 50
  const footprint: Rectangle = { x: 0, y: 0, width: W, height: D }

  const rooms: RawRoom[] = [
    {
      id: 'entrance',
      label: 'Entrance / Reception',
      type: 'reception',
      bounds: { min: { x: 0, y: 0 }, max: { x: W, y: 10 } },
    },
    {
      id: 'styling',
      label: 'Styling Floor',
      type: 'styling',
      bounds: { min: { x: 0, y: 10 }, max: { x: W, y: 32 } },
    },
    {
      id: 'service',
      label: 'Back Service Room',
      type: 'service',
      bounds: { min: { x: 0, y: 32 }, max: { x: 6, y: 50 } },
    },
    {
      id: 'hallway',
      label: 'Hallway / Circulation',
      type: 'hallway',
      bounds: { min: { x: 6, y: 32 }, max: { x: 14, y: 42 } },
    },
    {
      id: 'storage',
      label: 'Storage',
      type: 'storage',
      bounds: { min: { x: 6, y: 42 }, max: { x: 14, y: 50 } },
    },
    {
      id: 'bath',
      label: 'Restroom',
      type: 'bath',
      bounds: { min: { x: 14, y: 32 }, max: { x: W, y: 40 } },
    },
    {
      id: 'utility',
      label: 'Utility / Panel',
      type: 'utility',
      bounds: { min: { x: 14, y: 40 }, max: { x: W, y: 50 } },
    },
  ]
  return { footprint, rooms }
}

function buildCommercialSuiteLayoutRaw(): { footprint: Rectangle; rooms: RawRoom[] } {
  // Commercial tenant suite: 22 ft wide × 36 ft deep.
  const W = 22
  const D = 36
  return {
    footprint: { x: 0, y: 0, width: W, height: D },
    rooms: [
      {
        id: 'reception',
        label: 'Reception / Lobby',
        type: 'reception',
        bounds: { min: { x: 0, y: 0 }, max: { x: W, y: 9 } },
      },
      {
        id: 'office-a',
        label: 'Office A',
        type: 'office',
        bounds: { min: { x: 0, y: 9 }, max: { x: 11, y: 22 } },
      },
      {
        id: 'office-b',
        label: 'Office B',
        type: 'office',
        bounds: { min: { x: 11, y: 9 }, max: { x: W, y: 22 } },
      },
      {
        id: 'conference',
        label: 'Conference',
        type: 'other',
        bounds: { min: { x: 0, y: 22 }, max: { x: 14, y: 36 } },
      },
      {
        id: 'bath',
        label: 'Restroom',
        type: 'bath',
        bounds: { min: { x: 14, y: 22 }, max: { x: W, y: 30 } },
      },
      {
        id: 'utility',
        label: 'Utility / Panel',
        type: 'utility',
        bounds: { min: { x: 14, y: 30 }, max: { x: W, y: 36 } },
      },
    ],
  }
}

function buildResidentialLayoutRaw(): { footprint: Rectangle; rooms: RawRoom[] } {
  // Residential: 28 ft × 36 ft.
  const W = 28
  const D = 36
  return {
    footprint: { x: 0, y: 0, width: W, height: D },
    rooms: [
      {
        id: 'living',
        label: 'Living Room',
        type: 'living',
        bounds: { min: { x: 0, y: 0 }, max: { x: 18, y: 16 } },
      },
      {
        id: 'kitchen',
        label: 'Kitchen',
        type: 'kitchen',
        bounds: { min: { x: 18, y: 0 }, max: { x: W, y: 16 } },
      },
      {
        id: 'bedroom',
        label: 'Bedroom',
        type: 'bedroom',
        bounds: { min: { x: 0, y: 16 }, max: { x: 14, y: 30 } },
      },
      {
        id: 'bath',
        label: 'Bathroom',
        type: 'bath',
        bounds: { min: { x: 14, y: 16 }, max: { x: 22, y: 30 } },
      },
      {
        id: 'utility',
        label: 'Utility / Panel',
        type: 'utility',
        bounds: { min: { x: 22, y: 16 }, max: { x: W, y: 36 } },
      },
      {
        id: 'hall',
        label: 'Hallway',
        type: 'hallway',
        bounds: { min: { x: 0, y: 30 }, max: { x: 22, y: 36 } },
      },
    ],
  }
}

function buildElectricalRoomLayoutRaw(): { footprint: Rectangle; rooms: RawRoom[] } {
  const W = 22
  const D = 16
  return {
    footprint: { x: 0, y: 0, width: W, height: D },
    rooms: [
      {
        id: 'panel-room',
        label: 'Electrical Panel Room',
        type: 'utility',
        bounds: { min: { x: 0, y: 0 }, max: { x: W, y: D } },
      },
    ],
  }
}

function buildGenericLayoutRaw(): { footprint: Rectangle; rooms: RawRoom[] } {
  const W = 30
  const D = 22
  return {
    footprint: { x: 0, y: 0, width: W, height: D },
    rooms: [
      {
        id: 'main',
        label: 'Main Space',
        type: 'other',
        bounds: { min: { x: 0, y: 0 }, max: { x: W - 6, y: D } },
      },
      {
        id: 'utility',
        label: 'Utility / Panel',
        type: 'utility',
        bounds: { min: { x: W - 6, y: 0 }, max: { x: W, y: D } },
      },
    ],
  }
}

/**
 * Choose the suite fallback layout based on blueprint context.
 *
 * Exported so external callers can preview which layout the scanner would pick
 * without running the full scan pipeline.
 */
export function chooseSalonSuiteFallbackFromBlueprintContext(
  context: BlueprintPlanScanResult['layoutContext'],
): { footprint: Rectangle; rooms: RawRoom[] } {
  switch (context) {
    case 'salon-tenant-suite':
      return buildSalonSuiteLayoutRaw()
    case 'commercial-suite':
      return buildCommercialSuiteLayoutRaw()
    case 'residential':
      return buildResidentialLayoutRaw()
    case 'electrical-room':
      return buildElectricalRoomLayoutRaw()
    case 'generic':
    default:
      return buildGenericLayoutRaw()
  }
}

// ---------------------------------------------------------------------------
// Walls / openings from a tiled room set
// ---------------------------------------------------------------------------

function buildWallsAndOpeningsFromRooms(
  footprint: Rectangle,
  rooms: RawRoom[],
): { walls: PlanWallCandidate[]; openings: PlanOpeningCandidate[] } {
  const walls: PlanWallCandidate[] = []
  const openings: PlanOpeningCandidate[] = []
  const fpMinX = footprint.x
  const fpMinY = footprint.y
  const fpMaxX = footprint.x + footprint.width
  const fpMaxY = footprint.y + footprint.height

  rooms.forEach((room) => {
    const { min, max } = room.bounds
    const isExterior = (a: Point2D, b: Point2D): boolean => {
      const onWest = a.x === fpMinX && b.x === fpMinX
      const onEast = a.x === fpMaxX && b.x === fpMaxX
      const onNorth = a.y === fpMinY && b.y === fpMinY
      const onSouth = a.y === fpMaxY && b.y === fpMaxY
      return onWest || onEast || onNorth || onSouth
    }
    const sides: Array<{ id: string; a: Point2D; b: Point2D }> = [
      { id: `${room.id}_wall_n`, a: { x: min.x, y: min.y }, b: { x: max.x, y: min.y } },
      { id: `${room.id}_wall_s`, a: { x: min.x, y: max.y }, b: { x: max.x, y: max.y } },
      { id: `${room.id}_wall_w`, a: { x: min.x, y: min.y }, b: { x: min.x, y: max.y } },
      { id: `${room.id}_wall_e`, a: { x: max.x, y: min.y }, b: { x: max.x, y: max.y } },
    ]
    for (const s of sides) {
      const exterior = isExterior(s.a, s.b)
      walls.push({
        id: s.id,
        start: s.a,
        end: s.b,
        thicknessFt: 0.5,
        exterior,
        confidence: 0.55,
      })
    }
  })

  // Doors: one door on each room's "inward" side. We anchor doors at the side
  // closest to the suite center for a believable circulation pattern.
  rooms.forEach((room) => {
    const center = footprint
    const cx = center.x + center.width / 2
    const cy = center.y + center.height / 2
    const rcx = (room.bounds.min.x + room.bounds.max.x) / 2
    const rcy = (room.bounds.min.y + room.bounds.max.y) / 2
    const wallId =
      Math.abs(rcx - cx) > Math.abs(rcy - cy)
        ? rcx > cx
          ? `${room.id}_wall_w`
          : `${room.id}_wall_e`
        : rcy > cy
        ? `${room.id}_wall_n`
        : `${room.id}_wall_s`
    const targetWall = walls.find((w) => w.id === wallId)
    if (!targetWall) return
    const wallLen = Math.hypot(
      targetWall.end.x - targetWall.start.x,
      targetWall.end.y - targetWall.start.y,
    )
    if (wallLen < 3) return
    openings.push({
      id: `${room.id}_door`,
      wallId,
      type: 'door',
      positionFt: wallLen / 2,
      widthFt: Math.min(3.5, Math.max(2.5, wallLen / 4)),
      heightFt: 7,
      confidence: 0.45,
    })
  })

  // Storefront window on the front (south? we keep y=0 as front) exterior wall.
  const frontExterior = walls.find(
    (w) =>
      w.exterior &&
      w.start.y === fpMinY &&
      w.end.y === fpMinY &&
      Math.abs(w.end.x - w.start.x) >= 6,
  )
  if (frontExterior) {
    const wallLen = Math.abs(frontExterior.end.x - frontExterior.start.x)
    openings.push({
      id: `${frontExterior.id}_storefront`,
      wallId: frontExterior.id,
      type: 'window',
      positionFt: wallLen / 2,
      widthFt: Math.min(8, wallLen * 0.5),
      heightFt: 6,
      confidence: 0.5,
    })
  }

  return { walls, openings }
}

// ---------------------------------------------------------------------------
// Main scan entry point
// ---------------------------------------------------------------------------

/**
 * Scan a blueprint plan into a deterministic candidate model.
 *
 * If the input provides a vector trace payload, the scanner will adapt it and
 * attempt to recover walls/openings/rooms from those candidates. When trace
 * data is unavailable (the common case today), the scanner falls back to a
 * context-aware suite layout and reports the inferred status clearly.
 */
export function scanBlueprintPlan(
  input: BlueprintPlanScanInput,
): BlueprintPlanScanResult {
  const warnings: PlanScanWarning[] = []
  const layoutContext = detectLayoutContext(input)
  const generatedAt = new Date().toISOString()

  // 1. Adapt any upstream trace data.
  const adapted: AdaptedTrace = adaptPdfTraceToPlanLines(input.tracePayload)
  const traceLines = adapted.lines

  // 2. When real trace lines exist, try to infer geometry from them.
  let inferredFootprint = inferBuildingFootprintFromTraceLines(traceLines)
  let inferredWalls = inferWallsFromOrthogonalLines(traceLines)
  let inferredOpenings = inferOpeningsFromGaps(inferredWalls, traceLines)
  let inferredRooms = inferRoomsFromEnclosedOrGridLayout(inferredWalls, inferredFootprint)

  // 3. Decide whether the trace path can succeed.
  const traceUsable =
    !!inferredFootprint &&
    inferredFootprint.width > 6 &&
    inferredFootprint.height > 6 &&
    inferredWalls.length >= 4 &&
    inferredRooms.length >= 1

  // 4. If trace not usable, fall back to context layout.
  let footprint: Rectangle
  let walls: PlanWallCandidate[]
  let openings: PlanOpeningCandidate[]
  let rooms: PlanRoomCandidate[]
  let isFallback: boolean
  let confidence: number

  if (traceUsable) {
    footprint = inferredFootprint!
    walls = inferredWalls
    openings = inferredOpenings
    rooms = inferredRooms
    isFallback = false
    confidence = Math.min(
      0.85,
      Math.max(0.4, walls.reduce((acc, w) => acc + w.confidence, 0) / Math.max(1, walls.length)),
    )
  } else {
    if (traceLines.length === 0) {
      warnings.push({
        code: 'NO_TRACE_INPUT',
        message:
          'No vector trace data is available for the active blueprint page. ' +
          'Falling back to a deterministic suite layout from blueprint context.',
      })
    } else {
      warnings.push({
        code: 'AMBIGUOUS_SUITE_SHAPE',
        message:
          'Vector trace data did not form a clean enclosed suite. ' +
          'Using a context-derived layout until trace recovery improves.',
      })
    }

    const fb = chooseSalonSuiteFallbackFromBlueprintContext(layoutContext)
    footprint = fb.footprint
    rooms = fb.rooms.map((r) => ({
      id: r.id,
      label: r.label,
      type: r.type,
      bounds: r.bounds,
      confidence: 0.4,
    }))
    const wallsOpenings = buildWallsAndOpeningsFromRooms(fb.footprint, fb.rooms)
    walls = wallsOpenings.walls
    openings = wallsOpenings.openings
    isFallback = true
    confidence = 0.3

    if (layoutContext === 'salon-tenant-suite') {
      warnings.push({
        code: 'SALON_CONTEXT_DETECTED',
        message:
          'Beauty Salon / tenant-improvement context detected. Rendering a long, narrow ' +
          'salon suite (18 ft × 50 ft) with reception at the front, styling floor down the ' +
          'main run, and restroom / utility / storage / service rooms at the back.',
      })
      warnings.push({
        code: 'NARROW_SUITE_ASSUMED',
        message: 'Suite shape assumed long and narrow until floor-plan trace is available.',
      })
    } else if (layoutContext === 'commercial-suite') {
      warnings.push({
        code: 'COMMERCIAL_CONTEXT_DETECTED',
        message: 'Commercial tenant-suite context detected — using office / conference layout.',
      })
    } else if (layoutContext === 'residential') {
      warnings.push({
        code: 'RESIDENTIAL_CONTEXT_DETECTED',
        message: 'Residential context detected — using living / kitchen / bedroom / bath layout.',
      })
    } else {
      warnings.push({
        code: 'FALLBACK_LAYOUT_USED',
        message:
          'No specific project context detected. A generic main + utility fallback layout is used.',
      })
    }
  }

  if (!input.sheetIndex || input.sheetIndex.length === 0) {
    warnings.push({
      code: 'NO_SHEET_CONTEXT',
      message:
        'No sheet index rows were provided. Scanner could not weight sheet labels into context.',
    })
  }

  if (confidence < 0.5) {
    warnings.push({
      code: 'LOW_CONFIDENCE',
      message:
        'Floor-plan scan is below 50% confidence. The model is a scan-ready inference and may ' +
        'not match the printed sheet until vector trace extraction lands.',
    })
  }

  // 5. Build deterministic dimension annotations.
  const dimensions: PlanDimensionCandidate[] = [
    {
      id: 'dim-overall-width',
      start: { x: footprint.x, y: footprint.y + footprint.height + 2 },
      end: { x: footprint.x + footprint.width, y: footprint.y + footprint.height + 2 },
      valueFt: footprint.width,
      label: `${Math.round(footprint.width)}'-0" SUITE WIDTH`,
      confidence,
    },
    {
      id: 'dim-overall-depth',
      start: { x: footprint.x + footprint.width + 2, y: footprint.y },
      end: { x: footprint.x + footprint.width + 2, y: footprint.y + footprint.height },
      valueFt: footprint.height,
      label: `${Math.round(footprint.height)}'-0" SUITE DEPTH`,
      confidence,
    },
  ]

  return {
    footprint,
    walls,
    openings,
    rooms,
    dimensions,
    warnings,
    traceLines,
    isFallback,
    confidence,
    layoutContext,
    metadata: {
      projectName: input.projectName,
      blueprintTitle: input.blueprintTitle,
      activePageNumber: input.activePageNumber,
      totalPages: input.totalPages,
      generatedAt,
    },
  }
}

// ---------------------------------------------------------------------------
// BuildingModel conversion
// ---------------------------------------------------------------------------

function wallModelFromCandidate(
  wall: PlanWallCandidate,
  wallHeight: MeasurementValue,
  openings: BuildingOpeningModel[],
): BuildingWallModel {
  return {
    id: wall.id,
    start: wall.start,
    end: wall.end,
    thickness: createMeasurement(wall.thicknessFt, 'ft', 'scanner', wall.confidence),
    height: wallHeight,
    openings,
    visible: true,
  }
}

function openingModelFromCandidate(opening: PlanOpeningCandidate): BuildingOpeningModel {
  return {
    id: opening.id,
    type: opening.type,
    positionAlongWall: createMeasurement(opening.positionFt, 'ft', 'scanner', opening.confidence),
    width: createMeasurement(opening.widthFt, 'ft', 'scanner', opening.confidence),
    height: createMeasurement(opening.heightFt, 'ft', 'scanner', opening.confidence),
    visible: true,
  }
}

/**
 * Convert a scan result into a fully-built BlueprintBuildingModel ready for the
 * 2D plan, 3D dollhouse, and room interior views.
 */
export function convertPlanScanToBuildingModel(
  scan: BlueprintPlanScanResult,
): BlueprintBuildingModel {
  const wallHeight = createMeasurement(9, 'ft', 'scanner', scan.confidence)
  const ceilingHeight = createMeasurement(9, 'ft', 'scanner', scan.confidence)
  const slabThickness = createMeasurement(4, 'in', 'scanner', scan.confidence)

  // Group openings by the wall id they live on.
  const openingsByWall = new Map<string, BuildingOpeningModel[]>()
  for (const o of scan.openings) {
    const list = openingsByWall.get(o.wallId) || []
    list.push(openingModelFromCandidate(o))
    openingsByWall.set(o.wallId, list)
  }

  // Map scanner room types onto the building-model's restricted enum.
  const toModelType = (
    t: PlanRoomCandidate['type'],
  ): 'living' | 'bedroom' | 'kitchen' | 'bath' | 'utility' | 'garage' | 'other' => {
    switch (t) {
      case 'living':
      case 'bedroom':
      case 'kitchen':
      case 'bath':
      case 'utility':
      case 'garage':
        return t
      default:
        return 'other'
    }
  }

  // Build rooms. Each room owns the 4 walls that form its perimeter.
  const rooms: BuildingRoomModel[] = scan.rooms.map((room) => {
    const wallCandidates = scan.walls.filter((w) => w.id.startsWith(`${room.id}_wall_`))
    const wallList: BuildingWallModel[] = wallCandidates.map((wc) =>
      wallModelFromCandidate(wc, wallHeight, openingsByWall.get(wc.id) || []),
    )
    const width = room.bounds.max.x - room.bounds.min.x
    const depth = room.bounds.max.y - room.bounds.min.y
    return {
      id: room.id,
      label: room.label,
      bounds: room.bounds,
      area: width * depth,
      height: wallHeight,
      walls: wallList,
      electricalAnchors: [],
      visible: true,
      metadata: {
        type: toModelType(room.type),
        floor: 0,
        notes: `Scanner role: ${room.type}`,
      },
    }
  })

  const level: BuildingLevelModel = {
    levelNumber: 0,
    label: 'Ground Floor',
    rooms,
    footprint: scan.footprint,
    visible: true,
  }

  const now = new Date().toISOString()
  const displayLabel = `${scan.metadata.projectName || 'Project'} — ${
    scan.layoutContext === 'salon-tenant-suite' ? 'Beauty Salon Suite' :
    scan.layoutContext === 'commercial-suite' ? 'Commercial Suite' :
    scan.layoutContext === 'residential' ? 'Residential Layout' :
    scan.layoutContext === 'electrical-room' ? 'Electrical Panel Room' :
    'Suite Layout'
  }`

  return {
    id: `scan-${Date.now()}`,
    name: displayLabel,
    footprint: scan.footprint,
    levels: [level],
    wallHeight,
    ceilingHeight,
    slabThickness,
    scale: {
      pixelsPerUnit: 1,
      unit: 'ft',
      source: scan.isFallback ? 'default' : 'measured',
    },
    confidence: scan.confidence,
    metadata: {
      createdAt: now,
      updatedAt: now,
      source: scan.isFallback ? 'fallback' : 'extraction',
      sourceBlueprint: scan.metadata.blueprintTitle,
      sourceProject: scan.metadata.projectName,
      sourcePage: scan.metadata.activePageNumber,
      notes:
        scan.isFallback
          ? `Scan-ready fallback: ${scan.layoutContext}. ${scan.warnings.length} warning(s).`
          : `Scanned floor plan: ${scan.layoutContext}. Confidence ${(scan.confidence * 100).toFixed(0)}%.`,
      displayLabel,
    },
  }
}
