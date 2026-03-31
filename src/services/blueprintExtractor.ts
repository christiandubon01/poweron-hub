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
