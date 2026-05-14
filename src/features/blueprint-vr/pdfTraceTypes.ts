/**
 * src/features/blueprint-vr/pdfTraceTypes.ts
 *
 * Library-agnostic contracts for PDF/vector trace extraction.
 */

export interface PdfTracePoint {
  x: number
  y: number
}

export interface WorldPoint2D {
  x: number
  y: number
}

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

export interface PdfTraceLine {
  id: string
  start: PdfTracePoint
  end: PdfTracePoint
  weight?: number
  pageIndex?: number
  layer?: string
  role?: PdfTraceLineRole
  confidence?: number
}

export interface PdfTraceRect {
  id: string
  x: number
  y: number
  width: number
  height: number
  weight?: number
  role?: PdfTraceLineRole
  confidence?: number
}

export interface PdfTracePolyline {
  id: string
  points: PdfTracePoint[]
  closed?: boolean
  role?: PdfTraceLineRole
  confidence?: number
}

export interface PdfTraceArc {
  id: string
  center: PdfTracePoint
  radius: number
  startAngleDeg: number
  endAngleDeg: number
  clockwise?: boolean
  role?: PdfTraceLineRole
  confidence?: number
}

export interface PdfTraceTextRun {
  id: string
  text: string
  origin: PdfTracePoint
  bounds?: { min: PdfTracePoint; max: PdfTracePoint }
  pageIndex?: number
  confidence?: number
}

export interface PdfTracePageBounds {
  width: number
  height: number
}

export interface PdfTraceViewport {
  scale: number
  width: number
  height: number
  rotation?: number
  offsetX?: number
  offsetY?: number
}

export interface PdfTraceScaleHint {
  pixelsPerFoot: number
  confidence: number
  source: 'scale-bar' | 'dimension-label' | 'trace-text' | 'inferred' | 'default'
  raw?: string
}

export interface PdfTracePayload {
  pageNumber: number
  sheetNumber?: string
  sheetTitle?: string
  coordinateSpace: 'pdf-points' | 'viewer-pixels' | 'normalized'
  pageBounds: PdfTracePageBounds
  viewport?: PdfTraceViewport
  lines: PdfTraceLine[]
  rects: PdfTraceRect[]
  polylines: PdfTracePolyline[]
  arcs: PdfTraceArc[]
  textRuns: PdfTraceTextRun[]
  scaleHints: PdfTraceScaleHint[]
  runtime?: {
    providerStatus?: 'available' | 'missing' | 'error' | 'unknown'
    providerKey?: string
    providerRequestedKey?: string
    providerRegisteredKeys?: string[]
    providerMatchReason?: string
    providerMetadata?: Record<string, any>
    selectedPageNumber?: number
    operatorListStatus?: 'available' | 'missing' | 'error' | 'unknown'
    textContentStatus?: 'available' | 'missing' | 'error' | 'unknown'
  }
  warnings: PdfTraceExtractionWarning[]
}

export interface PdfTraceExtractionWarning {
  code:
    | 'MISSING_PAGE_ACCESS'
    | 'MISSING_OPERATOR_LIST'
    | 'MISSING_TEXT_CONTENT'
    | 'MISSING_VIEWPORT'
    | 'EMPTY_TRACE_GEOMETRY'
    | 'UNSUPPORTED_OPERATOR_SEQUENCE'
    | 'ADAPTER_REQUIRED'
    | 'RUNTIME_PROVIDER_MISSING'
    | 'RUNTIME_PROVIDER_ERROR'
    | 'EXTRACTION_ERROR'
  message: string
}

export interface PdfTraceExtractionResult {
  success: boolean
  payload: PdfTracePayload | null
  warnings: PdfTraceExtractionWarning[]
}

// Backward-compatible aliases used by scanner/adapter code.
export type PdfTraceScale = PdfTraceScaleHint
export type PdfTraceTextNote = PdfTraceTextRun
export type PdfTracePagePayload = PdfTracePayload
