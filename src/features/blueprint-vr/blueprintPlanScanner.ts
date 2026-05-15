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
  WallKind,
  DoorSwingDirection,
  OpeningSubtype,
  RoomEquipmentHint,
  RoomRole,
} from './buildingModel'
import { createMeasurement } from './dimensionModel'
import type {
  AdaptedTrace,
  PlanTraceLine,
} from './blueprintTraceAdapter'
import {
  adaptPdfTraceToPlanLines,
  detectOuterFootprint,
  inferDimensionCandidatesFromText,
  inferDoorCandidatesFromArcs,
  inferGlassStorefrontCandidates,
  inferOpeningCandidatesFromGaps,
  inferScaleFromTraceText,
  inferWallCandidatesFromTrace,
} from './blueprintTraceAdapter'
import type { PdfTracePayload, PdfTraceTextRun } from './pdfTraceTypes'

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
  tracePayload?: PdfTracePayload | null
  /** Whether vector trace extraction was attempted for this page. */
  traceAttempted?: boolean
  /** Warnings emitted by the vector extractor seam. */
  traceWarnings?: Array<{ code: string; message: string }>
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
  /** Optional wall kind (exterior / partition / divider / glass / pony). */
  kind?: WallKind
  /** Optional owning room id (for layout grouping). */
  roomId?: string
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
  /** Door swing direction or window subtype. */
  swing?: DoorSwingDirection
  /** Swing arc in degrees (default 90 for hinged doors). */
  swingDegrees?: number
  /** Refined opening subtype (storefront, pocket, etc.). */
  subtype?: OpeningSubtype
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
  /**
   * Optional role override surfaced by the fallback layout (e.g.
   * 'wash-station' on top of a 'service' type). Lets the building-model
   * conversion preserve specialised room roles for the 3D / interior views.
   */
  roleHint?: RoomRole
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
  | 'FULL_SET_INFERRED'
  | 'SHEET_ROLES_INFERRED'
  | 'NO_FLOOR_PLAN_SHEET'
  | 'NO_ELECTRICAL_SHEET'
  | 'NO_RENDERING_SHEET'

export interface PlanScanWarning {
  code: PlanScanWarningCode
  message: string
}

// ---------------------------------------------------------------------------
// Equipment / fixture / door / wall hint types (carried out of full-set scan)
// ---------------------------------------------------------------------------

/**
 * Equipment hint surfaced by the scanner — e.g. styling chair, reception
 * counter, panel box. Each hint is anchored to a room id when possible.
 */
export interface EquipmentHint {
  id: string
  roomId?: string
  kind: RoomEquipmentHint['kind']
  label: string
  /** Optional normalized position 0..1 inside the room rectangle. */
  positionNormalized?: { x: number; y: number }
  confidence: number
  sourceTag?: string
}

/**
 * Finish hint — what surface / material a room is expected to have.
 */
export interface FinishHint {
  id: string
  roomId?: string
  surface: 'floor' | 'wall' | 'ceiling'
  finish: string
  confidence: number
}

/**
 * Electrical device hint placed on a wall or floor for stage rendering.
 */
export interface ElectricalDeviceHint {
  id: string
  roomId?: string
  kind: 'receptacle' | 'switch' | 'gfci' | 'light' | 'panel' | 'disconnect' | 'other'
  positionNormalized?: { x: number; y: number }
  heightInches?: number
  confidence: number
  sourceTag?: string
}

/**
 * Door hint — used by full-set scan to refine door positions / swing.
 */
export interface DoorHint {
  id: string
  roomId?: string
  /** Approximate world position in feet, or normalized to room. */
  positionWorld?: Point2D
  widthFt?: number
  swing?: DoorSwingDirection
  swingDegrees?: number
  confidence: number
}

/**
 * Wall hint — refines wall classification (exterior / partition / divider /
 * glass / pony) from full-set context.
 */
export interface WallHint {
  id: string
  start?: Point2D
  end?: Point2D
  thicknessFt?: number
  kind?: WallKind
  confidence: number
}

/**
 * Composite "project style" hint produced from the full-set scan.
 */
export interface ExtractedProjectHint {
  projectKind: 'beauty-salon' | 'barber-shop' | 'nail-salon' | 'spa' | 'office' |
                'residential' | 'retail' | 'electrical-room' | 'generic'
  /** Detected style keywords (e.g. "modern", "luxury", "industrial"). */
  styleKeywords: string[]
  /** Suggested wall-thickness defaults in feet. */
  wallThicknessDefaults: {
    exterior: number
    partition: number
    divider: number
  }
  /** Suggested overall room palette / finish defaults. */
  finishDefaults: {
    floor?: string
    wall?: string
    ceiling?: string
  }
  confidence: number
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
  /** Equipment / fixture hints anchored to rooms. */
  equipmentHints: EquipmentHint[]
  /** Finish hints anchored to rooms. */
  finishHints: FinishHint[]
  /** Electrical device hints anchored to rooms. */
  electricalHints: ElectricalDeviceHint[]
  /** Door swing / opening hints. */
  doorHints: DoorHint[]
  /** Wall thickness / kind hints. */
  wallHints: WallHint[]
  /** Composite project-style hint. */
  projectHint: ExtractedProjectHint
  /** Metadata snapshot for diagnostics / display. */
  metadata: {
    projectName?: string
    blueprintTitle?: string
    activePageNumber?: number
    totalPages?: number
    generatedAt: string
    /** True when footprint/rooms are context fallback (e.g. salon template), not trace-validated. */
    geometryFromFallback?: boolean
    /** Runtime PDF registry match quality for the trace that drove this scan. */
    runtimeProviderMatchTier?: 'exact' | 'partial' | 'none'
  }
  /** Point-by-point confidence explanation for scanner status panel. */
  confidenceBreakdown?: ScanConfidenceBreakdown
  /** Honest scan result status for UI labels. */
  scanResultKind?: 'fallback' | 'inferred' | 'cached-inferred' | 'measured-trace'
  /** Trace availability state. */
  traceStatus?: 'missing' | 'provided' | 'extracted'
  /** Whether trace extraction was attempted upstream. */
  traceAttempted?: boolean
  /** Whether usable trace geometry was available. */
  traceAvailable?: boolean
  /** Warnings emitted by vector extraction seam. */
  traceWarnings?: Array<{ code: string; message: string }>
  /** Scale extraction state. */
  scaleStatus?: 'missing' | 'default' | 'detected'
  /** Lightweight debug counts for trace diagnostics. */
  traceDebugCounts?: {
    rawLines: number
    rawRects?: number
    rawPolylines?: number
    rawTextRuns?: number
    runtimeProviderStatus?: 'available' | 'partial' | 'missing' | 'error' | 'unknown'
    runtimeProviderMatchTier?: 'exact' | 'partial' | 'none'
    operatorListStatus?: 'available' | 'missing' | 'error' | 'unknown'
    textContentStatus?: 'available' | 'missing' | 'error' | 'unknown'
    mergedWalls: number
    openings: number
    roomCandidates: number
    confidenceCapReason?: string
  }
  /** Selected floor-plan sheet metadata when full-set scan is used. */
  selectedFloorPlanSheet?: SelectedFloorPlanSheet | null
}

export interface ScanConfidenceBreakdown {
  totalPoints: number
  totalPercent: number
  confidenceCapReason?: string
  items: {
    sourceSetSelected: number
    sheetsClassified: number
    floorPlanSheetSelected: number
    scaleDetected: number
    dimensionsDetected: number
    vectorTraceAvailable: number
    wallCandidatesFound: number
    openingsFound: number
    roomsValidated: number
    elevationsMatched: number
    electricalSheetsMatched: number
  }
  reasons: Record<keyof ScanConfidenceBreakdown['items'], string>
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
  return inferWallCandidatesFromTrace(lines)
    .filter((l) => l.orthogonal && l.lengthFt >= minLengthFt)
    .map((l, i) => ({
      id: `wall-trace-${i}`,
      start: l.start,
      end: l.end,
      thicknessFt: l.role === 'exterior-wall' ? 0.5 : 0.34,
      exterior: l.role === 'exterior-wall',
      confidence: l.confidence ?? 0.5,
      kind: l.role === 'exterior-wall' ? 'exterior' : 'partition',
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
  const wallTraceLines: PlanTraceLine[] = walls.map((w) => ({
    id: w.id,
    start: w.start,
    end: w.end,
    lengthFt: Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y),
    angleDeg: 0,
    orthogonal: true,
    role: w.exterior ? 'exterior-wall' : 'interior-wall',
    confidence: w.confidence,
  }))
  return inferOpeningCandidatesFromGaps(wallTraceLines, lines).map((o, i) => {
    const wall = walls.find((w) => w.id === o.wallId)
    const wallLen = wall ? Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) : o.widthFt
    const positionFt = wall
      ? Math.max(
          0,
          Math.min(
            wallLen,
            ((o.center.x - wall.start.x) * (wall.end.x - wall.start.x) +
              (o.center.y - wall.start.y) * (wall.end.y - wall.start.y)) /
              Math.max(1e-6, wallLen),
          ),
        )
      : 0
    return {
      id: `opening-trace-${i}`,
      wallId: o.wallId,
      type: o.type,
      positionFt,
      widthFt: o.widthFt,
      heightFt: o.type === 'window' ? 6 : 7,
      confidence: o.confidence,
      swing: o.type === 'door' ? 'right' : 'fixed',
      swingDegrees: o.type === 'door' ? 90 : 0,
      subtype: o.type === 'window' ? 'window-standard' : 'door-swing',
    }
  })
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
  const minX = footprint.x
  const minY = footprint.y
  const maxX = footprint.x + footprint.width
  const maxY = footprint.y + footprint.height
  const verticalCuts = new Set<number>([minX, maxX])
  const horizontalCuts = new Set<number>([minY, maxY])
  for (const wall of walls) {
    const dx = Math.abs(wall.end.x - wall.start.x)
    const dy = Math.abs(wall.end.y - wall.start.y)
    if (dx < 0.2 && dy > footprint.height * 0.28) {
      verticalCuts.add(Number(((wall.start.x + wall.end.x) / 2).toFixed(2)))
    } else if (dy < 0.2 && dx > footprint.width * 0.28) {
      horizontalCuts.add(Number(((wall.start.y + wall.end.y) / 2).toFixed(2)))
    }
  }
  const xs = Array.from(verticalCuts).sort((a, b) => a - b)
  const ys = Array.from(horizontalCuts).sort((a, b) => a - b)
  const rooms: PlanRoomCandidate[] = []
  let idx = 0
  for (let yi = 0; yi < ys.length - 1; yi += 1) {
    for (let xi = 0; xi < xs.length - 1; xi += 1) {
      const rx1 = xs[xi]
      const ry1 = ys[yi]
      const rx2 = xs[xi + 1]
      const ry2 = ys[yi + 1]
      const w = rx2 - rx1
      const h = ry2 - ry1
      if (w < 3 || h < 3) continue
      rooms.push({
        id: `trace-room-${idx + 1}`,
        label: `Room ${idx + 1}`,
        type: w * h > 180 ? 'other' : 'service',
        bounds: { min: { x: rx1, y: ry1 }, max: { x: rx2, y: ry2 } },
        confidence: 0.58,
      })
      idx += 1
    }
  }
  return validateRoomCandidates(rooms, footprint)
}

export function validateRoomCandidates(
  rooms: PlanRoomCandidate[],
  footprint: Rectangle,
): PlanRoomCandidate[] {
  const validated: PlanRoomCandidate[] = []
  for (const room of rooms) {
    const within =
      room.bounds.min.x >= footprint.x &&
      room.bounds.min.y >= footprint.y &&
      room.bounds.max.x <= footprint.x + footprint.width &&
      room.bounds.max.y <= footprint.y + footprint.height
    if (!within) continue
    const overlap = validated.some((existing) => {
      const ox = Math.max(0, Math.min(room.bounds.max.x, existing.bounds.max.x) - Math.max(room.bounds.min.x, existing.bounds.min.x))
      const oy = Math.max(0, Math.min(room.bounds.max.y, existing.bounds.max.y) - Math.max(room.bounds.min.y, existing.bounds.min.y))
      return ox * oy > 1
    })
    if (overlap) continue
    validated.push(room)
  }
  return validated
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

/**
 * Internal raw room shape used by the fallback layout builders. Carries
 * enough metadata so doors / dividers / equipment hints can be attached
 * deterministically.
 */
interface RawRoom {
  id: string
  label: string
  type: PlanRoomCandidate['type']
  bounds: Bounds2D
  role?: RoomRole
  /** Optional standalone divider walls (thin partitions inside the room). */
  dividers?: Array<{
    id: string
    start: Point2D
    end: Point2D
    thicknessFt?: number
  }>
  /** Optional door overrides keyed by wall side. */
  doorPlan?: Array<{
    side: 'n' | 's' | 'e' | 'w'
    positionFraction?: number
    widthFt?: number
    swing?: DoorSwingDirection
    swingDegrees?: number
    subtype?: OpeningSubtype
  }>
}

/**
 * Beauty Salon fallback: 18 ft × 50 ft long-narrow tenant suite tuned to the
 * actual project floor plan and interior elevation references. Includes:
 *   - storefront / reception at the front with glass entry
 *   - a wide reception → styling pass-through flanked by thin divider columns
 *     so the render's gold/black trim reads as a finish detail, not a wall
 *   - styling floor with hair-station dividers along both side walls
 *   - dedicated hair-wash sub-zone at the back of styling (shampoo bowls)
 *   - back-of-house split into treatment room, restroom, utility/panel,
 *     storage, and a circulation hallway connecting them
 *   - explicit door swing directions
 */
function buildSalonSuiteLayoutRaw(): { footprint: Rectangle; rooms: RawRoom[] } {
  const W = 18
  const D = 50
  const footprint: Rectangle = { x: 0, y: 0, width: W, height: D }

  // ── Station divider walls (thin partitions) inside the styling room.
  // They mark the visual separators between styling stations along each side.
  // The numbers mirror the elevation sheet's HAIR STATION #1 / #2 placement.
  const stationDividers: RawRoom['dividers'] = []
  ;[13.5, 19.5, 25.5].forEach((yPos, i) => {
    stationDividers.push({
      id: `styling_divider_l_${i}`,
      start: { x: 0, y: yPos },
      end: { x: 3.6, y: yPos },
      thicknessFt: 0.18,
    })
  })
  ;[13.5, 19.5, 25.5].forEach((yPos, i) => {
    stationDividers.push({
      id: `styling_divider_r_${i}`,
      start: { x: W - 3.6, y: yPos },
      end: { x: W, y: yPos },
      thicknessFt: 0.18,
    })
  })

  // ── Reception / styling transition. The actual floor plan shows a wide,
  //    nearly-full-width opening between reception and the styling floor.
  //    The gold/black render elements are an accent finish, not a wall.
  //    We model the transition as a wide 14 ft pass-through plus two short
  //    column-style divider stubs (vertical, perpendicular to the partition).
  const transitionDividers: RawRoom['dividers'] = [
    // Left column stub (vertical) at the inside edge of the exterior wall
    {
      id: 'reception_styling_col_l',
      start: { x: 1.8, y: 8.4 },
      end: { x: 1.8, y: 9.6 },
      thicknessFt: 0.5,
    },
    // Right column stub mirroring the left
    {
      id: 'reception_styling_col_r',
      start: { x: W - 1.8, y: 8.4 },
      end: { x: W - 1.8, y: 9.6 },
      thicknessFt: 0.5,
    },
  ]

  const rooms: RawRoom[] = [
    {
      id: 'entrance',
      label: 'Entrance / Reception',
      type: 'reception',
      role: 'reception',
      bounds: { min: { x: 0, y: 0 }, max: { x: W, y: 9 } },
      doorPlan: [
        // Front storefront entry — large glass facade with a centered door
        {
          side: 'n',
          positionFraction: 0.5,
          widthFt: 10,
          swing: 'fixed',
          subtype: 'window-storefront',
        },
        // Reception → styling open transition (wide). The flanking
        // transitionDividers (placed on the styling room) sit at the corners
        // so the opening reads as a wide pass instead of a doorway.
        {
          side: 's',
          positionFraction: 0.5,
          widthFt: 14,
          swing: 'fixed',
          subtype: 'pass-through',
        },
      ],
      dividers: transitionDividers,
    },
    {
      id: 'styling',
      label: 'Styling Floor',
      type: 'styling',
      role: 'styling',
      bounds: { min: { x: 0, y: 9 }, max: { x: W, y: 27 } },
      dividers: stationDividers,
    },
    {
      id: 'wash',
      label: 'Hair Wash',
      type: 'service',
      role: 'wash-station',
      bounds: { min: { x: 0, y: 27 }, max: { x: W, y: 32 } },
      doorPlan: [
        // Styling → wash open transition
        {
          side: 'n',
          positionFraction: 0.5,
          widthFt: 12,
          swing: 'fixed',
          subtype: 'pass-through',
        },
      ],
    },
    {
      id: 'hallway',
      label: 'Hallway / Circulation',
      type: 'hallway',
      role: 'hallway',
      bounds: { min: { x: 6, y: 32 }, max: { x: 12, y: 50 } },
      doorPlan: [
        // Wash → hallway opening (smaller, more architectural)
        {
          side: 'n',
          positionFraction: 0.5,
          widthFt: 4,
          swing: 'fixed',
          subtype: 'pass-through',
        },
      ],
    },
    {
      id: 'service',
      label: 'Treatment Room',
      type: 'service',
      role: 'service',
      bounds: { min: { x: 0, y: 32 }, max: { x: 6, y: 44 } },
      doorPlan: [
        {
          side: 'e',
          positionFraction: 0.3,
          widthFt: 3,
          swing: 'right',
          swingDegrees: 90,
          subtype: 'door-swing',
        },
      ],
    },
    {
      id: 'storage',
      label: 'Storage',
      type: 'storage',
      role: 'storage',
      bounds: { min: { x: 0, y: 44 }, max: { x: 6, y: 50 } },
      doorPlan: [
        {
          side: 'e',
          positionFraction: 0.5,
          widthFt: 2.8,
          swing: 'left',
          swingDegrees: 90,
          subtype: 'door-swing',
        },
      ],
    },
    {
      id: 'bath',
      label: 'Restroom',
      type: 'bath',
      role: 'bath',
      bounds: { min: { x: 12, y: 32 }, max: { x: W, y: 42 } },
      doorPlan: [
        {
          side: 'w',
          positionFraction: 0.4,
          widthFt: 2.8,
          swing: 'left',
          swingDegrees: 90,
          subtype: 'door-swing',
        },
      ],
    },
    {
      id: 'utility',
      label: 'Utility / Panel',
      type: 'utility',
      role: 'utility',
      bounds: { min: { x: 12, y: 42 }, max: { x: W, y: 50 } },
      doorPlan: [
        {
          side: 'w',
          positionFraction: 0.5,
          widthFt: 2.8,
          swing: 'right',
          swingDegrees: 90,
          subtype: 'door-swing',
        },
      ],
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
        role: 'reception',
        bounds: { min: { x: 0, y: 0 }, max: { x: W, y: 9 } },
        doorPlan: [
          { side: 'n', positionFraction: 0.5, widthFt: 6, swing: 'fixed', subtype: 'window-storefront' },
        ],
      },
      {
        id: 'office-a',
        label: 'Office A',
        type: 'office',
        role: 'office',
        bounds: { min: { x: 0, y: 9 }, max: { x: 11, y: 22 } },
        doorPlan: [{ side: 'n', positionFraction: 0.7, widthFt: 3, swing: 'right', swingDegrees: 90 }],
      },
      {
        id: 'office-b',
        label: 'Office B',
        type: 'office',
        role: 'office',
        bounds: { min: { x: 11, y: 9 }, max: { x: W, y: 22 } },
        doorPlan: [{ side: 'n', positionFraction: 0.3, widthFt: 3, swing: 'left', swingDegrees: 90 }],
      },
      {
        id: 'conference',
        label: 'Conference',
        type: 'other',
        role: 'conference',
        bounds: { min: { x: 0, y: 22 }, max: { x: 14, y: 36 } },
        doorPlan: [{ side: 'n', positionFraction: 0.7, widthFt: 3, swing: 'left', swingDegrees: 90 }],
      },
      {
        id: 'bath',
        label: 'Restroom',
        type: 'bath',
        role: 'bath',
        bounds: { min: { x: 14, y: 22 }, max: { x: W, y: 30 } },
        doorPlan: [{ side: 'w', positionFraction: 0.5, widthFt: 2.8, swing: 'right', swingDegrees: 90 }],
      },
      {
        id: 'utility',
        label: 'Utility / Panel',
        type: 'utility',
        role: 'utility',
        bounds: { min: { x: 14, y: 30 }, max: { x: W, y: 36 } },
        doorPlan: [{ side: 'w', positionFraction: 0.5, widthFt: 2.8, swing: 'left', swingDegrees: 90 }],
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
// Equipment / fixture hint builders per layout context
// ---------------------------------------------------------------------------

function projectHintForContext(
  context: BlueprintPlanScanResult['layoutContext'],
): ExtractedProjectHint {
  if (context === 'salon-tenant-suite') {
    return {
      projectKind: 'beauty-salon',
      styleKeywords: ['salon', 'beauty', 'tenant-improvement', 'commercial'],
      wallThicknessDefaults: DEFAULT_WALL_THICKNESS_FT,
      finishDefaults: {
        floor: 'polished concrete / luxury vinyl plank',
        wall: 'painted drywall with feature accents',
        ceiling: 'painted gypsum / acoustic tile',
      },
      confidence: 0.5,
    }
  }
  if (context === 'commercial-suite') {
    return {
      projectKind: 'office',
      styleKeywords: ['commercial', 'tenant', 'office'],
      wallThicknessDefaults: DEFAULT_WALL_THICKNESS_FT,
      finishDefaults: {
        floor: 'commercial carpet tile',
        wall: 'painted drywall',
        ceiling: 'acoustic tile grid',
      },
      confidence: 0.45,
    }
  }
  if (context === 'residential') {
    return {
      projectKind: 'residential',
      styleKeywords: ['residential'],
      wallThicknessDefaults: { exterior: 0.5, partition: 0.34, divider: 0.25 },
      finishDefaults: {
        floor: 'engineered hardwood / tile',
        wall: 'painted drywall',
        ceiling: 'painted drywall',
      },
      confidence: 0.4,
    }
  }
  if (context === 'electrical-room') {
    return {
      projectKind: 'electrical-room',
      styleKeywords: ['electrical', 'mep', 'panel-room'],
      wallThicknessDefaults: DEFAULT_WALL_THICKNESS_FT,
      finishDefaults: {
        floor: 'sealed concrete',
        wall: 'sealed CMU / drywall',
        ceiling: 'exposed structure',
      },
      confidence: 0.55,
    }
  }
  return {
    projectKind: 'generic',
    styleKeywords: [],
    wallThicknessDefaults: DEFAULT_WALL_THICKNESS_FT,
    finishDefaults: {},
    confidence: 0.3,
  }
}

function pushHint(
  acc: EquipmentHint[],
  roomId: string,
  kind: EquipmentHint['kind'],
  label: string,
  nx: number,
  ny: number,
  confidence = 0.5,
  sourceTag = 'fallback-context',
): void {
  acc.push({
    id: `${roomId}_${kind}_${acc.length}`,
    roomId,
    kind,
    label,
    positionNormalized: { x: nx, y: ny },
    confidence,
    sourceTag,
  })
}

function pushElec(
  acc: ElectricalDeviceHint[],
  roomId: string,
  kind: ElectricalDeviceHint['kind'],
  nx: number,
  ny: number,
  heightInches?: number,
): void {
  acc.push({
    id: `${roomId}_elec_${kind}_${acc.length}`,
    roomId,
    kind,
    positionNormalized: { x: nx, y: ny },
    heightInches,
    confidence: 0.45,
    sourceTag: 'fallback-context',
  })
}

function buildSalonHints(
  rooms: RawRoom[],
): { equipment: EquipmentHint[]; finishes: FinishHint[]; electrical: ElectricalDeviceHint[] } {
  const equipment: EquipmentHint[] = []
  const finishes: FinishHint[] = []
  const electrical: ElectricalDeviceHint[] = []

  for (const room of rooms) {
    const role = room.role || 'other'
    if (role === 'reception') {
      pushHint(equipment, room.id, 'reception-counter', 'Reception Counter', 0.5, 0.7, 0.65)
      pushHint(equipment, room.id, 'waiting-couch', 'Waiting Couch', 0.2, 0.3, 0.5)
      pushHint(equipment, room.id, 'waiting-chair', 'Waiting Chair', 0.5, 0.3, 0.5)
      pushHint(equipment, room.id, 'waiting-chair', 'Waiting Chair', 0.8, 0.3, 0.5)
      pushHint(equipment, room.id, 'side-table', 'Side Table', 0.35, 0.45, 0.45)
      pushHint(equipment, room.id, 'storefront-sign', 'Storefront Sign', 0.5, 0.05, 0.4)
      pushHint(equipment, room.id, 'chandelier', 'Reception Chandelier', 0.5, 0.5, 0.55, 'lighting')
      pushElec(electrical, room.id, 'receptacle', 0.15, 0.7, 18)
      pushElec(electrical, room.id, 'receptacle', 0.85, 0.7, 18)
      pushElec(electrical, room.id, 'switch', 0.95, 0.5, 48)
      pushElec(electrical, room.id, 'light', 0.5, 0.5)
      finishes.push({
        id: `${room.id}_floor_finish`,
        roomId: room.id,
        surface: 'floor',
        finish: 'Luxury vinyl plank · driftwood tone',
        confidence: 0.5,
      })
    } else if (role === 'styling') {
      // Stations along left and right walls. Three stations per side mirrors
      // the elevation sheet's HAIR STATION #1 / #2 spacing.
      const leftStations = [0.22, 0.5, 0.78]
      const rightStations = [0.22, 0.5, 0.78]
      leftStations.forEach((y) => {
        pushHint(equipment, room.id, 'styling-mirror', 'Mirror', 0.07, y, 0.6)
        pushHint(equipment, room.id, 'styling-chair', 'Styling Chair', 0.2, y, 0.6)
        pushHint(equipment, room.id, 'vanity-counter', 'Station Vanity', 0.13, y + 0.04, 0.55)
        pushElec(electrical, room.id, 'receptacle', 0.08, y, 42)
      })
      rightStations.forEach((y) => {
        pushHint(equipment, room.id, 'styling-mirror', 'Mirror', 0.93, y, 0.6)
        pushHint(equipment, room.id, 'styling-chair', 'Styling Chair', 0.8, y, 0.6)
        pushHint(equipment, room.id, 'vanity-counter', 'Station Vanity', 0.87, y + 0.04, 0.55)
        pushElec(electrical, room.id, 'receptacle', 0.92, y, 42)
      })
      // Track lights along the centerline
      pushHint(equipment, room.id, 'track-light', 'Track Lighting', 0.5, 0.25, 0.5, 'lighting')
      pushHint(equipment, room.id, 'track-light', 'Track Lighting', 0.5, 0.55, 0.5, 'lighting')
      pushHint(equipment, room.id, 'track-light', 'Track Lighting', 0.5, 0.85, 0.5, 'lighting')
      pushElec(electrical, room.id, 'light', 0.5, 0.25)
      pushElec(electrical, room.id, 'light', 0.5, 0.55)
      pushElec(electrical, room.id, 'light', 0.5, 0.85)
      pushElec(electrical, room.id, 'switch', 0.05, 0.05, 48)
      finishes.push({
        id: `${room.id}_floor_finish`,
        roomId: room.id,
        surface: 'floor',
        finish: 'Polished concrete · light grey',
        confidence: 0.5,
      })
    } else if (role === 'wash-station') {
      // Hair-wash bowls in a row. Mirrors the salon's shampoo wall.
      pushHint(equipment, room.id, 'shampoo-bowl', 'Shampoo Bowl', 0.25, 0.5, 0.55)
      pushHint(equipment, room.id, 'shampoo-bowl', 'Shampoo Bowl', 0.45, 0.5, 0.55)
      pushHint(equipment, room.id, 'shampoo-bowl', 'Shampoo Bowl', 0.65, 0.5, 0.55)
      pushHint(equipment, room.id, 'vanity-counter', 'Wash Counter', 0.85, 0.5, 0.5)
      pushHint(equipment, room.id, 'overhead-light', 'Recessed Light', 0.5, 0.3, 0.5, 'lighting')
      pushHint(equipment, room.id, 'overhead-light', 'Recessed Light', 0.5, 0.7, 0.5, 'lighting')
      pushElec(electrical, room.id, 'gfci', 0.15, 0.5, 42)
      pushElec(electrical, room.id, 'gfci', 0.95, 0.5, 42)
      pushElec(electrical, room.id, 'light', 0.5, 0.3)
      pushElec(electrical, room.id, 'light', 0.5, 0.7)
      finishes.push({
        id: `${room.id}_floor_finish`,
        roomId: room.id,
        surface: 'floor',
        finish: 'Porcelain tile · slip-resistant',
        confidence: 0.5,
      })
    } else if (role === 'bath') {
      pushHint(equipment, room.id, 'restroom-sink', 'Restroom Sink', 0.25, 0.7, 0.6)
      pushHint(equipment, room.id, 'toilet', 'Toilet', 0.75, 0.7, 0.6)
      pushHint(equipment, room.id, 'styling-mirror', 'Mirror over Sink', 0.25, 0.25, 0.5)
      pushHint(equipment, room.id, 'overhead-light', 'Vanity Light', 0.25, 0.1, 0.55, 'lighting')
      pushElec(electrical, room.id, 'gfci', 0.25, 0.55, 42)
      pushElec(electrical, room.id, 'switch', 0.92, 0.1, 48)
      pushElec(electrical, room.id, 'light', 0.5, 0.5)
      finishes.push({
        id: `${room.id}_floor_finish`,
        roomId: room.id,
        surface: 'floor',
        finish: 'Porcelain tile · matte',
        confidence: 0.55,
      })
    } else if (role === 'utility') {
      pushHint(equipment, room.id, 'utility-panel', 'Main Panel 200A', 0.5, 0.05, 0.65)
      pushHint(equipment, room.id, 'service-equipment', 'HVAC / Water Heater', 0.25, 0.6, 0.45)
      pushHint(equipment, room.id, 'service-equipment', 'Disconnect', 0.75, 0.55, 0.45)
      pushElec(electrical, room.id, 'panel', 0.5, 0.05, 60)
      pushElec(electrical, room.id, 'light', 0.5, 0.5)
      pushElec(electrical, room.id, 'switch', 0.05, 0.05, 48)
      finishes.push({
        id: `${room.id}_floor_finish`,
        roomId: room.id,
        surface: 'floor',
        finish: 'Sealed concrete',
        confidence: 0.5,
      })
    } else if (role === 'storage') {
      pushHint(equipment, room.id, 'storage-shelving', 'Storage Shelving', 0.1, 0.5, 0.5)
      pushHint(equipment, room.id, 'storage-shelving', 'Storage Shelving', 0.9, 0.5, 0.5)
      pushHint(equipment, room.id, 'overhead-light', 'Service Light', 0.5, 0.5, 0.45, 'lighting')
      pushElec(electrical, room.id, 'receptacle', 0.5, 0.7, 18)
      pushElec(electrical, room.id, 'light', 0.5, 0.5)
      finishes.push({
        id: `${room.id}_floor_finish`,
        roomId: room.id,
        surface: 'floor',
        finish: 'Sealed concrete',
        confidence: 0.45,
      })
    } else if (role === 'service') {
      // Treatment room — single chair, mirror, side counter, soft lighting.
      pushHint(equipment, room.id, 'styling-chair', 'Treatment Chair', 0.5, 0.45, 0.55)
      pushHint(equipment, room.id, 'styling-mirror', 'Treatment Mirror', 0.5, 0.18, 0.5)
      pushHint(equipment, room.id, 'wash-sink', 'Treatment Sink', 0.18, 0.78, 0.5)
      pushHint(equipment, room.id, 'vanity-counter', 'Work Counter', 0.65, 0.8, 0.5)
      pushHint(equipment, room.id, 'overhead-light', 'Treatment Light', 0.5, 0.5, 0.5, 'lighting')
      pushElec(electrical, room.id, 'gfci', 0.18, 0.7, 42)
      pushElec(electrical, room.id, 'receptacle', 0.65, 0.7, 18)
      pushElec(electrical, room.id, 'switch', 0.92, 0.05, 48)
      pushElec(electrical, room.id, 'light', 0.5, 0.5)
      finishes.push({
        id: `${room.id}_floor_finish`,
        roomId: room.id,
        surface: 'floor',
        finish: 'Slip-resistant tile',
        confidence: 0.45,
      })
    } else if (role === 'hallway') {
      pushHint(equipment, room.id, 'overhead-light', 'Hallway Downlight', 0.5, 0.25, 0.45, 'lighting')
      pushHint(equipment, room.id, 'overhead-light', 'Hallway Downlight', 0.5, 0.75, 0.45, 'lighting')
      pushElec(electrical, room.id, 'light', 0.5, 0.25)
      pushElec(electrical, room.id, 'light', 0.5, 0.75)
      finishes.push({
        id: `${room.id}_floor_finish`,
        roomId: room.id,
        surface: 'floor',
        finish: 'Luxury vinyl plank',
        confidence: 0.45,
      })
    }
  }

  return { equipment, finishes, electrical }
}

function buildCommercialHints(
  rooms: RawRoom[],
): { equipment: EquipmentHint[]; finishes: FinishHint[]; electrical: ElectricalDeviceHint[] } {
  const equipment: EquipmentHint[] = []
  const finishes: FinishHint[] = []
  const electrical: ElectricalDeviceHint[] = []
  for (const room of rooms) {
    pushHint(equipment, room.id, 'overhead-light', 'Recessed Light', 0.5, 0.5, 0.4, 'lighting')
    pushElec(electrical, room.id, 'light', 0.5, 0.5)
    pushElec(electrical, room.id, 'receptacle', 0.1, 0.5, 18)
    pushElec(electrical, room.id, 'receptacle', 0.9, 0.5, 18)
    pushElec(electrical, room.id, 'switch', 0.05, 0.05, 48)
    finishes.push({
      id: `${room.id}_floor_finish`,
      roomId: room.id,
      surface: 'floor',
      finish: 'Commercial carpet tile',
      confidence: 0.4,
    })
  }
  return { equipment, finishes, electrical }
}

function buildResidentialHints(
  rooms: RawRoom[],
): { equipment: EquipmentHint[]; finishes: FinishHint[]; electrical: ElectricalDeviceHint[] } {
  const equipment: EquipmentHint[] = []
  const finishes: FinishHint[] = []
  const electrical: ElectricalDeviceHint[] = []
  for (const room of rooms) {
    pushHint(equipment, room.id, 'overhead-light', 'Ceiling Light', 0.5, 0.5, 0.4, 'lighting')
    pushElec(electrical, room.id, 'light', 0.5, 0.5)
    pushElec(electrical, room.id, 'receptacle', 0.1, 0.5, 18)
    pushElec(electrical, room.id, 'receptacle', 0.9, 0.5, 18)
    pushElec(electrical, room.id, 'switch', 0.05, 0.05, 48)
    finishes.push({
      id: `${room.id}_floor_finish`,
      roomId: room.id,
      surface: 'floor',
      finish: 'Engineered hardwood',
      confidence: 0.4,
    })
  }
  return { equipment, finishes, electrical }
}

function buildGenericHints(
  rooms: RawRoom[],
): { equipment: EquipmentHint[]; finishes: FinishHint[]; electrical: ElectricalDeviceHint[] } {
  return buildCommercialHints(rooms)
}

function buildHintsForContext(
  context: BlueprintPlanScanResult['layoutContext'],
  rooms: RawRoom[],
): { equipment: EquipmentHint[]; finishes: FinishHint[]; electrical: ElectricalDeviceHint[] } {
  switch (context) {
    case 'salon-tenant-suite':
      return buildSalonHints(rooms)
    case 'commercial-suite':
      return buildCommercialHints(rooms)
    case 'residential':
      return buildResidentialHints(rooms)
    case 'electrical-room':
      return {
        equipment: rooms.flatMap((r) => [
          {
            id: `${r.id}_panel`,
            roomId: r.id,
            kind: 'utility-panel' as const,
            label: 'Electrical Panel',
            positionNormalized: { x: 0.5, y: 0.1 },
            confidence: 0.7,
            sourceTag: 'fallback-context',
          },
        ]),
        finishes: [],
        electrical: rooms.flatMap((r) => [
          {
            id: `${r.id}_panel_elec`,
            roomId: r.id,
            kind: 'panel' as const,
            positionNormalized: { x: 0.5, y: 0.1 },
            heightInches: 60,
            confidence: 0.7,
            sourceTag: 'fallback-context',
          },
        ]),
      }
    case 'generic':
    default:
      return buildGenericHints(rooms)
  }
}

// ---------------------------------------------------------------------------
// Walls / openings from a tiled room set
// ---------------------------------------------------------------------------

/**
 * Default wall-thickness defaults (feet) for the project hint shape. The
 * scanner reads these and applies them per wall kind during build.
 */
const DEFAULT_WALL_THICKNESS_FT = {
  exterior: 0.5, // 6 in
  partition: 0.34, // 4 in
  divider: 0.17, // 2 in
}

/** Wall side helpers used by the room/door plan. */
type WallSide = 'n' | 's' | 'e' | 'w'

function wallSideKey(roomId: string, side: WallSide): string {
  return `${roomId}_wall_${side}`
}

function pointsForSide(bounds: Bounds2D, side: WallSide): { a: Point2D; b: Point2D } {
  const { min, max } = bounds
  switch (side) {
    case 'n':
      return { a: { x: min.x, y: min.y }, b: { x: max.x, y: min.y } }
    case 's':
      return { a: { x: min.x, y: max.y }, b: { x: max.x, y: max.y } }
    case 'w':
      return { a: { x: min.x, y: min.y }, b: { x: min.x, y: max.y } }
    case 'e':
      return { a: { x: max.x, y: min.y }, b: { x: max.x, y: max.y } }
  }
}

function buildWallsAndOpeningsFromRooms(
  footprint: Rectangle,
  rooms: RawRoom[],
  thicknessDefaults: { exterior: number; partition: number; divider: number } = DEFAULT_WALL_THICKNESS_FT,
): { walls: PlanWallCandidate[]; openings: PlanOpeningCandidate[] } {
  const walls: PlanWallCandidate[] = []
  const openings: PlanOpeningCandidate[] = []
  const fpMinX = footprint.x
  const fpMinY = footprint.y
  const fpMaxX = footprint.x + footprint.width
  const fpMaxY = footprint.y + footprint.height

  // ── 1. Perimeter walls for every room (4 sides). Classify each as
  //       exterior or partition based on footprint edges.
  rooms.forEach((room) => {
    const sides: WallSide[] = ['n', 's', 'w', 'e']
    for (const side of sides) {
      const { a, b } = pointsForSide(room.bounds, side)
      const onNorth = a.y === fpMinY && b.y === fpMinY
      const onSouth = a.y === fpMaxY && b.y === fpMaxY
      const onWest = a.x === fpMinX && b.x === fpMinX
      const onEast = a.x === fpMaxX && b.x === fpMaxX
      const exterior = onWest || onEast || onNorth || onSouth
      const kind: WallKind = exterior ? 'exterior' : 'partition'
      const thicknessFt = exterior ? thicknessDefaults.exterior : thicknessDefaults.partition
      walls.push({
        id: wallSideKey(room.id, side),
        start: a,
        end: b,
        thicknessFt,
        exterior,
        confidence: 0.6,
        kind,
        roomId: room.id,
      })
    }
  })

  // ── 2. Standalone divider walls (thin station partitions). These are
  //       attached to a room id and rendered visibly thinner.
  rooms.forEach((room) => {
    if (!room.dividers || room.dividers.length === 0) return
    for (const div of room.dividers) {
      walls.push({
        id: div.id,
        start: div.start,
        end: div.end,
        thicknessFt: div.thicknessFt ?? thicknessDefaults.divider,
        exterior: false,
        confidence: 0.5,
        kind: 'divider',
        roomId: room.id,
      })
    }
  })

  // ── 3. Door plan from room metadata. Falls back to a simple "inward door"
  //       heuristic when no doorPlan was provided.
  rooms.forEach((room) => {
    if (room.doorPlan && room.doorPlan.length > 0) {
      for (const door of room.doorPlan) {
        const wallId = wallSideKey(room.id, door.side)
        const wall = walls.find((w) => w.id === wallId)
        if (!wall) continue
        const wallLen = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
        if (wallLen < 1.5) continue
        const t = Math.max(0.05, Math.min(0.95, door.positionFraction ?? 0.5))
        const widthFt = Math.min(wallLen - 0.5, Math.max(2, door.widthFt ?? 3))
        const subtype: OpeningSubtype | undefined = door.subtype
        const isWindow = subtype === 'window-standard' ||
                         subtype === 'window-storefront' ||
                         subtype === 'window-clerestory'
        const isFixed = door.swing === 'fixed' || subtype === 'pass-through'
        // Reclassify glass walls / storefront as the "glass" wall kind
        if (subtype === 'window-storefront') wall.kind = 'glass'
        openings.push({
          id: `${room.id}_${door.side}_door_${Math.round(t * 100)}`,
          wallId,
          type: isWindow ? 'window' : 'door',
          positionFt: t * wallLen,
          widthFt,
          heightFt: isWindow ? 6 : 7,
          confidence: 0.55,
          swing: door.swing,
          swingDegrees: door.swingDegrees ?? (isFixed ? 0 : 90),
          subtype: subtype,
        })
      }
      return
    }

    // Heuristic fallback: place one door on the side closest to suite center.
    const cx = footprint.x + footprint.width / 2
    const cy = footprint.y + footprint.height / 2
    const rcx = (room.bounds.min.x + room.bounds.max.x) / 2
    const rcy = (room.bounds.min.y + room.bounds.max.y) / 2
    const side: WallSide =
      Math.abs(rcx - cx) > Math.abs(rcy - cy)
        ? rcx > cx
          ? 'w'
          : 'e'
        : rcy > cy
        ? 'n'
        : 's'
    const targetWall = walls.find((w) => w.id === wallSideKey(room.id, side))
    if (!targetWall) return
    const wallLen = Math.hypot(
      targetWall.end.x - targetWall.start.x,
      targetWall.end.y - targetWall.start.y,
    )
    if (wallLen < 3) return
    openings.push({
      id: `${room.id}_door`,
      wallId: targetWall.id,
      type: 'door',
      positionFt: wallLen / 2,
      widthFt: Math.min(3.5, Math.max(2.5, wallLen / 4)),
      heightFt: 7,
      confidence: 0.45,
      swing: side === 'w' || side === 'n' ? 'right' : 'left',
      swingDegrees: 90,
      subtype: 'door-swing',
    })
  })

  // ── 3.5 Mirror openings onto the matching wall of the adjacent room so
  //         shared partition walls read as a single opening from both sides.
  //         Without this, one room's wall is solid while the other has the
  //         opening, which produces the "reversed wall / opening" artifact
  //         that previously made the entrance → styling transition look wrong.
  const wallByEndpoints = new Map<string, PlanWallCandidate[]>()
  for (const w of walls) {
    const a = `${w.start.x.toFixed(2)},${w.start.y.toFixed(2)}`
    const b = `${w.end.x.toFixed(2)},${w.end.y.toFixed(2)}`
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    const list = wallByEndpoints.get(key) || []
    list.push(w)
    wallByEndpoints.set(key, list)
  }
  const seedOpenings = [...openings]
  for (const op of seedOpenings) {
    const sourceWall = walls.find((x) => x.id === op.wallId)
    if (!sourceWall) continue
    const a = `${sourceWall.start.x.toFixed(2)},${sourceWall.start.y.toFixed(2)}`
    const b = `${sourceWall.end.x.toFixed(2)},${sourceWall.end.y.toFixed(2)}`
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    const siblings = (wallByEndpoints.get(key) || []).filter((p) => p.id !== sourceWall.id)
    for (const sib of siblings) {
      const exists = openings.some(
        (o) => o.wallId === sib.id && Math.abs(o.positionFt - op.positionFt) < 0.25,
      )
      if (exists) continue
      openings.push({
        ...op,
        id: `${op.id}_mirror_${sib.id}`,
        wallId: sib.id,
      })
      if (op.subtype === 'window-storefront') sib.kind = 'glass'
      if (op.subtype === 'pass-through') {
        // Pass-through marks both walls as "open"; downstream renderers can
        // skip drawing solid wall mass at that gap.
        sib.kind = sib.kind === 'exterior' ? sib.kind : 'partition'
      }
    }
  }

  // ── 4. Default front storefront if no glass-storefront opening was
  //       explicitly described in the layout's doorPlan.
  const alreadyHasStorefront = openings.some(
    (op) => op.subtype === 'window-storefront' || op.subtype === 'pass-through',
  )
  if (!alreadyHasStorefront) {
    const frontExterior = walls.find(
      (w) =>
        w.exterior &&
        w.start.y === fpMinY &&
        w.end.y === fpMinY &&
        Math.abs(w.end.x - w.start.x) >= 6,
    )
    if (frontExterior) {
      const wallLen = Math.abs(frontExterior.end.x - frontExterior.start.x)
      frontExterior.kind = 'glass'
      openings.push({
        id: `${frontExterior.id}_storefront`,
        wallId: frontExterior.id,
        type: 'window',
        positionFt: wallLen / 2,
        widthFt: Math.min(8, wallLen * 0.5),
        heightFt: 6,
        confidence: 0.5,
        swing: 'fixed',
        swingDegrees: 0,
        subtype: 'window-storefront',
      })
    }
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
  const traceAttempted = Boolean(input.traceAttempted || input.tracePayload)
  const traceWarnings = (input.traceWarnings || []).map((w) => ({
    code: String(w.code || 'TRACE_ADAPTER'),
    message: String(w.message || ''),
  }))
  for (const tw of traceWarnings) {
    warnings.push({
      code: 'NO_TRACE_INPUT',
      message: tw.message,
    })
  }

  // 1. Adapt any upstream trace data.
  const adapted: AdaptedTrace = adaptPdfTraceToPlanLines(input.tracePayload)
  const traceLines = adapted.lines
  const traceTextRuns: PdfTraceTextRun[] = input.tracePayload?.textRuns || []
  const rtStatus = input.tracePayload?.runtime?.providerStatus
  const runtimeProviderStatus: NonNullable<BlueprintPlanScanResult['traceDebugCounts']>['runtimeProviderStatus'] =
    rtStatus === 'available' || rtStatus === 'partial' || rtStatus === 'missing' || rtStatus === 'error'
      ? rtStatus
      : traceAttempted
        ? 'missing'
        : 'unknown'
  const operatorListStatus = input.tracePayload?.runtime?.operatorListStatus || 'unknown'
  const textContentStatus = input.tracePayload?.runtime?.textContentStatus || 'unknown'
  const rawRectCount = Array.isArray(input.tracePayload?.rects) ? input.tracePayload!.rects.length : 0
  const rawPolylineCount = Array.isArray(input.tracePayload?.polylines) ? input.tracePayload!.polylines.length : 0
  const rawTextRunCount = traceTextRuns.length

  // 2. When real trace lines exist, try to infer geometry from them.
  let inferredFootprint = inferBuildingFootprintFromTraceLines(traceLines)
  const outerFootprint = detectOuterFootprint(traceLines)
  if (outerFootprint) {
    inferredFootprint = {
      x: outerFootprint.minX,
      y: outerFootprint.minY,
      width: outerFootprint.maxX - outerFootprint.minX,
      height: outerFootprint.maxY - outerFootprint.minY,
    }
  }
  let inferredWalls = inferWallsFromOrthogonalLines(traceLines)
  let inferredOpenings = inferOpeningsFromGaps(inferredWalls, traceLines)
  let inferredRooms = inferRoomsFromEnclosedOrGridLayout(inferredWalls, inferredFootprint)
  const inferredDoorArcs = inferDoorCandidatesFromArcs(input.tracePayload?.arcs || [], traceTextRuns)
  const inferredStorefront = inferGlassStorefrontCandidates(traceLines, traceTextRuns)
  const inferredDimensionText = inferDimensionCandidatesFromText(traceTextRuns)
  const inferredScaleFromText = inferScaleFromTraceText(traceTextRuns)
  if (inferredStorefront.length > 0) {
    for (const storefront of inferredStorefront) {
      const wall = inferredWalls.find((w) => w.id === storefront.lineId || w.id.endsWith(storefront.lineId))
      if (wall) wall.kind = 'glass'
    }
  }
  if (inferredDoorArcs.length > 0 && inferredOpenings.length > 0) {
    inferredOpenings = inferredOpenings.map((o) =>
      o.type === 'door'
        ? { ...o, swing: 'right', swingDegrees: 90, subtype: 'door-swing', confidence: Math.max(o.confidence, 0.6) }
        : o,
    )
  }

  // 3. Decide whether the trace path can succeed.
  const traceUsable =
    !!inferredFootprint &&
    inferredFootprint.width > 6 &&
    inferredFootprint.height > 6 &&
    inferredWalls.length >= 4 &&
    inferredRooms.length >= 1
  const traceAvailable = traceLines.length > 0

  // 4. If trace not usable, fall back to context layout.
  let footprint: Rectangle
  let walls: PlanWallCandidate[]
  let openings: PlanOpeningCandidate[]
  let rooms: PlanRoomCandidate[]
  let isFallback: boolean
  let confidence: number
  let confidenceCapReason = 'No confidence cap applied.'

  const projectHint = projectHintForContext(layoutContext)
  let rawRooms: RawRoom[] = []
  let equipmentHints: EquipmentHint[] = []
  let finishHints: FinishHint[] = []
  let electricalHints: ElectricalDeviceHint[] = []
  let doorHints: DoorHint[] = []
  let wallHints: WallHint[] = []

  if (traceUsable) {
    footprint = inferredFootprint!
    walls = inferredWalls
    openings = inferredOpenings
    rooms = inferredRooms
    isFallback = false
    confidence = Math.min(
      0.82,
      Math.max(0.4, walls.reduce((acc, w) => acc + w.confidence, 0) / Math.max(1, walls.length)),
    )
    confidenceCapReason = 'Trace geometry validated with walls + openings + rooms.'
  } else {
    if (!traceAvailable) {
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
    rawRooms = fb.rooms
    rooms = fb.rooms.map((r) => ({
      id: r.id,
      label: r.label,
      type: r.type,
      bounds: r.bounds,
      confidence: 0.4,
      roleHint: r.role,
    }))
    const wallsOpenings = buildWallsAndOpeningsFromRooms(
      fb.footprint,
      fb.rooms,
      projectHint.wallThicknessDefaults,
    )
    walls = wallsOpenings.walls
    openings = wallsOpenings.openings

    const hintsBundle = buildHintsForContext(layoutContext, fb.rooms)
    equipmentHints = hintsBundle.equipment
    finishHints = hintsBundle.finishes
    electricalHints = hintsBundle.electrical

    // Door hints surfaced from openings so external consumers can preview
    // swing direction without re-walking the openings array.
    doorHints = openings
      .filter((op) => op.type === 'door')
      .map((op) => ({
        id: `${op.id}_hint`,
        roomId: op.wallId.split('_wall_')[0],
        widthFt: op.widthFt,
        swing: op.swing,
        swingDegrees: op.swingDegrees,
        confidence: op.confidence,
      }))

    // Wall hints summarise wall kinds for downstream views/UI.
    wallHints = walls.map((w) => ({
      id: `${w.id}_hint`,
      start: w.start,
      end: w.end,
      thicknessFt: w.thicknessFt,
      kind: w.kind,
      confidence: w.confidence,
    }))

    isFallback = true
    confidence = 0.35
    if (runtimeProviderStatus !== 'available') {
      confidenceCapReason = 'Runtime PDF provider missing; cap remains below 60%.'
    } else if (!traceAvailable && rawTextRunCount > 0) {
      confidenceCapReason = 'Text content available but no vector primitives; cap remains below 65%.'
    } else if (!traceAvailable) {
      confidenceCapReason = 'Runtime provider available but vector primitives unavailable; cap remains below 65%.'
    } else {
      confidenceCapReason = 'Vector primitives found but wall/room graph is not validated; cap remains below 75%.'
    }

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
    ...inferredDimensionText.slice(0, 4).map((d, i) => ({
      id: `dim-trace-${i + 1}`,
      start: { x: footprint.x, y: footprint.y + footprint.height + 4 + i },
      end: { x: footprint.x + Math.min(footprint.width, d.feet), y: footprint.y + footprint.height + 4 + i },
      valueFt: d.feet,
      label: d.text,
      confidence: d.confidence,
    })),
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
    equipmentHints,
    finishHints,
    electricalHints,
    doorHints,
    wallHints,
    projectHint,
    metadata: {
      projectName: input.projectName,
      blueprintTitle: input.blueprintTitle,
      activePageNumber: input.activePageNumber,
      totalPages: input.totalPages,
      generatedAt,
      geometryFromFallback: isFallback,
      runtimeProviderMatchTier: input.tracePayload?.runtime?.providerMatchTier,
    },
    scanResultKind: isFallback ? 'fallback' : 'measured-trace',
    traceStatus: traceAvailable ? (isFallback ? 'provided' : 'extracted') : 'missing',
    traceAttempted,
    traceAvailable,
    traceWarnings,
    traceDebugCounts: {
      rawLines: traceLines.length,
      rawRects: rawRectCount,
      rawPolylines: rawPolylineCount,
      rawTextRuns: rawTextRunCount,
      runtimeProviderStatus,
      runtimeProviderMatchTier: input.tracePayload?.runtime?.providerMatchTier,
      operatorListStatus,
      textContentStatus,
      mergedWalls: inferredWalls.length,
      openings: inferredOpenings.length,
      roomCandidates: inferredRooms.length,
      confidenceCapReason,
    },
    scaleStatus: inferredScaleFromText ? 'detected' : isFallback ? 'default' : 'detected',
    confidenceBreakdown: {
      totalPoints: Math.round(confidence * 100),
      totalPercent: Math.round(confidence * 100),
      confidenceCapReason,
      items: {
        sourceSetSelected: 0,
        sheetsClassified: 0,
        floorPlanSheetSelected: 0,
        scaleDetected: isFallback ? 0 : 10,
        dimensionsDetected: dimensions.length > 0 && !isFallback ? 10 : 0,
        vectorTraceAvailable: traceLines.length > 0 && !isFallback ? 10 : 0,
        wallCandidatesFound: !isFallback && walls.length > 0 ? 10 : 0,
        openingsFound: !isFallback && openings.length > 0 ? 5 : 0,
        roomsValidated: !isFallback && rooms.length > 0 ? 5 : 0,
        elevationsMatched: 0,
        electricalSheetsMatched: 0,
      },
      reasons: {
        sourceSetSelected: 'Single-sheet scan path.',
        sheetsClassified: 'Single-sheet scan path.',
        floorPlanSheetSelected: 'Single-sheet scan path.',
        scaleDetected: isFallback ? 'Scale not detected from measured trace.' : 'Scale inferred from trace context.',
        dimensionsDetected: dimensions.length > 0 ? 'Dimensions generated for the scanned layout.' : 'No dimensions detected.',
        vectorTraceAvailable: traceLines.length > 0 ? 'Vector trace payload was provided.' : 'No vector trace payload provided.',
        wallCandidatesFound: walls.length > 0 ? `Generated ${walls.length} wall candidates.` : 'No wall candidates generated.',
        openingsFound: openings.length > 0 ? `Generated ${openings.length} opening candidates.` : 'No opening candidates generated.',
        roomsValidated: rooms.length > 0 ? `Generated ${rooms.length} room candidates.` : 'No room candidates generated.',
        elevationsMatched: 'Not applicable in single-sheet scan.',
        electricalSheetsMatched: 'Not applicable in single-sheet scan.',
      },
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
    kind: wall.kind ?? (wall.exterior ? 'exterior' : 'partition'),
    confidence: wall.confidence,
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
    swing: opening.swing,
    swingDegrees: opening.swingDegrees,
    subtype: opening.subtype,
    metadata: {
      sourceTag: 'scanner',
    },
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

  const roleFromPlanType = (t: PlanRoomCandidate['type']): RoomRole => {
    switch (t) {
      case 'reception':
        return 'reception'
      case 'waiting':
        return 'waiting'
      case 'styling':
        return 'styling'
      case 'hallway':
        return 'hallway'
      case 'bath':
        return 'bath'
      case 'utility':
        return 'utility'
      case 'storage':
        return 'storage'
      case 'service':
        return 'service'
      case 'office':
        return 'office'
      case 'living':
        return 'living'
      case 'bedroom':
        return 'bedroom'
      case 'kitchen':
        return 'kitchen'
      case 'garage':
        return 'garage'
      default:
        return 'other'
    }
  }

  // Group equipment hints by room id for fast attach.
  const equipmentByRoom = new Map<string, RoomEquipmentHint[]>()
  for (const hint of scan.equipmentHints || []) {
    if (!hint.roomId) continue
    const list = equipmentByRoom.get(hint.roomId) || []
    list.push({
      id: hint.id,
      kind: hint.kind,
      label: hint.label,
      positionNormalized: hint.positionNormalized,
      confidence: hint.confidence,
      sourceTag: hint.sourceTag,
    })
    equipmentByRoom.set(hint.roomId, list)
  }

  // Build rooms. Each room owns the 4 walls that form its perimeter plus any
  // standalone divider walls that the scanner attributed to it.
  const rooms: BuildingRoomModel[] = scan.rooms.map((room) => {
    const perimeterIds = ['n', 's', 'w', 'e'].map((s) => `${room.id}_wall_${s}`)
    const wallCandidates = scan.walls.filter(
      (w) =>
        perimeterIds.includes(w.id) ||
        w.roomId === room.id ||
        w.id.startsWith(`${room.id}_wall_`) ||
        w.id.startsWith(`${room.id}_divider_`),
    )
    const wallList: BuildingWallModel[] = wallCandidates.map((wc) =>
      wallModelFromCandidate(wc, wallHeight, openingsByWall.get(wc.id) || []),
    )
    const width = room.bounds.max.x - room.bounds.min.x
    const depth = room.bounds.max.y - room.bounds.min.y
    const roomHints = equipmentByRoom.get(room.id) || []
    return {
      id: room.id,
      label: room.label,
      bounds: room.bounds,
      area: width * depth,
      height: wallHeight,
      walls: wallList,
      electricalAnchors: [],
      visible: true,
      equipmentHints: roomHints,
      metadata: {
        type: toModelType(room.type),
        floor: 0,
        notes: `Scanner role: ${room.roleHint || room.type}`,
        role: room.roleHint || roleFromPlanType(room.type),
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

/**
 * Convenience converter when callers have room candidates but still want the
 * canonical BlueprintBuildingModel shape.
 */
export function convertRoomCandidatesToBuildingModel(params: {
  footprint: Rectangle
  rooms: PlanRoomCandidate[]
  walls: PlanWallCandidate[]
  openings?: PlanOpeningCandidate[]
  layoutContext?: BlueprintPlanScanResult['layoutContext']
  confidence?: number
  projectName?: string
  blueprintTitle?: string
}): BlueprintBuildingModel {
  const scan: BlueprintPlanScanResult = {
    footprint: params.footprint,
    walls: params.walls,
    openings: params.openings || [],
    rooms: params.rooms,
    dimensions: [],
    warnings: [],
    traceLines: [],
    isFallback: false,
    confidence: params.confidence ?? 0.6,
    layoutContext: params.layoutContext || 'commercial-suite',
    equipmentHints: [],
    finishHints: [],
    electricalHints: [],
    doorHints: [],
    wallHints: [],
    projectHint: projectHintForContext(params.layoutContext || 'commercial-suite'),
    metadata: {
      projectName: params.projectName,
      blueprintTitle: params.blueprintTitle,
      generatedAt: new Date().toISOString(),
    },
    scanResultKind: 'inferred',
    traceStatus: 'missing',
    scaleStatus: 'default',
  }
  return convertPlanScanToBuildingModel(scan)
}

type SheetClassificationContext = {
  sourceSetName?: string
  sourceSetType?: string
  blueprintTitle?: string
  extractedText?: string
  projectName?: string
}

// ---------------------------------------------------------------------------
// Wave 1B — full-set page classification roles (deterministic, per-page)
// ---------------------------------------------------------------------------

export type BlueprintPageClassificationRole =
  | 'proposed_dimensioned_plan'
  | 'proposed_floor_plan'
  | 'partition_plan'
  | 'demolition_plan'
  | 'electrical_plan'
  | 'reflected_ceiling_plan'
  | 'interior_elevation'
  | 'rendering'
  | 'schedule'
  | 'title_notes'
  | 'unknown'

export interface BlueprintPageClassification {
  pageNumber: number
  sheetNumber?: string
  sheetTitle?: string
  role: BlueprintPageClassificationRole
  roleConfidence: number
  reasons: string[]
  eligibleForWallSource: boolean
}

export interface RankedWallPlanCandidate {
  rank: number
  pageNumber: number
  sheetNumber?: string
  sheetTitle?: string
  role: BlueprintPageClassificationRole
  score: number
  reasons: string[]
}

export interface CanonicalWallPlanPage {
  pageNumber: number
  sheetNumber?: string
  sheetTitle?: string
  role: BlueprintPageClassificationRole
  confidence: number
  selectionReasons: string[]
}

const WALL_SOURCE_ROLES: ReadonlySet<BlueprintPageClassificationRole> = new Set([
  'proposed_dimensioned_plan',
  'proposed_floor_plan',
  'partition_plan',
])

/** Higher index = lower priority when scores tie. */
const ROLE_TIEBREAK_ORDER: BlueprintPageClassificationRole[] = [
  'proposed_dimensioned_plan',
  'proposed_floor_plan',
  'partition_plan',
  'demolition_plan',
  'electrical_plan',
  'reflected_ceiling_plan',
  'interior_elevation',
  'rendering',
  'schedule',
  'title_notes',
  'unknown',
]

function roleTiebreakIndex(role: BlueprintPageClassificationRole): number {
  const idx = ROLE_TIEBREAK_ORDER.indexOf(role)
  return idx >= 0 ? idx : ROLE_TIEBREAK_ORDER.length
}

function flattenTraceText(payload: PdfTracePayload | null | undefined): string {
  if (!payload?.textRuns?.length) return ''
  const joined = payload.textRuns
    .map((t) => String(t.text || '').trim())
    .filter(Boolean)
    .join(' ')
  return joined.length > 8000 ? joined.slice(0, 8000) : joined
}

function traceGeometryHints(payload: PdfTracePayload | null | undefined): {
  lineCount: number
  textRunCount: number
  rectCount: number
} {
  if (!payload) return { lineCount: 0, textRunCount: 0, rectCount: 0 }
  return {
    lineCount: Array.isArray(payload.lines) ? payload.lines.length : 0,
    textRunCount: Array.isArray(payload.textRuns) ? payload.textRuns.length : 0,
    rectCount: Array.isArray(payload.rects) ? payload.rects.length : 0,
  }
}

type RoleKeywordRule = { term: string; weight: number }

const PAGE_ROLE_KEYWORD_RULES: Record<BlueprintPageClassificationRole, RoleKeywordRule[]> = {
  proposed_dimensioned_plan: [
    { term: 'proposed dimensioned plan', weight: 1.0 },
    { term: 'dimensioned plan', weight: 0.75 },
    { term: 'dimensioned floor plan', weight: 0.85 },
    { term: 'proposed dimensioned', weight: 0.9 },
  ],
  proposed_floor_plan: [
    { term: 'proposed floor plan', weight: 0.95 },
    { term: 'floor plan', weight: 0.7 },
    { term: 'proposed plan', weight: 0.72 },
    { term: 'suite plan', weight: 0.65 },
    { term: 'tenant improvement plan', weight: 0.55 },
    { term: 'furniture plan', weight: 0.5 },
    { term: 'architectural plan', weight: 0.62 },
    { term: 'layout plan', weight: 0.45 },
  ],
  partition_plan: [
    { term: 'partition plan', weight: 0.95 },
    { term: 'partition layout', weight: 0.85 },
    { term: 'stud layout', weight: 0.75 },
    { term: 'drywall layout', weight: 0.72 },
    { term: 'framing plan', weight: 0.68 },
    { term: 'wall layout', weight: 0.55 },
  ],
  demolition_plan: [
    { term: 'demolition plan', weight: 0.95 },
    { term: 'demo plan', weight: 0.88 },
    { term: 'demolition', weight: 0.65 },
    { term: 'remove existing', weight: 0.55 },
    { term: 'existing to remain', weight: 0.35 },
  ],
  electrical_plan: [
    { term: 'electrical plan', weight: 0.9 },
    { term: 'power plan', weight: 0.82 },
    { term: 'receptacle plan', weight: 0.85 },
    { term: 'lighting plan', weight: 0.55 },
    { term: 'panel schedule', weight: 0.45 },
    { term: 'electrical', weight: 0.5 },
  ],
  reflected_ceiling_plan: [
    { term: 'reflected ceiling plan', weight: 0.95 },
    { term: 'reflected ceiling', weight: 0.88 },
    { term: 'rcp', weight: 0.75 },
    { term: 'ceiling plan', weight: 0.72 },
  ],
  interior_elevation: [
    { term: 'interior elevation', weight: 0.95 },
    { term: 'interior elevations', weight: 0.92 },
    { term: 'wall elevation', weight: 0.55 },
    { term: 'elevation', weight: 0.45 },
    { term: 'north elevation', weight: 0.35 },
    { term: 'south elevation', weight: 0.35 },
    { term: 'east elevation', weight: 0.35 },
    { term: 'west elevation', weight: 0.35 },
  ],
  rendering: [
    { term: 'rendering', weight: 0.92 },
    { term: 'renderings', weight: 0.92 },
    { term: '3d rendering', weight: 0.88 },
    { term: 'perspective', weight: 0.75 },
    { term: 'photorealistic', weight: 0.55 },
  ],
  schedule: [
    { term: 'door schedule', weight: 0.92 },
    { term: 'finish schedule', weight: 0.88 },
    { term: 'equipment schedule', weight: 0.88 },
    { term: 'panel schedule', weight: 0.72 },
    { term: 'schedule', weight: 0.55 },
    { term: 'door list', weight: 0.6 },
  ],
  title_notes: [
    { term: 'title sheet', weight: 0.92 },
    { term: 'cover sheet', weight: 0.88 },
    { term: 'general notes', weight: 0.78 },
    { term: 'drawing index', weight: 0.72 },
    { term: 'index of drawings', weight: 0.72 },
    { term: 'sheet index', weight: 0.7 },
    { term: 'abbreviations', weight: 0.45 },
    { term: 'symbol legend', weight: 0.42 },
  ],
  unknown: [],
}

function scorePageRoleFromHaystack(
  role: BlueprintPageClassificationRole,
  haystack: string,
): { score: number; hits: string[] } {
  const rules = PAGE_ROLE_KEYWORD_RULES[role]
  let score = 0
  const hits: string[] = []
  for (const { term, weight } of rules) {
    if (haystack.includes(term)) {
      score += weight
      hits.push(term)
    }
  }
  return { score: Math.min(2.5, score), hits }
}

/**
 * Deterministic per-page classification for Wave 1B. Uses sheet metadata,
 * optional extracted/trace text, file names, and light vector/text counts —
 * never uses "current viewer page" (caller must not pass that as sheet truth).
 */
export function classifyBlueprintPage(
  sheet: BlueprintVRSourceSheet,
  context?: SheetClassificationContext,
  tracePayload?: PdfTracePayload | null,
): BlueprintPageClassification {
  const traceText = flattenTraceText(tracePayload)
  const geom = traceGeometryHints(tracePayload)
  const haystack = normalizeText([
    sheet.sheetNumber,
    sheet.sheetTitle,
    sheet.sheetLabel,
    sheet.label,
    sheet.discipline,
    sheet.fileName,
    sheet.extractedText,
    traceText,
    sheet.sourceSetName || context?.sourceSetName,
    sheet.sourceSetType || context?.sourceSetType,
    sheet.blueprintTitle || context?.blueprintTitle,
    context?.extractedText,
    context?.projectName,
  ])

  const reasons: string[] = []
  const scores: Partial<Record<BlueprintPageClassificationRole, number>> = {}

  for (const role of ROLE_TIEBREAK_ORDER) {
    if (role === 'unknown') continue
    const { score, hits } = scorePageRoleFromHaystack(role, haystack)
    if (score > 0) {
      scores[role] = score
      if (hits.length) reasons.push(`${role}:keyword=${hits.slice(0, 3).join('|')}`)
    }
  }

  const sheetNumHay = normalizeText([sheet.sheetNumber, sheet.sheetLabel, sheet.label])
  if (/\bap[\s\-]?\d{2,4}(?:\.\d+)?\b/i.test(sheetNumHay)) {
    scores.proposed_floor_plan = (scores.proposed_floor_plan || 0) + 0.55
    reasons.push('sheet_number:architectural_ap_prefix')
  }
  if (/\be[\s\-]?\d{1,3}(?:\.\d+)?\b/i.test(sheetNumHay)) {
    scores.electrical_plan = (scores.electrical_plan || 0) + 0.65
    reasons.push('sheet_number:electrical_e_prefix')
  }
  if (/\bie[\s\-]?\d{1,3}(?:\.\d+)?\b/i.test(sheetNumHay)) {
    scores.interior_elevation = (scores.interior_elevation || 0) + 0.7
    reasons.push('sheet_number:interior_elevation_ie_prefix')
  }
  if (/\b(?:p|l|m)\d{1,2}(?:\.\d+)?\b/i.test(sheetNumHay) && haystack.includes('schedule')) {
    scores.schedule = (scores.schedule || 0) + 0.35
    reasons.push('sheet_number:possible_schedule_index')
  }

  const disc = normalizeText([sheet.discipline])
  if (disc.includes('electrical') || disc.includes('ee')) {
    scores.electrical_plan = (scores.electrical_plan || 0) + 0.45
    reasons.push('discipline:electrical')
  }
  if (disc.includes('architectural') || disc.includes('aia')) {
    scores.proposed_floor_plan = (scores.proposed_floor_plan || 0) + 0.25
    reasons.push('discipline:architectural')
  }

  if (geom.lineCount > 400 && geom.textRunCount < 5) {
    scores.rendering = (scores.rendering || 0) + 0.15
    reasons.push('trace:high_line_low_text_suggesting_image_like_sheet')
  }
  if (geom.textRunCount > 80 && (scores.schedule || 0) < 0.4) {
    scores.schedule = (scores.schedule || 0) + 0.12
    reasons.push('trace:high_text_run_count_weak_schedule_hint')
  }

  let bestRole: BlueprintPageClassificationRole = 'unknown'
  let bestScore = -1
  for (const role of ROLE_TIEBREAK_ORDER) {
    if (role === 'unknown') continue
    const s = scores[role] || 0
    if (s > bestScore || (s === bestScore && roleTiebreakIndex(role) < roleTiebreakIndex(bestRole))) {
      bestScore = s
      bestRole = role
    }
  }

  if (bestScore <= 0) {
    bestRole = 'unknown'
    reasons.push('no_role_evidence_from_metadata_or_trace_text')
  }

  let eligibleForWallSource = WALL_SOURCE_ROLES.has(bestRole) && bestScore >= 0.45

  if (WALL_SOURCE_ROLES.has(bestRole)) {
    const veto = Math.max(
      scores.electrical_plan || 0,
      scores.demolition_plan || 0,
      scores.reflected_ceiling_plan || 0,
      scores.rendering || 0,
      scores.schedule || 0,
      scores.title_notes || 0,
      scores.interior_elevation || 0,
    )
    if (veto >= bestScore - 0.15 && veto >= 0.5) {
      eligibleForWallSource = false
      reasons.push(`veto:competing_non_wall_role_score=${veto.toFixed(2)}`)
    }
  }

  const roleConfidence =
    bestRole === 'unknown'
      ? 0.22
      : Math.max(0.28, Math.min(0.92, 0.28 + bestScore * 0.28))

  return {
    pageNumber: sheet.pageNumber,
    sheetNumber: sheet.sheetNumber,
    sheetTitle: sheet.sheetTitle,
    role: bestRole,
    roleConfidence,
    reasons: Array.from(new Set(reasons)).slice(0, 12),
    eligibleForWallSource,
  }
}

function mapPageRoleToLegacySheetRoles(role: BlueprintPageClassificationRole): SheetRole[] {
  switch (role) {
    case 'proposed_dimensioned_plan':
    case 'proposed_floor_plan':
    case 'partition_plan':
      return ['floor_plan']
    case 'electrical_plan':
      return ['electrical', 'power']
    case 'reflected_ceiling_plan':
      return ['reflected_ceiling_plan', 'lighting']
    case 'interior_elevation':
      return ['elevations']
    case 'rendering':
      return ['rendering']
    case 'schedule':
      return ['schedules']
    case 'title_notes':
      return ['unknown']
    case 'demolition_plan':
      return ['finish']
    default:
      return ['unknown']
  }
}

function pageClassificationToLegacyRow(
  row: BlueprintPageClassification,
  legacyScores: Partial<Record<SheetRole, number>>,
): FullSetSheetClassification {
  const roles = mapPageRoleToLegacySheetRoles(row.role)
  return {
    pageNumber: row.pageNumber,
    sheetNumber: row.sheetNumber,
    sheetTitle: row.sheetTitle,
    sheetLabel: undefined,
    discipline: undefined,
    roles: roles.length ? roles : ['unknown'],
    roleScores: legacyScores,
    reason: row.reasons.join('; ') || row.role,
    confidence: row.roleConfidence,
  }
}

function countPageRoles(
  rows: BlueprintPageClassification[],
): Record<BlueprintPageClassificationRole, number> {
  const init = {} as Record<BlueprintPageClassificationRole, number>
  for (const r of ROLE_TIEBREAK_ORDER) init[r] = 0
  for (const row of rows) {
    init[row.role] = (init[row.role] || 0) + 1
  }
  return init
}

function rankWallPlanCandidatesFromPages(
  pages: BlueprintPageClassification[],
): RankedWallPlanCandidate[] {
  const eligible = pages.filter((p) => p.eligibleForWallSource)
  const roleRank = (role: BlueprintPageClassificationRole): number => {
    if (role === 'proposed_dimensioned_plan') return 0
    if (role === 'proposed_floor_plan') return 1
    if (role === 'partition_plan') return 2
    return 99
  }
  const sorted = [...eligible].sort((a, b) => {
    const ra = roleRank(a.role)
    const rb = roleRank(b.role)
    if (ra !== rb) return ra - rb
    if (b.roleConfidence !== a.roleConfidence) return b.roleConfidence - a.roleConfidence
    return a.pageNumber - b.pageNumber
  })
  return sorted.map((p, i) => ({
    rank: i + 1,
    pageNumber: p.pageNumber,
    sheetNumber: p.sheetNumber,
    sheetTitle: p.sheetTitle,
    role: p.role,
    score: p.roleConfidence + (roleRank(p.role) <= 2 ? (2 - roleRank(p.role)) * 0.08 : 0),
    reasons: [...p.reasons].slice(0, 4),
  }))
}

function selectCanonicalWallPlanPages(params: {
  ranked: RankedWallPlanCandidate[]
  pages: BlueprintPageClassification[]
}): {
  canonical: CanonicalWallPlanPage[]
  ambiguous: boolean
  confidence: number
  warnings: string[]
  blockers: string[]
} {
  const warnings: string[] = []
  const blockers: string[] = []
  if (params.ranked.length === 0) {
    blockers.push('no_eligible_wall_plan_pages_after_classification')
    return { canonical: [], ambiguous: false, confidence: 0.15, warnings, blockers }
  }

  const top = params.ranked[0]
  const second = params.ranked[1]
  const scoreGap = second ? top.score - second.score : 1
  const nearTie = second && Math.abs(scoreGap) < 0.06 && top.role === second.role

  if (nearTie) {
    warnings.push('ambiguous_canonical_wall_plan:top_two_candidates_nearly_tied')
    const conf = Math.max(0.25, Math.min(0.55, (top.score + second.score) / 4))
    return {
      canonical: [
        {
          pageNumber: top.pageNumber,
          sheetNumber: top.sheetNumber,
          sheetTitle: top.sheetTitle,
          role: top.role,
          confidence: conf,
          selectionReasons: [
            'co_top_ranked_eligible_wall_source',
            `tied_with_page_${second.pageNumber}`,
          ],
        },
        {
          pageNumber: second.pageNumber,
          sheetNumber: second.sheetNumber,
          sheetTitle: second.sheetTitle,
          role: second.role,
          confidence: conf,
          selectionReasons: [
            'co_top_ranked_eligible_wall_source',
            `tied_with_page_${top.pageNumber}`,
          ],
        },
      ],
      ambiguous: true,
      confidence: conf,
      warnings,
      blockers,
    }
  }

  const conf = Math.max(0.35, Math.min(0.9, top.score))
  return {
    canonical: [
      {
        pageNumber: top.pageNumber,
        sheetNumber: top.sheetNumber,
        sheetTitle: top.sheetTitle,
        role: top.role,
        confidence: conf,
        selectionReasons: [
          'highest_ranked_eligible_wall_plan_candidate',
          second ? `score_gap_vs_rank2=${scoreGap.toFixed(3)}` : 'single_eligible_candidate',
        ],
      },
    ],
    ambiguous: false,
    confidence: conf,
    warnings,
    blockers,
  }
}

/**
 * Enumerate one {@link BlueprintVRSourceSheet} per physical page (1..N).
 * Merges optional per-page vector payloads for trace text / geometry hints only
 * after extraction; classification does not assume traces exist.
 */
export function enumerateFullSourceSetSheets(
  sourceSet: BlueprintVRSourceSet,
  multiPageTraces?: Record<number, PdfTracePayload | null | undefined>,
): BlueprintVRSourceSheet[] {
  const sheets = sourceSet.sheets || []
  const maxFromRows = sheets.reduce((m, s) => Math.max(m, Math.floor(Number(s.pageNumber) || 0)), 0)
  const declared = Math.floor(Number(sourceSet.totalPages) || 0)
  const total = Math.max(declared, maxFromRows, sheets.length > 0 ? sheets.length : 0, 1)
  const byPage = new Map<number, BlueprintVRSourceSheet>()
  for (const sh of sheets) {
    const p = Math.floor(Number(sh.pageNumber) || 0)
    if (p > 0) byPage.set(p, sh)
  }
  const out: BlueprintVRSourceSheet[] = []
  for (let page = 1; page <= total; page += 1) {
    const base = byPage.get(page)
    const trace = multiPageTraces?.[page] ?? undefined
    const traceText = flattenTraceText(trace || null)
    const mergedText = [base?.extractedText, traceText].filter(Boolean).join(' | ')
    out.push({
      pageNumber: page,
      sheetNumber: base?.sheetNumber,
      sheetTitle: base?.sheetTitle,
      sheetLabel: base?.sheetLabel,
      label: base?.label,
      discipline: base?.discipline,
      fileName: base?.fileName || sourceSet.filePath,
      extractedText: mergedText.length > 12000 ? mergedText.slice(0, 12000) : mergedText || undefined,
      sourceSetName: base?.sourceSetName || sourceSet.name,
      sourceSetType: base?.sourceSetType || sourceSet.type,
      blueprintTitle: base?.blueprintTitle || sourceSet.name,
      tracePayload: trace ?? base?.tracePayload ?? null,
      traceAttempted:
        base?.traceAttempted ||
        (multiPageTraces ? Object.prototype.hasOwnProperty.call(multiPageTraces, page) : false),
      traceWarnings: base?.traceWarnings,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Full-set scanner — multi-sheet classification + merged hints
// ---------------------------------------------------------------------------

/**
 * Coarse role classification for a sheet inside a multi-sheet blueprint set.
 *
 *  - 'floor_plan' — primary architectural floor plan
 *  - 'reflected_ceiling_plan' — RCP
 *  - 'electrical' — generic electrical sheet
 *  - 'lighting' — lighting plan
 *  - 'power' — power / receptacle plan
 *  - 'finish' — finish plan / interiors
 *  - 'rendering' — perspective renders or 3D model
 *  - 'elevations' — exterior / interior elevations
 *  - 'schedules' — door / equipment / panel schedules
 *  - 'unknown' — could not classify
 */
export type SheetRole =
  | 'floor_plan'
  | 'reflected_ceiling_plan'
  | 'electrical'
  | 'lighting'
  | 'power'
  | 'finish'
  | 'rendering'
  | 'elevations'
  | 'schedules'
  | 'unknown'

/**
 * A single sheet inside a full-set source. The scanner only needs label / title
 * / discipline / page-number context — actual vector trace is optional.
 */
export interface BlueprintVRSourceSheet {
  pageNumber: number
  sheetNumber?: string
  sheetTitle?: string
  sheetLabel?: string
  /** Optional alternate label field from source index rows. */
  label?: string
  discipline?: string
  fileName?: string
  /** Optional extracted text snippet for this page. */
  extractedText?: string
  /** Optional source-set metadata propagated for classification context. */
  sourceSetName?: string
  sourceSetType?: string
  /** Optional originating blueprint title/name. */
  blueprintTitle?: string
  /** Optional structured payload for future vector extraction. */
  tracePayload?: PdfTracePayload | null
  /** True when vector extraction was attempted for this sheet. */
  traceAttempted?: boolean
  /** Extraction warnings for this sheet. */
  traceWarnings?: Array<{ code: string; message: string }>
}

/**
 * Blueprint set used as the canonical Generate VR source for a project. Each
 * source set typically corresponds to a "Full Set" or "Updated Revisions"
 * upload but may also be a custom derived set.
 */
export interface BlueprintVRSourceSet {
  id: string
  name: string
  /** Optional set type (Full Set, Electrical Only, etc.). */
  type?: string
  /** Project id this set belongs to. */
  projectId?: string
  /** Project display name. */
  projectName?: string
  /** Sheets contained in the set. */
  sheets: BlueprintVRSourceSheet[]
  /** Optional storage key / file name. */
  filePath?: string
  /** Optional total page count when fewer sheet rows are listed. */
  totalPages?: number
}

/**
 * Input shape consumed by scanBlueprintFullSet().
 */
export interface BlueprintFullSetScanInput {
  projectName?: string
  /** The blueprint set selected as the VR source. */
  sourceSet: BlueprintVRSourceSet
  /** Active sheet/page the user is currently viewing (for tie-break). */
  activePageNumber?: number
  /** Optional extracted text from the set for context detection. */
  extractedText?: string
  /** Optional annotation summary for the set. */
  annotationsSummary?: string
  /**
   * Multi-page trace results from the async PDF extraction loop.
   * Keyed by 1-based page number. When provided, the scanner picks the best
   * floor-plan page's trace from this map instead of relying on the sheet's
   * pre-attached tracePayload (which may be stale or absent).
   */
  multiPageTraces?: Record<number, import('./pdfTraceTypes').PdfTracePayload>
  /** Total pages that were actually scanned (for diagnostics / confidence). */
  totalPagesScanned?: number
}

/**
 * Per-sheet classification entry returned by the full-set scan.
 */
export interface FullSetSheetClassification {
  pageNumber: number
  sheetNumber?: string
  sheetTitle?: string
  sheetLabel?: string
  discipline?: string
  roles: SheetRole[]
  roleScores: Partial<Record<SheetRole, number>>
  reason: string
  /** Classification confidence, 0–1. */
  confidence: number
}

export interface SelectedFloorPlanSheet {
  pageNumber: number
  sheetNumber?: string
  sheetTitle?: string
  confidence: number
  reason: string
}

/**
 * Output of the full-set scan. Combines a base plan scan with classifications
 * for every sheet and merged hints across the set.
 */
export interface BlueprintFullSetScanResult {
  /** Underlying plan scan that drove the geometry. */
  planScan: BlueprintPlanScanResult
  /** Per-sheet role classifications. */
  classifications: FullSetSheetClassification[]
  /** Wave 1B: deterministic per-page roles (full enumerated set). */
  pageClassifications: BlueprintPageClassification[]
  /** Total physical pages in the enumerated source set (classification pass). */
  totalPagesScanned: number
  /** Ranked eligible wall-plan source pages (proposed / partition roles). */
  rankedWallPlanCandidates: RankedWallPlanCandidate[]
  /** Canonical wall-plan source page(s); may be multiple when ambiguous. */
  canonicalWallPlanPages: CanonicalWallPlanPage[]
  /** Non-fatal classification issues (e.g. ambiguity). */
  classificationWarnings: string[]
  /** Hard gating issues (e.g. no eligible wall-plan pages). */
  classificationBlockers: string[]
  /** 0–1 confidence in canonical wall-plan selection. */
  canonicalSelectionConfidence: number
  /** True when two or more pages share top-tier canonical status. */
  canonicalSelectionAmbiguous: boolean
  /** Histogram of Wave 1B roles across all pages. */
  pageRoleCounts: Record<BlueprintPageClassificationRole, number>
  /** Best floor-plan sheet chosen from the set (if any). */
  bestFloorPlanSheet: SelectedFloorPlanSheet | null
  /** Best electrical sheets in priority order. */
  bestElectricalSheets: BlueprintVRSourceSheet[]
  /** Best rendering / perspective sheets. */
  bestRenderingSheets: BlueprintVRSourceSheet[]
  /** Equipment hints aggregated from the set (project context). */
  equipmentHints: EquipmentHint[]
  /** Door / opening hints aggregated from the set. */
  doorHints: DoorHint[]
  /** Wall thickness / kind hints aggregated from the set. */
  wallHints: WallHint[]
  /** Composite project hint (style, finishes, wall defaults). */
  projectHint: ExtractedProjectHint
  /** Warnings surfaced during the full-set walk. */
  warnings: PlanScanWarning[]
  /** Aggregated role counts for scanner status diagnostics. */
  sheetRoleCounts: {
    floorPlan: number
    electricalPower: number
    rendering: number
    interiorElevation: number
    finishMaterial: number
    schedule: number
    unknown: number
  }
  /** Point-by-point confidence explanation. */
  confidenceBreakdown: ScanConfidenceBreakdown
  /** Metadata for diagnostics. */
  metadata: {
    sourceSetId: string
    sourceSetName: string
    projectName?: string
    sheetCount: number
    generatedAt: string
  }
}

// ---------------------------------------------------------------------------
// Sheet classification heuristics
// ---------------------------------------------------------------------------

const SHEET_ROLE_RULES: Array<{
  role: SheetRole
  weightedNeedles: Array<{ term: string; weight: number }>
  weightedRegexes: Array<{ pattern: RegExp; weight: number }>
}> = [
  {
    role: 'floor_plan',
    weightedNeedles: [
      { term: 'floor plan', weight: 0.55 },
      { term: 'dimensioned plan', weight: 0.8 },
      { term: 'proposed dimensioned plan', weight: 1.0 },
      { term: 'proposed plan', weight: 0.75 },
      { term: 'architectural plan', weight: 0.75 },
      { term: 'tenant improvement', weight: 0.45 },
      { term: 'layout', weight: 0.35 },
      { term: 'furniture plan', weight: 0.45 },
    ],
    weightedRegexes: [
      { pattern: /\bap[\s\-]?100(?:\.\d+)?\b/i, weight: 1.0 },
      { pattern: /\ba[\s\-]?\d{1,3}(?:\.\d+)?\b/i, weight: 0.45 },
    ],
  },
  {
    role: 'electrical',
    weightedNeedles: [
      { term: 'electrical', weight: 0.75 },
      { term: 'power', weight: 0.65 },
      { term: 'receptacle', weight: 0.65 },
      { term: 'lighting', weight: 0.55 },
      { term: 'panel', weight: 0.55 },
      { term: 'circuit', weight: 0.5 },
      { term: 'branch', weight: 0.45 },
      { term: 'switch', weight: 0.45 },
      { term: 'device', weight: 0.35 },
      { term: 'low voltage', weight: 0.4 },
    ],
    weightedRegexes: [{ pattern: /\be[\s\-]?\d{1,3}(?:\.\d+)?\b/i, weight: 0.75 }],
  },
  {
    role: 'lighting',
    weightedNeedles: [
      { term: 'lighting', weight: 0.8 },
      { term: 'light plan', weight: 0.75 },
      { term: 'reflected ceiling', weight: 0.7 },
      { term: 'rcp', weight: 0.65 },
    ],
    weightedRegexes: [],
  },
  {
    role: 'power',
    weightedNeedles: [
      { term: 'power', weight: 0.8 },
      { term: 'receptacle', weight: 0.7 },
      { term: 'panel schedule', weight: 0.65 },
      { term: 'distribution', weight: 0.45 },
    ],
    weightedRegexes: [],
  },
  {
    role: 'rendering',
    weightedNeedles: [
      { term: 'rendering', weight: 0.9 },
      { term: 'renderings', weight: 0.9 },
      { term: 'interior rendering', weight: 0.9 },
      { term: '3d', weight: 0.45 },
      { term: 'perspective', weight: 0.8 },
      { term: 'beauty bar', weight: 0.45 },
      { term: 'lobby rendering', weight: 0.8 },
    ],
    weightedRegexes: [],
  },
  {
    role: 'elevations',
    weightedNeedles: [
      { term: 'interior elevation', weight: 0.95 },
      { term: 'elevation', weight: 0.75 },
      { term: 'facing north', weight: 0.7 },
      { term: 'facing south', weight: 0.7 },
      { term: 'facing east', weight: 0.7 },
      { term: 'facing west', weight: 0.7 },
      { term: 'hair station', weight: 0.45 },
      { term: 'restroom', weight: 0.35 },
      { term: 'storage', weight: 0.35 },
      { term: 'treatment', weight: 0.35 },
      { term: 'wash station', weight: 0.4 },
      { term: 'storefront', weight: 0.45 },
    ],
    weightedRegexes: [{ pattern: /\bie[\s\-]?\d{1,3}(?:\.\d+)?\b/i, weight: 0.85 }],
  },
  {
    role: 'finish',
    weightedNeedles: [
      { term: 'finish', weight: 0.8 },
      { term: 'material', weight: 0.65 },
      { term: 'wall finish', weight: 0.8 },
      { term: 'floor finish', weight: 0.8 },
      { term: 'tile', weight: 0.35 },
      { term: 'paint', weight: 0.35 },
      { term: 'millwork', weight: 0.5 },
    ],
    weightedRegexes: [],
  },
  {
    role: 'schedules',
    weightedNeedles: [
      { term: 'schedule', weight: 0.7 },
      { term: 'door schedule', weight: 0.9 },
      { term: 'panel schedule', weight: 0.85 },
      { term: 'equipment schedule', weight: 0.8 },
      { term: 'storefront', weight: 0.45 },
      { term: 'glazing', weight: 0.5 },
      { term: 'glass', weight: 0.4 },
      { term: 'door', weight: 0.3 },
      { term: 'window', weight: 0.35 },
    ],
    weightedRegexes: [],
  },
  {
    role: 'reflected_ceiling_plan',
    weightedNeedles: [
      { term: 'reflected ceiling', weight: 0.9 },
      { term: 'rcp', weight: 0.8 },
      { term: 'ceiling plan', weight: 0.8 },
    ],
    weightedRegexes: [],
  },
]

function normalizeText(parts: Array<string | undefined | null>): string {
  return parts
    .filter(Boolean)
    .map((p) => String(p))
    .join(' ')
    .toLowerCase()
}

/**
 * Classify a single sheet into one or more roles based on its label, title,
 * discipline, and (when known) page number range.
 */
export function classifySheetRole(sheet: BlueprintVRSourceSheet): SheetRole[] {
  return classifySheetRoleDetailed(sheet).roles
}

function classifySheetRoleDetailed(
  sheet: BlueprintVRSourceSheet,
  context?: SheetClassificationContext,
): {
  roles: SheetRole[]
  roleScores: Partial<Record<SheetRole, number>>
  confidence: number
  reason: string
} {
  const combined = normalizeText([
    sheet.sheetNumber,
    sheet.sheetTitle,
    sheet.sheetLabel,
    sheet.label,
    sheet.discipline,
    sheet.fileName,
    String(sheet.pageNumber || ''),
    sheet.sourceSetName || context?.sourceSetName,
    sheet.sourceSetType || context?.sourceSetType,
    sheet.blueprintTitle || context?.blueprintTitle,
    sheet.extractedText || context?.extractedText,
    context?.projectName,
  ])

  const roleScores: Partial<Record<SheetRole, number>> = {}
  for (const rule of SHEET_ROLE_RULES) {
    let score = 0
    for (const needle of rule.weightedNeedles) {
      if (combined.includes(needle.term)) score += needle.weight
    }
    for (const weightedRegex of rule.weightedRegexes) {
      if (weightedRegex.pattern.test(combined)) score += weightedRegex.weight
    }
    roleScores[rule.role] = Math.min(1, score)
  }

  const sheetNumber = normalizeText([sheet.sheetNumber, sheet.sheetLabel, sheet.label])
  const discipline = normalizeText([sheet.discipline])
  if (discipline.includes('architectural')) {
    roleScores.floor_plan = Math.min(1, (roleScores.floor_plan || 0) + 0.35)
  }
  if (discipline.includes('electrical')) {
    roleScores.electrical = Math.min(1, (roleScores.electrical || 0) + 0.45)
    roleScores.lighting = Math.min(1, (roleScores.lighting || 0) + 0.2)
  }
  if (/\bap[\s\-]?100(?:\.\d+)?\b/i.test(sheetNumber)) {
    roleScores.floor_plan = Math.min(1, (roleScores.floor_plan || 0) + 0.7)
  }
  if (/\be[\s\-]?\d{1,3}(?:\.\d+)?\b/i.test(sheetNumber)) {
    roleScores.electrical = Math.min(1, (roleScores.electrical || 0) + 0.5)
  }
  if (/\bie[\s\-]?\d{1,3}(?:\.\d+)?\b/i.test(sheetNumber)) {
    roleScores.elevations = Math.min(1, (roleScores.elevations || 0) + 0.65)
  }

  const roles = Object.entries(roleScores)
    .filter(([role, score]) => role !== 'unknown' && (score || 0) >= 0.5)
    .sort((a, b) => (b[1] || 0) - (a[1] || 0))
    .map(([role]) => role as SheetRole)

  if (roles.length === 0) roles.push('unknown')

  const topRole = roles[0]
  const topScore = roleScores[topRole] || 0.2
  const reason =
    topRole === 'unknown'
      ? 'Weak metadata signal; no reliable role keyword match.'
      : `Matched ${topRole.replace(/_/g, ' ')} sheet keywords and numbering cues.`
  return { roles, roleScores, confidence: Math.max(0.2, Math.min(0.98, topScore)), reason }
}

function classifyAllSheets(
  sheets: BlueprintVRSourceSheet[],
  context?: SheetClassificationContext,
): FullSetSheetClassification[] {
  return sheets.map((sheet) => {
    const classified = classifySheetRoleDetailed(sheet, context)
    return {
      pageNumber: sheet.pageNumber,
      sheetNumber: sheet.sheetNumber,
      sheetTitle: sheet.sheetTitle,
      sheetLabel: sheet.sheetLabel,
      discipline: sheet.discipline,
      roles: classified.roles,
      roleScores: classified.roleScores,
      reason: classified.reason,
      confidence: classified.confidence,
    }
  })
}

/**
 * Pick the best floor plan sheet from a classified set. Preference order:
 * sheets explicitly tagged floor_plan, then architectural discipline + plan,
 * then lowest page number with "plan" in the title.
 */
export function chooseBestFloorPlanSheet(
  sheets: BlueprintVRSourceSheet[],
  context?: SheetClassificationContext,
): SelectedFloorPlanSheet | null {
  if (!sheets || sheets.length === 0) return null
  let best: { sheet: BlueprintVRSourceSheet; score: number; reason: string } | null = null
  for (const sheet of sheets) {
    const classified = classifySheetRoleDetailed(sheet, context)
    const text = normalizeText([sheet.sheetNumber, sheet.sheetTitle, sheet.sheetLabel, sheet.label])
    let score = classified.roleScores.floor_plan || 0
    const reasons: string[] = []
    if ((classified.roleScores.floor_plan || 0) >= 0.5) reasons.push('floor-plan role matched')
    if (text.includes('proposed dimensioned plan')) {
      score += 1.2
      reasons.push('contains "Proposed Dimensioned Plan"')
    } else if (text.includes('dimensioned plan')) {
      score += 0.8
      reasons.push('contains "Dimensioned Plan"')
    } else if (text.includes('proposed plan') || text.includes('floor plan')) {
      score += 0.55
      reasons.push('contains floor-plan title keyword')
    }
    if (/\bap[\s\-]?100(?:\.\d+)?\b/i.test(text)) {
      score += 1.1
      reasons.push('matches AP100 floor-plan numbering')
    }
    if ((classified.roleScores.rendering || 0) >= 0.5) score -= 0.35
    if ((classified.roleScores.elevations || 0) >= 0.6) score -= 0.3
    if ((classified.roleScores.schedules || 0) >= 0.6) score -= 0.25
    if (best === null || score > best.score) {
      best = {
        sheet,
        score,
        reason: reasons.length > 0 ? reasons.join('; ') : 'Best available floor-plan candidate from metadata.',
      }
    }
  }
  if (!best || best.score < 0.45) return null
  return {
    pageNumber: best.sheet.pageNumber,
    sheetNumber: best.sheet.sheetNumber || best.sheet.sheetLabel || best.sheet.label,
    sheetTitle: best.sheet.sheetTitle,
    confidence: Math.max(0.35, Math.min(0.98, best.score / 2.6)),
    reason: best.reason,
  }
}

export function chooseBestElectricalSheets(
  sheets: BlueprintVRSourceSheet[],
  context?: SheetClassificationContext,
): BlueprintVRSourceSheet[] {
  if (!sheets || sheets.length === 0) return []
  return sheets
    .filter((s) => {
      const roles = classifySheetRoleDetailed(s, context).roles
      return (
        roles.includes('electrical') ||
        roles.includes('lighting') ||
        roles.includes('power')
      )
    })
    .sort((a, b) => a.pageNumber - b.pageNumber)
}

export function chooseBestRenderingSheets(
  sheets: BlueprintVRSourceSheet[],
  context?: SheetClassificationContext,
): BlueprintVRSourceSheet[] {
  if (!sheets || sheets.length === 0) return []
  return sheets
    .filter((s) => classifySheetRoleDetailed(s, context).roles.includes('rendering'))
    .sort((a, b) => a.pageNumber - b.pageNumber)
}

function getSheetRoleCounts(
  classifications: FullSetSheetClassification[],
): BlueprintFullSetScanResult['sheetRoleCounts'] {
  const counts = {
    floorPlan: 0,
    electricalPower: 0,
    rendering: 0,
    interiorElevation: 0,
    finishMaterial: 0,
    schedule: 0,
    unknown: 0,
  }
  for (const row of classifications) {
    const roles = row.roles || []
    if (roles.includes('floor_plan')) counts.floorPlan += 1
    if (roles.includes('electrical') || roles.includes('lighting') || roles.includes('power')) {
      counts.electricalPower += 1
    }
    if (roles.includes('rendering')) counts.rendering += 1
    if (roles.includes('elevations')) counts.interiorElevation += 1
    if (roles.includes('finish')) counts.finishMaterial += 1
    if (roles.includes('schedules')) counts.schedule += 1
    if (roles.includes('unknown')) counts.unknown += 1
  }
  return counts
}

function buildConfidenceBreakdown(params: {
  sourceSetSelected: boolean
  classifiedKnownSheets: number
  floorPlanSheet: SelectedFloorPlanSheet | null
  planScan: BlueprintPlanScanResult
  roleCounts: BlueprintFullSetScanResult['sheetRoleCounts']
  bestElectricalSheets: BlueprintVRSourceSheet[]
}): ScanConfidenceBreakdown {
  const runtimeProviderStatus = params.planScan.traceDebugCounts?.runtimeProviderStatus || 'missing'
  const rawTextRuns = params.planScan.traceDebugCounts?.rawTextRuns || 0
  const hasVectorTrace = (params.planScan.traceLines || []).length > 0 && !params.planScan.isFallback
  const hasWallsFromTrace = hasVectorTrace && params.planScan.walls.length >= 8
  const hasRoomsFromTrace = hasVectorTrace && params.planScan.rooms.length >= 2
  const hasOpeningsFromTrace = hasVectorTrace && params.planScan.openings.length >= 1
  const hasValidatedFootprint = hasVectorTrace && params.planScan.footprint.width >= 10 && params.planScan.footprint.height >= 10
  const hasScaleSignal =
    params.floorPlanSheet?.sheetTitle?.toLowerCase().includes('dimension') ||
    params.floorPlanSheet?.reason.toLowerCase().includes('dimensioned') ||
    false
  const hasDimensionSignal = (params.planScan.dimensions || []).length > 0 && hasScaleSignal

  const items: ScanConfidenceBreakdown['items'] = {
    sourceSetSelected: params.sourceSetSelected ? 8 : 0,
    sheetsClassified: params.classifiedKnownSheets > 0 ? 10 : 0,
    floorPlanSheetSelected: params.floorPlanSheet ? 12 : 0,
    scaleDetected: hasScaleSignal ? 10 : 0,
    dimensionsDetected: hasDimensionSignal ? 8 : 0,
    vectorTraceAvailable: hasVectorTrace ? 10 : 0,
    wallCandidatesFound: hasWallsFromTrace ? 10 : 0,
    openingsFound: hasOpeningsFromTrace ? 7 : 0,
    roomsValidated: hasRoomsFromTrace && hasValidatedFootprint ? 10 : 0,
    elevationsMatched: params.roleCounts.interiorElevation > 0 || params.roleCounts.rendering > 0 ? 5 : 0,
    electricalSheetsMatched: params.bestElectricalSheets.length > 0 ? 5 : 0,
  }

  const reasons: ScanConfidenceBreakdown['reasons'] = {
    sourceSetSelected: params.sourceSetSelected ? 'Project source set selected.' : 'No explicit source set selected.',
    sheetsClassified:
      params.classifiedKnownSheets > 0
        ? `Classified ${params.classifiedKnownSheets} sheet(s) with known roles.`
        : 'No reliable sheet metadata to classify roles.',
    floorPlanSheetSelected: params.floorPlanSheet
      ? `Selected floor-plan sheet: ${params.floorPlanSheet.sheetNumber || 'no number'} ${params.floorPlanSheet.sheetTitle || ''}`.trim()
      : 'No canonical floor-plan sheet could be selected.',
    scaleDetected: hasScaleSignal ? 'Dimensioned-plan signal detected in selected floor-plan sheet.' : 'No reliable scale/dimensioned-plan signal found.',
    dimensionsDetected: hasDimensionSignal ? 'Dimension annotations available with scale signal.' : 'Dimensions are fallback-only; measured dimensions not confirmed.',
    vectorTraceAvailable: hasVectorTrace ? 'Vector trace lines available for geometry extraction.' : 'No usable vector trace lines provided.',
    wallCandidatesFound: hasWallsFromTrace ? `Trace produced ${params.planScan.walls.length} wall candidates.` : 'Wall candidates still inferred from fallback model.',
    openingsFound: hasOpeningsFromTrace ? `Trace produced ${params.planScan.openings.length} opening candidates.` : 'Openings still inferred from fallback model.',
    roomsValidated: hasRoomsFromTrace ? `Trace-derived rooms validated (${params.planScan.rooms.length}).` : 'Rooms are inferred layout partitions, not trace-validated rooms.',
    elevationsMatched:
      params.roleCounts.interiorElevation > 0 || params.roleCounts.rendering > 0
        ? 'Elevation/rendering sheets matched in source set.'
        : 'No elevation/rendering sheet match found.',
    electricalSheetsMatched:
      params.bestElectricalSheets.length > 0
        ? `Electrical/power sheets matched (${params.bestElectricalSheets.length}).`
        : 'No electrical/power sheet match found.',
  }

  let totalPoints = 35 + Object.values(items).reduce((sum, value) => sum + value, 0)
  let confidenceCapReason = 'No cap applied.'
  if (!params.floorPlanSheet) {
    totalPoints = Math.min(totalPoints, 55)
    confidenceCapReason = 'No canonical floor-plan sheet selected; confidence capped below 60%.'
  }
  if (runtimeProviderStatus === 'missing' || runtimeProviderStatus === 'unknown') {
    totalPoints = Math.min(totalPoints, 59)
    confidenceCapReason = 'Runtime PDF provider missing; confidence capped below 60%.'
  } else if (runtimeProviderStatus === 'error') {
    totalPoints = Math.min(totalPoints, 59)
    confidenceCapReason = 'Runtime PDF provider error; confidence capped below 60%.'
  } else if (runtimeProviderStatus === 'partial') {
    totalPoints = Math.min(totalPoints, 62)
    confidenceCapReason =
      'Runtime PDF provider identity is a partial registry match only; confidence capped below 63%.'
  } else if (!hasVectorTrace) {
    totalPoints = Math.min(totalPoints, 64)
    confidenceCapReason =
      rawTextRuns > 0
        ? 'Text-only trace extraction; confidence capped below 65%.'
        : 'Runtime provider available but vector primitives unavailable; confidence capped below 65%.'
  } else if (!hasWallsFromTrace || !hasValidatedFootprint || !hasRoomsFromTrace) {
    totalPoints = Math.min(totalPoints, 74)
    confidenceCapReason = 'Vector primitives available but wall graph/rooms not fully validated; confidence capped below 75%.'
  } else {
    totalPoints = Math.max(totalPoints, 80)
    confidenceCapReason = 'Trace geometry validated with walls + footprint + rooms; 80% confidence unlocked.'
  }
  if ((!hasScaleSignal || !hasDimensionSignal) && !hasVectorTrace) {
    totalPoints = Math.min(totalPoints, 65)
    if (confidenceCapReason === 'No cap applied.') {
      confidenceCapReason = 'Scale/dimension signal missing; confidence capped below 65%.'
    }
  }
  if (!hasOpeningsFromTrace && totalPoints > 79) {
    totalPoints = 79
    confidenceCapReason = 'Openings are not trace-validated yet; confidence capped below 80%.'
  }
  totalPoints = Math.max(35, Math.min(95, totalPoints))
  return {
    totalPoints,
    totalPercent: totalPoints,
    confidenceCapReason,
    items,
    reasons,
  }
}

// ---------------------------------------------------------------------------
// Hint extractors driven by the full-set context
// ---------------------------------------------------------------------------

/**
 * Extract project style / finish hints from a full-set source. Today this
 * mostly reads project name / titles / labels and applies deterministic
 * defaults; it is the seam where richer text recovery will land.
 */
export function extractProjectStyleHints(
  input: BlueprintFullSetScanInput,
): ExtractedProjectHint {
  const combined = normalizeText([
    input.projectName,
    input.sourceSet?.name,
    input.sourceSet?.projectName,
    input.extractedText,
    input.annotationsSummary,
    ...(input.sourceSet?.sheets || []).map((s) =>
      [s.sheetNumber, s.sheetTitle, s.sheetLabel, s.discipline].join(' '),
    ),
  ])
  const ctx: BlueprintPlanScanResult['layoutContext'] = combined.includes('salon')
    ? 'salon-tenant-suite'
    : combined.includes('office') || combined.includes('tenant') || combined.includes('commercial')
    ? 'commercial-suite'
    : combined.includes('panel room') || combined.includes('mep')
    ? 'electrical-room'
    : combined.includes('residential') || combined.includes('home')
    ? 'residential'
    : 'generic'

  const base = projectHintForContext(ctx)
  const styles: string[] = []
  if (combined.includes('modern')) styles.push('modern')
  if (combined.includes('luxury')) styles.push('luxury')
  if (combined.includes('industrial')) styles.push('industrial')
  if (combined.includes('boutique')) styles.push('boutique')
  return {
    ...base,
    styleKeywords: Array.from(new Set([...base.styleKeywords, ...styles])),
  }
}

/**
 * Equipment hints derived from a full-set scan. Defers to per-context
 * fallback hints today; future versions will read schedules.
 */
export function extractEquipmentHints(
  scan: BlueprintPlanScanResult,
): EquipmentHint[] {
  return scan.equipmentHints || []
}

/**
 * Door / opening hints from full-set context. Today this reads openings from
 * the plan scan and surfaces them with refined source tags.
 */
export function extractDoorAndOpeningHints(
  scan: BlueprintPlanScanResult,
): DoorHint[] {
  return scan.openings
    .filter((op) => op.type === 'door')
    .map((op) => ({
      id: `${op.id}_set_hint`,
      widthFt: op.widthFt,
      swing: op.swing,
      swingDegrees: op.swingDegrees,
      confidence: op.confidence,
    }))
}

/**
 * Wall-thickness hints from full-set context. Returns the project-default
 * thicknesses plus any per-wall kind classification carried by the scan.
 */
export function extractWallThicknessHints(
  scan: BlueprintPlanScanResult,
): WallHint[] {
  return scan.walls.map((w) => ({
    id: `${w.id}_thickness`,
    start: w.start,
    end: w.end,
    thicknessFt: w.thicknessFt,
    kind: w.kind,
    confidence: w.confidence,
  }))
}

/**
 * Merge a full-set scan back into a building model. Today this attaches the
 * equipment hints from the full-set scan onto matching rooms; future versions
 * can also rewrite finishes / electrical anchors.
 */
export function mergeFullSetScanIntoBuildingModel(
  scan: BlueprintFullSetScanResult,
  baseModel: BlueprintBuildingModel,
): BlueprintBuildingModel {
  if (!scan || !baseModel) return baseModel
  const equipmentByRoom = new Map<string, EquipmentHint[]>()
  for (const hint of scan.equipmentHints) {
    if (!hint.roomId) continue
    const list = equipmentByRoom.get(hint.roomId) || []
    list.push(hint)
    equipmentByRoom.set(hint.roomId, list)
  }

  const newLevels = baseModel.levels.map((level) => ({
    ...level,
    rooms: level.rooms.map((room) => {
      const fromSet = equipmentByRoom.get(room.id)
      if (!fromSet || fromSet.length === 0) return room
      const merged: RoomEquipmentHint[] = [
        ...(room.equipmentHints || []),
        ...fromSet.map((h) => ({
          id: h.id,
          kind: h.kind,
          label: h.label,
          positionNormalized: h.positionNormalized,
          confidence: h.confidence,
          sourceTag: h.sourceTag || 'full-set',
        })),
      ]
      // Dedupe by id
      const seen = new Set<string>()
      const deduped = merged.filter((h) => {
        if (seen.has(h.id)) return false
        seen.add(h.id)
        return true
      })
      return { ...room, equipmentHints: deduped }
    }),
  }))

  return {
    ...baseModel,
    levels: newLevels,
    metadata: {
      ...baseModel.metadata,
      notes:
        (baseModel.metadata.notes || '') +
        ` Full-set merge: ${scan.classifications.length} sheets, ` +
        `${scan.equipmentHints.length} equipment hints.`,
    },
  }
}

// ---------------------------------------------------------------------------
// Full-set scan entry point
// ---------------------------------------------------------------------------

/**
 * Scan a full blueprint set into a deterministic project-level model.
 *
 * Steps:
 *   1. Classify every sheet in the set into one or more roles.
 *   2. Pick the best floor-plan sheet for the geometry seed.
 *   3. Run scanBlueprintPlan() with combined sheet context.
 *   4. Aggregate hints (equipment, doors, walls, project style).
 *   5. Return a merged BlueprintFullSetScanResult.
 *
 * The result is deterministic for the same input.
 */
export function scanBlueprintFullSet(
  input: BlueprintFullSetScanInput,
): BlueprintFullSetScanResult {
  const warnings: PlanScanWarning[] = []
  const classificationContext: SheetClassificationContext = {
    sourceSetName: input.sourceSet?.name,
    sourceSetType: input.sourceSet?.type,
    blueprintTitle: input.sourceSet?.name,
    extractedText: input.extractedText,
    projectName: input.projectName || input.sourceSet?.projectName,
  }

  const expandedSheets = enumerateFullSourceSetSheets(
    input.sourceSet,
    input.multiPageTraces,
  )
  const totalPagesScanned = expandedSheets.length

  const pageClassifications: BlueprintPageClassification[] = expandedSheets.map((sheet) =>
    classifyBlueprintPage(
      sheet,
      classificationContext,
      input.multiPageTraces?.[sheet.pageNumber],
    ),
  )

  const rankedWallPlanCandidates = rankWallPlanCandidatesFromPages(pageClassifications)
  const selection = selectCanonicalWallPlanPages({
    ranked: rankedWallPlanCandidates,
    pages: pageClassifications,
  })

  const classificationWarnings = [...selection.warnings]
  const classificationBlockers = [...selection.blockers]
  if (selection.ambiguous) {
    classificationWarnings.push('canonical_wall_plan_selection:ambiguous')
  }

  const canonicalWallPlanPages = selection.canonical
  const geometryDriverPage =
    canonicalWallPlanPages.length > 0
      ? [...canonicalWallPlanPages].sort((a, b) => a.pageNumber - b.pageNumber)[0]!.pageNumber
      : rankedWallPlanCandidates[0]?.pageNumber ?? null

  const bestFloorPlanSourceSheet = geometryDriverPage
    ? expandedSheets.find((s) => s.pageNumber === geometryDriverPage) || null
    : null

  const bestFloorPlanSheet: SelectedFloorPlanSheet | null =
    geometryDriverPage && bestFloorPlanSourceSheet
      ? {
          pageNumber: geometryDriverPage,
          sheetNumber:
            bestFloorPlanSourceSheet.sheetNumber ||
            bestFloorPlanSourceSheet.sheetLabel ||
            bestFloorPlanSourceSheet.label,
          sheetTitle: bestFloorPlanSourceSheet.sheetTitle,
          confidence: selection.confidence,
          reason:
            selection.ambiguous && canonicalWallPlanPages.length > 1
              ? `ambiguous:geometry_uses_lowest_page_among_canonical [${canonicalWallPlanPages
                  .map((c) => c.pageNumber)
                  .sort((a, b) => a - b)
                  .join(',')}]`
              : canonicalWallPlanPages[0]?.selectionReasons.join('; ') ||
                'ranked_wall_plan_candidate',
        }
      : null

  const classifications: FullSetSheetClassification[] = pageClassifications.map((row) => {
    const legacyRoles = mapPageRoleToLegacySheetRoles(row.role)
    const legacyScores: Partial<Record<SheetRole, number>> = {}
    for (const lr of legacyRoles) {
      legacyScores[lr] = Math.max(legacyScores[lr] || 0, row.roleConfidence)
    }
    return pageClassificationToLegacyRow(row, legacyScores)
  })

  const bestElectricalSheets = chooseBestElectricalSheets(expandedSheets, classificationContext)
  const bestRenderingSheets = chooseBestRenderingSheets(expandedSheets, classificationContext)
  const roleCounts = getSheetRoleCounts(classifications)
  const classifiedKnownSheets = pageClassifications.filter((c) => c.role !== 'unknown').length

  if (!bestFloorPlanSheet && expandedSheets.length > 0) {
    warnings.push({
      code: 'NO_FLOOR_PLAN_SHEET',
      message:
        'No eligible wall-plan source page identified after full-set classification. Scanner stays inferred until a proposed/partition plan is labeled or detected in text.',
    })
  }
  if (bestFloorPlanSheet && bestFloorPlanSheet.confidence < 0.55) {
    warnings.push({
      code: 'NO_FLOOR_PLAN_SHEET',
      message: `Wall-plan source confidence is low (${Math.round(bestFloorPlanSheet.confidence * 100)}%). ${bestFloorPlanSheet.reason}`,
    })
  }
  if (bestElectricalSheets.length === 0 && expandedSheets.length > 0) {
    warnings.push({
      code: 'NO_ELECTRICAL_SHEET',
      message:
        'No electrical/power sheet identified in source metadata. Electrical overlays remain inferred.',
    })
  }
  if (bestRenderingSheets.length === 0 && expandedSheets.length > 0) {
    warnings.push({
      code: 'NO_RENDERING_SHEET',
      message:
        'No rendering/elevation sheet identified in source metadata. Visual detail hints remain inferred.',
    })
  }
  if (classifiedKnownSheets === 0 && expandedSheets.length > 0) {
    warnings.push({
      code: 'SHEET_ROLES_INFERRED',
      message:
        'Per-page metadata and trace text did not yield confident roles. Add sheet titles/labels or index rows for better scanner confidence.',
    })
  }

  const sheetIndex: BlueprintPlanScanSheetHint[] = expandedSheets.map((s) => ({
    pageNumber: s.pageNumber,
    sheetNumber: s.sheetNumber,
    sheetTitle: s.sheetTitle,
    sheetLabel: s.sheetLabel,
    discipline: s.discipline,
  }))

  const bestTraceFromMap =
    geometryDriverPage && input.multiPageTraces && geometryDriverPage > 0
      ? input.multiPageTraces[geometryDriverPage] ?? null
      : null
  const bestTrace = bestTraceFromMap ?? bestFloorPlanSourceSheet?.tracePayload ?? null
  const traceAttempted = Boolean(
    (geometryDriverPage &&
      input.multiPageTraces &&
      Object.prototype.hasOwnProperty.call(input.multiPageTraces, geometryDriverPage)) ||
      bestFloorPlanSourceSheet?.traceAttempted ||
      bestFloorPlanSourceSheet?.tracePayload,
  )

  const planScan = scanBlueprintPlan({
    projectName: input.projectName || input.sourceSet?.projectName,
    blueprintTitle: input.sourceSet?.name,
    fileName: input.sourceSet?.filePath || bestFloorPlanSourceSheet?.fileName,
    activePageNumber: geometryDriverPage ?? undefined,
    totalPages: totalPagesScanned,
    extractedText: input.extractedText,
    annotationsSummary: input.annotationsSummary,
    sheetIndex,
    tracePayload: bestTrace,
    traceAttempted,
    traceWarnings: bestFloorPlanSourceSheet?.traceWarnings || [],
  })
  const confidenceBreakdown = buildConfidenceBreakdown({
    sourceSetSelected: Boolean(input.sourceSet?.id),
    classifiedKnownSheets,
    floorPlanSheet: bestFloorPlanSheet,
    planScan,
    roleCounts,
    bestElectricalSheets,
  })
  const enrichedPlanScan: BlueprintPlanScanResult = {
    ...planScan,
    confidence: Math.max(0.35, Math.min(0.95, confidenceBreakdown.totalPercent / 100)),
    confidenceBreakdown,
    selectedFloorPlanSheet: bestFloorPlanSheet,
    traceStatus: planScan.traceStatus,
    traceAttempted: planScan.traceAttempted,
    traceAvailable: planScan.traceAvailable,
    traceWarnings: planScan.traceWarnings,
    traceDebugCounts: {
      ...(planScan.traceDebugCounts || {
        rawLines: 0,
        mergedWalls: planScan.walls.length,
        openings: planScan.openings.length,
        roomCandidates: planScan.rooms.length,
      }),
      confidenceCapReason:
        confidenceBreakdown.confidenceCapReason ||
        planScan.traceDebugCounts?.confidenceCapReason,
    },
    scaleStatus: confidenceBreakdown.items.scaleDetected > 0 ? 'detected' : 'default',
    scanResultKind: planScan.isFallback
      ? 'fallback'
      : confidenceBreakdown.items.vectorTraceAvailable > 0
        ? 'measured-trace'
        : confidenceBreakdown.items.floorPlanSheetSelected > 0
          ? 'inferred'
          : 'fallback',
  }

  const projectHint = extractProjectStyleHints(input)
  const equipmentHints = extractEquipmentHints(enrichedPlanScan)
  const doorHints = extractDoorAndOpeningHints(enrichedPlanScan)
  const wallHints = extractWallThicknessHints(enrichedPlanScan)

  warnings.push({
    code: 'FULL_SET_INFERRED',
    message:
      `Full-set scan classified ${totalPagesScanned} page(s); ` +
      `${rankedWallPlanCandidates.length} eligible wall-plan candidate(s); ` +
      `canonical page(s): ${canonicalWallPlanPages.length ? canonicalWallPlanPages.map((c) => c.pageNumber).join(',') : 'none'}. ` +
      `Geometry driver page ${geometryDriverPage ?? 'n/a'}. Confidence ${confidenceBreakdown.totalPercent}%.`,
  })

  const pageRoleCounts = countPageRoles(pageClassifications)

  return {
    planScan: enrichedPlanScan,
    classifications,
    pageClassifications,
    totalPagesScanned,
    rankedWallPlanCandidates,
    canonicalWallPlanPages,
    classificationWarnings,
    classificationBlockers,
    canonicalSelectionConfidence: selection.confidence,
    canonicalSelectionAmbiguous: selection.ambiguous,
    pageRoleCounts,
    bestFloorPlanSheet,
    bestElectricalSheets,
    bestRenderingSheets,
    equipmentHints,
    doorHints,
    wallHints,
    projectHint,
    sheetRoleCounts: roleCounts,
    confidenceBreakdown,
    warnings: [...enrichedPlanScan.warnings, ...warnings],
    metadata: {
      sourceSetId: input.sourceSet?.id || 'unknown',
      sourceSetName: input.sourceSet?.name || 'Unknown Set',
      projectName: input.projectName || input.sourceSet?.projectName,
      sheetCount: totalPagesScanned,
      generatedAt: new Date().toISOString(),
    },
  }
}
