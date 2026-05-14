/**
 * src/features/blueprint-vr/dimensionModel.ts
 *
 * Dimension model for Blueprint VR — rooms, walls, openings, and building space.
 */

import type {
  Unit,
  MeasurementValue,
  Point2D,
  Rectangle,
  Bounds,
} from './measurementTypes'

// Re-export so consumers only need one import
export type { Unit, MeasurementValue, Point2D, Rectangle, Bounds } from './measurementTypes'

// ---------------------------------------------------------------------------
// Openings (doors & windows)
// ---------------------------------------------------------------------------

export interface Opening {
  id: string
  type: 'door' | 'window'
  position: Point2D
  width: MeasurementValue
  height: MeasurementValue
}

// ---------------------------------------------------------------------------
// Wall
// ---------------------------------------------------------------------------

export interface Wall {
  id: string
  start: Point2D
  end: Point2D
  thickness: MeasurementValue
  height: MeasurementValue
}

// ---------------------------------------------------------------------------
// Room zone
// ---------------------------------------------------------------------------

export interface RoomZone {
  id: string
  label: string
  bounds: Bounds
  height: MeasurementValue
  walls: Wall[]
  openings: Opening[]
}

// ---------------------------------------------------------------------------
// Scale source
// ---------------------------------------------------------------------------

export type ScaleSource = 'user' | 'ai' | 'default' | 'measured'

// ---------------------------------------------------------------------------
// Building space — top-level model
// ---------------------------------------------------------------------------

export interface BuildingSpace {
  footprint: Rectangle
  rooms: RoomZone[]
  levels: number
  scale: {
    pixelsPerUnit: number
    unit: Unit
    source: ScaleSource
  }
  wallHeight: MeasurementValue
  slabThickness: MeasurementValue
  ceilingHeight: MeasurementValue
  metadata: {
    createdAt: string
    updatedAt: string
    confidence: number
    notes?: string
  }
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/** Convert feet to inches */
export function feetToInches(ft: number): number {
  return ft * 12
}

/** Convert inches to feet */
export function inchesToFeet(inches: number): number {
  return inches / 12
}

/**
 * Format a total-inches value as a feet-and-inches string.
 * e.g. 114 → "9' 6\""
 */
export function formatFeetInches(totalInches: number): string {
  const feet = Math.floor(totalInches / 12)
  const inches = Math.round(totalInches % 12)
  if (inches === 0) return `${feet}'`
  return `${feet}' ${inches}"`
}

/**
 * Convenience constructor for a MeasurementValue.
 *
 * @param value      Numeric magnitude
 * @param unit       Unit of measurement
 * @param source     Origin label (defaults to 'default')
 * @param confidence Confidence score 0–1 (defaults to 1)
 */
export function createMeasurement(
  value: number,
  unit: Unit,
  source = 'default',
  confidence = 1,
): MeasurementValue {
  let display: string
  if (unit === 'ft') {
    display = `${value}'`
  } else if (unit === 'in') {
    display = `${value}"`
  } else {
    display = `${value} ${unit}`
  }
  return { value, unit, display, confidence, source }
}

/**
 * Returns a sensible default BuildingSpace:
 * - 20 ft × 20 ft footprint (in pixels at 1 px/ft)
 * - 9 ft wall height
 * - 8 ft ceiling height
 * - 1 ft slab thickness
 */
export function createDefaultBuildingSpace(): BuildingSpace {
  const now = new Date().toISOString()
  return {
    footprint: { x: 0, y: 0, width: 20, height: 20 },
    rooms: [],
    levels: 1,
    scale: {
      pixelsPerUnit: 1,
      unit: 'ft',
      source: 'default',
    },
    wallHeight: createMeasurement(9, 'ft', 'default', 1),
    slabThickness: createMeasurement(1, 'ft', 'default', 1),
    ceilingHeight: createMeasurement(8, 'ft', 'default', 1),
    metadata: {
      createdAt: now,
      updatedAt: now,
      confidence: 1,
    },
  }
}

/**
 * Returns the area of a room zone in square units, derived from its bounds.
 */
export function getRoomArea(room: RoomZone): number {
  const width = room.bounds.max.x - room.bounds.min.x
  const height = room.bounds.max.y - room.bounds.min.y
  return width * height
}

/**
 * Returns the footprint area (width × height) of a BuildingSpace.
 */
export function getFootprintArea(space: BuildingSpace): number {
  return space.footprint.width * space.footprint.height
}
