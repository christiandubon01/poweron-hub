/**
 * Blueprint plan scanner — vision pipeline shim + type contracts.
 *
 * Heuristic Wave 1B / Wave 2 extraction was removed. Geometry comes from the
 * Anthropic vision API via buildScanResultFromVisionExtraction().
 */

import type {
  BlueprintBuildingModel,
  BuildingLevelModel,
  BuildingRoomModel,
  BuildingWallModel,
  BuildingOpeningModel,
  MeasurementValue,
  WallKind,
  DoorSwingDirection,
  OpeningSubtype,
  RoomEquipmentHint,
  RoomRole,
  ExtractedWallPlanSegment,
  DetectedPlanFootprint,
  Point2D,
  Rectangle,
  Bounds2D,
} from './buildingModel'
import { createMeasurement } from './dimensionModel'
import type { PdfTracePayload } from './pdfTraceTypes'
import type { BlueprintVisionExtractionResult } from './blueprintVisionClient'

export type { BlueprintVisionExtractionResult } from './blueprintVisionClient'

// ---------------------------------------------------------------------------
// Scanner input / output contracts
// ---------------------------------------------------------------------------

export interface BlueprintPlanScanSheetHint {
  pageNumber: number
  sheetNumber?: string
  sheetTitle?: string
  sheetLabel?: string
  discipline?: string
}

export interface BlueprintPlanScanInput {
  projectName?: string
  blueprintTitle?: string
  fileName?: string
  activePageNumber?: number
  totalPages?: number
  extractedText?: string
  annotationsSummary?: string
  sheetIndex?: BlueprintPlanScanSheetHint[]
  tracePayload?: PdfTracePayload | null
  traceAttempted?: boolean
  traceWarnings?: Array<{ code: string; message: string }>
  knownDimensionsFt?: { width?: number; depth?: number }
}

export interface PlanWallCandidate {
  id: string
  start: Point2D
  end: Point2D
  thicknessFt: number
  exterior: boolean
  confidence: number
  kind?: WallKind
  roomId?: string
}

export interface PlanOpeningCandidate {
  id: string
  wallId: string
  type: 'door' | 'window'
  positionFt: number
  widthFt: number
  heightFt: number
  confidence: number
  swing?: DoorSwingDirection
  swingDegrees?: number
  subtype?: OpeningSubtype
}

export interface PlanRoomCandidate {
  id: string
  label: string
  bounds: Bounds2D
  type:
    | 'reception'
    | 'waiting'
    | 'styling'
    | 'hallway'
    | 'bath'
    | 'utility'
    | 'storage'
    | 'service'
    | 'office'
    | 'living'
    | 'bedroom'
    | 'kitchen'
    | 'garage'
    | 'other'
  confidence: number
  roleHint?: RoomRole
}

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
  | 'GEOMETRY_DRIVER_PAGE_SWITCH'
  | 'VISION_DEPRECATED_SCANNER'

export interface PlanScanWarning {
  code: PlanScanWarningCode
  message: string
}

export interface EquipmentHint {
  id: string
  roomId?: string
  kind: RoomEquipmentHint['kind']
  label: string
  positionNormalized?: { x: number; y: number }
  confidence: number
  sourceTag?: string
}

export interface FinishHint {
  id: string
  roomId?: string
  surface: 'floor' | 'wall' | 'ceiling'
  finish: string
  confidence: number
}

export interface ElectricalDeviceHint {
  id: string
  roomId?: string
  kind: 'receptacle' | 'switch' | 'gfci' | 'light' | 'panel' | 'disconnect' | 'other'
  positionNormalized?: { x: number; y: number }
  heightInches?: number
  confidence: number
  sourceTag?: string
}

export interface DoorHint {
  id: string
  roomId?: string
  positionWorld?: Point2D
  widthFt?: number
  swing?: DoorSwingDirection
  swingDegrees?: number
  confidence: number
}

export interface WallHint {
  id: string
  start?: Point2D
  end?: Point2D
  thicknessFt?: number
  kind?: WallKind
  confidence: number
}

export interface ExtractedProjectHint {
  projectKind:
    | 'beauty-salon'
    | 'barber-shop'
    | 'nail-salon'
    | 'spa'
    | 'office'
    | 'residential'
    | 'retail'
    | 'electrical-room'
    | 'generic'
  styleKeywords: string[]
  wallThicknessDefaults: {
    exterior: number
    partition: number
    divider: number
  }
  finishDefaults: {
    floor?: string
    wall?: string
    ceiling?: string
  }
  confidence: number
}

export interface BlueprintPlanScanResult {
  footprint: Rectangle
  walls: PlanWallCandidate[]
  openings: PlanOpeningCandidate[]
  rooms: PlanRoomCandidate[]
  dimensions: PlanDimensionCandidate[]
  warnings: PlanScanWarning[]
  traceLines: PlanTraceLine[]
  isFallback: boolean
  confidence: number
  layoutContext:
    | 'salon-tenant-suite'
    | 'commercial-suite'
    | 'residential'
    | 'electrical-room'
    | 'generic'
  equipmentHints: EquipmentHint[]
  finishHints: FinishHint[]
  electricalHints: ElectricalDeviceHint[]
  doorHints: DoorHint[]
  wallHints: WallHint[]
  projectHint: ExtractedProjectHint
  metadata: {
    projectName?: string
    blueprintTitle?: string
    activePageNumber?: number
    totalPages?: number
    generatedAt: string
    geometryFromFallback?: boolean
    runtimeProviderMatchTier?: 'exact' | 'partial' | 'none'
    visionScale?: string
  }
  confidenceBreakdown?: ScanConfidenceBreakdown
  scanResultKind?: 'fallback' | 'inferred' | 'cached-inferred' | 'measured-trace'
  traceStatus?: 'missing' | 'provided' | 'extracted'
  traceAttempted?: boolean
  traceAvailable?: boolean
  traceWarnings?: Array<{ code: string; message: string }>
  scaleStatus?: 'missing' | 'default' | 'detected'
  traceDebugCounts?: {
    rawLines: number
    mergedWalls: number
    openings: number
    roomCandidates: number
    geometrySourcePageNumbers?: number[]
  }
  selectedFloorPlanSheet?: SelectedFloorPlanSheet | null
  extractedWallSegments?: ExtractedWallPlanSegment[]
  exteriorWallSegments?: ExtractedWallPlanSegment[]
  interiorWallSegments?: ExtractedWallPlanSegment[]
  partitionWallSegments?: ExtractedWallPlanSegment[]
  detectedFootprint?: DetectedPlanFootprint | null
  wallExtractionWarnings?: string[]
  wallExtractionBlockers?: string[]
  wallExtractionConfidence?: number
  geometrySourcePageNumbers?: number[]
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

export interface PlanTraceLine {
  id: string
  start: Point2D
  end: Point2D
  lengthFt: number
  angleDeg: number
  orthogonal: boolean
  role?: string
  confidence?: number
}

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

export interface BlueprintVRSourceSheet {
  pageNumber: number
  sheetNumber?: string
  sheetTitle?: string
  sheetLabel?: string
  label?: string
  discipline?: string
  fileName?: string
  extractedText?: string
  sourceSetName?: string
  sourceSetType?: string
  blueprintTitle?: string
  tracePayload?: PdfTracePayload | null
  traceAttempted?: boolean
  traceWarnings?: Array<{ code: string; message: string }>
}

export interface BlueprintVRSourceSet {
  id: string
  name: string
  type?: string
  projectId?: string
  projectName?: string
  sheets: BlueprintVRSourceSheet[]
  filePath?: string
  totalPages?: number
}

export interface BlueprintFullSetScanInput {
  projectName?: string
  sourceSet: BlueprintVRSourceSet
  activePageNumber?: number
  extractedText?: string
  annotationsSummary?: string
  multiPageTraces?: Record<number, PdfTracePayload>
  totalPagesScanned?: number
}

export interface FullSetSheetClassification {
  pageNumber: number
  sheetNumber?: string
  sheetTitle?: string
  sheetLabel?: string
  discipline?: string
  roles: SheetRole[]
  roleScores: Partial<Record<SheetRole, number>>
  reason: string
  confidence: number
}

export interface SelectedFloorPlanSheet {
  pageNumber: number
  sheetNumber?: string
  sheetTitle?: string
  confidence: number
  reason: string
}

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
  confidence: number
  reason: string
}

export interface CanonicalWallPlanPage {
  pageNumber: number
  sheetNumber?: string
  sheetTitle?: string
  role: BlueprintPageClassificationRole
  confidence: number
  reason: string
}

export interface BlueprintFullSetScanResult {
  planScan: BlueprintPlanScanResult
  classifications: FullSetSheetClassification[]
  pageClassifications: BlueprintPageClassification[]
  totalPagesScanned: number
  rankedWallPlanCandidates: RankedWallPlanCandidate[]
  canonicalWallPlanPages: CanonicalWallPlanPage[]
  classificationWarnings: string[]
  classificationBlockers: string[]
  canonicalSelectionConfidence: number
  canonicalSelectionAmbiguous: boolean
  pageRoleCounts: Record<BlueprintPageClassificationRole, number>
  bestFloorPlanSheet: SelectedFloorPlanSheet | null
  bestElectricalSheets: BlueprintVRSourceSheet[]
  bestRenderingSheets: BlueprintVRSourceSheet[]
  equipmentHints: EquipmentHint[]
  doorHints: DoorHint[]
  wallHints: WallHint[]
  projectHint: ExtractedProjectHint
  warnings: PlanScanWarning[]
  sheetRoleCounts: {
    floorPlan: number
    electricalPower: number
    rendering: number
    interiorElevation: number
    finishMaterial: number
    schedule: number
    unknown: number
  }
  confidenceBreakdown: ScanConfidenceBreakdown
  metadata: {
    sourceSetId: string
    sourceSetName: string
    projectName?: string
    sheetCount: number
    generatedAt: string
  }
}

export const WAVE2_EXTRACTED_SUITE_ROOM_ID = 'wave2-suite'

const DEFAULT_WALL_THICKNESS_FT = { exterior: 0.5, partition: 0.34, divider: 0.25 }
const DEPRECATED_MSG = 'Heuristic scanner deprecated — use vision pipeline.'

const EMPTY_ROLE_COUNTS: Record<BlueprintPageClassificationRole, number> = {
  proposed_dimensioned_plan: 0,
  proposed_floor_plan: 0,
  partition_plan: 0,
  demolition_plan: 0,
  electrical_plan: 0,
  reflected_ceiling_plan: 0,
  interior_elevation: 0,
  rendering: 0,
  schedule: 0,
  title_notes: 0,
  unknown: 0,
}

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

function emptyConfidenceBreakdown(): ScanConfidenceBreakdown {
  return {
    totalPoints: 0,
    totalPercent: 0,
    items: {
      sourceSetSelected: 0,
      sheetsClassified: 0,
      floorPlanSheetSelected: 0,
      scaleDetected: 0,
      dimensionsDetected: 0,
      vectorTraceAvailable: 0,
      wallCandidatesFound: 0,
      openingsFound: 0,
      roomsValidated: 0,
      elevationsMatched: 0,
      electricalSheetsMatched: 0,
    },
    reasons: {
      sourceSetSelected: DEPRECATED_MSG,
      sheetsClassified: DEPRECATED_MSG,
      floorPlanSheetSelected: DEPRECATED_MSG,
      scaleDetected: DEPRECATED_MSG,
      dimensionsDetected: DEPRECATED_MSG,
      vectorTraceAvailable: DEPRECATED_MSG,
      wallCandidatesFound: DEPRECATED_MSG,
      openingsFound: DEPRECATED_MSG,
      roomsValidated: DEPRECATED_MSG,
      elevationsMatched: DEPRECATED_MSG,
      electricalSheetsMatched: DEPRECATED_MSG,
    },
  }
}

function createDeprecatedStubScan(input?: BlueprintPlanScanInput): BlueprintPlanScanResult {
  const now = new Date().toISOString()
  return {
    footprint: { x: 0, y: 0, width: 40, height: 30 },
    walls: [],
    openings: [],
    rooms: [],
    dimensions: [],
    warnings: [{ code: 'VISION_DEPRECATED_SCANNER', message: DEPRECATED_MSG }],
    traceLines: [],
    isFallback: true,
    confidence: 0,
    layoutContext: 'generic',
    equipmentHints: [],
    finishHints: [],
    electricalHints: [],
    doorHints: [],
    wallHints: [],
    projectHint: projectHintForContext('generic'),
    metadata: {
      projectName: input?.projectName,
      blueprintTitle: input?.blueprintTitle,
      activePageNumber: input?.activePageNumber,
      totalPages: input?.totalPages,
      generatedAt: now,
      geometryFromFallback: true,
    },
    scanResultKind: 'fallback',
    traceStatus: 'missing',
    confidenceBreakdown: emptyConfidenceBreakdown(),
  }
}

function mapVisionRoleToRoomType(role: string): PlanRoomCandidate['type'] {
  const r = role.toLowerCase()
  const known: PlanRoomCandidate['type'][] = [
    'reception',
    'waiting',
    'styling',
    'hallway',
    'bath',
    'utility',
    'storage',
    'service',
    'office',
    'living',
    'bedroom',
    'kitchen',
    'garage',
    'other',
  ]
  if (known.includes(r as PlanRoomCandidate['type'])) return r as PlanRoomCandidate['type']
  if (r === 'wash-station') return 'service'
  return 'other'
}

function mapVisionRoleHint(role: string): RoomRole | undefined {
  const r = role.toLowerCase()
  if (r === 'wash-station') return 'wash-station'
  return undefined
}

function mapWallKind(kind: string | undefined, exterior: boolean): WallKind {
  if (kind === 'glass') return 'glass'
  if (kind === 'exterior' || exterior) return 'exterior'
  return 'partition'
}

function mapSwing(swing: string | undefined): DoorSwingDirection | undefined {
  if (swing === 'left' || swing === 'right' || swing === 'fixed' || swing === 'sliding') {
    return swing
  }
  if (swing === 'double') return 'double'
  return undefined
}

export interface BuildScanFromVisionMeta {
  projectName?: string
  blueprintTitle?: string
  pageNumber: number
  sheetNumber?: string
  sheetTitle?: string
}

/**
 * Convert vision extraction JSON into BlueprintPlanScanResult for the 3D pipeline.
 */
export function buildScanResultFromVisionExtraction(
  vision: BlueprintVisionExtractionResult,
  meta: BuildScanFromVisionMeta,
): BlueprintPlanScanResult {
  const now = new Date().toISOString()

  if (vision.error === 'not_a_floor_plan') {
    return {
      ...createDeprecatedStubScan({
        projectName: meta.projectName,
        blueprintTitle: meta.blueprintTitle,
        activePageNumber: meta.pageNumber,
      }),
      warnings: [
        {
          code: 'NO_FLOOR_PLAN_SHEET',
          message: vision.reason || 'Selected sheet is not a floor plan.',
        },
      ],
      selectedFloorPlanSheet: {
        pageNumber: meta.pageNumber,
        sheetNumber: meta.sheetNumber,
        sheetTitle: meta.sheetTitle,
        confidence: 0,
        reason: vision.reason || 'not_a_floor_plan',
      },
    }
  }

  const fpW = Math.max(1, Number(vision.footprint?.width) || 40)
  const fpH = Math.max(1, Number(vision.footprint?.height) || 30)
  const footprint: Rectangle = { x: 0, y: 0, width: fpW, height: fpH }

  const rooms: PlanRoomCandidate[] = (vision.rooms || []).map((room, idx) => {
    const b = room.boundsFeet || { x: 0, y: 0, width: 0, height: 0 }
    const x = Number(b.x) || 0
    const y = Number(b.y) || 0
    const w = Math.max(0.5, Number(b.width) || 0)
    const h = Math.max(0.5, Number(b.height) || 0)
    const role = String(room.role || 'other')
    return {
      id: room.id || `room-${idx + 1}`,
      label: room.label || `Room ${idx + 1}`,
      bounds: {
        min: { x, y },
        max: { x: x + w, y: y + h },
      },
      type: mapVisionRoleToRoomType(role),
      confidence: 0.85,
      roleHint: mapVisionRoleHint(role),
    }
  })

  const walls: PlanWallCandidate[] = (vision.walls || []).map((wall, idx) => {
    const start = wall.startFeet || { x: 0, y: 0 }
    const end = wall.endFeet || { x: 0, y: 0 }
    const thicknessFt = Math.max(0.1, (Number(wall.thicknessInches) || 6) / 12)
    const kind = String(wall.kind || 'partition')
    const exterior = kind === 'exterior'
    return {
      id: wall.id || `wall-${idx + 1}`,
      start: { x: Number(start.x) || 0, y: Number(start.y) || 0 },
      end: { x: Number(end.x) || 0, y: Number(end.y) || 0 },
      thicknessFt,
      exterior,
      confidence: 0.85,
      kind: mapWallKind(kind, exterior),
    }
  })

  const openings: PlanOpeningCandidate[] = (vision.openings || []).map((opening, idx) => {
    const type = opening.type === 'window' ? 'window' : 'door'
    return {
      id: opening.id || `opening-${idx + 1}`,
      wallId: opening.wallId || walls[0]?.id || 'wall-1',
      type,
      positionFt: Math.max(0, Number(opening.positionFeet) || 0),
      widthFt: Math.max(0.5, Number(opening.widthFeet) || 3),
      heightFt: type === 'window' ? 4 : 7,
      confidence: 0.8,
      swing: type === 'door' ? mapSwing(String(opening.swing || 'left')) : 'fixed',
    }
  })

  const roomCount = rooms.length
  const confidence = Math.min(
    0.95,
    0.55 + Math.min(roomCount, 12) * 0.03 + (walls.length > 0 ? 0.1 : 0),
  )

  return {
    footprint,
    walls,
    openings,
    rooms,
    dimensions: [],
    warnings: [],
    traceLines: [],
    isFallback: false,
    confidence,
    layoutContext: 'commercial-suite',
    equipmentHints: [],
    finishHints: [],
    electricalHints: [],
    doorHints: [],
    wallHints: [],
    projectHint: projectHintForContext('commercial-suite'),
    metadata: {
      projectName: meta.projectName,
      blueprintTitle: meta.blueprintTitle,
      activePageNumber: meta.pageNumber,
      generatedAt: now,
      geometryFromFallback: false,
      visionScale: vision.scale,
    },
    scanResultKind: 'measured-trace',
    traceStatus: 'extracted',
    traceAvailable: true,
    scaleStatus: vision.scale ? 'detected' : 'default',
    selectedFloorPlanSheet: {
      pageNumber: meta.pageNumber,
      sheetNumber: meta.sheetNumber,
      sheetTitle: meta.sheetTitle,
      confidence: 0.9,
      reason: 'Vision extraction',
    },
    geometrySourcePageNumbers: [meta.pageNumber],
    traceDebugCounts: {
      rawLines: 0,
      mergedWalls: walls.length,
      openings: openings.length,
      roomCandidates: roomCount,
      geometrySourcePageNumbers: [meta.pageNumber],
    },
    confidenceBreakdown: {
      totalPoints: Math.round(confidence * 100),
      totalPercent: Math.round(confidence * 100),
      items: {
        sourceSetSelected: 8,
        sheetsClassified: 8,
        floorPlanSheetSelected: 10,
        scaleDetected: vision.scale ? 8 : 0,
        dimensionsDetected: 0,
        vectorTraceAvailable: 0,
        wallCandidatesFound: walls.length > 0 ? 10 : 0,
        openingsFound: openings.length > 0 ? 5 : 0,
        roomsValidated: roomCount > 0 ? 5 : 0,
        elevationsMatched: 0,
        electricalSheetsMatched: 0,
      },
      reasons: {
        sourceSetSelected: 'Vision pipeline active.',
        sheetsClassified: 'Pages classified via vision API.',
        floorPlanSheetSelected: 'User selected floor plan sheet.',
        scaleDetected: vision.scale ? `Scale: ${vision.scale}` : 'Scale not returned.',
        dimensionsDetected: 'No dimension strings extracted.',
        vectorTraceAvailable: 'Geometry from vision, not vector trace.',
        wallCandidatesFound: `${walls.length} walls from vision.`,
        openingsFound: `${openings.length} openings from vision.`,
        roomsValidated: `${roomCount} rooms from vision.`,
        elevationsMatched: 'Not applicable.',
        electricalSheetsMatched: 'Not applicable.',
      },
    },
  }
}

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
    metadata: { sourceTag: 'scanner' },
  }
}

export function convertPlanScanToBuildingModel(
  scan: BlueprintPlanScanResult,
): BlueprintBuildingModel {
  const wallHeight = createMeasurement(9, 'ft', 'scanner', scan.confidence)
  const ceilingHeight = createMeasurement(9, 'ft', 'scanner', scan.confidence)
  const slabThickness = createMeasurement(4, 'in', 'scanner', scan.confidence)

  const openingsByWall = new Map<string, BuildingOpeningModel[]>()
  for (const o of scan.openings) {
    const list = openingsByWall.get(o.wallId) || []
    list.push(openingModelFromCandidate(o))
    openingsByWall.set(o.wallId, list)
  }

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
    scan.layoutContext === 'salon-tenant-suite'
      ? 'Beauty Salon Suite'
      : scan.layoutContext === 'commercial-suite'
        ? 'Commercial Suite'
        : scan.layoutContext === 'residential'
          ? 'Residential Layout'
          : scan.layoutContext === 'electrical-room'
            ? 'Electrical Panel Room'
            : 'Suite Layout'
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
      notes: scan.isFallback
        ? `Scan-ready fallback: ${scan.layoutContext}. ${scan.warnings.length} warning(s).`
        : `Vision floor plan: ${scan.layoutContext}. Confidence ${(scan.confidence * 100).toFixed(0)}%.`,
      displayLabel,
    },
  }
}

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

export function enumerateFullSourceSetSheets(
  sourceSet: BlueprintVRSourceSet,
  _multiPageTraces?: Record<number, PdfTracePayload | null | undefined>,
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
    out.push({
      pageNumber: page,
      sheetNumber: base?.sheetNumber,
      sheetTitle: base?.sheetTitle,
      sheetLabel: base?.sheetLabel,
      label: base?.label,
      discipline: base?.discipline,
      fileName: base?.fileName || sourceSet.filePath,
      extractedText: base?.extractedText,
      sourceSetName: base?.sourceSetName || sourceSet.name,
      sourceSetType: base?.sourceSetType || sourceSet.type,
      blueprintTitle: base?.blueprintTitle || sourceSet.name,
      tracePayload: base?.tracePayload ?? null,
      traceAttempted: base?.traceAttempted,
      traceWarnings: base?.traceWarnings,
    })
  }
  return out
}

export function scanBlueprintPlan(input?: BlueprintPlanScanInput): BlueprintPlanScanResult {
  return createDeprecatedStubScan(input)
}

export function scanBlueprintFullSet(input: BlueprintFullSetScanInput): BlueprintFullSetScanResult {
  const planScan = createDeprecatedStubScan({
    projectName: input.projectName,
    blueprintTitle: input.sourceSet?.name,
    fileName: input.sourceSet?.filePath,
  })
  const now = new Date().toISOString()
  return {
    planScan,
    classifications: [],
    pageClassifications: [],
    totalPagesScanned: enumerateFullSourceSetSheets(input.sourceSet).length,
    rankedWallPlanCandidates: [],
    canonicalWallPlanPages: [],
    classificationWarnings: [DEPRECATED_MSG],
    classificationBlockers: [DEPRECATED_MSG],
    canonicalSelectionConfidence: 0,
    canonicalSelectionAmbiguous: true,
    pageRoleCounts: { ...EMPTY_ROLE_COUNTS },
    bestFloorPlanSheet: null,
    bestElectricalSheets: [],
    bestRenderingSheets: [],
    equipmentHints: [],
    doorHints: [],
    wallHints: [],
    projectHint: planScan.projectHint,
    warnings: planScan.warnings,
    sheetRoleCounts: {
      floorPlan: 0,
      electricalPower: 0,
      rendering: 0,
      interiorElevation: 0,
      finishMaterial: 0,
      schedule: 0,
      unknown: 0,
    },
    confidenceBreakdown: emptyConfidenceBreakdown(),
    metadata: {
      sourceSetId: input.sourceSet?.id || 'unknown',
      sourceSetName: input.sourceSet?.name || 'Unknown',
      projectName: input.projectName,
      sheetCount: input.sourceSet?.sheets?.length || 0,
      generatedAt: now,
    },
  }
}

export function mergeFullSetScanIntoBuildingModel(
  _scan: BlueprintFullSetScanResult,
  baseModel: BlueprintBuildingModel,
): BlueprintBuildingModel {
  return baseModel
}

// ---------------------------------------------------------------------------
// Deprecated heuristic stubs (compile-time compatibility only)
// ---------------------------------------------------------------------------

export function inferBuildingFootprintFromTraceLines(
  _lines: PlanTraceLine[],
): Rectangle | null {
  return null
}

export function inferWallsFromOrthogonalLines(
  _lines: PlanTraceLine[],
  _minLengthFt = 3,
): PlanWallCandidate[] {
  return []
}

export function inferOpeningsFromGaps(
  _walls: PlanWallCandidate[],
  _lines: PlanTraceLine[],
): PlanOpeningCandidate[] {
  return []
}

export function inferRoomsFromEnclosedOrGridLayout(
  _footprint: Rectangle,
  _walls: PlanWallCandidate[],
): PlanRoomCandidate[] {
  return []
}

export function validateRoomCandidates(rooms: PlanRoomCandidate[]): PlanRoomCandidate[] {
  return rooms
}

export function chooseSalonSuiteFallbackFromBlueprintContext(
  _input?: BlueprintPlanScanInput,
): BlueprintPlanScanResult {
  return createDeprecatedStubScan(_input)
}

export function runWave2WallExtractionFromAdapted(): {
  walls: PlanWallCandidate[]
  warnings: string[]
  blockers: string[]
} {
  return { walls: [], warnings: [DEPRECATED_MSG], blockers: [DEPRECATED_MSG] }
}

export function classifySheetRole(): FullSetSheetClassification {
  return {
    pageNumber: 0,
    roles: ['unknown'],
    roleScores: {},
    reason: DEPRECATED_MSG,
    confidence: 0,
  }
}

export function classifyBlueprintPage(pageNumber: number): BlueprintPageClassification {
  return {
    pageNumber,
    role: 'unknown',
    roleConfidence: 0,
    reasons: [DEPRECATED_MSG],
    eligibleForWallSource: false,
  }
}

export function chooseBestFloorPlanSheet(): SelectedFloorPlanSheet | null {
  return null
}

export function chooseBestElectricalSheets(): BlueprintVRSourceSheet[] {
  return []
}

export function chooseBestRenderingSheets(): BlueprintVRSourceSheet[] {
  return []
}

export function extractProjectStyleHints(): ExtractedProjectHint {
  return projectHintForContext('generic')
}

export function extractEquipmentHints(): EquipmentHint[] {
  return []
}

export function extractDoorAndOpeningHints(): DoorHint[] {
  return []
}

export function extractWallThicknessHints(): WallHint[] {
  return []
}
