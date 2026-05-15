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
  wallCandidatesAfterCoreCrop: number
  /** Final segments accepted into the wall network (same as finalWallNetworkSegments). */
  wallCandidatesFiltered: number
  /** Full extent of orthogonal trace geometry (not used as plan bounds). */
  drawingBounds: PlanCoreBounds | null
  detectedPlanCoreBounds: PlanCoreBounds | null
  /** Padded bbox used for final segment crop (exterior walls kept via padding). */
  finalCropBounds: PlanCoreBounds | null
  removedFrameSegments: number
  removedSheetFrameSegments: number
  removedTitleBlockSegments: number
  removedDetailRegionSegments: number
  removedOutsideCoreSegments: number
  removedAnnotationNoiseSegments: number
  removedFurnitureNoiseSegments: number
  finalWallNetworkSegments: number
  rejectedTinyCoreComponents: number
  rejectedEmptyFrameComponents: number
  selectedPlanCoreComponentScore: number
  selectedPlanCoreDensity: number
  selectedPlanCoreInternalSegments: number
  selectedPlanCorePerimeterRatio: number
  removedEmptyFrameSegments: number
  keptWallNetworkComponents: number
}

const WALL_NETWORK_SCORE_THRESHOLD = 0.28
const WALL_NETWORK_SCORE_SATELLITE = 0.34
const ENDPOINT_SNAP_FT = 0.42
const MIN_MEANINGFUL_CORE_SEGMENTS = 10
const MIN_COMPONENT_SEGMENTS_WHEN_LARGER_EXISTS = 6

function traceLineMidpoint(line: PlanTraceLine): WorldPoint2D {
  return { x: (line.start.x + line.end.x) / 2, y: (line.start.y + line.end.y) / 2 }
}

function pointInBounds(p: WorldPoint2D, b: PlanCoreBounds, pad = 0): boolean {
  return p.x >= b.minX - pad && p.x <= b.maxX + pad && p.y >= b.minY - pad && p.y <= b.maxY + pad
}

function segmentMidpointInsideBounds(line: PlanTraceLine, b: PlanCoreBounds, pad = 0): boolean {
  return pointInBounds(traceLineMidpoint(line), b, pad)
}

function boundsFromLines(lines: PlanTraceLine[]): PlanCoreBounds | null {
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
  if (!isFinite(minX)) return null
  return { minX, minY, maxX, maxY }
}

function boundsArea(b: PlanCoreBounds): number {
  return Math.max(0.01, (b.maxX - b.minX) * (b.maxY - b.minY))
}

function countSegmentsInsideBounds(lines: PlanTraceLine[], b: PlanCoreBounds, pad = 0): number {
  let n = 0
  for (const line of lines) {
    if (segmentMidpointInsideBounds(line, b, pad)) n += 1
  }
  return n
}

function medianWallLength(lines: PlanTraceLine[]): number {
  if (!lines.length) return 6
  const lengths = lines.map((l) => l.lengthFt).sort((a, b) => a - b)
  return lengths[Math.floor(lengths.length / 2)] || 6
}

function shrinkBoundsInset(b: PlanCoreBounds, ratio: number): PlanCoreBounds {
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  const ix = w * ratio
  const iy = h * ratio
  return {
    minX: b.minX + ix,
    minY: b.minY + iy,
    maxX: b.maxX - ix,
    maxY: b.maxY - iy,
  }
}

function computeFinalCropBounds(core: PlanCoreBounds): PlanCoreBounds {
  const cw = core.maxX - core.minX
  const ch = core.maxY - core.minY
  const pad = Math.max(1.2, Math.min(cw, ch) * 0.08)
  return {
    minX: core.minX - pad,
    minY: core.minY - pad,
    maxX: core.maxX + pad,
    maxY: core.maxY + pad,
  }
}

/** Lines used only for density/core detection — excludes sheet frame and title clutter. */
function filterLinesForCoreDetection(
  lines: PlanTraceLine[],
  page: { minX: number; minY: number; maxX: number; maxY: number } | null,
  medianLen: number,
): PlanTraceLine[] {
  if (!page) {
    return lines.filter((l) => l.orthogonal && l.lengthFt >= 1.5 && l.lengthFt <= medianLen * 4.5)
  }
  const pw = page.maxX - page.minX
  const ph = page.maxY - page.minY
  const pageSpan = Math.max(pw, ph)
  return lines.filter((line) => {
    if (!line.orthogonal || line.lengthFt < 1.5) return false
    if (line.lengthFt > Math.max(22, medianLen * 3.2)) return false
    const mid = traceLineMidpoint(line)
    if (isInTitleBlockHeuristicRegion(mid, page, null)) return false
    const orient = classifyLineOrientation(line)
    const span =
      orient === 'horizontal'
        ? Math.abs(line.end.x - line.start.x)
        : orient === 'vertical'
          ? Math.abs(line.end.y - line.start.y)
          : line.lengthFt
    if (span >= pageSpan * 0.72) return false
    const margin = Math.max(0.5, Math.min(pw, ph) * 0.02)
    const nearEdge =
      mid.x <= page.minX + margin ||
      mid.x >= page.maxX - margin ||
      mid.y <= page.minY + margin ||
      mid.y >= page.maxY - margin
    if (nearEdge && span >= Math.min(pw, ph) * 0.55) return false
    return true
  })
}

function lineConnectsToPool(line: PlanTraceLine, pool: PlanTraceLine[], snapFt = ENDPOINT_SNAP_FT): boolean {
  for (const other of pool) {
    if (other.id === line.id) continue
    const connected =
      Math.hypot(line.start.x - other.start.x, line.start.y - other.start.y) <= snapFt ||
      Math.hypot(line.start.x - other.end.x, line.start.y - other.end.y) <= snapFt ||
      Math.hypot(line.end.x - other.start.x, line.end.y - other.start.y) <= snapFt ||
      Math.hypot(line.end.x - other.end.x, line.end.y - other.end.y) <= snapFt
    if (connected) return true
  }
  return false
}

function isInDetailTableRegion(
  p: WorldPoint2D,
  page: { minX: number; minY: number; maxX: number; maxY: number },
  core: PlanCoreBounds | null,
): boolean {
  const pw = page.maxX - page.minX
  const ph = page.maxY - page.minY
  const nx = (p.x - page.minX) / Math.max(1, pw)
  const ny = (p.y - page.minY) / Math.max(1, ph)
  const rightDetail = nx > 0.58 && ny > 0.06 && ny < 0.94
  const bottomDetail = ny > 0.74 && nx > 0.12 && nx < 0.95
  const farRightTable = nx > 0.68 && ny > 0.1 && ny < 0.88
  if (!rightDetail && !bottomDetail && !farRightTable) return false
  if (core && pointInBounds(p, core, Math.min(pw, ph) * 0.06)) return false
  return true
}

function countGridParallelDensity(
  lines: PlanTraceLine[],
  region: PlanCoreBounds,
): number {
  let hits = 0
  for (const line of lines) {
    if (!line.orthogonal || line.lengthFt > 6) continue
    const mid = traceLineMidpoint(line)
    if (!pointInBounds(mid, region, 0)) continue
    const parallel = countParallelNeighbors(line, lines, 0.28)
    if (parallel >= 3) hits += 1
  }
  return hits
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

  const medianLen = medianWallLength(lines.filter((l) => l.orthogonal && l.lengthFt >= 1.5))
  const coreLines = filterLinesForCoreDetection(lines, page, medianLen)
  const densitySource = coreLines.length >= 6 ? coreLines : lines.filter((l) => l.orthogonal && l.lengthFt >= 1.5)

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

  for (const line of densitySource) {
    if (!line.orthogonal && line.lengthFt < 3.5) continue
    const m = traceLineMidpoint(line)
    if (page && isInTitleBlockHeuristicRegion(m, page, null)) continue
    if (page && isInDetailTableRegion(m, page, null)) continue
    const cx = Math.min(cols - 1, Math.max(0, Math.floor((m.x - pageMinX) / cellW)))
    const cy = Math.min(rows - 1, Math.max(0, Math.floor((m.y - pageMinY) / cellH)))
    const lenW = 1 + Math.min(2.2, line.lengthFt / 14)
    const w = line.orthogonal ? lenW : 0.25
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
  const componentSelectionEarly = selectDensePlanCoreFromComponents(densitySource, page, outer)
  const componentCoreEarly = componentSelectionEarly.bounds
  if (peak < 1.2) {
    if (componentCoreEarly) return componentCoreEarly
    return shrinkBoundsInset(outer, 0.12)
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
  const gridCore: PlanCoreBounds = {
    minX: pageMinX + minCx * cellW - padX,
    minY: pageMinY + minCy * cellH - padY,
    maxX: pageMinX + (maxCx + 1) * cellW + padX,
    maxY: pageMinY + (maxCy + 1) * cellH + padY,
  }

  const gridCoreSegments = countSegmentsInsideBounds(densitySource, gridCore, 0)
  const gridDensity = coreDensityScore(gridCore, densitySource)
  const componentSelection =
    componentSelectionEarly.bounds != null
      ? componentSelectionEarly
      : selectDensePlanCoreFromComponents(densitySource, page, outer)
  const componentCore = componentSelection.bounds
  if (componentCore) {
    const compSegments = countSegmentsInsideBounds(lines, componentCore, 0)
    const compDensity = componentSelection.selectedPlanCoreDensity || coreDensityScore(componentCore, densitySource)
    const gridTooSmall =
      gridCoreSegments < MIN_MEANINGFUL_CORE_SEGMENTS &&
      compSegments >= MIN_MEANINGFUL_CORE_SEGMENTS
    const compDenser = compDensity >= gridDensity * 1.15
    const gridLooksHollow = gridDensity < 0.055 && compDensity >= 0.07
    if (gridTooSmall || compDenser || gridLooksHollow) return componentCore
  }

  if (gridCoreSegments < MIN_MEANINGFUL_CORE_SEGMENTS && componentCore) {
    return componentCore
  }
  if (gridDensity < 0.05 && componentCore) return componentCore
  return gridCore
}

interface WallComponentMetrics {
  ids: string[]
  bounds: PlanCoreBounds
  segmentCount: number
  totalLength: number
  orthogonalCount: number
  intersectionHits: number
  endpointConnections: number
  internalSegmentCount: number
  internalSegmentDensity: number
  perimeterLengthRatio: number
  roomLikeScore: number
  isEmptyFrame: boolean
  isTitleBlockLike: boolean
}

interface PlanCoreSelectionResult {
  bounds: PlanCoreBounds | null
  rejectedEmptyFrameComponents: number
  selectedPlanCoreComponentScore: number
  selectedPlanCoreDensity: number
  selectedPlanCoreInternalSegments: number
  selectedPlanCorePerimeterRatio: number
  emptyFrameLineIds: Set<string>
}

function buildLineAdjacency(lines: PlanTraceLine[]): Map<string, Set<string>> {
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
  return adj
}

function connectedComponentsFromAdjacency(
  lines: PlanTraceLine[],
  adj: Map<string, Set<string>>,
): WallComponentMetrics[] {
  const byId = new Map(lines.map((l) => [l.id, l]))
  const visited = new Set<string>()
  const out: WallComponentMetrics[] = []
  for (const line of lines) {
    if (visited.has(line.id)) continue
    const stack = [line.id]
    const ids: string[] = []
    visited.add(line.id)
    while (stack.length > 0) {
      const id = stack.pop()!
      ids.push(id)
      for (const nb of adj.get(id) || []) {
        if (visited.has(nb)) continue
        visited.add(nb)
        stack.push(nb)
      }
    }
    const compLines = ids.map((id) => byId.get(id)).filter(Boolean) as PlanTraceLine[]
    const bounds = boundsFromLines(compLines)
    if (!bounds) continue
    let totalLength = 0
    let orthogonalCount = 0
    for (const l of compLines) {
      totalLength += l.lengthFt
      if (l.orthogonal) orthogonalCount += 1
    }
    out.push({
      ids,
      bounds,
      segmentCount: compLines.length,
      totalLength,
      orthogonalCount,
      intersectionHits: 0,
      endpointConnections: 0,
      internalSegmentCount: 0,
      internalSegmentDensity: 0,
      perimeterLengthRatio: 0,
      roomLikeScore: 0,
      isEmptyFrame: false,
      isTitleBlockLike: false,
    })
  }
  return out
}

function lineMidpointOnComponentPerimeter(line: PlanTraceLine, b: PlanCoreBounds, margin: number): boolean {
  const mid = traceLineMidpoint(line)
  return isNearBoundsEdge(mid, b, margin)
}

function enrichWallComponentMetrics(comp: WallComponentMetrics, compLines: PlanTraceLine[]): void {
  if (!compLines.length) return
  const bw = comp.bounds.maxX - comp.bounds.minX
  const bh = comp.bounds.maxY - comp.bounds.minY
  const area = boundsArea(comp.bounds)
  const edgeMargin = Math.max(0.35, Math.min(bw, bh) * 0.04)
  const insetBounds = shrinkBoundsInset(comp.bounds, 0.12)

  let perimeterLength = 0
  let internalCount = 0
  let interiorOrthogonal = 0
  for (const line of compLines) {
    if (lineMidpointOnComponentPerimeter(line, comp.bounds, edgeMargin)) {
      perimeterLength += line.lengthFt
    }
    if (segmentMidpointInsideBounds(line, insetBounds, 0)) {
      internalCount += 1
      if (line.orthogonal && !lineMidpointOnComponentPerimeter(line, comp.bounds, edgeMargin * 1.2)) {
        interiorOrthogonal += 1
      }
    }
  }

  const endpointBuckets = new Map<string, number>()
  const bucketKey = (p: WorldPoint2D) =>
    `${Math.round(p.x / (ENDPOINT_SNAP_FT * 0.5))}:${Math.round(p.y / (ENDPOINT_SNAP_FT * 0.5))}`
  for (const line of compLines) {
    const k1 = bucketKey(line.start)
    const k2 = bucketKey(line.end)
    endpointBuckets.set(k1, (endpointBuckets.get(k1) || 0) + 1)
    endpointBuckets.set(k2, (endpointBuckets.get(k2) || 0) + 1)
  }
  let intersectionHits = 0
  let endpointConnections = 0
  for (const count of endpointBuckets.values()) {
    if (count >= 2) intersectionHits += count - 1
    if (count >= 2) endpointConnections += 1
  }

  const insetArea = boundsArea(insetBounds)
  const internalSegmentDensity = internalCount / Math.max(1, insetArea)
  const perimeterLengthRatio = comp.totalLength > 0 ? perimeterLength / comp.totalLength : 0
  const orthoRatio = comp.orthogonalCount / Math.max(1, comp.segmentCount)
  const interiorRatio = interiorOrthogonal / Math.max(1, comp.segmentCount)
  const roomLikeScore = Math.min(
    1,
    interiorRatio * 0.42 +
      Math.min(1, intersectionHits / 18) * 0.34 +
      Math.min(1, internalSegmentDensity * 55) * 0.24,
  )

  comp.internalSegmentCount = internalCount
  comp.internalSegmentDensity = internalSegmentDensity
  comp.perimeterLengthRatio = perimeterLengthRatio
  comp.intersectionHits = intersectionHits
  comp.endpointConnections = endpointConnections
  comp.roomLikeScore = roomLikeScore

  const aspect = bw > 0 && bh > 0 ? Math.min(bw, bh) / Math.max(bw, bh) : 0
  const mostlyPerimeter = perimeterLengthRatio >= 0.58 && internalCount <= Math.max(2, comp.segmentCount * 0.28)
  const fewCorners = intersectionHits <= Math.max(1, Math.floor(comp.segmentCount * 0.2))
  const largeHollowBox = area >= 120 && internalSegmentDensity < 0.07 && comp.segmentCount <= 14
  const fourEdgeRing =
    comp.segmentCount <= 8 &&
    perimeterLengthRatio >= 0.68 &&
    intersectionHits <= 3 &&
    orthoRatio >= 0.85
  const tallEmptyFrame =
    aspect <= 0.42 &&
    area >= 180 &&
    internalCount <= 4 &&
    perimeterLengthRatio >= 0.52
  const wideEmptyFrame =
    aspect >= 0.85 &&
    area >= 220 &&
    internalCount <= 5 &&
    interiorOrthogonal <= 2 &&
    perimeterLengthRatio >= 0.5

  comp.isEmptyFrame =
    mostlyPerimeter ||
    fourEdgeRing ||
    largeHollowBox ||
    tallEmptyFrame ||
    wideEmptyFrame ||
    (fewCorners && internalSegmentDensity < 0.045 && area >= 90)
}

function isEmptyFrameComponent(comp: WallComponentMetrics): boolean {
  return comp.isEmptyFrame
}

function scoreWallComponent(
  comp: WallComponentMetrics,
  page: { minX: number; minY: number; maxX: number; maxY: number } | null,
  drawingBounds: PlanCoreBounds | null,
  medianLen: number,
  linesById?: Map<string, PlanTraceLine>,
): number {
  if (comp.segmentCount < 3) return -1
  if (linesById) {
    const compLines = comp.ids.map((id) => linesById.get(id)).filter(Boolean) as PlanTraceLine[]
    enrichWallComponentMetrics(comp, compLines)
  }
  if (comp.isEmptyFrame || isEmptyFrameComponent(comp)) return -1

  const orthoRatio = comp.orthogonalCount / Math.max(1, comp.segmentCount)
  let score = Math.min(1.4, comp.segmentCount / 42) * 0.18
  score += Math.min(1.2, comp.totalLength / 220) * 0.14
  score += orthoRatio * 0.1
  score += comp.roomLikeScore * 0.32
  score += Math.min(1, comp.internalSegmentDensity * 70) * 0.26
  score += Math.min(1, comp.intersectionHits / 22) * 0.2
  score += Math.min(1, comp.endpointConnections / 14) * 0.08
  score -= comp.perimeterLengthRatio * 0.38
  if (comp.internalSegmentCount < 4 && boundsArea(comp.bounds) > 100) score -= 0.42
  if (comp.perimeterLengthRatio >= 0.62 && comp.internalSegmentCount <= 3) score -= 0.55

  const bw = comp.bounds.maxX - comp.bounds.minX
  const bh = comp.bounds.maxY - comp.bounds.minY
  const aspect = bw > 0 && bh > 0 ? Math.min(bw, bh) / Math.max(bw, bh) : 0
  if (aspect >= 0.12 && aspect <= 0.95) score += 0.06
  if (bw >= 8 && bh >= 8 && bw <= 220 && bh <= 220) score += 0.05

  if (page) {
    const pw = page.maxX - page.minX
    const ph = page.maxY - page.minY
    const cx = (comp.bounds.minX + comp.bounds.maxX) / 2
    const cy = (comp.bounds.minY + comp.bounds.maxY) / 2
    const nx = (cx - page.minX) / Math.max(1, pw)
    const ny = (cy - page.minY) / Math.max(1, ph)
    const inCorner = (nx > 0.68 && ny > 0.58) || (nx < 0.18 && ny > 0.55)
    const inTitleStrip = ny > 0.76 && nx > 0.45
    const inDetailStrip = nx > 0.62 && ny > 0.08 && ny < 0.92
    if (inCorner || inTitleStrip) score -= 0.28
    if (inDetailStrip) score -= 0.18
    if (linesById) {
      const compLines = comp.ids.map((id) => linesById.get(id)).filter(Boolean) as PlanTraceLine[]
      const tableDensity = countGridParallelDensity(compLines, comp.bounds)
      if (tableDensity >= 6 && comp.segmentCount < 40) score -= 0.2
    }
    const distCenter = Math.hypot(nx - 0.5, ny - 0.5)
    score += (1 - Math.min(1, distCenter * 1.15)) * 0.12
  }

  if (drawingBounds) {
    const dw = drawingBounds.maxX - drawingBounds.minX
    const dh = drawingBounds.maxY - drawingBounds.minY
    const coversDrawing =
      comp.bounds.minX <= drawingBounds.minX + dw * 0.04 &&
      comp.bounds.minY <= drawingBounds.minY + dh * 0.04 &&
      comp.bounds.maxX >= drawingBounds.maxX - dw * 0.04 &&
      comp.bounds.maxY >= drawingBounds.maxY - dh * 0.04
    const avgLen = comp.totalLength / Math.max(1, comp.segmentCount)
    if (coversDrawing && comp.segmentCount <= 8 && avgLen > medianLen * 2.2) {
      score -= 0.55
    }
    if (coversDrawing && comp.segmentCount <= 5) score -= 0.35
  }

  if (comp.segmentCount < MIN_COMPONENT_SEGMENTS_WHEN_LARGER_EXISTS) score -= 0.2
  if (comp.isTitleBlockLike) score -= 0.45
  return score
}

function selectDensePlanCoreFromComponents(
  lines: PlanTraceLine[],
  page: { minX: number; minY: number; maxX: number; maxY: number } | null,
  outer: PlanCoreBounds,
): PlanCoreSelectionResult {
  const empty: PlanCoreSelectionResult = {
    bounds: null,
    rejectedEmptyFrameComponents: 0,
    selectedPlanCoreComponentScore: 0,
    selectedPlanCoreDensity: 0,
    selectedPlanCoreInternalSegments: 0,
    selectedPlanCorePerimeterRatio: 0,
    emptyFrameLineIds: new Set(),
  }
  const wallish = lines.filter((l) => l.orthogonal && l.lengthFt >= 1.5)
  if (wallish.length < 6) return empty
  const adj = buildLineAdjacency(wallish)
  const components = connectedComponentsFromAdjacency(wallish, adj)
  if (!components.length) return empty
  const drawingBounds = boundsFromLines(wallish) || outer
  const medianLen = medianWallLength(wallish)
  const linesById = new Map(wallish.map((l) => [l.id, l]))
  let largestCount = 0
  let rejectedEmptyFrameComponents = 0
  const emptyFrameLineIds = new Set<string>()
  for (const comp of components) {
    largestCount = Math.max(largestCount, comp.segmentCount)
    const compLines = comp.ids.map((id) => linesById.get(id)).filter(Boolean) as PlanTraceLine[]
    enrichWallComponentMetrics(comp, compLines)
    if (comp.isEmptyFrame) {
      rejectedEmptyFrameComponents += 1
      for (const id of comp.ids) emptyFrameLineIds.add(id)
    }
  }

  let best: WallComponentMetrics | null = null
  let bestScore = -Infinity
  for (const comp of components) {
    if (comp.isEmptyFrame) continue
    if (comp.segmentCount < MIN_COMPONENT_SEGMENTS_WHEN_LARGER_EXISTS && largestCount >= MIN_MEANINGFUL_CORE_SEGMENTS) {
      comp.isTitleBlockLike = true
    }
    const s = scoreWallComponent(comp, page, drawingBounds, medianLen, linesById)
    if (s > bestScore) {
      bestScore = s
      best = comp
    }
  }
  if (!best || bestScore < 0.22) return { ...empty, rejectedEmptyFrameComponents, emptyFrameLineIds }

  const pad = Math.max(0.8, Math.min(best.bounds.maxX - best.bounds.minX, best.bounds.maxY - best.bounds.minY) * 0.06)
  return {
    bounds: {
      minX: best.bounds.minX - pad,
      minY: best.bounds.minY - pad,
      maxX: best.bounds.maxX + pad,
      maxY: best.bounds.maxY + pad,
    },
    rejectedEmptyFrameComponents,
    selectedPlanCoreComponentScore: bestScore,
    selectedPlanCoreDensity: best.internalSegmentDensity,
    selectedPlanCoreInternalSegments: best.internalSegmentCount,
    selectedPlanCorePerimeterRatio: best.perimeterLengthRatio,
    emptyFrameLineIds,
  }
}

function detectPlanCoreFromRankedComponents(
  lines: PlanTraceLine[],
  page: { minX: number; minY: number; maxX: number; maxY: number } | null,
  outer: PlanCoreBounds,
): PlanCoreBounds | null {
  return selectDensePlanCoreFromComponents(lines, page, outer).bounds
}

function coreDensityScore(bounds: PlanCoreBounds, sourceLines: PlanTraceLine[]): number {
  const inset = shrinkBoundsInset(bounds, 0.1)
  const internal = countSegmentsInsideBounds(sourceLines, inset, 0)
  const area = boundsArea(bounds)
  return internal / Math.max(1, area)
}

function isNearBoundsEdge(
  p: WorldPoint2D,
  b: PlanCoreBounds,
  margin: number,
): boolean {
  return (
    p.x <= b.minX + margin ||
    p.x >= b.maxX - margin ||
    p.y <= b.minY + margin ||
    p.y >= b.maxY - margin
  )
}

function lineSpansBounds(
  line: PlanTraceLine,
  b: PlanCoreBounds,
  ratio: number,
): boolean {
  const orient = classifyLineOrientation(line)
  const bw = b.maxX - b.minX
  const bh = b.maxY - b.minY
  if (orient === 'horizontal') {
    const span = Math.abs(line.end.x - line.start.x)
    return span >= bw * ratio
  }
  if (orient === 'vertical') {
    const span = Math.abs(line.end.y - line.start.y)
    return span >= bh * ratio
  }
  return false
}

function isLikelySheetFrameLine(
  line: PlanTraceLine,
  page: { minX: number; minY: number; maxX: number; maxY: number },
  core: PlanCoreBounds | null,
  drawingBounds: PlanCoreBounds | null,
  medianLen: number,
): boolean {
  const pw = page.maxX - page.minX
  const ph = page.maxY - page.minY
  if (pw < 2 || ph < 2) return false
  const margin = Math.max(0.45, Math.min(pw, ph) * 0.018)
  const nearPageEdge = (p: WorldPoint2D) =>
    p.x <= page.minX + margin ||
    p.x >= page.maxX - margin ||
    p.y <= page.minY + margin ||
    p.y >= page.maxY - margin
  const edgeA = nearPageEdge(line.start)
  const edgeB = nearPageEdge(line.end)
  const orient = classifyLineOrientation(line)
  const span =
    orient === 'horizontal'
      ? Math.abs(line.end.x - line.start.x)
      : orient === 'vertical'
        ? Math.abs(line.end.y - line.start.y)
        : line.lengthFt
  const pageSpan = orient === 'horizontal' ? pw : orient === 'vertical' ? ph : Math.min(pw, ph)
  const mid = traceLineMidpoint(line)

  const hugsPagePerimeter = edgeA && edgeB && span >= pageSpan * 0.52
  const veryLongVsTypical = line.orthogonal && line.lengthFt >= Math.max(16, medianLen * 2.4)

  let hugsDrawingFrame = false
  if (drawingBounds && line.orthogonal) {
    const dbMargin = Math.max(0.35, Math.min(drawingBounds.maxX - drawingBounds.minX, drawingBounds.maxY - drawingBounds.minY) * 0.02)
    const onDrawA = isNearBoundsEdge(line.start, drawingBounds, dbMargin)
    const onDrawB = isNearBoundsEdge(line.end, drawingBounds, dbMargin)
    const spansDraw = lineSpansBounds(line, drawingBounds, 0.55)
    hugsDrawingFrame = onDrawA && onDrawB && spansDraw
    if (!hugsDrawingFrame && spansDraw && (onDrawA || onDrawB) && line.lengthFt >= medianLen * 1.85) {
      hugsDrawingFrame = true
    }
  }

  let outsideCoreLongRing = false
  if (core && line.orthogonal) {
    const cw = core.maxX - core.minX
    const ch = core.maxY - core.minY
    const outsideCore = !segmentMidpointInsideBounds(line, core, Math.min(cw, ch) * 0.05)
    const spansCore =
      orient === 'horizontal'
        ? span >= cw * 0.78
        : orient === 'vertical'
          ? span >= ch * 0.78
          : false
    if (outsideCore && spansCore && line.lengthFt >= medianLen * 1.6) {
      outsideCoreLongRing = true
    }
  }

  if (!hugsPagePerimeter && !hugsDrawingFrame && !veryLongVsTypical && !outsideCoreLongRing) return false
  if (core && segmentMidpointInsideBounds(line, core, Math.min(pw, ph) * 0.06)) {
    const coreSpan = orient === 'horizontal' ? core.maxX - core.minX : orient === 'vertical' ? core.maxY - core.minY : 0
    if (orient !== 'angled' && span < coreSpan * 0.88) return false
  }
  if (hugsDrawingFrame && core && segmentMidpointInsideBounds(line, core, Math.min(pw, ph) * 0.03)) {
    return span >= (drawingBounds ? Math.max(drawingBounds.maxX - drawingBounds.minX, drawingBounds.maxY - drawingBounds.minY) * 0.5 : pageSpan * 0.5)
  }
  if (isInDetailTableRegion(mid, page, core) && span >= pageSpan * 0.35) return true
  return (
    hugsPagePerimeter ||
    hugsDrawingFrame ||
    outsideCoreLongRing ||
    (veryLongVsTypical && (!core || !segmentMidpointInsideBounds(line, core, 0)))
  )
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

  const conn = Math.min(1, endpointDegree / 3)
  score += conn * 0.14

  if (core) {
    const mid = traceLineMidpoint(line)
    const cw = core.maxX - core.minX
    const ch = core.maxY - core.minY
    const dx = Math.abs(mid.x - (core.minX + cw / 2)) / Math.max(1, cw / 2)
    const dy = Math.abs(mid.y - (core.minY + ch / 2)) / Math.max(1, ch / 2)
    const coreProx = 1 - Math.min(1, Math.hypot(dx, dy))
    score += coreProx * 0.16
    if (!segmentMidpointInsideBounds(line, core, Math.min(cw, ch) * 0.18)) {
      score -= 0.08
    }
  }

  if (page && isInTitleBlockHeuristicRegion(traceLineMidpoint(line), page, core)) {
    score -= 0.28
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

function isLikelySheetFrameComponent(
  comp: WallComponentMetrics,
  page: { minX: number; minY: number; maxX: number; maxY: number } | null,
  drawingBounds: PlanCoreBounds | null,
  medianLen: number,
  linesById?: Map<string, PlanTraceLine>,
): boolean {
  if (linesById) {
    const compLines = comp.ids.map((id) => linesById.get(id)).filter(Boolean) as PlanTraceLine[]
    enrichWallComponentMetrics(comp, compLines)
  }
  if (comp.isEmptyFrame || isEmptyFrameComponent(comp)) return true
  if (comp.perimeterLengthRatio >= 0.62 && comp.internalSegmentCount <= 4) return true
  if (comp.segmentCount > 24 && comp.internalSegmentDensity >= 0.08) return false
  const avgLen = comp.totalLength / Math.max(1, comp.segmentCount)
  if (avgLen < medianLen * 1.6 && comp.segmentCount > 10) return false
  if (!drawingBounds) return false
  const dw = drawingBounds.maxX - drawingBounds.minX
  const dh = drawingBounds.maxY - drawingBounds.minY
  const covers =
    comp.bounds.minX <= drawingBounds.minX + dw * 0.03 &&
    comp.bounds.minY <= drawingBounds.minY + dh * 0.03 &&
    comp.bounds.maxX >= drawingBounds.maxX - dw * 0.03 &&
    comp.bounds.maxY >= drawingBounds.maxY - dh * 0.03
  if (!covers) return false
  if (comp.segmentCount <= 6 && comp.orthogonalCount >= comp.segmentCount - 1) return true
  if (page) {
    const pw = page.maxX - page.minX
    const ph = page.maxY - page.minY
    const compArea = boundsArea(comp.bounds)
    const pageArea = pw * ph
    if (compArea / Math.max(1, pageArea) > 0.88 && comp.segmentCount <= 8) return true
  }
  return false
}

function keepRankedWallNetworkComponents(
  lines: PlanTraceLine[],
  scores: Map<string, number>,
  page: { minX: number; minY: number; maxX: number; maxY: number } | null,
  core: PlanCoreBounds | null,
  drawingBounds: PlanCoreBounds | null,
): { lines: PlanTraceLine[]; rejectedTinyCoreComponents: number; keptWallNetworkComponents: number } {
  if (lines.length <= 2) {
    return { lines, rejectedTinyCoreComponents: 0, keptWallNetworkComponents: lines.length > 0 ? 1 : 0 }
  }
  const byId = new Map(lines.map((l) => [l.id, l]))
  const adj = buildLineAdjacency(lines)
  const components = connectedComponentsFromAdjacency(lines, adj)
  const medianLen = medianWallLength(lines)
  let largestCount = 0
  for (const comp of components) largestCount = Math.max(largestCount, comp.segmentCount)

  const linesById = new Map(lines.map((l) => [l.id, l]))
  const ranked = components
    .map((comp) => ({
      comp,
      score: scoreWallComponent(comp, page, drawingBounds, medianLen, linesById),
      frame: isLikelySheetFrameComponent(comp, page, drawingBounds, medianLen, linesById),
    }))
    .filter((r) => !r.frame && !r.comp.isEmptyFrame && r.score >= 0.12)
    .sort((a, b) => b.score - a.score)

  let rejectedTinyCoreComponents = 0
  for (const r of components) {
    if (r.segmentCount < MIN_COMPONENT_SEGMENTS_WHEN_LARGER_EXISTS && largestCount >= MIN_MEANINGFUL_CORE_SEGMENTS) {
      rejectedTinyCoreComponents += 1
    }
  }

  const keptIds = new Set<string>()
  const primary = ranked[0]
  if (primary) {
    for (const id of primary.comp.ids) keptIds.add(id)
  }

  const mergeDist = Math.max(2.5, medianLen * 0.85)
  for (let i = 1; i < ranked.length; i += 1) {
    const entry = ranked[i]
    if (entry.comp.segmentCount < MIN_COMPONENT_SEGMENTS_WHEN_LARGER_EXISTS && largestCount >= MIN_MEANINGFUL_CORE_SEGMENTS) {
      continue
    }
    if (!primary) continue
    const dx =
      Math.abs((entry.comp.bounds.minX + entry.comp.bounds.maxX) / 2 - (primary.comp.bounds.minX + primary.comp.bounds.maxX) / 2)
    const dy =
      Math.abs((entry.comp.bounds.minY + entry.comp.bounds.maxY) / 2 - (primary.comp.bounds.minY + primary.comp.bounds.maxY) / 2)
    const nearPrimary = Math.hypot(dx, dy) <= mergeDist * 3.2
    const overlapsCore =
      core != null &&
      countSegmentsInsideBounds(
        entry.comp.ids.map((id) => byId.get(id)).filter(Boolean) as PlanTraceLine[],
        core,
        Math.min(core.maxX - core.minX, core.maxY - core.minY) * 0.14,
      ) >= Math.max(2, Math.floor(entry.comp.segmentCount * 0.35))
    const inDetail =
      page != null &&
      isInDetailTableRegion(
        {
          x: (entry.comp.bounds.minX + entry.comp.bounds.maxX) / 2,
          y: (entry.comp.bounds.minY + entry.comp.bounds.maxY) / 2,
        },
        page,
        core,
      )
    if (!inDetail && (nearPrimary || overlapsCore || entry.score >= primary.score * 0.72)) {
      for (const id of entry.comp.ids) keptIds.add(id)
    }
  }

  for (const line of lines) {
    if (keptIds.has(line.id)) continue
    const s = scores.get(line.id) ?? 0
    const inCore = core ? segmentMidpointInsideBounds(line, core, 0) : true
    const inDetail = page ? isInDetailTableRegion(traceLineMidpoint(line), page, core) : false
    if (inDetail && !inCore) continue
    if (inCore && s >= WALL_NETWORK_SCORE_THRESHOLD) keptIds.add(line.id)
    else if (line.orthogonal && line.lengthFt >= 4.5 && s >= WALL_NETWORK_SCORE_SATELLITE && inCore) keptIds.add(line.id)
    else if (line.orthogonal && line.lengthFt >= 7 && inCore) keptIds.add(line.id)
  }

  const out: PlanTraceLine[] = []
  for (const id of keptIds) {
    const line = byId.get(id)
    if (line) out.push(line)
  }
  let keptWallNetworkComponents = 0
  for (const entry of ranked) {
    if (entry.comp.ids.some((id) => keptIds.has(id))) keptWallNetworkComponents += 1
  }

  return {
    lines: out,
    rejectedTinyCoreComponents,
    keptWallNetworkComponents,
  }
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
    wallCandidatesAfterCoreCrop: 0,
    wallCandidatesFiltered: 0,
    drawingBounds: null,
    detectedPlanCoreBounds: null,
    finalCropBounds: null,
    removedFrameSegments: 0,
    removedSheetFrameSegments: 0,
    removedTitleBlockSegments: 0,
    removedDetailRegionSegments: 0,
    removedOutsideCoreSegments: 0,
    removedAnnotationNoiseSegments: 0,
    removedFurnitureNoiseSegments: 0,
    finalWallNetworkSegments: 0,
    rejectedTinyCoreComponents: 0,
    rejectedEmptyFrameComponents: 0,
    selectedPlanCoreComponentScore: 0,
    selectedPlanCoreDensity: 0,
    selectedPlanCoreInternalSegments: 0,
    selectedPlanCorePerimeterRatio: 0,
    removedEmptyFrameSegments: 0,
    keptWallNetworkComponents: 0,
  })

  if (lines.length === 0) {
    return { lines: [], stats: emptyStats() }
  }

  const medianLen = medianWallLength(lines)
  const drawingBounds =
    boundsFromLines(filterLinesForCoreDetection(lines, page, medianLen)) ||
    boundsFromLines(lines.filter((l) => l.orthogonal && l.lengthFt >= 1.5)) ||
    boundsFromLines(lines)
  const outer = detectOuterFootprint(lines) || drawingBounds
  const coreSelection = outer
    ? selectDensePlanCoreFromComponents(
        filterLinesForCoreDetection(lines, page, medianLen).length >= 6
          ? filterLinesForCoreDetection(lines, page, medianLen)
          : lines.filter((l) => l.orthogonal && l.lengthFt >= 1.5),
        page,
        outer,
      )
    : {
        bounds: detectPlanCoreBounds(lines, page),
        rejectedEmptyFrameComponents: 0,
        selectedPlanCoreComponentScore: 0,
        selectedPlanCoreDensity: 0,
        selectedPlanCoreInternalSegments: 0,
        selectedPlanCorePerimeterRatio: 0,
        emptyFrameLineIds: new Set<string>(),
      }
  const core = coreSelection.bounds ?? detectPlanCoreBounds(lines, page)
  const finalCropBounds = core ? computeFinalCropBounds(core) : null
  let pool = [...lines]
  let removedEmptyFrameSegments = 0
  if (coreSelection.emptyFrameLineIds.size > 0) {
    pool = pool.filter((line) => {
      if (!coreSelection.emptyFrameLineIds.has(line.id)) return true
      removedEmptyFrameSegments += 1
      return false
    })
  }
  let removedFrameSegments = 0
  let removedSheetFrameSegments = 0

  if (page) {
    const afterFrame: PlanTraceLine[] = []
    for (const line of pool) {
      if (isLikelySheetFrameLine(line, page, core, drawingBounds, medianLen)) {
        removedFrameSegments += 1
        const mid = traceLineMidpoint(line)
        const spansSheet =
          line.orthogonal &&
          (lineSpansBounds(line, drawingBounds || { minX: page.minX, minY: page.minY, maxX: page.maxX, maxY: page.maxY }, 0.5) ||
            isInDetailTableRegion(mid, page, core))
        if (spansSheet) removedSheetFrameSegments += 1
        continue
      }
      afterFrame.push(line)
    }
    pool = afterFrame
  }
  const wallCandidatesAfterFrameFilter = pool.length

  let removedTitleBlockSegments = 0
  let removedDetailRegionSegments = 0
  if (page) {
    const afterTitle: PlanTraceLine[] = []
    for (const line of pool) {
      const mid = traceLineMidpoint(line)
      const inTitle = isInTitleBlockHeuristicRegion(mid, page, core)
      const inDetail = isInDetailTableRegion(mid, page, core)
      const insideCore = core ? segmentMidpointInsideBounds(line, core, 0) : false
      if (inDetail && !insideCore) {
        removedDetailRegionSegments += 1
        continue
      }
      if (inTitle && !insideCore) {
        if (line.lengthFt < 12 || !lineConnectsToPool(line, pool.filter((l) => core && segmentMidpointInsideBounds(l, core, 0)))) {
          removedTitleBlockSegments += 1
          continue
        }
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
    if (page && isInDetailTableRegion(traceLineMidpoint(line), page, core) && !segmentMidpointInsideBounds(line, core || { minX: 0, minY: 0, maxX: 0, maxY: 0 }, 0)) {
      removedDetailRegionSegments += 1
      continue
    }
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
    if (page && isInDetailTableRegion(traceLineMidpoint(line), page, core) && !(core && segmentMidpointInsideBounds(line, core, 0))) {
      return false
    }
    if (s >= WALL_NETWORK_SCORE_THRESHOLD) return true
    if (line.orthogonal && line.lengthFt >= 5.5) {
      if (!core || segmentMidpointInsideBounds(line, core, Math.min(12, (core.maxX - core.minX) * 0.06))) return true
    }
    if (line.orthogonal && line.lengthFt >= 3.2 && core && segmentMidpointInsideBounds(line, core, 0)) {
      return s >= WALL_NETWORK_SCORE_THRESHOLD - 0.06
    }
    return false
  })

  const rankedNetwork = keepRankedWallNetworkComponents(scoredKeep, scores, page, core, drawingBounds)
  let networked = rankedNetwork.lines

  let removedOutsideCoreSegments = 0
  if (finalCropBounds) {
    const corePad = core
      ? Math.min(core.maxX - core.minX, core.maxY - core.minY) * 0.12
      : 0
    const insideNetwork = networked.filter((l) => segmentMidpointInsideBounds(l, finalCropBounds, 0))
    const afterCrop: PlanTraceLine[] = [...insideNetwork]
    const insideIds = new Set(insideNetwork.map((l) => l.id))
    for (const line of networked) {
      if (insideIds.has(line.id)) continue
      const nearCore = core && segmentMidpointInsideBounds(line, core, corePad)
      const connects = lineConnectsToPool(line, insideNetwork)
      if (nearCore && connects) {
        afterCrop.push(line)
        insideIds.add(line.id)
      } else {
        removedOutsideCoreSegments += 1
      }
    }
    networked = afterCrop
  }
  const wallCandidatesAfterCoreCrop = networked.length
  const finalWallNetworkSegments = networked.length

  const stats: WallNetworkFilterStats = {
    wallCandidatesRaw,
    wallCandidatesAfterFrameFilter,
    wallCandidatesAfterTitleBlockFilter,
    wallCandidatesAfterNoiseFilter,
    wallCandidatesAfterCoreCrop,
    wallCandidatesFiltered: finalWallNetworkSegments,
    drawingBounds,
    detectedPlanCoreBounds: core,
    finalCropBounds,
    removedFrameSegments,
    removedSheetFrameSegments,
    removedTitleBlockSegments,
    removedDetailRegionSegments,
    removedOutsideCoreSegments,
    removedAnnotationNoiseSegments,
    removedFurnitureNoiseSegments,
    finalWallNetworkSegments,
    rejectedTinyCoreComponents: rankedNetwork.rejectedTinyCoreComponents,
    rejectedEmptyFrameComponents: coreSelection.rejectedEmptyFrameComponents,
    selectedPlanCoreComponentScore: coreSelection.selectedPlanCoreComponentScore,
    selectedPlanCoreDensity: coreSelection.selectedPlanCoreDensity,
    selectedPlanCoreInternalSegments: coreSelection.selectedPlanCoreInternalSegments,
    selectedPlanCorePerimeterRatio: coreSelection.selectedPlanCorePerimeterRatio,
    removedEmptyFrameSegments,
    keptWallNetworkComponents: rankedNetwork.keptWallNetworkComponents,
  }

  return { lines: networked, stats }
}

// ---------------------------------------------------------------------------
// Wave 2C — page-level table/schedule grid detection (full-set ranking)
// ---------------------------------------------------------------------------

export interface PageTableGridAnalysis {
  tableGridScore: number
  wallLikeIrregularityScore: number
  uniformRowSpacingScore: number
  uniformColSpacingScore: number
  parallelHorizontalCount: number
  parallelVerticalCount: number
  shortCellSegmentRatio: number
  longWallSegmentRatio: number
  isLikelyTableGrid: boolean
  reasons: string[]
}

function scoreUniformLineSpacing(sortedPositions: number[]): number {
  if (sortedPositions.length < 8) return 0
  const gaps: number[] = []
  for (let i = 1; i < sortedPositions.length; i += 1) {
    const g = sortedPositions[i] - sortedPositions[i - 1]
    if (g >= 0.2 && g <= 24) gaps.push(g)
  }
  if (gaps.length < 6) return 0
  const sortedGaps = [...gaps].sort((a, b) => a - b)
  const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)] || 0
  if (medianGap <= 0) return 0
  const matching = gaps.filter((g) => Math.abs(g - medianGap) <= Math.max(0.18, medianGap * 0.18))
  return matching.length / gaps.length
}

function lengthVariance(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  let v = 0
  for (const x of values) v += (x - mean) ** 2
  return v / values.length
}

/**
 * Detect schedule/table/detail grids from orthogonal line regularity.
 * Used to penalize full-set wall-plan page ranking — dense uniform grids are not suites.
 */
export function analyzePageTableGridFromTrace(
  payload: PdfTracePayload | null | undefined,
): PageTableGridAnalysis {
  const empty: PageTableGridAnalysis = {
    tableGridScore: 0,
    wallLikeIrregularityScore: 0,
    uniformRowSpacingScore: 0,
    uniformColSpacingScore: 0,
    parallelHorizontalCount: 0,
    parallelVerticalCount: 0,
    shortCellSegmentRatio: 0,
    longWallSegmentRatio: 0,
    isLikelyTableGrid: false,
    reasons: [],
  }
  if (!payload) return empty

  const adapted = adaptPdfTraceToPlanLines(payload)
  const lines = adapted.lines.filter((l) => l.orthogonal && l.lengthFt >= 0.45)
  if (lines.length < 12) return empty

  const horizontals = lines.filter((l) => classifyLineOrientation(l) === 'horizontal')
  const verticals = lines.filter((l) => classifyLineOrientation(l) === 'vertical')
  const hPositions = horizontals.map((l) => (l.start.y + l.end.y) / 2).sort((a, b) => a - b)
  const vPositions = verticals.map((l) => (l.start.x + l.end.x) / 2).sort((a, b) => a - b)
  const uniformRowSpacingScore = scoreUniformLineSpacing(hPositions)
  const uniformColSpacingScore = scoreUniformLineSpacing(vPositions)

  const shortCell = lines.filter((l) => l.lengthFt < 5.5)
  const longWalls = lines.filter((l) => l.lengthFt >= 12)
  const shortCellSegmentRatio = shortCell.length / Math.max(1, lines.length)
  const longWallSegmentRatio = longWalls.length / Math.max(1, lines.length)
  const lenVar = lengthVariance(lines.map((l) => l.lengthFt))

  const gridLineCount = horizontals.length + verticals.length
  const gridDominance = gridLineCount / Math.max(1, lines.length)
  const uniformGrid =
    uniformRowSpacingScore >= 0.62 &&
    uniformColSpacingScore >= 0.62 &&
    horizontals.length >= 18 &&
    verticals.length >= 18

  let tableGridScore = 0
  const reasons: string[] = []
  if (uniformGrid) {
    tableGridScore += 0.38
    reasons.push('uniform_row_col_grid')
  }
  if (gridDominance > 0.88 && lines.length > 50) {
    tableGridScore += 0.12
    reasons.push('orthogonal_grid_dominant')
  }
  if (shortCellSegmentRatio > 0.52 && longWallSegmentRatio < 0.1) {
    tableGridScore += 0.22
    reasons.push('many_short_cells_few_long_walls')
  }
  if (horizontals.length > 35 && verticals.length > 35 && lenVar < 18) {
    tableGridScore += 0.15
    reasons.push('high_parallel_count_low_length_variance')
  }
  if (lines.length > 90 && uniformRowSpacingScore > 0.55 && uniformColSpacingScore > 0.55) {
    tableGridScore += 0.1
    reasons.push('dense_regular_lattice')
  }

  const openingHints =
    (payload.arcs?.length || 0) +
    lines.filter((l) => l.role === 'door' || l.role === 'window').length
  if (openingHints >= 2 && tableGridScore > 0.2) {
    tableGridScore -= 0.12
    reasons.push('opening_arcs_reduce_table_confidence')
  }

  tableGridScore = Math.max(0, Math.min(1, tableGridScore))

  let wallLikeIrregularityScore = 0
  wallLikeIrregularityScore += Math.min(0.35, lenVar / 90)
  wallLikeIrregularityScore += longWallSegmentRatio * 0.45
  wallLikeIrregularityScore += (1 - uniformRowSpacingScore) * 0.12
  wallLikeIrregularityScore += (1 - uniformColSpacingScore) * 0.12
  if (lines.length >= 20 && lines.length <= 220) wallLikeIrregularityScore += 0.08
  wallLikeIrregularityScore = Math.max(0, Math.min(1, wallLikeIrregularityScore))

  const isLikelyTableGrid =
    tableGridScore >= 0.52 ||
    (uniformGrid && shortCellSegmentRatio > 0.45) ||
    (horizontals.length > 40 && verticals.length > 40 && longWallSegmentRatio < 0.06)

  return {
    tableGridScore,
    wallLikeIrregularityScore,
    uniformRowSpacingScore,
    uniformColSpacingScore,
    parallelHorizontalCount: horizontals.length,
    parallelVerticalCount: verticals.length,
    shortCellSegmentRatio,
    longWallSegmentRatio,
    isLikelyTableGrid,
    reasons: reasons.slice(0, 6),
  }
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
