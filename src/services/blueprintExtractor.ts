// @ts-nocheck
/**
 * blueprintExtractor.ts
 *
 * PDF text extraction for Blueprint Intelligence feature.
 * Uses pdfjs-dist to extract text from uploaded blueprint PDFs.
 * Flags electrical pages containing key panel schedule keywords.
 *
 * Part of Session 13 — Blueprint Intelligence + PO Development Mode
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BlueprintExtract {
  extractedText: string
  pageCount: number
  electricalFlags: string[]
  pageTexts: string[]
}

export interface DetectedSheetIndexRow {
  pageNumber: number
  sheetNumber?: string
  sheetTitle?: string
  discipline?: string
  confidence: 'high' | 'medium' | 'low'
  source: 'auto'
  updatedAt: string
}

export interface SheetIndexDetectionResult {
  pageCount: number
  startPage: number
  endPage: number
  rows: DetectedSheetIndexRow[]
}

// ── Electrical keyword detection ──────────────────────────────────────────────

const ELECTRICAL_KEYWORDS = [
  'panel schedule',
  'load schedule',
  'one-line',
  'single line',
  'service entrance',
  'switchboard',
  'MDP',
  'distribution',
  'panelboard',
  'main breaker',
  'circuit breaker',
  'load center',
  'fault current',
  'short circuit',
  'KAIC',
  'SCCR',
  'AIC rating',
  'bus rating',
  'bus bar',
  'transformer',
  'meter socket',
  'metering',
  'feeder',
  'sub-panel',
  'subpanel',
  'disconnect',
] as const

function detectElectricalFlags(text: string): string[] {
  const lowerText = text.toLowerCase()
  const found: string[] = []
  for (const kw of ELECTRICAL_KEYWORDS) {
    if (lowerText.includes(kw.toLowerCase())) {
      if (!found.includes(kw)) found.push(kw)
    }
  }
  return found
}

const SHEET_NUMBER_PATTERNS: Array<{ discipline: string; regex: RegExp }> = [
  { discipline: 'Fire Alarm', regex: /\bFA[-\s]?\d{1,3}(?:\.\d{1,3})?\b/i },
  { discipline: 'Electrical', regex: /\bE[-\s]?\d{1,3}(?:\.\d{1,3})?\b/i },
  { discipline: 'Plumbing', regex: /\bP[-\s]?\d{1,3}(?:\.\d{1,3})?\b/i },
  { discipline: 'Mechanical', regex: /\bM[-\s]?\d{1,3}(?:\.\d{1,3})?\b/i },
  { discipline: 'Architectural', regex: /\bA[-\s]?\d{1,3}(?:\.\d{1,3})?\b/i },
  { discipline: 'Structural', regex: /\bS[-\s]?\d{1,3}(?:\.\d{1,3})?\b/i },
  { discipline: 'Civil', regex: /\bC[-\s]?\d{1,3}(?:\.\d{1,3})?\b/i },
  { discipline: 'General', regex: /\bG[-\s]?\d{1,3}(?:\.\d{1,3})?\b/i },
]

const DISCIPLINE_KEYWORDS: Record<string, string[]> = {
  Electrical: ['electrical', 'lighting', 'power', 'panel', 'one-line', 'one line'],
  Plumbing: ['plumbing', 'water', 'waste', 'gas'],
  Mechanical: ['mechanical', 'hvac', 'duct'],
  'Fire Alarm': ['fire alarm', 'smoke', 'fa'],
  Architectural: ['architectural', 'floor plan', 'elevation'],
  Structural: ['structural', 'foundation', 'framing'],
  Civil: ['civil', 'site', 'grading'],
  General: ['general', 'notes', 'cover'],
}

function normalizeSheetNumber(value?: string): string | undefined {
  if (!value) return undefined
  return value.replace(/\s+/g, '').toUpperCase()
}

function guessDisciplineFromText(text: string): string | undefined {
  const lower = text.toLowerCase()
  for (const [discipline, kws] of Object.entries(DISCIPLINE_KEYWORDS)) {
    if (kws.some((kw) => lower.includes(kw))) return discipline
  }
  return undefined
}

function detectSheetFromPageText(pageText: string): {
  sheetNumber?: string
  sheetTitle?: string
  discipline?: string
  confidence: 'high' | 'medium' | 'low'
} {
  const cleanText = String(pageText || '').replace(/\s+/g, ' ').trim()
  if (!cleanText) return { confidence: 'low' }

  let detectedNumber: string | undefined
  let detectedDiscipline: string | undefined
  for (const p of SHEET_NUMBER_PATTERNS) {
    const m = cleanText.match(p.regex)
    if (m?.[0]) {
      detectedNumber = normalizeSheetNumber(m[0])
      detectedDiscipline = p.discipline
      break
    }
  }

  if (!detectedDiscipline) {
    detectedDiscipline = guessDisciplineFromText(cleanText)
  }

  const titleSegments = cleanText
    .split(/[\n|]/g)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 16)
  let sheetTitle = ''
  for (const seg of titleSegments) {
    const compact = seg.replace(/\s+/g, ' ').trim()
    if (!compact) continue
    const upperRatio = compact.replace(/[^A-Z]/g, '').length / Math.max(1, compact.replace(/[^A-Za-z]/g, '').length)
    const hasWords = compact.split(' ').length >= 2
    const notJustCode = !/^[A-Z]{1,3}[-\s]?\d/.test(compact)
    if (hasWords && notJustCode && upperRatio > 0.55) {
      sheetTitle = compact.slice(0, 120)
      break
    }
  }

  let confidence: 'high' | 'medium' | 'low' = 'low'
  if (detectedNumber && (detectedDiscipline || sheetTitle)) confidence = 'high'
  else if (detectedNumber) confidence = 'medium'
  else if (detectedDiscipline || sheetTitle) confidence = 'low'

  return {
    sheetNumber: detectedNumber,
    sheetTitle: sheetTitle || undefined,
    discipline: detectedDiscipline,
    confidence,
  }
}

// ── PDF.js loader (lazy) ──────────────────────────────────────────────────────

let _pdfjsLib: typeof import('pdfjs-dist') | null = null

async function getPdfjsLib(): Promise<typeof import('pdfjs-dist')> {
  if (_pdfjsLib) return _pdfjsLib

  try {
    // Dynamic import to avoid SSR issues and allow tree shaking
    const pdfjsLib = await import(/* @vite-ignore */ 'pdfjs-dist')

    // Configure worker — use CDN worker to avoid bundling issues
    // The worker URL must match the installed pdfjs-dist version
    if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      // Use the bundled worker (Vite handles this via URL import)
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url
      ).toString()
    }

    _pdfjsLib = pdfjsLib
    return pdfjsLib
  } catch (e) {
    console.warn('[blueprintExtractor] pdfjs-dist not available:', e)
    throw new Error('PDF extraction requires pdfjs-dist. Run: npm install pdfjs-dist')
  }
}

// ── Main extraction function ──────────────────────────────────────────────────

/**
 * Extract text content from a PDF File using pdfjs-dist.
 * Returns extracted text, page count, and detected electrical keyword flags.
 *
 * @param file   The PDF File object from a file input or drag-drop
 * @param label  The user-selected label type (used for prioritization)
 */
export async function extractBlueprintText(
  file: File,
  label: string = 'Full Set'
): Promise<BlueprintExtract> {
  const fallback: BlueprintExtract = {
    extractedText: '',
    pageCount: 0,
    electricalFlags: [],
    pageTexts: [],
  }

  try {
    const pdfjsLib = await getPdfjsLib()

    // Convert File to ArrayBuffer
    const arrayBuffer = await file.arrayBuffer()

    // Load the PDF document
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    const pdfDoc = await loadingTask.promise

    const pageCount = pdfDoc.numPages
    const pageTexts: string[] = []
    const allElectricalFlags = new Set<string>()

    // Extract text from each page
    // For large blueprints, limit to first 30 pages to keep context manageable
    const maxPages = Math.min(pageCount, 30)

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      try {
        const page = await pdfDoc.getPage(pageNum)
        const textContent = await page.getTextContent()

        // Join text items from this page
        const pageText = textContent.items
          .filter((item: any) => 'str' in item)
          .map((item: any) => (item as { str: string }).str)
          .join(' ')
          .trim()

        pageTexts.push(pageText)

        // Flag electrical pages
        const flags = detectElectricalFlags(pageText)
        flags.forEach(f => allElectricalFlags.add(f))
      } catch (pageErr) {
        console.warn(`[blueprintExtractor] Error extracting page ${pageNum}:`, pageErr)
        pageTexts.push('') // Keep index alignment
      }
    }

    // For Electrical Only sheets, prioritize electrical content pages
    let combinedText = ''
    if (label === 'Electrical Only') {
      // Put flagged pages first
      const flaggedPages: string[] = []
      const otherPages: string[] = []

      pageTexts.forEach(pt => {
        if (detectElectricalFlags(pt).length > 0) {
          flaggedPages.push(pt)
        } else {
          otherPages.push(pt)
        }
      })
      combinedText = [...flaggedPages, ...otherPages].join('\n\n--- PAGE BREAK ---\n\n')
    } else {
      combinedText = pageTexts.join('\n\n--- PAGE BREAK ---\n\n')
    }

    // Clean up: normalize whitespace, remove excessive blank lines
    combinedText = combinedText
      .replace(/\s{3,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    return {
      extractedText: combinedText,
      pageCount,
      electricalFlags: Array.from(allElectricalFlags),
      pageTexts,
    }
  } catch (e: unknown) {
    console.error('[blueprintExtractor] Extraction failed:', e)

    // Return empty result with error info — don't throw; caller handles
    return {
      ...fallback,
      extractedText: `[Text extraction failed: ${e instanceof Error ? e.message : String(e)}]`,
    }
  }
}

// ── Utility: Estimate page count without full extraction ───────────────────────

/**
 * Quick page count estimate without full text extraction.
 * Useful for showing page count immediately after upload.
 */
export async function getPageCount(file: File): Promise<number> {
  try {
    const pdfjsLib = await getPdfjsLib()
    const arrayBuffer = await file.arrayBuffer()
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    const pdfDoc = await loadingTask.promise
    return pdfDoc.numPages
  } catch {
    return 0
  }
}

export async function extractSheetIndexCandidatesFromStorage(params: {
  storagePath: string
  startPage?: number
  endPage?: number
  maxPages?: number
  onProgress?: (progress: { processed: number; total: number; pageNumber: number }) => void
}): Promise<SheetIndexDetectionResult> {
  const storagePath = String(params?.storagePath || '').trim()
  if (!storagePath) throw new Error('Missing storagePath for auto-detect.')

  const { getBlueprintSignedUrl } = await import('@/services/blueprintLibraryService')
  const signedUrl = await getBlueprintSignedUrl(storagePath, 1800)
  const resp = await fetch(signedUrl)
  if (!resp.ok) throw new Error('Failed to fetch blueprint PDF for auto-detect.')
  const bytes = await resp.arrayBuffer()

  const pdfjsLib = await getPdfjsLib()
  const loadingTask = pdfjsLib.getDocument({ data: bytes })
  const pdfDoc = await loadingTask.promise
  const pageCount = Number(pdfDoc.numPages || 0)
  if (pageCount < 1) {
    return { pageCount: 0, startPage: 1, endPage: 0, rows: [] }
  }

  const requestedStart = Math.max(1, Math.floor(Number(params?.startPage) || 1))
  const defaultEnd = Math.min(pageCount, Math.max(1, Number(params?.maxPages) || 30))
  const requestedEnd = Math.floor(Number(params?.endPage) || defaultEnd)
  const startPage = Math.max(1, Math.min(pageCount, requestedStart))
  const endPage = Math.max(startPage, Math.min(pageCount, requestedEnd))

  const rows: DetectedSheetIndexRow[] = []
  const total = endPage - startPage + 1
  for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
    const page = await pdfDoc.getPage(pageNum)
    const textContent = await page.getTextContent()
    const pageText = textContent.items
      .filter((item: any) => 'str' in item)
      .map((item: any) => String((item as { str: string }).str || ''))
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
    const parsed = detectSheetFromPageText(pageText)
    if (parsed.sheetNumber || parsed.sheetTitle || parsed.discipline) {
      rows.push({
        pageNumber: pageNum,
        sheetNumber: parsed.sheetNumber,
        sheetTitle: parsed.sheetTitle,
        discipline: parsed.discipline,
        confidence: parsed.confidence,
        source: 'auto',
        updatedAt: new Date().toISOString(),
      })
    }

    const processed = pageNum - startPage + 1
    params?.onProgress?.({ processed, total, pageNumber: pageNum })
    if (processed % 3 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }

  return { pageCount, startPage, endPage, rows }
}
