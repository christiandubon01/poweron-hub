/**
 * src/features/blueprint-vr/pdfTraceTypes.ts
 *
 * Pure type definitions for future PDF / blueprint vector trace input.
 *
 * These types describe what a deterministic line/polyline extractor would emit
 * after walking the active blueprint page (PDF.js path operators, vector
 * commands, or future OCR-derived line candidates).
 *
 * No runtime extraction is performed here — this is the contract that the
 * Blueprint plan scanner consumes when trace data is available. When it is not,
 * the scanner falls back to a deterministic suite layout based on blueprint
 * project context (e.g. Beauty Salon, tenant improvement).
 */

// ---------------------------------------------------------------------------
// Coordinate / scale primitives
// ---------------------------------------------------------------------------

/**
 * A 2-D point in PDF page coordinates (raw, pre-scale).
 */
export interface PdfTracePoint {
  /** Horizontal page coordinate, paper units (typically PDF points). */
  x: number
  /** Vertical page coordinate, paper units. */
  y: number
}

/**
 * A 2-D point in real-world building coordinates (feet).
 */
export interface WorldPoint2D {
  x: number
  y: number
}

/**
 * Scale information used to convert PDF / paper coordinates into world feet.
 *
 * pixelsPerFoot tells the scanner: "this many PDF units equal one real foot".
 * When the scale was inferred (not measured directly on a scale bar), confidence
 * should reflect that.
 */
export interface PdfTraceScale {
  /** PDF units per real foot. */
  pixelsPerFoot: number
  /** Confidence in the scale, 0–1. */
  confidence: number
  /** Where the scale came from. */
  source: 'scale-bar' | 'dimension-label' | 'inferred' | 'default'
  /** Optional raw notation, e.g. "1/4\" = 1'-0\"". */
  raw?: string
}

// ---------------------------------------------------------------------------
// Geometry primitives describing what a vector extractor would yield
// ---------------------------------------------------------------------------

/**
 * Tags describing how a line was classified after geometry analysis.
 * Used by the scanner to bias wall/room/opening inference.
 */
export type PdfTraceLineRole =
  | 'unknown'
  | 'exterior-wall'
  | 'interior-wall'
  | 'door'
  | 'window'
  | 'dimension'
  | 'leader'
  | 'hatch'
  | 'symbol'

/**
 * A single straight line in the PDF page, already classified.
 *
 * Coordinates are still in PDF units. World conversion happens during scan,
 * using the active scale (see PdfTraceScale).
 */
export interface PdfTraceLine {
  id: string
  start: PdfTracePoint
  end: PdfTracePoint
  /** Estimated stroke weight in PDF units. */
  weight?: number
  /** Page index this line belongs to (zero-based). */
  pageIndex?: number
  /** Layer / class name if known. */
  layer?: string
  /** Pre-classified role from upstream extractors. */
  role?: PdfTraceLineRole
  /** Extraction confidence, 0–1. */
  confidence?: number
}

/**
 * A polyline grouping (e.g. closed perimeter, door swing arc, hatch).
 */
export interface PdfTracePolyline {
  id: string
  /** Vertices in PDF space; often derived from constructPath / stroked polygons. */
  points: PdfTracePoint[]
  closed?: boolean
  role?: PdfTraceLineRole
  confidence?: number
}

/**
 * A piece of text recovered from the PDF that may contribute a dimension.
 */
export interface PdfTraceTextNote {
  id: string
  text: string
  origin: PdfTracePoint
  /** Bounds of the text block, if known. */
  bounds?: { min: PdfTracePoint; max: PdfTracePoint }
  /** Page index this text belongs to. */
  pageIndex?: number
}

// ---------------------------------------------------------------------------
// Top-level trace payload that the scanner consumes
// ---------------------------------------------------------------------------

/**
 * The full vector trace payload for a single blueprint page.
 *
 * This is what a deterministic PDF vector extractor (e.g. pdf.js operator
 * walker) would build. The Blueprint plan scanner consumes this shape; when
 * absent, the scanner falls back to context-based defaults.
 */
export interface PdfTracePagePayload {
  pageIndex: number
  pageLabel?: string
  pageDiscipline?: string
  /** Active scale for this page, if known. */
  scale?: PdfTraceScale
  /** Page width in PDF units, if known. */
  pageWidth?: number
  /** Page height in PDF units, if known. */
  pageHeight?: number
  /** Raw line list. */
  lines: PdfTraceLine[]
  /** Closed polylines / arc groupings. */
  polylines?: PdfTracePolyline[]
  /** Text notes (dimension labels, room labels, etc.). */
  textNotes?: PdfTraceTextNote[]
}
