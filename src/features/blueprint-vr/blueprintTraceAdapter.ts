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
  PdfTraceLine,
  PdfTracePolyline,
  PdfTracePagePayload,
  PdfTraceScale,
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

function pdfToWorld(px: number, py: number, scale: PdfTraceScale): WorldPoint2D {
  const factor = scale.pixelsPerFoot > 0 ? 1 / scale.pixelsPerFoot : 1
  return { x: px * factor, y: py * factor }
}

// ---------------------------------------------------------------------------
// Main conversion
// ---------------------------------------------------------------------------

export interface AdaptedTrace {
  lines: PlanTraceLine[]
  scale: PdfTraceScale | null
}

/**
 * Convert a PDF trace payload into world-coordinate plan candidate lines.
 *
 * @param payload Optional upstream trace payload. When null/undefined or empty,
 *   the adapter returns an empty candidate set.
 */
export function adaptPdfTraceToPlanLines(
  payload: PdfTracePagePayload | null | undefined,
): AdaptedTrace {
  if (!payload || !Array.isArray(payload.lines) || payload.lines.length === 0) {
    return { lines: [], scale: payload?.scale ?? null }
  }

  const scale: PdfTraceScale =
    payload.scale && payload.scale.pixelsPerFoot > 0
      ? payload.scale
      : { pixelsPerFoot: 1, confidence: 0.1, source: 'default' }

  const polylineLines: PdfTraceLine[] = []
  if (Array.isArray(payload.polylines)) {
    payload.polylines.forEach((poly: PdfTracePolyline, polyIdx) => {
      for (let i = 0; i + 1 < poly.points.length; i++) {
        polylineLines.push({
          id: `${poly.id}-seg-${i}`,
          start: poly.points[i],
          end: poly.points[i + 1],
          role: poly.role ?? 'unknown',
          confidence: poly.confidence ?? 0.5,
          pageIndex: payload.pageIndex,
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
          pageIndex: payload.pageIndex,
          layer: `polyline-${polyIdx}`,
        })
      }
    })
  }

  const allLines = [...payload.lines, ...polylineLines]

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

  return { lines: out, scale }
}
