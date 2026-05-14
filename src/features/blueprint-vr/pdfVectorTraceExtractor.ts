import type {
  PdfTraceArc,
  PdfTraceExtractionResult,
  PdfTraceExtractionWarning,
  PdfTraceLine,
  PdfTracePayload,
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

export interface PdfVectorTraceExtractorInput {
  page?: PdfPageLike | null
  pageNumber: number
  sheetNumber?: string
  sheetTitle?: string
  coordinateSpace?: PdfTracePayload['coordinateSpace']
  existingPayload?: PdfTracePayload | null
  expectedAdapterFields?: string[]
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

  if (!page) {
    warnings.push(
      warning(
        'MISSING_PAGE_ACCESS',
        'Vector trace unavailable from current viewer context.',
      ),
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
    } else {
      warnings.push(warning('MISSING_TEXT_CONTENT', 'Page textContent is unavailable.'))
    }
  } catch {
    warnings.push(warning('MISSING_TEXT_CONTENT', 'Failed reading PDF textContent.'))
  }

  try {
    if (typeof page.getOperatorList !== 'function') {
      warnings.push(
        warning(
          'MISSING_OPERATOR_LIST',
          'Page operator list is unavailable; vector path extraction not possible.',
        ),
      )
    } else {
      // Seam in place: operator list can now be consumed here when exposed.
      // First pass keeps extraction conservative to avoid incorrect geometry.
      await page.getOperatorList()
      warnings.push(
        warning(
          'UNSUPPORTED_OPERATOR_SEQUENCE',
          'Operator parsing seam is ready, but line/path decoding is not enabled in this pass.',
        ),
      )
    }
  } catch {
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
  const normalized = normalizePdfTracePayload(payload)
  return {
    success: hasUsableTracePayload(normalized),
    payload: normalized,
    warnings,
  }
}

export type {
  PdfTracePayload,
  PdfTraceLine,
  PdfTraceRect,
  PdfTraceArc,
  PdfTraceTextRun,
}
