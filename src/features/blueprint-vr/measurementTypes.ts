/**
 * src/features/blueprint-vr/measurementTypes.ts
 *
 * Core measurement and geometry primitives for the Blueprint VR dimension model.
 */

// ---------------------------------------------------------------------------
// Unit system
// ---------------------------------------------------------------------------

export type Unit = 'ft' | 'in' | 'm' | 'mm' | 'px'

// ---------------------------------------------------------------------------
// Measurement value
// ---------------------------------------------------------------------------

export interface MeasurementValue {
  /** Numeric magnitude in the given unit */
  value: number
  /** Unit of measurement */
  unit: Unit
  /** Human-readable display string, e.g. "9' 6\"" */
  display: string
  /** Confidence score in the range [0, 1] */
  confidence: number
  /** Origin of the measurement, e.g. 'ai', 'user', 'default' */
  source: string
}

// ---------------------------------------------------------------------------
// 2-D geometry primitives
// ---------------------------------------------------------------------------

export interface Point2D {
  x: number
  y: number
}

export interface Rectangle {
  x: number
  y: number
  width: number
  height: number
}

export interface Bounds {
  min: Point2D
  max: Point2D
}

// ---------------------------------------------------------------------------
// Dimension line
// ---------------------------------------------------------------------------

export interface DimensionLine {
  start: Point2D
  end: Point2D
  measurement: MeasurementValue
  label?: string
}
