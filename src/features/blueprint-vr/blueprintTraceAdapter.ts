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
  PdfTracePolyline,
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

const ORTHO_TOLERANCE_DEG = 4

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

export interface AdaptedTrace {
  lines: PlanTraceLine[]
  scale: PdfTraceScaleHint | null
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
  if (!payload) {
    return { lines: [], scale: null }
  }
  const sourceLines = normalizeTraceLines(payload)
  if (sourceLines.length === 0) return { lines: [], scale: inferScaleFromTraceText(payload.textRuns || []) }

  const bestScale =
    inferScaleFromTraceText(payload.textRuns || []) ||
    payload.scaleHints?.find((h) => h.pixelsPerFoot > 0) ||
    null
  const scale: PdfTraceScaleHint =
    bestScale && bestScale.pixelsPerFoot > 0
      ? bestScale
      : { pixelsPerFoot: 1, confidence: 0.1, source: 'default' }

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

  const allLines = [...sourceLines, ...polylineLines]

  const out: PlanTraceLine[] = []
  for (const line of allLines) {
    const a = pdfToWorld(line.start.x, line.start.y, scale)
    const b = pdfToWorld(line.end.x, line.end.y, scale)
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthFt = Math.hypot(dx, dy)

    if (lengthFt < 0.5) continue

    const angle = angleBetween(a.x, a.y, b.x, b.y)
    const ortho = isOrthogonal(angle)

    let role: PlanTraceLine['role'] = 'unknown'
    if (line.role === 'exterior-wall' || line.role === 'interior-wall' ||
        line.role === 'door' || line.role === 'window' ||
        line.role === 'dimension') {
      role = line.role
    } else if (ortho && lengthFt >= 6) {
      role = 'exterior-wall'
    } else if (ortho && lengthFt >= 2) {
      role = 'interior-wall'
    }

    out.push({
      id: line.id,
      start: a,
      end: b,
      lengthFt,
      angleDeg: angle,
      orthogonal: ortho,
      role,
      confidence: line.confidence ?? (ortho ? 0.5 : 0.25),
    })
  }

  const filtered = filterNoiseLines(out)
  const merged = mergeCollinearSegments(filtered)
  return { lines: merged, scale }
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
  return lines.filter((line) => {
    if (line.lengthFt < 0.6) return false
    if (!line.orthogonal && line.lengthFt < 2.5) return false
    return true
  })
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
