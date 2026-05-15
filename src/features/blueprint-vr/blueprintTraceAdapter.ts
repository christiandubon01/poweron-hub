/**
 * src/features/blueprint-vr/blueprintTraceAdapter.ts
 *
 * Adapter that converts an upstream PDF trace payload (vector lines, polylines,
 * dimension labels) into the structured candidate sets the Blueprint plan
 * scanner consumes.
 *
 * The adapter is deterministic and pure. It does NOT call OCR, AI services, or
 * external rendering. When the upstream payload is empty or missing, the
 * adapter returns empty candidate arrays — the scanner is responsible for the
 * deterministic fallback in that case.
 *
 * Today the adapter mostly normalises shapes and applies very simple
 * orthogonal-line heuristics. As real vector extraction comes online (PDF.js
 * operator walking, drawing-layer separation) this module is the seam where it
 * lands without changing the scanner contract.
 */

import type {
  PdfTraceArc,
  PdfTraceLine,
  PdfTracePayload,
  PdfTracePoint,
  PdfTracePolyline,
  PdfTraceRect,
  PdfTraceScaleHint,
  PdfTraceTextRun,
  WorldPoint2D,
} from './pdfTraceTypes'

// ---------------------------------------------------------------------------
// Candidate types emitted by the adapter
// ---------------------------------------------------------------------------

/**
 * A line normalised into world feet and classified as a candidate plan trace.
 *
 * The scanner uses these candidates to infer footprint, walls, openings, and
 * rooms.
 */
export interface PlanTraceLine {
  id: string
  start: WorldPoint2D
  end: WorldPoint2D
  /** Real-world length in feet. */
  lengthFt: number
  /** Approximate angle in degrees (0 = along +X). Wrapped to [0,180). */
  angleDeg: number
  /** Whether the line is essentially horizontal or vertical (orthogonal). */
  orthogonal: boolean
  /** Best-guess role for this line. */
  role:
    | 'unknown'
    | 'exterior-wall'
    | 'interior-wall'
    | 'door'
    | 'window'
    | 'dimension'
  /** Classification confidence, 0–1. */
  confidence: number
}

export type LineOrientation = 'horizontal' | 'vertical' | 'angled'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORTHO_TOLERANCE_DEG = 7
const NEAR_ORTHO_TOLERANCE_DEG = 12

function normaliseAngle(deg: number): number {
  let a = deg % 180
  if (a < 0) a += 180
  return a
}

function angleBetween(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  return normaliseAngle((Math.atan2(dy, dx) * 180) / Math.PI)
}

function isOrthogonal(angleDeg: number): boolean {
  const a = normaliseAngle(angleDeg)
  return (
    a <= ORTHO_TOLERANCE_DEG ||
    Math.abs(a - 90) <= ORTHO_TOLERANCE_DEG ||
    a >= 180 - ORTHO_TOLERANCE_DEG
  )
}

function isNearOrthogonal(angleDeg: number): boolean {
  const a = normaliseAngle(angleDeg)
  return (
    a <= NEAR_ORTHO_TOLERANCE_DEG ||
    Math.abs(a - 90) <= NEAR_ORTHO_TOLERANCE_DEG ||
    a >= 180 - NEAR_ORTHO_TOLERANCE_DEG
  )
}

function pdfToWorld(px: number, py: number, scale: PdfTraceScaleHint): WorldPoint2D {
  const factor = scale.pixelsPerFoot > 0 ? 1 / scale.pixelsPerFoot : 1
  return { x: px * factor, y: py * factor }
}

function midpoint(a: WorldPoint2D, b: WorldPoint2D): WorldPoint2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function lineLength(a: WorldPoint2D, b: WorldPoint2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

// ---------------------------------------------------------------------------
// Main conversion
// ---------------------------------------------------------------------------

export interface AdaptedTraceStats {
  adaptedRawSegments: number
  adaptedMergedTraceLines: number
  adapterDroppedTiny: number
  adapterDroppedInvalid: number
  adapterDroppedNonWallLike: number
  adapterPolylineSegments: number
  adapterRectEdgeSegments: number
}

export interface AdaptedTrace {
  lines: PlanTraceLine[]
  scale: PdfTraceScaleHint | null
  stats?: AdaptedTraceStats
}

/**
 * Convert a PDF trace payload into world-coordinate plan candidate lines.
 *
 * @param payload Optional upstream trace payload. When null/undefined or empty,
 *   the adapter returns an empty candidate set.
 */
export function adaptPdfTraceToPlanLines(
  payload: PdfTracePayload | null | undefined,
): AdaptedTrace {
  const emptyStats: AdaptedTraceStats = {
    adaptedRawSegments: 0,
    adaptedMergedTraceLines: 0,
    adapterDroppedTiny: 0,
    adapterDroppedInvalid: 0,
    adapterDroppedNonWallLike: 0,
    adapterPolylineSegments: 0,
    adapterRectEdgeSegments: 0,
  }
  if (!payload) {
    return { lines: [], scale: null, stats: emptyStats }
  }

  const rectEdgeSegments = Array.isArray(payload.rects) ? payload.rects.length * 4 : 0
  const polylineLines: PdfTraceLine[] = []
  if (Array.isArray(payload.polylines)) {
    payload.polylines.forEach((poly: PdfTracePolyline, polyIdx: number) => {
      for (let i = 0; i + 1 < poly.points.length; i++) {
        polylineLines.push({
          id: `${poly.id}-seg-${i}`,
          start: poly.points[i],
          end: poly.points[i + 1],
          role: poly.role ?? 'unknown',
          confidence: poly.confidence ?? 0.5,
          pageIndex: payload.pageNumber - 1,
          layer: `polyline-${polyIdx}`,
        })
      }
      if (poly.closed && poly.points.length > 1) {
        polylineLines.push({
          id: `${poly.id}-seg-close`,
          start: poly.points[poly.points.length - 1],
          end: poly.points[0],
          role: poly.role ?? 'unknown',
          confidence: poly.confidence ?? 0.5,
          pageIndex: payload.pageNumber - 1,
          layer: `polyline-${polyIdx}`,
        })
      }
    })
  }

  const sourceLines = normalizeTraceLines(payload)
  const adaptedRawSegments = sourceLines.length + polylineLines.length

  if (adaptedRawSegments === 0) {
    return {
      lines: [],
      scale: inferScaleFromTraceText(payload.textRuns || []),
      stats: { ...emptyStats, adapterRectEdgeSegments: rectEdgeSegments },
    }
  }

  const bestScale =
    inferScaleFromTraceText(payload.textRuns || []) ||
    payload.scaleHints?.find((h) => h.pixelsPerFoot > 0) ||
    null
  const scale: PdfTraceScaleHint =
    bestScale && bestScale.pixelsPerFoot > 0
      ? bestScale
      : { pixelsPerFoot: 1, confidence: 0.1, source: 'default' }

  const allLines = [...sourceLines, ...polylineLines]

  const out: PlanTraceLine[] = []
  let adapterDroppedTiny = 0
  let adapterDroppedInvalid = 0
  for (const line of allLines) {
    if (!line?.start || !line?.end) {
      adapterDroppedInvalid += 1
      continue
    }
    const a = pdfToWorld(line.start.x, line.start.y, scale)
    const b = pdfToWorld(line.end.x, line.end.y, scale)
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthFt = Math.hypot(dx, dy)

    if (!Number.isFinite(lengthFt) || lengthFt < 0.2) {
      adapterDroppedInvalid += 1
      continue
    }
    if (lengthFt < 0.35) {
      adapterDroppedTiny += 1
      continue
    }

    const angle = angleBetween(a.x, a.y, b.x, b.y)
    const ortho = isOrthogonal(angle)
    const nearOrtho = isNearOrthogonal(angle)
    const treatAsOrtho = ortho || (nearOrtho && lengthFt >= 1.2)

    let role: PlanTraceLine['role'] = 'unknown'
    if (line.role === 'exterior-wall' || line.role === 'interior-wall' ||
        line.role === 'door' || line.role === 'window' ||
        line.role === 'dimension') {
      role = line.role
    } else if (treatAsOrtho && lengthFt >= 6) {
      role = 'exterior-wall'
    } else if (treatAsOrtho && lengthFt >= 1.5) {
      role = 'interior-wall'
    }

    out.push({
      id: line.id,
      start: a,
      end: b,
      lengthFt,
      angleDeg: angle,
      orthogonal: treatAsOrtho,
      role,
      confidence: line.confidence ?? (treatAsOrtho ? 0.5 : 0.3),
    })
  }

  const { lines: filtered, droppedNonWallLike } = filterNoiseLinesWithStats(out)
  const merged = mergeCollinearSegments(filtered)
  return {
    lines: merged,
    scale,
    stats: {
      adaptedRawSegments,
      adaptedMergedTraceLines: merged.length,
      adapterDroppedTiny,
      adapterDroppedInvalid,
      adapterDroppedNonWallLike: droppedNonWallLike,
      adapterPolylineSegments: polylineLines.length,
      adapterRectEdgeSegments: rectEdgeSegments,
    },
  }
}

export function normalizeTraceLines(payload: PdfTracePayload | null | undefined): PdfTraceLine[] {
  if (!payload) return []
  const lines: PdfTraceLine[] = []
  if (Array.isArray(payload.lines)) lines.push(...payload.lines)
  if (Array.isArray(payload.rects)) {
    payload.rects.forEach((r) => {
      const x1 = r.x
      const y1 = r.y
      const x2 = r.x + r.width
      const y2 = r.y + r.height
      lines.push(
        { id: `${r.id}-t`, start: { x: x1, y: y1 }, end: { x: x2, y: y1 }, role: r.role, confidence: r.confidence },
        { id: `${r.id}-r`, start: { x: x2, y: y1 }, end: { x: x2, y: y2 }, role: r.role, confidence: r.confidence },
        { id: `${r.id}-b`, start: { x: x2, y: y2 }, end: { x: x1, y: y2 }, role: r.role, confidence: r.confidence },
        { id: `${r.id}-l`, start: { x: x1, y: y2 }, end: { x: x1, y: y1 }, role: r.role, confidence: r.confidence },
      )
    })
  }
  return lines
}

export function classifyLineOrientation(line: PlanTraceLine): LineOrientation {
  if (!line.orthogonal) return 'angled'
  const dx = Math.abs(line.end.x - line.start.x)
  const dy = Math.abs(line.end.y - line.start.y)
  if (dx >= dy) return 'horizontal'
  return 'vertical'
}

export function filterNoiseLines(lines: PlanTraceLine[]): PlanTraceLine[] {
  return filterNoiseLinesWithStats(lines).lines
}

export function filterNoiseLinesWithStats(lines: PlanTraceLine[]): {
  lines: PlanTraceLine[]
  droppedNonWallLike: number
} {
  let droppedNonWallLike = 0
  const kept = lines.filter((line) => {
    if (line.lengthFt < 0.35) {
      droppedNonWallLike += 1
      return false
    }
    if (!line.orthogonal && line.lengthFt < 1.5) {
      droppedNonWallLike += 1
      return false
    }
    return true
  })
  return { lines: kept, droppedNonWallLike }
}

export function mergeCollinearSegments(lines: PlanTraceLine[]): PlanTraceLine[] {
  if (lines.length <= 1) return lines
  const horizontals = lines.filter((l) => classifyLineOrientation(l) === 'horizontal')
  const verticals = lines.filter((l) => classifyLineOrientation(l) === 'vertical')
  const angled = lines.filter((l) => classifyLineOrientation(l) === 'angled')

  const mergeAxis = (items: PlanTraceLine[], axis: 'x' | 'y'): PlanTraceLine[] => {
    const out: PlanTraceLine[] = []
    const used = new Set<string>()
    const tol = 0.25
    for (let i = 0; i < items.length; i += 1) {
      const base = items[i]
      if (used.has(base.id)) continue
      used.add(base.id)
      let a = { ...base.start }
      let b = { ...base.end }
      for (let j = i + 1; j < items.length; j += 1) {
        const candidate = items[j]
        if (used.has(candidate.id)) continue
        const sameLane =
          axis === 'x'
            ? Math.abs(base.start.y - candidate.start.y) <= tol && Math.abs(base.end.y - candidate.end.y) <= tol
            : Math.abs(base.start.x - candidate.start.x) <= tol && Math.abs(base.end.x - candidate.end.x) <= tol
        if (!sameLane) continue
        const baseMin = axis === 'x' ? Math.min(a.x, b.x) : Math.min(a.y, b.y)
        const baseMax = axis === 'x' ? Math.max(a.x, b.x) : Math.max(a.y, b.y)
        const candMin = axis === 'x' ? Math.min(candidate.start.x, candidate.end.x) : Math.min(candidate.start.y, candidate.end.y)
        const candMax = axis === 'x' ? Math.max(candidate.start.x, candidate.end.x) : Math.max(candidate.start.y, candidate.end.y)
        if (candMin > baseMax + 0.5 || baseMin > candMax + 0.5) continue
        if (axis === 'x') {
          a = { x: Math.min(baseMin, candMin), y: a.y }
          b = { x: Math.max(baseMax, candMax), y: b.y }
        } else {
          a = { x: a.x, y: Math.min(baseMin, candMin) }
          b = { x: b.x, y: Math.max(baseMax, candMax) }
        }
        used.add(candidate.id)
      }
      out.push({
        ...base,
        id: `merged-${base.id}`,
        start: a,
        end: b,
        lengthFt: lineLength(a, b),
      })
    }
    return out
  }

  return [...mergeAxis(horizontals, 'x'), ...mergeAxis(verticals, 'y'), ...angled]
}

export function detectDoubleLineWalls(lines: PlanTraceLine[]): Array<{ primary: PlanTraceLine; secondary: PlanTraceLine }> {
  const pairs: Array<{ primary: PlanTraceLine; secondary: PlanTraceLine }> = []
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const a = lines[i]
      const b = lines[j]
      const oa = classifyLineOrientation(a)
      const ob = classifyLineOrientation(b)
      if (oa !== ob || oa === 'angled') continue
      const midA = midpoint(a.start, a.end)
      const midB = midpoint(b.start, b.end)
      const offset = oa === 'horizontal' ? Math.abs(midA.y - midB.y) : Math.abs(midA.x - midB.x)
      const overlap =
        oa === 'horizontal'
          ? Math.min(Math.max(a.start.x, a.end.x), Math.max(b.start.x, b.end.x)) - Math.max(Math.min(a.start.x, a.end.x), Math.min(b.start.x, b.end.x))
          : Math.min(Math.max(a.start.y, a.end.y), Math.max(b.start.y, b.end.y)) - Math.max(Math.min(a.start.y, a.end.y), Math.min(b.start.y, b.end.y))
      if (offset >= 0.18 && offset <= 0.85 && overlap > 1.5) {
        pairs.push({ primary: a, secondary: b })
      }
    }
  }
  return pairs
}

export function detectOuterFootprint(lines: PlanTraceLine[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!lines.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const line of lines) {
    minX = Math.min(minX, line.start.x, line.end.x)
    minY = Math.min(minY, line.start.y, line.end.y)
    maxX = Math.max(maxX, line.start.x, line.end.x)
    maxY = Math.max(maxY, line.start.y, line.end.y)
  }
  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null
  return { minX, minY, maxX, maxY }
}

export function inferWallCandidatesFromTrace(lines: PlanTraceLine[]): PlanTraceLine[] {
  const normalized = mergeCollinearSegments(filterNoiseLines(lines))
  const doubleWalls = detectDoubleLineWalls(normalized)
  const tagged = normalized.map((line) => ({ ...line }))
  for (const pair of doubleWalls) {
    tagged.forEach((line) => {
      if (line.id === pair.primary.id || line.id === pair.secondary.id) {
        line.role = line.role === 'unknown' ? 'interior-wall' : line.role
        line.confidence = Math.max(line.confidence, 0.7)
      }
    })
  }
  return tagged.filter((line) => line.role === 'exterior-wall' || line.role === 'interior-wall' || (line.orthogonal && line.lengthFt >= 3))
}

export function inferOpeningCandidatesFromGaps(
  walls: PlanTraceLine[],
  lines: PlanTraceLine[],
): Array<{ wallId: string; center: WorldPoint2D; widthFt: number; type: 'door' | 'window'; confidence: number }> {
  if (!walls.length || !lines.length) return []
  const candidates: Array<{ wallId: string; center: WorldPoint2D; widthFt: number; type: 'door' | 'window'; confidence: number }> = []
  for (const line of lines) {
    if (line.role !== 'door' && line.role !== 'window') continue
    const c = midpoint(line.start, line.end)
    let bestWall: PlanTraceLine | null = null
    let bestDistance = Infinity
    for (const wall of walls) {
      const wc = midpoint(wall.start, wall.end)
      const d = lineLength(c, wc)
      if (d < bestDistance) {
        bestDistance = d
        bestWall = wall
      }
    }
    if (!bestWall) continue
    candidates.push({
      wallId: bestWall.id,
      center: c,
      widthFt: Math.max(2, Math.min(8, line.lengthFt)),
      type: line.role === 'window' ? 'window' : 'door',
      confidence: Math.max(0.45, line.confidence),
    })
  }
  return candidates
}

export function inferDoorCandidatesFromArcs(
  arcs: PdfTraceArc[],
  textRuns: PdfTraceTextRun[],
): Array<{ center: WorldPoint2D; radius: number; confidence: number }> {
  if (!Array.isArray(arcs) || arcs.length === 0) return []
  const text = (textRuns || []).map((t) => t.text.toLowerCase()).join(' ')
  const doorTextBoost = text.includes('door') ? 0.1 : 0
  return arcs
    .filter((arc) => Math.abs((arc.endAngleDeg || 0) - (arc.startAngleDeg || 0)) >= 50)
    .map((arc) => ({
      center: { x: arc.center.x, y: arc.center.y },
      radius: arc.radius,
      confidence: Math.min(0.9, Math.max(0.45, (arc.confidence || 0.5) + doorTextBoost)),
    }))
}

export function inferGlassStorefrontCandidates(
  lines: PlanTraceLine[],
  textRuns: PdfTraceTextRun[],
): Array<{ lineId: string; confidence: number }> {
  const combined = (textRuns || []).map((t) => t.text.toLowerCase()).join(' ')
  const hasStorefrontSignal =
    combined.includes('storefront') || combined.includes('glazing') || combined.includes('glass')
  if (!hasStorefrontSignal) return []
  return lines
    .filter((line) => classifyLineOrientation(line) === 'horizontal')
    .sort((a, b) => b.lengthFt - a.lengthFt)
    .slice(0, 3)
    .map((line) => ({ lineId: line.id, confidence: Math.max(0.5, line.confidence) }))
}

export function inferDimensionCandidatesFromText(
  textRuns: PdfTraceTextRun[],
): Array<{ text: string; feet: number; confidence: number }> {
  const out: Array<{ text: string; feet: number; confidence: number }> = []
  const patterns = [
    /(\d+)\s*'\s*[-]?\s*(\d+)\s*"/,
    /(\d+(?:\.\d+)?)\s*ft/i,
  ]
  for (const run of textRuns || []) {
    const t = run.text.trim()
    let feet = 0
    const a = t.match(patterns[0])
    if (a) {
      feet = Number(a[1]) + Number(a[2]) / 12
    } else {
      const b = t.match(patterns[1])
      if (b) feet = Number(b[1])
    }
    if (feet > 0.5) {
      out.push({ text: t, feet, confidence: run.confidence || 0.55 })
    }
  }
  return out
}

export function inferScaleFromTraceText(textRuns: PdfTraceTextRun[]): PdfTraceScaleHint | null {
  const combined = (textRuns || []).map((t) => t.text).join(' ')
  const m = combined.match(/(\d+)\s*\/\s*(\d+)\s*"\s*=\s*(\d+)\s*'-?0?"/i)
  if (!m) return null
  const num = Number(m[1])
  const den = Number(m[2])
  const feet = Number(m[3])
  if (!num || !den || !feet) return null
  const inches = num / den
  if (inches <= 0) return null
  return {
    pixelsPerFoot: 1 / inches,
    confidence: 0.55,
    source: 'trace-text',
    raw: m[0],
  }
}

// ---------------------------------------------------------------------------
// Wave 2 — PDF-space sheet artifact filtering (canonical wall-plan traces)
// ---------------------------------------------------------------------------

export interface PdfTraceWallSanitizeStats {
  removedPageFrameRects: number
  removedMarginEdgeLines: number
  removedTitleBlockShortLines: number
  removedShortTicks: number
}

function clonePayloadShell(payload: PdfTracePayload): PdfTracePayload {
  return {
    ...payload,
    lines: [...(payload.lines || [])],
    rects: [...(payload.rects || [])],
    polylines: [...(payload.polylines || [])],
    arcs: [...(payload.arcs || [])],
    textRuns: [...(payload.textRuns || [])],
    scaleHints: [...(payload.scaleHints || [])],
    warnings: [...(payload.warnings || [])],
  }
}

function isInTitleBlockPdfRegion(p: PdfTracePoint, W: number, H: number): boolean {
  const x = p.x
  const y = p.y
  const lowerRight = x > W * 0.66 && y > H * 0.55
  const lowerLeft = x < W * 0.2 && y > H * 0.48
  return lowerRight || lowerLeft
}

function nearPdfPageEdge(p: PdfTracePoint, W: number, H: number, margin: number): boolean {
  return p.x <= margin || p.x >= W - margin || p.y <= margin || p.y >= H - margin
}

function segmentPdfLength(a: PdfTracePoint, b: PdfTracePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function isLikelyPageFrameRect(r: PdfTraceRect, W: number, H: number, margin: number): boolean {
  if (r.width <= 0 || r.height <= 0) return false
  const nearSheetEdge =
    r.x <= margin * 2 &&
    r.y <= margin * 2 &&
    r.x + r.width >= W - margin * 2 &&
    r.y + r.height >= H - margin * 2
  const coversMostOfSheet = r.width >= W * 0.94 && r.height >= H * 0.94
  return nearSheetEdge && coversMostOfSheet
}

/**
 * Remove sheet border, oversized page frame rectangles, title-block clutter,
 * and very short ticks before vector→world adaptation for wall extraction.
 */
export function filterPdfTracePayloadForWallExtraction(
  payload: PdfTracePayload | null | undefined,
): { payload: PdfTracePayload | null; stats: PdfTraceWallSanitizeStats } {
  const emptyStats: PdfTraceWallSanitizeStats = {
    removedPageFrameRects: 0,
    removedMarginEdgeLines: 0,
    removedTitleBlockShortLines: 0,
    removedShortTicks: 0,
  }
  if (!payload) return { payload: null, stats: emptyStats }
  const W = Math.max(1, Number(payload.pageBounds?.width) || 1)
  const H = Math.max(1, Number(payload.pageBounds?.height) || 1)
  const margin = Math.max(6, Math.min(W, H) * 0.014)
  const diag = Math.hypot(W, H)
  const out = clonePayloadShell(payload)
  const stats: PdfTraceWallSanitizeStats = { ...emptyStats }

  const keptRects: PdfTraceRect[] = []
  for (const r of out.rects || []) {
    if (isLikelyPageFrameRect(r, W, H, margin)) {
      stats.removedPageFrameRects += 1
      continue
    }
    keptRects.push(r)
  }
  out.rects = keptRects

  const filterLine = (line: PdfTraceLine): boolean => {
    const len = segmentPdfLength(line.start, line.end)
    const mid = { x: (line.start.x + line.end.x) / 2, y: (line.start.y + line.end.y) / 2 }
    const edgeA = nearPdfPageEdge(line.start, W, H, margin)
    const edgeB = nearPdfPageEdge(line.end, W, H, margin)
    if (len < diag * 0.006) {
      stats.removedShortTicks += 1
      return false
    }
    if (edgeA && edgeB && len >= Math.min(W, H) * 0.9) {
      stats.removedMarginEdgeLines += 1
      return false
    }
    if (isInTitleBlockPdfRegion(mid, W, H) && len < diag * 0.14) {
      stats.removedTitleBlockShortLines += 1
      return false
    }
    return true
  }

  out.lines = (out.lines || []).filter(filterLine)

  out.polylines = [...(out.polylines || [])]

  return { payload: out, stats }
}

/**
 * Page bounds in the same world units as {@link PlanTraceLine} (feet-like trace space).
 */
export function computeWorldPageBoundsFromPayload(
  payload: PdfTracePayload | null | undefined,
  scale: PdfTraceScaleHint | null,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!payload?.pageBounds) return null
  const s =
    scale && scale.pixelsPerFoot > 0
      ? scale
      : { pixelsPerFoot: 1, confidence: 0.1, source: 'default' as const }
  const factor = s.pixelsPerFoot > 0 ? 1 / s.pixelsPerFoot : 1
  const maxX = payload.pageBounds.width * factor
  const maxY = payload.pageBounds.height * factor
  return { minX: 0, minY: 0, maxX, maxY: maxY }
}

/**
 * Drop segments that still hug the physical sheet edge in world units (bleed/frame).
 */
// ---------------------------------------------------------------------------
// Wave 2B — plan-core detection + wall-network filtering (world units)
// ---------------------------------------------------------------------------

export interface PlanCoreBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface WallNetworkFilterStats {
  wallCandidatesRaw: number
  wallCandidatesAfterFrameFilter: number
  wallCandidatesAfterTitleBlockFilter: number
  wallCandidatesAfterNoiseFilter: number
  /** Final segments accepted into the wall network (same as finalWallNetworkSegments). */
  wallCandidatesFiltered: number
  detectedPlanCoreBounds: PlanCoreBounds | null
  removedFrameSegments: number
  removedTitleBlockSegments: number
  removedAnnotationNoiseSegments: number
  removedFurnitureNoiseSegments: number
  finalWallNetworkSegments: number
}

const WALL_NETWORK_SCORE_THRESHOLD = 0.38
const ENDPOINT_SNAP_FT = 0.42

function traceLineMidpoint(line: PlanTraceLine): WorldPoint2D {
  return { x: (line.start.x + line.end.x) / 2, y: (line.start.y + line.end.y) / 2 }
}

function pointInBounds(p: WorldPoint2D, b: PlanCoreBounds, pad = 0): boolean {
  return p.x >= b.minX - pad && p.x <= b.maxX + pad && p.y >= b.minY - pad && p.y <= b.maxY + pad
}

function segmentMidpointInsideBounds(line: PlanTraceLine, b: PlanCoreBounds, pad = 0): boolean {
  return pointInBounds(traceLineMidpoint(line), b, pad)
}

/**
 * Locate the dense orthogonal wall cluster (tenant suite / floor plan core)
 * without assuming the plan is centered on the sheet.
 */
export function detectPlanCoreBounds(
  lines: PlanTraceLine[],
  page: { minX: number; minY: number; maxX: number; maxY: number } | null,
): PlanCoreBounds | null {
  if (lines.length < 4) return null
  const outer = detectOuterFootprint(lines)
  if (!outer) return null

  const pageMinX = page?.minX ?? outer.minX
  const pageMinY = page?.minY ?? outer.minY
  const pageMaxX = page?.maxX ?? outer.maxX
  const pageMaxY = page?.maxY ?? outer.maxY
  const pw = Math.max(1, pageMaxX - pageMinX)
  const ph = Math.max(1, pageMaxY - pageMinY)

  const cols = 28
  const rows = Math.max(18, Math.round(cols * (ph / pw)))
  const cellW = pw / cols
  const cellH = ph / rows
  const grid: number[] = new Array(cols * rows).fill(0)

  for (const line of lines) {
    if (!line.orthogonal && line.lengthFt < 3.5) continue
    const m = traceLineMidpoint(line)
    const cx = Math.min(cols - 1, Math.max(0, Math.floor((m.x - pageMinX) / cellW)))
    const cy = Math.min(rows - 1, Math.max(0, Math.floor((m.y - pageMinY) / cellH)))
    const w = line.orthogonal ? 1 + Math.min(2.5, line.lengthFt / 12) : 0.35
    grid[cy * cols + cx] += w
  }

  let peak = 0
  let peakIdx = 0
  for (let i = 0; i < grid.length; i += 1) {
    if (grid[i] > peak) {
      peak = grid[i]
      peakIdx = i
    }
  }
  if (peak < 1.2) {
    return {
      minX: outer.minX,
      minY: outer.minY,
      maxX: outer.maxX,
      maxY: outer.maxY,
    }
  }

  const threshold = peak * 0.28
  const visited = new Set<number>()
  const queue = [peakIdx]
  visited.add(peakIdx)
  let minCx = cols
  let maxCx = 0
  let minCy = rows
  let maxCy = 0

  while (queue.length > 0) {
    const idx = queue.shift()!
    const cx = idx % cols
    const cy = Math.floor(idx / cols)
    minCx = Math.min(minCx, cx)
    maxCx = Math.max(maxCx, cx)
    minCy = Math.min(minCy, cy)
    maxCy = Math.max(maxCy, cy)
    const neighbors = [
      idx - 1,
      idx + 1,
      idx - cols,
      idx + cols,
    ]
    for (const n of neighbors) {
      if (n < 0 || n >= grid.length) continue
      if (visited.has(n)) continue
      if (grid[n] < threshold) continue
      visited.add(n)
      queue.push(n)
    }
  }

  const padX = cellW * 1.4
  const padY = cellH * 1.4
  return {
    minX: pageMinX + minCx * cellW - padX,
    minY: pageMinY + minCy * cellH - padY,
    maxX: pageMinX + (maxCx + 1) * cellW + padX,
    maxY: pageMinY + (maxCy + 1) * cellH + padY,
  }
}

function isLikelySheetFrameLine(
  line: PlanTraceLine,
  page: { minX: number; minY: number; maxX: number; maxY: number },
  core: PlanCoreBounds | null,
): boolean {
  const pw = page.maxX - page.minX
  const ph = page.maxY - page.minY
  if (pw < 2 || ph < 2) return false
  const margin = Math.max(0.45, Math.min(pw, ph) * 0.014)
  const nearEdge = (p: WorldPoint2D) =>
    p.x <= page.minX + margin ||
    p.x >= page.maxX - margin ||
    p.y <= page.minY + margin ||
    p.y >= page.maxY - margin
  const edgeA = nearEdge(line.start)
  const edgeB = nearEdge(line.end)
  if (!edgeA || !edgeB) return false
  const orient = classifyLineOrientation(line)
  const span =
    orient === 'horizontal'
      ? Math.abs(line.end.x - line.start.x)
      : orient === 'vertical'
        ? Math.abs(line.end.y - line.start.y)
        : line.lengthFt
  const pageSpan = orient === 'horizontal' ? pw : orient === 'vertical' ? ph : Math.min(pw, ph)
  if (span < pageSpan * 0.72) return false
  if (core && segmentMidpointInsideBounds(line, core, Math.min(pw, ph) * 0.06)) return false
  return true
}

function isInTitleBlockHeuristicRegion(
  p: WorldPoint2D,
  page: { minX: number; minY: number; maxX: number; maxY: number },
  core: PlanCoreBounds | null,
): boolean {
  const pw = page.maxX - page.minX
  const ph = page.maxY - page.minY
  const nx = (p.x - page.minX) / pw
  const ny = (p.y - page.minY) / ph
  const rightStrip = nx > 0.62 && ny > 0.08 && ny < 0.92
  const bottomStrip = ny > 0.78 && nx > 0.08
  const farRightCorner = nx > 0.72 && ny > 0.52
  if (!rightStrip && !bottomStrip && !farRightCorner) return false
  if (core && pointInBounds(p, core, Math.min(pw, ph) * 0.04)) return false
  return true
}

function countParallelNeighbors(
  line: PlanTraceLine,
  lines: PlanTraceLine[],
  maxOffset: number,
): number {
  const orient = classifyLineOrientation(line)
  if (orient === 'angled') return 0
  const mid = traceLineMidpoint(line)
  let count = 0
  for (const other of lines) {
    if (other.id === line.id) continue
    if (classifyLineOrientation(other) !== orient) continue
    if (other.lengthFt > line.lengthFt * 1.8) continue
    const om = traceLineMidpoint(other)
    const offset =
      orient === 'horizontal' ? Math.abs(mid.y - om.y) : Math.abs(mid.x - om.x)
    if (offset > 0.04 && offset <= maxOffset) count += 1
  }
  return count
}

function isLikelyHatchOrDetailNoise(line: PlanTraceLine, pool: PlanTraceLine[]): boolean {
  if (!line.orthogonal) return false
  if (line.lengthFt >= 5.5) return false
  const parallel = countParallelNeighbors(line, pool, 0.22)
  if (parallel >= 4 && line.lengthFt < 4.5) return true
  if (parallel >= 7) return true
  return false
}

function isLikelyAnnotationLeader(line: PlanTraceLine, core: PlanCoreBounds | null): boolean {
  if (line.orthogonal) return false
  if (line.lengthFt >= 9) return false
  const a = line.angleDeg
  const diag = a > 18 && a < 72
  if (!diag) return line.lengthFt < 2.2
  if (core && segmentMidpointInsideBounds(line, core, 0)) return false
  return line.lengthFt < 7.5
}

function isLikelyFurnitureSymbol(line: PlanTraceLine, pool: PlanTraceLine[]): boolean {
  if (line.lengthFt > 6.5) return false
  if (!line.orthogonal) {
    return line.lengthFt < 2.8 && countParallelNeighbors(line, pool, 0.35) === 0
  }
  const mid = traceLineMidpoint(line)
  let nearbyShort = 0
  for (const other of pool) {
    if (other.id === line.id) continue
    if (other.lengthFt > 5.5) continue
    const om = traceLineMidpoint(other)
    if (Math.hypot(mid.x - om.x, mid.y - om.y) < 2.2) nearbyShort += 1
  }
  return nearbyShort >= 5 && line.lengthFt < 4.2
}

function scoreWallCandidate(
  line: PlanTraceLine,
  core: PlanCoreBounds | null,
  page: { minX: number; minY: number; maxX: number; maxY: number } | null,
  endpointDegree: number,
): number {
  let score = 0.12
  const lenScore = Math.min(1, line.lengthFt / 28)
  score += lenScore * 0.28
  if (line.orthogonal) score += 0.22
  else if (line.lengthFt >= 6) score += 0.06
  else score -= 0.18

  const conn = Math.min(1, endpointDegree / 4)
  score += conn * 0.26

  if (core) {
    const mid = traceLineMidpoint(line)
    const cw = core.maxX - core.minX
    const ch = core.maxY - core.minY
    const dx = Math.abs(mid.x - (core.minX + cw / 2)) / Math.max(1, cw / 2)
    const dy = Math.abs(mid.y - (core.minY + ch / 2)) / Math.max(1, ch / 2)
    const coreProx = 1 - Math.min(1, Math.hypot(dx, dy))
    score += coreProx * 0.18
    if (!segmentMidpointInsideBounds(line, core, Math.min(cw, ch) * 0.12)) {
      score -= 0.14
    }
  }

  if (page && isInTitleBlockHeuristicRegion(traceLineMidpoint(line), page, core)) {
    score -= 0.35
  }

  if (line.role === 'exterior-wall') score += 0.12
  else if (line.role === 'interior-wall') score += 0.08

  return Math.max(0, Math.min(1, score))
}

function buildEndpointDegree(lines: PlanTraceLine[]): Map<string, number> {
  const points: WorldPoint2D[] = []
  for (const line of lines) {
    points.push(line.start, line.end)
  }
  const degree = new Map<string, number>()
  for (const line of lines) {
    let d = 0
    for (const p of [line.start, line.end]) {
      for (const other of lines) {
        if (other.id === line.id) continue
        const hits =
          Math.hypot(p.x - other.start.x, p.y - other.start.y) <= ENDPOINT_SNAP_FT ||
          Math.hypot(p.x - other.end.x, p.y - other.end.y) <= ENDPOINT_SNAP_FT
        if (hits) {
          d += 1
          break
        }
      }
    }
    degree.set(line.id, d)
  }
  return degree
}

function keepLargestConnectedWallNetwork(
  lines: PlanTraceLine[],
  scores: Map<string, number>,
): PlanTraceLine[] {
  if (lines.length <= 2) return lines
  const byId = new Map(lines.map((l) => [l.id, l]))
  const adj = new Map<string, Set<string>>()
  for (const line of lines) adj.set(line.id, new Set())

  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const a = lines[i]
      const b = lines[j]
      const connected =
        Math.hypot(a.start.x - b.start.x, a.start.y - b.start.y) <= ENDPOINT_SNAP_FT ||
        Math.hypot(a.start.x - b.end.x, a.start.y - b.end.y) <= ENDPOINT_SNAP_FT ||
        Math.hypot(a.end.x - b.start.x, a.end.y - b.start.y) <= ENDPOINT_SNAP_FT ||
        Math.hypot(a.end.x - b.end.x, a.end.y - b.end.y) <= ENDPOINT_SNAP_FT
      if (!connected) continue
      adj.get(a.id)!.add(b.id)
      adj.get(b.id)!.add(a.id)
    }
  }

  const visited = new Set<string>()
  let best: string[] = []
  for (const line of lines) {
    if (visited.has(line.id)) continue
    const stack = [line.id]
    const comp: string[] = []
    visited.add(line.id)
    while (stack.length > 0) {
      const id = stack.pop()!
      comp.push(id)
      for (const nb of adj.get(id) || []) {
        if (visited.has(nb)) continue
        visited.add(nb)
        stack.push(nb)
      }
    }
    if (comp.length > best.length) best = comp
  }

  const coreIds = new Set(best)
  const out: PlanTraceLine[] = []
  for (const id of coreIds) {
    const line = byId.get(id)
    if (line) out.push(line)
  }

  for (const line of lines) {
    if (coreIds.has(line.id)) continue
    const s = scores.get(line.id) ?? 0
    if (s >= WALL_NETWORK_SCORE_THRESHOLD + 0.12 && line.lengthFt >= 5.5 && line.orthogonal) {
      out.push(line)
    }
  }
  return out
}

/**
 * Progressive wall-only filter: sheet frame → title block → hatch/leaders →
 * scored wall network connected to the detected plan core.
 */
export function filterWallCandidatesToWallNetwork(
  lines: PlanTraceLine[],
  page: { minX: number; minY: number; maxX: number; maxY: number } | null,
): { lines: PlanTraceLine[]; stats: WallNetworkFilterStats } {
  const wallCandidatesRaw = lines.length
  const emptyStats = (): WallNetworkFilterStats => ({
    wallCandidatesRaw,
    wallCandidatesAfterFrameFilter: 0,
    wallCandidatesAfterTitleBlockFilter: 0,
    wallCandidatesAfterNoiseFilter: 0,
    wallCandidatesFiltered: 0,
    detectedPlanCoreBounds: null,
    removedFrameSegments: 0,
    removedTitleBlockSegments: 0,
    removedAnnotationNoiseSegments: 0,
    removedFurnitureNoiseSegments: 0,
    finalWallNetworkSegments: 0,
  })

  if (lines.length === 0) {
    return { lines: [], stats: emptyStats() }
  }

  const core = detectPlanCoreBounds(lines, page)
  let pool = [...lines]
  let removedFrameSegments = 0

  if (page) {
    const afterFrame: PlanTraceLine[] = []
    for (const line of pool) {
      if (isLikelySheetFrameLine(line, page, core)) {
        removedFrameSegments += 1
        continue
      }
      afterFrame.push(line)
    }
    pool = afterFrame
  }
  const wallCandidatesAfterFrameFilter = pool.length

  let removedTitleBlockSegments = 0
  if (page) {
    const afterTitle: PlanTraceLine[] = []
    for (const line of pool) {
      const mid = traceLineMidpoint(line)
      const inTitle = isInTitleBlockHeuristicRegion(mid, page, core)
      if (inTitle && line.lengthFt < 8.5) {
        removedTitleBlockSegments += 1
        continue
      }
      afterTitle.push(line)
    }
    pool = afterTitle
  }
  const wallCandidatesAfterTitleBlockFilter = pool.length

  let removedAnnotationNoiseSegments = 0
  let removedFurnitureNoiseSegments = 0
  const afterNoise: PlanTraceLine[] = []
  for (const line of pool) {
    if (isLikelyAnnotationLeader(line, core)) {
      removedAnnotationNoiseSegments += 1
      continue
    }
    if (isLikelyHatchOrDetailNoise(line, pool)) {
      removedAnnotationNoiseSegments += 1
      continue
    }
    if (isLikelyFurnitureSymbol(line, pool)) {
      removedFurnitureNoiseSegments += 1
      continue
    }
    if (!line.orthogonal && line.lengthFt < 4.5) {
      removedAnnotationNoiseSegments += 1
      continue
    }
    if (line.orthogonal && line.lengthFt < 1.15) {
      removedAnnotationNoiseSegments += 1
      continue
    }
    afterNoise.push(line)
  }
  pool = afterNoise
  const wallCandidatesAfterNoiseFilter = pool.length

  const endpointDegree = buildEndpointDegree(pool)
  const scores = new Map<string, number>()
  for (const line of pool) {
    scores.set(line.id, scoreWallCandidate(line, core, page, endpointDegree.get(line.id) ?? 0))
  }

  const scoredKeep = pool.filter((line) => {
    const s = scores.get(line.id) ?? 0
    if (s >= WALL_NETWORK_SCORE_THRESHOLD) return true
    if (line.orthogonal && line.lengthFt >= 7) {
      if (!core || segmentMidpointInsideBounds(line, core, 0)) return true
    }
    return false
  })

  const networked = keepLargestConnectedWallNetwork(scoredKeep, scores)
  const finalWallNetworkSegments = networked.length

  const stats: WallNetworkFilterStats = {
    wallCandidatesRaw,
    wallCandidatesAfterFrameFilter,
    wallCandidatesAfterTitleBlockFilter,
    wallCandidatesAfterNoiseFilter,
    wallCandidatesFiltered: finalWallNetworkSegments,
    detectedPlanCoreBounds: core,
    removedFrameSegments,
    removedTitleBlockSegments,
    removedAnnotationNoiseSegments,
    removedFurnitureNoiseSegments,
    finalWallNetworkSegments,
  }

  return { lines: networked, stats }
}

export function filterWorldMarginArtifactLines(
  lines: PlanTraceLine[],
  page: { minX: number; minY: number; maxX: number; maxY: number },
): PlanTraceLine[] {
  const pw = page.maxX - page.minX
  const ph = page.maxY - page.minY
  if (pw < 1 || ph < 1) return lines
  const m = Math.max(0.35, Math.min(pw, ph) * 0.012)
  const onSameOuterEdge = (a: WorldPoint2D, b: WorldPoint2D): 'n' | 's' | 'e' | 'w' | null => {
    const tol = m * 1.2
    const near = (v: number, t: number) => Math.abs(v - t) <= tol
    if (near(a.y, page.minY) && near(b.y, page.minY)) return 'n'
    if (near(a.y, page.maxY) && near(b.y, page.maxY)) return 's'
    if (near(a.x, page.minX) && near(b.x, page.minX)) return 'w'
    if (near(a.x, page.maxX) && near(b.x, page.maxX)) return 'e'
    return null
  }
  return lines.filter((line) => {
    const len = line.lengthFt
    if (len < Math.min(pw, ph) * 0.75) return true
    const edge = onSameOuterEdge(line.start, line.end)
    if (!edge) return true
    if (len >= Math.min(pw, ph) * 0.78) return false
    return true
  })
}
