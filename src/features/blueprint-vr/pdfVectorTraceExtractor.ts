import type {
  PdfTraceArc,
  PdfTraceExtractionResult,
  PdfTraceExtractionWarning,
  PdfTraceLine,
  PdfTracePayload,
  PdfTracePoint,
  PdfTracePolyline,
  PdfTraceRect,
  PdfTraceScaleHint,
  PdfTraceTextRun,
} from './pdfTraceTypes'

type PdfPageLike = {
  getOperatorList?: () => Promise<any>
  getTextContent?: () => Promise<any>
  getViewport?: (args?: { scale?: number }) => any
  view?: number[]
}

type Matrix2D = [number, number, number, number, number, number]

type PathState = {
  points: PdfTracePoint[]
  closed: boolean
}

export interface PdfVectorTraceExtractorInput {
  page?: PdfPageLike | null
  pageNumber: number
  sheetNumber?: string
  sheetTitle?: string
  coordinateSpace?: PdfTracePayload['coordinateSpace']
  existingPayload?: PdfTracePayload | null
  expectedAdapterFields?: string[]
  opsConstants?: Record<string, number>
}

function warning(code: PdfTraceExtractionWarning['code'], message: string): PdfTraceExtractionWarning {
  return { code, message }
}

function createEmptyPayload(input: PdfVectorTraceExtractorInput): PdfTracePayload {
  return {
    pageNumber: Math.max(1, Math.floor(Number(input.pageNumber) || 1)),
    sheetNumber: input.sheetNumber,
    sheetTitle: input.sheetTitle,
    coordinateSpace: input.coordinateSpace || 'pdf-points',
    pageBounds: { width: 0, height: 0 },
    lines: [],
    rects: [],
    polylines: [],
    arcs: [],
    textRuns: [],
    scaleHints: [],
    warnings: [],
  }
}

function extractTextRuns(textContent: any): PdfTraceTextRun[] {
  const items = Array.isArray(textContent?.items) ? textContent.items : []
  const out: PdfTraceTextRun[] = []
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] || {}
    const str = String(item.str || '').trim()
    if (!str) continue
    const tx = Array.isArray(item.transform) ? Number(item.transform[4]) || 0 : 0
    const ty = Array.isArray(item.transform) ? Number(item.transform[5]) || 0 : 0
    const width = Number(item.width) || 0
    const height = Number(item.height) || 0
    out.push({
      id: `text-${i}`,
      text: str,
      origin: { x: tx, y: ty },
      bounds: {
        min: { x: tx, y: ty - height },
        max: { x: tx + width, y: ty },
      },
      confidence: 0.65,
    })
  }
  return out
}

function extractScaleHintsFromText(textRuns: PdfTraceTextRun[]): PdfTraceScaleHint[] {
  const hints: PdfTraceScaleHint[] = []
  const scaleRegex = /(\d+)\s*\/\s*(\d+)\s*["]?\s*=\s*(\d+)\s*['"]/i
  for (const run of textRuns) {
    const m = run.text.match(scaleRegex)
    if (!m) continue
    const numerator = Number(m[1])
    const denominator = Number(m[2])
    const feet = Number(m[3])
    if (!numerator || !denominator || !feet) continue
    const inches = numerator / denominator
    if (inches <= 0) continue
    hints.push({
      pixelsPerFoot: 1 / inches,
      confidence: 0.45,
      source: 'trace-text',
      raw: run.text,
    })
  }
  return hints
}

function multiplyMatrix(left: Matrix2D, right: Matrix2D): Matrix2D {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ]
}

function transformPoint(point: PdfTracePoint, matrix: Matrix2D): PdfTracePoint {
  return {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
  }
}

function samePoint(a: PdfTracePoint, b: PdfTracePoint, epsilon = 0.001): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon
}

function opMatches(fn: number, ops: Record<string, number>, names: string[]): boolean {
  for (const name of names) {
    const code = ops[name]
    if (typeof code === 'number' && fn === code) return true
  }
  return false
}

function normalizeRectFromPoints(points: PdfTracePoint[]): { x: number; y: number; width: number; height: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return {
    x: Number.isFinite(minX) ? minX : 0,
    y: Number.isFinite(minY) ? minY : 0,
    width: Number.isFinite(maxX - minX) ? maxX - minX : 0,
    height: Number.isFinite(maxY - minY) ? maxY - minY : 0,
  }
}

function decodeConstructPath(
  pathOps: number[],
  coords: number[],
  ops: Record<string, number>,
  pushMoveTo: (x: number, y: number) => void,
  pushLineTo: (x: number, y: number) => void,
  pushRect: (x: number, y: number, w: number, h: number) => void,
  pushClose: () => void,
): number {
  let index = 0
  let unsupported = 0
  for (const command of pathOps) {
    if (opMatches(command, ops, ['moveTo'])) {
      if (index + 1 < coords.length) pushMoveTo(Number(coords[index]), Number(coords[index + 1]))
      index += 2
      continue
    }
    if (opMatches(command, ops, ['lineTo'])) {
      if (index + 1 < coords.length) pushLineTo(Number(coords[index]), Number(coords[index + 1]))
      index += 2
      continue
    }
    if (opMatches(command, ops, ['rectangle'])) {
      if (index + 3 < coords.length) {
        pushRect(Number(coords[index]), Number(coords[index + 1]), Number(coords[index + 2]), Number(coords[index + 3]))
      }
      index += 4
      continue
    }
    if (opMatches(command, ops, ['closePath'])) {
      pushClose()
      continue
    }
    if (
      opMatches(command, ops, ['curveTo']) ||
      opMatches(command, ops, ['curveTo2']) ||
      opMatches(command, ops, ['curveTo3'])
    ) {
      index += 6
      unsupported += 1
      continue
    }
    unsupported += 1
  }
  return unsupported
}

function extractGeometryFromOperatorList(
  operatorList: any,
  ops: Record<string, number>,
  initialWarnings: PdfTraceExtractionWarning[],
): {
  lines: PdfTraceLine[]
  rects: PdfTraceRect[]
  polylines: PdfTracePolyline[]
  arcs: PdfTraceArc[]
  warnings: PdfTraceExtractionWarning[]
} {
  const fnArray: number[] = Array.isArray(operatorList?.fnArray) ? operatorList.fnArray : []
  const argsArray: any[] = Array.isArray(operatorList?.argsArray) ? operatorList.argsArray : []
  if (fnArray.length === 0 || argsArray.length === 0) {
    return {
      lines: [],
      rects: [],
      polylines: [],
      arcs: [],
      warnings: addUniqueWarning(initialWarnings, warning('EMPTY_TRACE_GEOMETRY', 'PDF operator list returned no drawing operations.')),
    }
  }

  const lines: PdfTraceLine[] = []
  const rects: PdfTraceRect[] = []
  const polylines: PdfTracePolyline[] = []
  const arcs: PdfTraceArc[] = []
  let warnings = [...initialWarnings]

  let lineId = 0
  let rectId = 0
  let polylineId = 0

  let ctm: Matrix2D = [1, 0, 0, 1, 0, 0]
  let currentLineWidth = 1
  const stack: Array<{ ctm: Matrix2D; lineWidth: number }> = []

  let currentPath: PathState[] = []

  const ensurePath = (): PathState => {
    const last = currentPath[currentPath.length - 1]
    if (last && !last.closed) return last
    const next: PathState = { points: [], closed: false }
    currentPath.push(next)
    return next
  }

  const pushMoveTo = (x: number, y: number): void => {
    const path: PathState = { points: [transformPoint({ x, y }, ctm)], closed: false }
    currentPath.push(path)
  }

  const pushLineTo = (x: number, y: number): void => {
    const path = ensurePath()
    path.points.push(transformPoint({ x, y }, ctm))
  }

  const pushRect = (x: number, y: number, width: number, height: number): void => {
    const p1 = transformPoint({ x, y }, ctm)
    const p2 = transformPoint({ x: x + width, y }, ctm)
    const p3 = transformPoint({ x: x + width, y: y + height }, ctm)
    const p4 = transformPoint({ x, y: y + height }, ctm)
    const normalized = normalizeRectFromPoints([p1, p2, p3, p4])
    rects.push({
      id: `rect-${rectId += 1}`,
      x: normalized.x,
      y: normalized.y,
      width: normalized.width,
      height: normalized.height,
      weight: currentLineWidth,
      role: 'unknown',
      confidence: 0.62,
    })
    currentPath.push({ points: [p1, p2, p3, p4], closed: true })
  }

  const pushClose = (): void => {
    const path = ensurePath()
    path.closed = true
  }

  const flushPath = (): void => {
    for (const path of currentPath) {
      if (!Array.isArray(path.points) || path.points.length < 2) continue
      const points = [...path.points]
      const closed = Boolean(path.closed)

      polylines.push({
        id: `polyline-${polylineId += 1}`,
        points,
        closed,
        role: 'unknown',
        confidence: closed ? 0.66 : 0.6,
      })

      for (let i = 0; i + 1 < points.length; i += 1) {
        const start = points[i]
        const end = points[i + 1]
        if (samePoint(start, end)) continue
        lines.push({
          id: `line-${lineId += 1}`,
          start,
          end,
          weight: currentLineWidth,
          role: 'unknown',
          confidence: 0.63,
        })
      }

      if (closed && points.length >= 3) {
        const start = points[points.length - 1]
        const end = points[0]
        if (!samePoint(start, end)) {
          lines.push({
            id: `line-${lineId += 1}`,
            start,
            end,
            weight: currentLineWidth,
            role: 'unknown',
            confidence: 0.63,
          })
        }
      }
    }
    currentPath = []
  }

  let unsupportedOps = 0

  for (let i = 0; i < fnArray.length; i += 1) {
    const fn = fnArray[i]
    const args = argsArray[i]
    if (opMatches(fn, ops, ['save'])) {
      stack.push({ ctm: [...ctm] as Matrix2D, lineWidth: currentLineWidth })
      continue
    }
    if (opMatches(fn, ops, ['restore'])) {
      const restored = stack.pop()
      if (restored) {
        ctm = restored.ctm
        currentLineWidth = restored.lineWidth
      }
      continue
    }
    if (opMatches(fn, ops, ['transform'])) {
      if (Array.isArray(args) && args.length >= 6) {
        const next: Matrix2D = [
          Number(args[0]) || 0,
          Number(args[1]) || 0,
          Number(args[2]) || 0,
          Number(args[3]) || 0,
          Number(args[4]) || 0,
          Number(args[5]) || 0,
        ]
        ctm = multiplyMatrix(ctm, next)
      }
      continue
    }
    if (opMatches(fn, ops, ['setLineWidth'])) {
      const raw = Array.isArray(args) ? Number(args[0]) : Number(args)
      currentLineWidth = Number.isFinite(raw) && raw > 0 ? raw : currentLineWidth
      continue
    }
    if (opMatches(fn, ops, ['moveTo'])) {
      if (Array.isArray(args) && args.length >= 2) pushMoveTo(Number(args[0]), Number(args[1]))
      continue
    }
    if (opMatches(fn, ops, ['lineTo'])) {
      if (Array.isArray(args) && args.length >= 2) pushLineTo(Number(args[0]), Number(args[1]))
      continue
    }
    if (opMatches(fn, ops, ['rectangle'])) {
      if (Array.isArray(args) && args.length >= 4) pushRect(Number(args[0]), Number(args[1]), Number(args[2]), Number(args[3]))
      continue
    }
    if (opMatches(fn, ops, ['constructPath'])) {
      if (Array.isArray(args) && args.length >= 2) {
        const pathOps = Array.isArray(args[0]) ? args[0].map((n: any) => Number(n)) : []
        const coords = Array.isArray(args[1]) ? args[1].map((n: any) => Number(n)) : []
        unsupportedOps += decodeConstructPath(pathOps, coords, ops, pushMoveTo, pushLineTo, pushRect, pushClose)
      } else {
        unsupportedOps += 1
      }
      continue
    }
    if (opMatches(fn, ops, ['closePath'])) {
      pushClose()
      continue
    }
    if (
      opMatches(fn, ops, ['stroke']) ||
      opMatches(fn, ops, ['fill']) ||
      opMatches(fn, ops, ['eoFill']) ||
      opMatches(fn, ops, ['fillStroke']) ||
      opMatches(fn, ops, ['eoFillStroke']) ||
      opMatches(fn, ops, ['closeStroke']) ||
      opMatches(fn, ops, ['closeFillStroke']) ||
      opMatches(fn, ops, ['closeEOFillStroke']) ||
      opMatches(fn, ops, ['endPath'])
    ) {
      flushPath()
      continue
    }
    unsupportedOps += 1
  }

  flushPath()
  if (unsupportedOps > 0) {
    warnings = addUniqueWarning(
      warnings,
      warning(
        'UNSUPPORTED_OPERATOR_SEQUENCE',
        `Skipped ${unsupportedOps} unsupported PDF operator sequence(s) while extracting vectors.`,
      ),
    )
  }

  return { lines, rects, polylines, arcs, warnings }
}

function addUniqueWarning(
  warnings: PdfTraceExtractionWarning[],
  next: PdfTraceExtractionWarning,
): PdfTraceExtractionWarning[] {
  if (warnings.some((w) => w.code === next.code && w.message === next.message)) {
    return warnings
  }
  return [...warnings, next]
}

/**
 * Normalize payload values and ensure deterministic ordering.
 */
export function normalizePdfTracePayload(payload: PdfTracePayload): PdfTracePayload {
  return {
    ...payload,
    pageNumber: Math.max(1, Math.floor(Number(payload.pageNumber) || 1)),
    lines: [...(payload.lines || [])].sort((a, b) => a.id.localeCompare(b.id)),
    rects: [...(payload.rects || [])].sort((a, b) => a.id.localeCompare(b.id)),
    polylines: [...(payload.polylines || [])].sort((a, b) => a.id.localeCompare(b.id)),
    arcs: [...(payload.arcs || [])].sort((a, b) => a.id.localeCompare(b.id)),
    textRuns: [...(payload.textRuns || [])].sort((a, b) => a.id.localeCompare(b.id)),
    scaleHints: [...(payload.scaleHints || [])],
    runtime: payload.runtime ? { ...payload.runtime } : undefined,
    warnings: [...(payload.warnings || [])],
  }
}

export function hasUsableTracePayload(payload: PdfTracePayload | null | undefined): boolean {
  if (!payload) return false
  const lineCount = Array.isArray(payload.lines) ? payload.lines.length : 0
  const rectCount = Array.isArray(payload.rects) ? payload.rects.length : 0
  const polyCount = Array.isArray(payload.polylines) ? payload.polylines.length : 0
  return lineCount + rectCount + polyCount > 0
}

/**
 * First-pass extraction seam for vector trace payloads.
 *
 * This is intentionally conservative. If the caller cannot provide a PDF page
 * object from viewer context, the result is a safe failure with explicit
 * adapter warnings (no fake geometry).
 */
export async function extractPdfVectorTraceFromPage(
  input: PdfVectorTraceExtractorInput,
): Promise<PdfTraceExtractionResult> {
  if (input.existingPayload) {
    const normalized = normalizePdfTracePayload(input.existingPayload)
    return {
      success: hasUsableTracePayload(normalized),
      payload: normalized,
      warnings: normalized.warnings || [],
    }
  }

  const warnings: PdfTraceExtractionWarning[] = []
  const payload = createEmptyPayload(input)
  const page = input.page
  let opsSource: 'provider' | 'dynamic-import' | 'missing' = 'missing'
  payload.runtime = {
    providerStatus: page ? 'available' : 'missing',
    selectedPageNumber: payload.pageNumber,
    operatorListStatus: 'unknown',
    textContentStatus: 'unknown',
  }

  if (!page) {
    warnings.push(warning('MISSING_PAGE_ACCESS', 'Vector trace unavailable from current viewer context.'))
    warnings.push(
      warning(
        'ADAPTER_REQUIRED',
        `Expected adapter fields: ${(input.expectedAdapterFields || ['page.getOperatorList', 'page.getTextContent', 'page.getViewport']).join(', ')}`,
      ),
    )
    payload.warnings = [...warnings]
    return { success: false, payload, warnings }
  }

  try {
    const viewport = typeof page.getViewport === 'function' ? page.getViewport({ scale: 1 }) : null
    const pageWidth = Number(viewport?.width || page.view?.[2] || 0)
    const pageHeight = Number(viewport?.height || page.view?.[3] || 0)
    payload.viewport = viewport
      ? {
          scale: Number(viewport.scale || 1),
          width: pageWidth,
          height: pageHeight,
          rotation: Number(viewport.rotation || 0),
          offsetX: Number(viewport.offsetX || 0),
          offsetY: Number(viewport.offsetY || 0),
        }
      : undefined
    payload.pageBounds = { width: pageWidth, height: pageHeight }
    if (!viewport) {
      warnings.push(warning('MISSING_VIEWPORT', 'Page viewport is unavailable.'))
    }
  } catch {
    warnings.push(warning('MISSING_VIEWPORT', 'Could not read page viewport.'))
  }

  try {
    if (typeof page.getTextContent === 'function') {
      const textContent = await page.getTextContent()
      payload.textRuns = extractTextRuns(textContent)
      payload.scaleHints = extractScaleHintsFromText(payload.textRuns)
      payload.runtime.textContentStatus = 'available'
    } else {
      payload.runtime.textContentStatus = 'missing'
      warnings.push(warning('MISSING_TEXT_CONTENT', 'Page textContent is unavailable.'))
    }
  } catch {
    payload.runtime.textContentStatus = 'error'
    warnings.push(warning('MISSING_TEXT_CONTENT', 'Failed reading PDF textContent.'))
  }

  try {
    if (typeof page.getOperatorList !== 'function') {
      payload.runtime.operatorListStatus = 'missing'
      warnings.push(
        warning(
          'MISSING_OPERATOR_LIST',
          'Page operator list is unavailable; vector path extraction not possible.',
        ),
      )
    } else {
      payload.runtime.operatorListStatus = 'available'
      const operatorList = await page.getOperatorList()
      let ops: Record<string, number> = {}
      if (input.opsConstants && Object.keys(input.opsConstants).length > 0) {
        ops = input.opsConstants
        opsSource = 'provider'
      } else {
        try {
          const pdfjsLib: any = await import(/* @vite-ignore */ 'pdfjs-dist')
          ops = (pdfjsLib?.OPS || {}) as Record<string, number>
          if (Object.keys(ops).length > 0) opsSource = 'dynamic-import'
        } catch {
          warnings.push(
            warning(
              'UNSUPPORTED_OPERATOR_SEQUENCE',
              'pdfjs OPS constants unavailable; operator decode is limited.',
            ),
          )
        }
      }
      const extracted = extractGeometryFromOperatorList(operatorList, ops, warnings)
      payload.lines = extracted.lines
      payload.rects = extracted.rects
      payload.polylines = extracted.polylines
      payload.arcs = extracted.arcs
      warnings.splice(0, warnings.length, ...extracted.warnings)
    }
  } catch {
    payload.runtime.operatorListStatus = 'error'
    warnings.push(warning('MISSING_OPERATOR_LIST', 'Failed reading PDF operator list.'))
  }

  if (
    payload.lines.length === 0 &&
    payload.rects.length === 0 &&
    payload.polylines.length === 0 &&
    payload.arcs.length === 0
  ) {
    warnings.push(
      warning(
        'EMPTY_TRACE_GEOMETRY',
        'No usable vector geometry extracted for this page.',
      ),
    )
  }

  payload.warnings = [...warnings]
  if (payload.runtime) payload.runtime.opsSource = opsSource
  const normalized = normalizePdfTracePayload(payload)
  return {
    success: hasUsableTracePayload(normalized),
    payload: normalized,
    warnings,
    opsSource,
  }
}

export type {
  PdfTracePayload,
  PdfTraceLine,
  PdfTraceRect,
  PdfTraceArc,
  PdfTraceTextRun,
}
