/**
 * src/features/blueprint-vr/blueprintDimensionExtractor.ts
 *
 * Blueprint dimension extraction adapter for Generate VR.
 *
 * Converts blueprint/PDF context into a Planner5D-style measured building space.
 * All extraction is deterministic and local — no OCR, no AI calls, no external services.
 */

import type { BuildingSpace, RoomZone, Wall, ScaleSource } from './dimensionModel'
import { createMeasurement } from './dimensionModel'
import type { MeasurementValue, Rectangle, Bounds } from './measurementTypes'
import type { BlueprintDocumentLike, NormalizedBlueprintMetadata } from './blueprintExtractionAdapter'
import { normalizeBlueprint } from './blueprintExtractionAdapter'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedDimensionText {
  raw: string
  /** Canonical value in inches */
  valueInches: number
  /** Text field this dimension was found in */
  source: string
  confidence: number
}

export interface ExtractedScaleInfo {
  raw: string
  /** Real feet represented by one paper inch (e.g. 4 for "1/4\" = 1'-0\"") */
  feetPerPaperInch: number
  isNTS: boolean
  source: string
  confidence: number
}

export type DimensionExtractionWarningCode =
  | 'NO_SCALE_FOUND'
  | 'NO_DIMENSIONS_FOUND'
  | 'FALLBACK_USED'
  | 'PARTIAL_DIMENSIONS'
  | 'NTS_SCALE'
  | 'AMBIGUOUS_DIMENSION'

export interface DimensionExtractionWarning {
  code: DimensionExtractionWarningCode
  message: string
  field?: string
}

/** Input type accepted by extractBlueprintDimensions. Extends the broad document shape with optional known-dimension overrides. */
export interface BlueprintDimensionExtractionInput extends BlueprintDocumentLike {
  /** Known building width in feet (overrides inference) */
  knownWidthFt?: number
  /** Known building depth in feet (overrides inference) */
  knownDepthFt?: number
  /** Known wall height in feet (overrides default 9 ft) */
  knownWallHeightFt?: number
  /** Known slab thickness in inches (overrides default 4 in) */
  knownSlabThicknessIn?: number
  /** Known ceiling height in feet (overrides default 9 ft) */
  knownCeilingHeightFt?: number
}

export interface BlueprintDimensionExtractionResult {
  /** The extracted or inferred BuildingSpace model */
  space: BuildingSpace
  /** All dimension strings found in blueprint text fields */
  extractedDimensions: ExtractedDimensionText[]
  /** Scale notation found, if any */
  scaleInfo: ExtractedScaleInfo | null
  warnings: DimensionExtractionWarning[]
  /** True when exact dimensions were unavailable and deterministic defaults were used */
  isFallback: boolean
  /** Overall confidence score 0–1 */
  confidence: number
  metadata: {
    extractedFrom: string[]
    processedAt: string
    inputProjectName: string
    inputBlueprintTitle: string
  }
}

// ---------------------------------------------------------------------------
// Scale parsing
// ---------------------------------------------------------------------------

/**
 * Parse an architectural scale notation.
 *
 * Supports:
 *   "1/4\" = 1'-0\""   → feetPerPaperInch: 4
 *   "1/8\" = 1'-0\""   → feetPerPaperInch: 8
 *   "3/16\" = 1'-0\""  → feetPerPaperInch: ≈5.33
 *   "SCALE BAR 1/4 = 1'-0\""
 *   "NTS" / "N.T.S."   → isNTS: true
 */
export function parseArchitecturalScale(text: string): ExtractedScaleInfo | null {
  if (!text || typeof text !== 'string') return null
  const trimmed = text.trim()

  // NTS / N.T.S.
  if (/\bN\.?T\.?S\.?\b/i.test(trimmed)) {
    return { raw: trimmed, feetPerPaperInch: 0, isNTS: true, source: 'parsed', confidence: 0.9 }
  }

  // Fraction-scale: N/D["] = M'-[inches]
  //   Handles: "1/4" = 1'-0"", "3/16 = 1'", "SCALE BAR 1/4 = 1'-0""
  const scalePattern =
    /(\d+)\s*\/\s*(\d+)\s*(?:"|''|in|inch)?\s*=\s*(\d+)\s*(?:'|′|-ft)\s*(?:-?\s*\d+\s*")?/i
  const m = trimmed.match(scalePattern)
  if (m) {
    const numerator = parseFloat(m[1])
    const denominator = parseFloat(m[2])
    const realFeet = parseFloat(m[3])
    if (denominator === 0 || realFeet === 0) return null
    const paperInches = numerator / denominator
    if (paperInches <= 0) return null
    return {
      raw: trimmed,
      feetPerPaperInch: realFeet / paperInches,
      isNTS: false,
      source: 'parsed',
      confidence: 0.85,
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Dimension text parsing
// ---------------------------------------------------------------------------

/**
 * Parse a single dimension string to inches.
 *
 * Supports:
 *   "12'-6\""     → 150
 *   "12' 6\""     → 150
 *   "12 ft 6 in"  → 150
 *   "12.5'"       → 150
 *   "150\""       → 150
 *   "12 ft"       → 144
 *
 * Returns null when the string cannot be parsed.
 */
export function parseDimensionText(text: string): number | null {
  if (!text || typeof text !== 'string') return null
  const t = text.trim()

  // 12'-6" or 12' 6" or 12'6"
  let m = t.match(/^(\d+(?:\.\d+)?)\s*['′]\s*[-–]?\s*(\d+(?:\.\d+)?)\s*["″]?$/)
  if (m) return parseFloat(m[1]) * 12 + parseFloat(m[2])

  // 12 ft 6 in
  m = t.match(/^(\d+(?:\.\d+)?)\s*(?:ft|feet)\s+(\d+(?:\.\d+)?)\s*(?:in|inch(?:es)?)?$/i)
  if (m) return parseFloat(m[1]) * 12 + parseFloat(m[2])

  // 12.5' or 12' (feet only)
  m = t.match(/^(\d+(?:\.\d+)?)\s*['′]$/)
  if (m) return parseFloat(m[1]) * 12

  // 12 ft (feet word only)
  m = t.match(/^(\d+(?:\.\d+)?)\s*(?:ft|feet)$/i)
  if (m) return parseFloat(m[1]) * 12

  // 150" (inches only)
  m = t.match(/^(\d+(?:\.\d+)?)\s*["″]$/)
  if (m) return parseFloat(m[1])

  // 150 in (inches word)
  m = t.match(/^(\d+(?:\.\d+)?)\s*(?:in|inch(?:es)?)$/i)
  if (m) return parseFloat(m[1])

  return null
}

// ---------------------------------------------------------------------------
// Dimension string normalization
// ---------------------------------------------------------------------------

/**
 * Scan an array of raw strings for architectural dimension patterns.
 * Returns all successfully parsed dimensions.
 */
export function normalizeDimensionStrings(
  values: string[],
  source = 'input',
): ExtractedDimensionText[] {
  const results: ExtractedDimensionText[] = []
  const seen = new Set<string>()

  // Ordered from most-specific to least — each pattern extracts a complete canonical form
  const patterns: RegExp[] = [
    // 12'-6" or 12' 6" (feet-inches combined)
    /\b\d+(?:\.\d+)?['′]\s*[-–]?\s*\d+(?:\.\d+)?["″]/g,
    // 12 ft 6 in
    /\b\d+(?:\.\d+)?\s*(?:ft|feet)\s+\d+(?:\.\d+)?\s*(?:in|inch(?:es)?)\b/gi,
    // 12.5' or 12' — only when NOT followed by another digit (avoids matching prefix of feet-inches)
    /\b\d+(?:\.\d+)?['′](?!\s*[-–]?\s*\d)/g,
    // 12 ft — only when NOT followed by a digit (avoids matching prefix of "12 ft 6 in")
    /\b\d+(?:\.\d+)?\s*(?:ft|feet)\b(?!\s+\d)/gi,
    // 150" — only when NOT preceded by = (avoids matching scale "= 1'")
    /(?<![='])\b\d+(?:\.\d+)?["″]/g,
  ]

  for (const val of values) {
    if (!val || typeof val !== 'string') continue

    for (const pattern of patterns) {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(val)) !== null) {
        const raw = match[0].trim()
        if (seen.has(raw)) continue
        const parsed = parseDimensionText(raw)
        // Filter to plausible building dimensions: 1 in – 2000 ft
        if (parsed !== null && parsed >= 1 && parsed <= 24_000) {
          seen.add(raw)
          results.push({ raw, valueInches: parsed, source, confidence: 0.7 })
        }
      }
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Footprint inference
// ---------------------------------------------------------------------------

/**
 * Infer a building footprint rectangle (in feet) from blueprint metadata and text.
 * Direct overrides take highest priority; text extraction is used as a fallback;
 * the final fallback is a 40 ft × 30 ft default.
 */
export function inferFootprintFromBlueprintMetadata(
  input: BlueprintDimensionExtractionInput,
): { footprint: Rectangle; scaleSource: ScaleSource; confidence: number } {
  // Priority 1: explicit overrides
  if (input.knownWidthFt && input.knownDepthFt) {
    return {
      footprint: { x: 0, y: 0, width: input.knownWidthFt, height: input.knownDepthFt },
      scaleSource: 'user',
      confidence: 1.0,
    }
  }

  // Priority 2: scan text fields for dimension strings
  const textSources: string[] = []

  const addText = (v: unknown) => {
    if (v && typeof v === 'string' && v.trim()) textSources.push(v.trim().slice(0, 1000))
  }

  addText(input.projectName)
  addText(input.title)
  addText(input.fileName)
  addText(input.extractedText)
  addText(input.annotationsSummary)

  if (Array.isArray(input.pageTexts)) {
    for (const t of input.pageTexts as unknown[]) addText(t)
  }
  if (Array.isArray(input.sheetIndex)) {
    for (const p of input.sheetIndex) {
      addText(p.sheetTitle)
      addText(p.sheetLabel)
      addText(p.sheetNumber)
    }
  }

  const extracted = normalizeDimensionStrings(textSources, 'metadata')

  if (extracted.length >= 2) {
    // Use the two largest plausible footprint-level dimensions (> 10 ft, < 1000 ft)
    const candidates = extracted
      .map((d) => d.valueInches / 12)
      .filter((ft) => ft > 10 && ft < 1000)
      .sort((a, b) => b - a)

    if (candidates.length >= 2) {
      return {
        footprint: { x: 0, y: 0, width: candidates[0], height: candidates[1] },
        scaleSource: 'measured',
        confidence: 0.4,
      }
    }
  }

  // Priority 3: deterministic default
  return {
    footprint: { x: 0, y: 0, width: 40, height: 30 },
    scaleSource: 'default',
    confidence: 0.1,
  }
}

// ---------------------------------------------------------------------------
// Room zone helpers
// ---------------------------------------------------------------------------

function createPerimeterWalls(roomId: string, bounds: Bounds, wallHeight: MeasurementValue): Wall[] {
  const { min, max } = bounds
  const thickness = createMeasurement(0.5, 'ft', 'default', 1)
  return [
    { id: `${roomId}_wall_n`, start: { x: min.x, y: max.y }, end: { x: max.x, y: max.y }, thickness, height: wallHeight },
    { id: `${roomId}_wall_s`, start: { x: min.x, y: min.y }, end: { x: max.x, y: min.y }, thickness, height: wallHeight },
    { id: `${roomId}_wall_e`, start: { x: max.x, y: min.y }, end: { x: max.x, y: max.y }, thickness, height: wallHeight },
    { id: `${roomId}_wall_w`, start: { x: min.x, y: min.y }, end: { x: min.x, y: max.y }, thickness, height: wallHeight },
  ]
}

/**
 * Infer room/zone rectangles from a building footprint using fractional layout rules.
 * If the metadata shows high electrical confidence the utility room is labelled "Electrical Panel".
 */
export function inferRoomZonesFromFootprint(
  footprint: Rectangle,
  metadata: NormalizedBlueprintMetadata,
): RoomZone[] {
  const w = footprint.width
  const h = footprint.height
  const wallHeight = createMeasurement(9, 'ft', 'default', 0.5)
  const isElectrical = metadata.electricalConfidence === 'high'

  const zoneDefs: Array<{
    id: string
    label: string
    xFrac: number
    yFrac: number
    wFrac: number
    hFrac: number
  }> = [
    { id: 'main',    label: 'Main',                            xFrac: 0,    yFrac: 0,    wFrac: 0.60, hFrac: 0.67 },
    { id: 'kitchen', label: 'Kitchen',                         xFrac: 0.60, yFrac: 0,    wFrac: 0.40, hFrac: 0.53 },
    { id: 'bedroom', label: 'Bedroom',                         xFrac: 0,    yFrac: 0.67, wFrac: 0.50, hFrac: 0.33 },
    { id: 'bath',    label: 'Bathroom',                        xFrac: 0.50, yFrac: 0.67, wFrac: 0.30, hFrac: 0.33 },
    { id: 'utility', label: isElectrical ? 'Electrical Panel' : 'Utility/Panel',
                                                                xFrac: 0.80, yFrac: 0.53, wFrac: 0.20, hFrac: 0.47 },
  ]

  return zoneDefs.map(({ id, label, xFrac, yFrac, wFrac, hFrac }) => {
    const rx = xFrac * w
    const ry = yFrac * h
    const rw = wFrac * w
    const rh = hFrac * h
    const bounds: Bounds = { min: { x: rx, y: ry }, max: { x: rx + rw, y: ry + rh } }
    return {
      id,
      label,
      bounds,
      height: wallHeight,
      walls: createPerimeterWalls(id, bounds, wallHeight),
      openings: [],
    }
  })
}

// ---------------------------------------------------------------------------
// Fallback measured space
// ---------------------------------------------------------------------------

/**
 * Create a deterministic fallback BuildingSpace when exact dimensions are unavailable.
 *
 * Produces a 40 ft × 30 ft small commercial/residential layout:
 *   Main · Kitchen · Bedroom · Bathroom · Utility/Panel
 * with 9 ft walls, 4 in slab, 9 ft ceiling.
 * Confidence is 0.1 to clearly signal fallback status.
 */
export function createFallbackMeasuredSpace(input: BlueprintDimensionExtractionInput): BuildingSpace {
  const now = new Date().toISOString()
  const normalized = normalizeBlueprint(input)
  const footprint: Rectangle = { x: 0, y: 0, width: 40, height: 30 }
  const rooms = inferRoomZonesFromFootprint(footprint, normalized)

  return {
    footprint,
    rooms,
    levels: 1,
    scale: { pixelsPerUnit: 1, unit: 'ft', source: 'default' },
    wallHeight: createMeasurement(9, 'ft', 'fallback', 0.1),
    slabThickness: createMeasurement(4, 'in', 'fallback', 0.1),
    ceilingHeight: createMeasurement(9, 'ft', 'fallback', 0.1),
    metadata: {
      createdAt: now,
      updatedAt: now,
      confidence: 0.1,
      notes:
        `Fallback dimensions — generated from blueprint context: ` +
        `${normalized.blueprintTitle} (${normalized.projectName}). ` +
        `No exact dimensions found in blueprint text.`,
    },
  }
}

// ---------------------------------------------------------------------------
// Internal scale scanner
// ---------------------------------------------------------------------------

function scanForScale(textSources: string[]): ExtractedScaleInfo | null {
  // Pattern that isolates scale-bar fragments in longer text
  const scaleScanPattern =
    /(?:scale(?:\s+bar)?|sc\.?)\s*:?\s*\d+\s*\/\s*\d+\s*(?:"|''|in)?\s*=\s*\d+\s*['′-]\s*(?:\d+\s*")?|N\.?T\.?S\.?/gi

  for (const text of textSources) {
    if (!text) continue

    // Try to find a scale fragment within the text
    scaleScanPattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = scaleScanPattern.exec(text)) !== null) {
      const info = parseArchitecturalScale(match[0].trim())
      if (info) return info
    }

    // Also try the whole string directly (useful for short label/title strings)
    const direct = parseArchitecturalScale(text)
    if (direct) return direct
  }

  return null
}

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

/**
 * Extract blueprint dimensions from broad blueprint/PDF context.
 *
 * Exact path (when scale + dimensions are found):
 *   Scans project name, title, file name, sheet labels, extracted text, and annotations
 *   for dimension strings and scale notation. Derives footprint from the two largest
 *   plausible dimensions and infers a five-zone room layout.
 *
 * Fallback path (when exact dimensions are unavailable):
 *   Returns a deterministic 40 ft × 30 ft layout with standard residential zones,
 *   9 ft walls, 4 in slab, 9 ft ceiling. Confidence is 0.1 and isFallback is true.
 *   Warnings indicate why exact dimensions could not be extracted.
 */
export function extractBlueprintDimensions(
  input: BlueprintDimensionExtractionInput,
): BlueprintDimensionExtractionResult {
  const processedAt = new Date().toISOString()
  const warnings: DimensionExtractionWarning[] = []

  const normalized = normalizeBlueprint(input)

  // Collect all text sources
  const textSources: string[] = []
  const extractedFrom: string[] = []

  const addSource = (value: unknown, label: string) => {
    if (value && typeof value === 'string' && value.trim()) {
      textSources.push(value.trim())
      extractedFrom.push(label)
    }
  }

  addSource(normalized.projectName, 'projectName')
  addSource(normalized.blueprintTitle, 'blueprintTitle')
  addSource(input.fileName, 'fileName')
  addSource(input.extractedText, 'extractedText')
  addSource(input.annotationsSummary, 'annotationsSummary')

  if (Array.isArray(input.pageTexts)) {
    ;(input.pageTexts as unknown[]).forEach((t, i) => {
      if (typeof t === 'string') addSource(t.slice(0, 500), `pageText[${i}]`)
    })
  }

  if (Array.isArray(input.annotations)) {
    ;(input.annotations as Array<{ text?: unknown }>).forEach((ann, i) => {
      addSource(ann.text, `annotation[${i}]`)
    })
  }

  for (const sheet of normalized.sheetLabels) {
    addSource(sheet.label, `sheetLabel[${sheet.pageNumber}]`)
    addSource(sheet.title, `sheetTitle[${sheet.pageNumber}]`)
  }

  // Scale detection
  const scaleInfo = scanForScale(textSources)
  if (!scaleInfo) {
    warnings.push({
      code: 'NO_SCALE_FOUND',
      message: 'No architectural scale notation found in blueprint text. Using default scale.',
    })
  } else if (scaleInfo.isNTS) {
    warnings.push({
      code: 'NTS_SCALE',
      message: 'Blueprint is marked "Not to Scale" (NTS). Dimensions are inferred from context only.',
    })
  }

  // Dimension extraction
  const extractedDimensions = normalizeDimensionStrings(textSources, 'blueprint-text')

  if (extractedDimensions.length === 0) {
    warnings.push({
      code: 'NO_DIMENSIONS_FOUND',
      message:
        'No dimension strings found in blueprint text. Using deterministic fallback measured space.',
    })
  } else if (extractedDimensions.length < 4) {
    warnings.push({
      code: 'PARTIAL_DIMENSIONS',
      message: `Only ${extractedDimensions.length} dimension(s) found. Footprint may not be precise.`,
      field: 'footprint',
    })
  }

  // Footprint and rooms
  const { footprint, scaleSource, confidence } = inferFootprintFromBlueprintMetadata(input)
  const rooms = inferRoomZonesFromFootprint(footprint, normalized)

  // Vertical dimensions — honour overrides, else use standard residential defaults
  const wallHeightFt = input.knownWallHeightFt ?? 9
  const slabThicknessIn = input.knownSlabThicknessIn ?? 4
  const ceilingHeightFt = input.knownCeilingHeightFt ?? 9

  const isFallback = scaleSource === 'default' && extractedDimensions.length === 0
  const dimSource = input.knownWallHeightFt ? 'user' : isFallback ? 'fallback' : 'default'
  const dimConf = input.knownWallHeightFt ? 1.0 : isFallback ? 0.1 : 0.5

  if (isFallback) {
    warnings.push({
      code: 'FALLBACK_USED',
      message:
        'Could not extract exact dimensions. Using deterministic fallback: ' +
        '40 ft × 30 ft layout with standard residential zones.',
    })
  }

  const now = new Date().toISOString()
  const space: BuildingSpace = {
    footprint,
    rooms,
    levels: 1,
    scale: {
      pixelsPerUnit: scaleInfo && !scaleInfo.isNTS ? scaleInfo.feetPerPaperInch : 1,
      unit: 'ft',
      source: scaleSource,
    },
    wallHeight: createMeasurement(wallHeightFt, 'ft', dimSource, dimConf),
    slabThickness: createMeasurement(slabThicknessIn, 'in', dimSource, dimConf),
    ceilingHeight: createMeasurement(ceilingHeightFt, 'ft', dimSource, dimConf),
    metadata: {
      createdAt: now,
      updatedAt: now,
      confidence,
      notes: isFallback
        ? `Fallback dimensions — generated from blueprint context: ` +
          `${normalized.blueprintTitle} (${normalized.projectName}).`
        : `Extracted from blueprint: ${normalized.blueprintTitle} (${normalized.projectName}). ` +
          `Scale source: ${scaleSource}.`,
    },
  }

  return {
    space,
    extractedDimensions,
    scaleInfo,
    warnings,
    isFallback,
    confidence,
    metadata: {
      extractedFrom,
      processedAt,
      inputProjectName: normalized.projectName,
      inputBlueprintTitle: normalized.blueprintTitle,
    },
  }
}
