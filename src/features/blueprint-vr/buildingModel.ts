/**
 * src/features/blueprint-vr/buildingModel.ts
 *
 * Core building model for Planner5D-style Generate VR.
 * Consolidates building dimensions, rooms, walls, openings, electrical anchors, and metadata.
 *
 * This is the source-of-truth data model for the measured plan viewer and 3D scene generation.
 */

import type {
  Unit,
  MeasurementValue,
  Point2D,
  Point3D,
  Rectangle,
  Bounds2D,
  Size2D,
} from './measurementTypes'

// ─────────────────────────────────────────────────────────────────────────────
// Basic Geometry Models (Point, Bounds, Size)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Re-export geometric primitives from measurementTypes for convenience.
 * This allows consumers to import them from either module.
 */
export type {
  Point2D,
  Point3D,
  Rectangle,
  Bounds2D,
  Size2D,
  Unit,
  MeasurementValue,
} from './measurementTypes'

// ─────────────────────────────────────────────────────────────────────────────
// Openings: Doors and Windows
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Door swing / opening direction hint used for plan + 3D rendering.
 *  - 'left' / 'right' — single-leaf door, swing direction along the wall.
 *  - 'double' — pair of doors meeting in the centre.
 *  - 'sliding' — sliding / pocket door (no swing arc).
 *  - 'fixed' — non-operable opening (e.g. storefront window, pass-through).
 */
export type DoorSwingDirection = 'left' | 'right' | 'double' | 'sliding' | 'fixed'

/**
 * Subtype for openings, used by the plan viewer / 3D viewer to render the
 * right primitive.
 */
export type OpeningSubtype =
  | 'door-swing'
  | 'door-sliding'
  | 'door-pocket'
  | 'window-standard'
  | 'window-storefront'
  | 'window-clerestory'
  | 'pass-through'

export interface BuildingOpeningModel {
  /** Unique identifier within the wall */
  id: string
  /** 'door' | 'window' */
  type: 'door' | 'window'
  /** Position along the wall (distance from start point) */
  positionAlongWall: MeasurementValue
  /** Width of the opening */
  width: MeasurementValue
  /** Height of the opening */
  height: MeasurementValue
  /** Whether opening is currently visible/active */
  visible?: boolean
  /** Optional structured subtype (storefront, sliding, etc.). */
  subtype?: OpeningSubtype
  /** Optional swing direction for doors. */
  swing?: DoorSwingDirection
  /** Optional swing arc in degrees (0–180). Used for plan rendering. */
  swingDegrees?: number
  /** Metadata */
  metadata?: {
    material?: string
    swing?: 'left' | 'right' | 'double'
    notes?: string
    /** Source / confidence tag, e.g. 'inferred', 'scanner', 'measured'. */
    sourceTag?: string
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Walls
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wall kind used by the plan + 3D renderers to pick thickness, color, and
 * primitive geometry.
 *
 *  - 'exterior' — building shell wall (default thicker, e.g. 6 in)
 *  - 'partition' — interior room divider (default 4 in)
 *  - 'divider' — thin salon station / display divider (default 2 in)
 *  - 'glass' — storefront / window wall (transparent in 3D)
 *  - 'pony' — half-height / counter-height wall
 */
export type WallKind =
  | 'exterior'
  | 'partition'
  | 'divider'
  | 'glass'
  | 'pony'

export interface BuildingWallModel {
  /** Unique identifier within the room/building */
  id: string
  /** Start point in 2D space (feet) */
  start: Point2D
  /** End point in 2D space (feet) */
  end: Point2D
  /** Wall thickness */
  thickness: MeasurementValue
  /** Wall height from floor to ceiling */
  height: MeasurementValue
  /** Doors and windows on this wall */
  openings: BuildingOpeningModel[]
  /** Whether wall is visible/active */
  visible?: boolean
  /** Optional wall classification (exterior/partition/divider/glass/pony). */
  kind?: WallKind
  /** Optional confidence in this wall, 0–1. */
  confidence?: number
}

/**
 * Canonical 2D segment extracted from vector plan traces (Wave 2 wall model).
 * Coordinates are plan/world feet consistent with {@link BlueprintBuildingModel}.
 */
export interface ExtractedWallPlanSegment {
  id: string
  start: Point2D
  end: Point2D
  classification: 'exterior' | 'interior' | 'partition'
  /** Inferred from double-line spacing when available. */
  inferredThicknessFt?: number
  confidence: number
  /** 1-based PDF page when geometry is merged from multiple canonical sheets. */
  sourcePageNumber?: number
}

/**
 * Detected building outline on a sheet — distinct from the physical page border.
 */
export interface DetectedPlanFootprint {
  /** Ordered boundary corners when a simple rect is recovered; may be empty. */
  boundaryPoints: Point2D[]
  boundingRect: Rectangle
  confidence: number
  /** True when the recovered outline tracks the sheet bleed box too closely. */
  isLikelyPageFrame: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Electrical Anchors and Panel Locations
// ─────────────────────────────────────────────────────────────────────────────

export type ElectricalAnchorType =
  | 'panel'
  | 'subpanel'
  | 'breaker'
  | 'outlet'
  | 'fixture'
  | 'disconnect'
  | 'other'

export interface BuildingElectricalAnchorModel {
  /** Unique identifier */
  id: string
  /** Type of electrical component */
  type: ElectricalAnchorType
  /** Position in 2D space (feet) */
  position: Point2D
  /** Optional position in 3D space when available */
  position3D?: Point3D
  /** Room or zone where anchor is located */
  roomId?: string
  /** Height above floor (for vertical placement) */
  heightAboveFloor?: MeasurementValue
  /** Associated room label for search/reference */
  roomLabel?: string
  /** Additional metadata */
  metadata?: {
    amperage?: number
    voltage?: number
    phase?: 'single' | 'three'
    panelType?: string
    notes?: string
  }
  /** Whether anchor is visible/active */
  visible?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Rooms / Zones
// ─────────────────────────────────────────────────────────────────────────────

/**
 * High-level role classification for rooms. Used by furniture / fixture
 * hint selection in the 3D viewer and the room interior view.
 */
export type RoomRole =
  | 'reception'
  | 'waiting'
  | 'styling'
  | 'salon-station'
  | 'wash-station'
  | 'hallway'
  | 'bath'
  | 'utility'
  | 'storage'
  | 'service'
  | 'office'
  | 'conference'
  | 'living'
  | 'bedroom'
  | 'kitchen'
  | 'garage'
  | 'other'

/**
 * Lightweight equipment / furniture / fixture hint attached to a room so the
 * 3D and room-interior views can render proxies that match the project type.
 */
export interface RoomEquipmentHint {
  id: string
  kind:
    | 'reception-counter'
    | 'waiting-chair'
    | 'waiting-couch'
    | 'side-table'
    | 'styling-chair'
    | 'styling-mirror'
    | 'vanity-counter'
    | 'wash-sink'
    | 'shampoo-bowl'
    | 'restroom-sink'
    | 'toilet'
    | 'utility-panel'
    | 'service-equipment'
    | 'storage-shelving'
    | 'storefront-sign'
    | 'decor-wall'
    | 'overhead-light'
    | 'track-light'
    | 'chandelier'
    | 'receptacle'
    | 'switch'
    | 'gfci'
    | 'other'
  /** Label for UI display. */
  label: string
  /** Optional normalized 0..1 position within the room (x, y). */
  positionNormalized?: { x: number; y: number }
  /** Optional approximate world position in feet. */
  positionWorld?: Point2D
  /** Optional footprint width / depth in feet for proxy rendering. */
  sizeFt?: { width: number; depth: number; height?: number }
  /** Hint confidence, 0–1. */
  confidence?: number
  /** Source tag (e.g. "inferred", "schedule", "render"). */
  sourceTag?: string
}

export interface BuildingRoomModel {
  /** Unique identifier */
  id: string
  /** Human-readable room name */
  label: string
  /** 2D bounds (min/max corners in feet) */
  bounds: Bounds2D
  /** Room area in square feet */
  area?: number
  /** Room height from floor to ceiling */
  height: MeasurementValue
  /** Walls that define this room */
  walls: BuildingWallModel[]
  /** Electrical anchors in this room */
  electricalAnchors?: BuildingElectricalAnchorModel[]
  /** Whether room is visible/active */
  visible?: boolean
  /**
   * Equipment / furniture / fixture hints derived from the project context
   * or full-set scan. Used by the 3D dollhouse and room interior view.
   */
  equipmentHints?: RoomEquipmentHint[]
  /** Metadata */
  metadata?: {
    type?: 'living' | 'bedroom' | 'kitchen' | 'bath' | 'utility' | 'garage' | 'other'
    floor?: number
    finishType?: string
    notes?: string
    /** Optional role classification beyond the basic type. */
    role?: RoomRole
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Horizontal Dimension Models
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildingDimensionModel {
  /** Unique identifier */
  id: string
  /** Start point for dimension line */
  start: Point2D
  /** End point for dimension line */
  end: Point2D
  /** Measured value */
  measurement: MeasurementValue
  /** Human-readable label (e.g., "12'-6\"") */
  label?: string
  /** Type of dimension: 'horizontal' | 'vertical' | 'diagonal' */
  dimensionType?: 'horizontal' | 'vertical' | 'diagonal'
  /** Whether dimension is visible in measured plan */
  visible?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Building Level / Floor
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildingLevelModel {
  /** Floor number (0 = ground, 1 = first above ground, etc.) */
  levelNumber: number
  /** Human-readable level name (e.g., "Ground Floor") */
  label: string
  /** Height of this level above the next level below */
  floorToFloorHeight?: MeasurementValue
  /** All rooms on this level */
  rooms: BuildingRoomModel[]
  /** Boundary of this floor (may differ from building footprint) */
  footprint?: Rectangle
  /** Visible in 3D viewer */
  visible?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-Level Building Model
// ─────────────────────────────────────────────────────────────────────────────

export interface BlueprintBuildingModel {
  /** Unique identifier for this building model */
  id: string
  /** Human-readable name */
  name: string
  /** Overall building footprint in 2D (feet) */
  footprint: Rectangle
  /** Number of floors/levels */
  levels: BuildingLevelModel[]
  /** Default wall height for this building */
  wallHeight: MeasurementValue
  /** Default ceiling/floor-to-floor height */
  ceilingHeight: MeasurementValue
  /** Slab thickness (floor-to-floor delta) */
  slabThickness?: MeasurementValue
  /** All dimension annotations (for measured plan) */
  dimensions?: BuildingDimensionModel[]
  /** All electrical anchors (across all levels) */
  electricalAnchors?: BuildingElectricalAnchorModel[]
  /** Scale information for the measured plan */
  scale: {
    pixelsPerUnit: number
    unit: Unit
    source: 'user' | 'ai' | 'default' | 'measured'
  }
  /** Overall confidence in model accuracy */
  confidence: number // 0–1
  /** Metadata and provenance */
  metadata: {
    createdAt: string
    updatedAt: string
    source: 'user' | 'extraction' | 'fallback' | 'ai'
    sourceBlueprint?: string
    sourceProject?: string
    sourceSheet?: string
    sourcePage?: number
    notes?: string
    displayLabel?: string
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback / Empty Model Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an empty building model with no rooms or content.
 * Used when no blueprint data is available, but a model skeleton is needed.
 */
export function createEmptyBuildingModel(name = 'Empty Building'): BlueprintBuildingModel {
  const now = new Date().toISOString()
  return {
    id: `model-${Date.now()}`,
    name,
    footprint: { x: 0, y: 0, width: 0, height: 0 },
    levels: [],
    wallHeight: { value: 9, unit: 'ft', display: "9'", confidence: 1, source: 'default' },
    ceilingHeight: { value: 9, unit: 'ft', display: "9'", confidence: 1, source: 'default' },
    scale: {
      pixelsPerUnit: 1,
      unit: 'ft',
      source: 'default',
    },
    confidence: 0,
    metadata: {
      createdAt: now,
      updatedAt: now,
      source: 'fallback',
      notes: 'Empty model – no blueprint data provided',
    },
  }
}
