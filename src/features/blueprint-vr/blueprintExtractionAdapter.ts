/**
 * src/features/blueprint-vr/blueprintExtractionAdapter.ts
 *
 * Safe adapter that converts the current Blueprint AI/PDF state into normalized VR inputs.
 *
 * This module:
 * - Accepts a broad `BlueprintDocumentLike` object (any shape with blueprint-ish properties)
 * - Normalizes it into a consistent metadata shape for VR generation
 * - Extracts electrical-specific hints and keywords
 * - Maps sheet index data to VR stage/discipline hints
 * - Performs NO OCR, NO API calls, NO external AI
 *
 * All extraction is deterministic and local.
 */

// ── Type Definitions ────────────────────────────────────────────────────────────

/**
 * Broad type representing a Blueprint document from the current app state.
 *
 * This is intentionally permissive to accept:
 * - BlueprintLibraryItem (from blueprintLibraryService.ts)
 * - BlueprintExtract (text extraction result)
 * - Hybrid objects combining both
 * - Incomplete or partial blueprint data
 *
 * The adapter normalizes these shapes into consistent metadata.
 */
export interface BlueprintDocumentLike {
  // Identification
  id?: string
  projectId?: string
  projectName?: string
  title?: string
  fileName?: string

  // Content metadata
  pageCount?: number
  pagesWithNotes?: number

  // Storage and access
  storagePath?: string
  fileSize?: number

  // Type and status
  type?: string // e.g., 'Full Set' | 'Electrical Only'
  status?: string // e.g., 'active' | 'archived'

  // Blueprint classification
  source?: string // e.g., 'operations_blueprint_ai'
  derivedFrom?: string
  derivationKind?: string

  // Sheet index (array of page-level metadata)
  sheetIndex?: BlueprintPageLike[]

  // Extracted content
  extractedText?: string
  pageTexts?: string[]
  electricalFlags?: string[]

  // Annotations
  annotationsSummary?: string
  annotations?: {
    id?: string
    pageNumber?: number
    type?: string
    text?: string
    color?: string
    // ... other annotation fields
  }[]

  // Timestamps
  createdAt?: string
  updatedAt?: string
  archivedAt?: string | null

  // Allow any other properties for flexibility
  [key: string]: unknown
}

/**
 * Broad type representing a single blueprint page's metadata.
 *
 * Normalizes across different page metadata schemas found in the app.
 */
export interface BlueprintPageLike {
  pageNumber?: number
  sheetLabel?: string
  sheetNumber?: string
  sheetTitle?: string
  discipline?: string
  confidence?: number | string
  source?: string
  updatedAt?: string

  // Allow any other properties for flexibility
  [key: string]: unknown
}

/**
 * Normalized blueprint metadata for VR generation.
 *
 * This is the output shape that VR generation code expects.
 * It contains all essential blueprint context in a guaranteed, consistent format.
 */
export interface NormalizedBlueprintMetadata {
  // Core identification
  projectName: string
  blueprintId: string
  blueprintTitle: string

  // Content structure
  pageCount: number
  activePage: number

  // Sheet organization
  sheetLabels: SheetLabelInfo[]
  totalSheets: number

  // Discipline and electrical hints
  disciplineHints: DisciplineHint[]
  electricalKeywords: string[]
  electricalConfidence: 'high' | 'medium' | 'low'

  // Annotation context
  hasAnnotations: boolean
  annotationPageNumbers: number[]

  // Optional extracted content
  extractedTextSample?: string
  sourceMetadata?: {
    type?: string
    storagePath?: string
    uploadedAt?: string
  }
}

/**
 * Information about a sheet in the blueprint.
 */
export interface SheetLabelInfo {
  pageNumber: number
  label: string
  discipline?: string
  confidence?: 'high' | 'medium' | 'low'
  title?: string
}

/**
 * Discipline categorization hint for a page or set of pages.
 */
export interface DisciplineHint {
  discipline: string
  pageNumbers: number[]
  confidence?: 'high' | 'medium' | 'low'
  count: number
}

// ── Electrical Keywords (local, no external calls) ──────────────────────────────

/**
 * Electrical keywords that indicate electrical work and system design info.
 *
 * These are extracted from blueprintExtractor.ts to maintain consistency
 * and are used to identify electrical discipline and keyword hints.
 */
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

/**
 * Common electrical symbols and abbreviations that appear on blueprints.
 *
 * These are deterministic patterns useful for electrical discipline identification.
 */
const ELECTRICAL_SYMBOLS = [
  // Electrical equipment symbols
  'DP', // disconnecting means
  'OC', // overcurrent
  'OCPD', // overcurrent protective device
  'PVC', // conduit
  'EMT', // conduit
  'GEC', // grounding electrode conductor
  'EGC', // equipment grounding conductor
  'AF', // amp frame
  'IC', // interrupting capacity
  'RMS', // root mean square
  'THW', // wire type
  'THHN', // wire type
  'THWN', // wire type
  'AWG', // wire gauge
  'XHHW', // wire type
  'USE', // wire type
  'RHW', // wire type

  // Common electrical prefixes in sheet numbers
  'E-', // typical electrical sheet prefix
  'ES-', // electrical symbol
  'EP-', // electrical plan
  'ER-', // electrical riser
] as const

// ── Helper Functions ───────────────────────────────────────────────────────────

/**
 * Validate a page number is within reasonable bounds.
 *
 * @param pageNumber The page number to validate
 * @param pageCount Total page count (optional upper bound)
 * @returns True if pageNumber is valid (positive, integer, within bounds)
 */
function isValidPageNumber(pageNumber: unknown, pageCount?: number): boolean {
  if (typeof pageNumber !== 'number') return false
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return false
  if (pageCount && pageNumber > pageCount) return false
  return true
}

/**
 * Normalize a page number to a safe value.
 * Returns 1 if invalid, clamped to [1, pageCount] if bounds provided.
 *
 * @param pageNumber The raw page number
 * @param pageCount Optional upper bound
 * @returns Safe page number
 */
function normalizePageNumber(pageNumber: unknown, pageCount?: number): number {
  if (!isValidPageNumber(pageNumber, pageCount)) return 1
  const safe = pageNumber as number
  if (pageCount && safe > pageCount) return pageCount
  return safe
}

/**
 * Safely convert pageCount to a positive integer.
 * Returns 0 if invalid or not provided.
 *
 * @param count Raw page count value
 * @returns Safe page count (0 or positive)
 */
function normalizePageCount(count: unknown): number {
  if (typeof count === 'number' && Number.isInteger(count) && count > 0) return count
  if (typeof count === 'string') {
    const parsed = parseInt(count, 10)
    if (!Number.isNaN(parsed) && parsed > 0) return parsed
  }
  return 0
}

/**
 * Extract project name from a blueprint document.
 *
 * Attempts to use projectName, then title, then fileName as fallback.
 *
 * @param doc Blueprint document
 * @returns Non-empty project name or default placeholder
 */
function extractProjectName(doc: BlueprintDocumentLike): string {
  if (doc.projectName && typeof doc.projectName === 'string') {
    const name = doc.projectName.trim()
    if (name) return name
  }

  if (doc.title && typeof doc.title === 'string') {
    const name = doc.title.trim()
    if (name) return name
  }

  if (doc.fileName && typeof doc.fileName === 'string') {
    const name = doc.fileName
      .replace(/\.[^.]+$/, '') // remove extension
      .replace(/[_-]/g, ' ') // replace underscores/hyphens with spaces
      .trim()
    if (name) return name
  }

  return 'Untitled Blueprint'
}

/**
 * Extract blueprint ID, preferring specific id, then derived identifiers.
 *
 * @param doc Blueprint document
 * @returns Non-empty blueprint ID
 */
function extractBlueprintId(doc: BlueprintDocumentLike): string {
  if (doc.id && typeof doc.id === 'string' && doc.id.trim()) {
    return doc.id.trim()
  }
  // Fallback: generate from projectId + timestamp
  if (doc.projectId && typeof doc.projectId === 'string') {
    return `${doc.projectId}_${Date.now()}`
  }
  return `blueprint_${Date.now()}`
}

/**
 * Extract blueprint title from document.
 *
 * @param doc Blueprint document
 * @returns Title or fallback
 */
function extractBlueprintTitle(doc: BlueprintDocumentLike): string {
  if (doc.title && typeof doc.title === 'string') {
    const title = doc.title.trim()
    if (title) return title
  }

  if (doc.fileName && typeof doc.fileName === 'string') {
    const title = doc.fileName.replace(/\.[^.]+$/, '').trim()
    if (title) return title
  }

  return 'Blueprint'
}

/**
 * Detect electrical keywords in a text string.
 *
 * Returns an array of detected keywords (no duplicates).
 * Comparison is case-insensitive.
 *
 * @param text The text to search
 * @returns Array of detected electrical keywords
 */
function detectElectricalKeywords(text: string): string[] {
  if (!text || typeof text !== 'string') return []

  const lowerText = text.toLowerCase()
  const detected = new Set<string>()

  for (const kw of ELECTRICAL_KEYWORDS) {
    if (lowerText.includes(kw.toLowerCase())) {
      detected.add(String(kw))
    }
  }

  return Array.from(detected).sort()
}

/**
 * Detect electrical symbols in a text string.
 *
 * Returns an array of detected symbols (no duplicates).
 * Useful for identifying electrical documents that may not have obvious keywords.
 *
 * @param text The text to search
 * @returns Array of detected electrical symbols
 */
function detectElectricalSymbols(text: string): string[] {
  if (!text || typeof text !== 'string') return []

  const lowerText = text.toLowerCase()
  const detected = new Set<string>()

  for (const sym of ELECTRICAL_SYMBOLS) {
    // Match as whole word or with common delimiters
    const patterns = [
      new RegExp(`\\b${sym.toLowerCase()}\\b`, 'g'),
      new RegExp(`\\b${sym.toUpperCase()}\\b`, 'g'),
    ]

    for (const pattern of patterns) {
      if (pattern.test(lowerText)) {
        detected.add(String(sym))
      }
    }
  }

  return Array.from(detected).sort()
}

/**
 * Calculate confidence level for electrical identification.
 *
 * High: Multiple strong indicators (keywords + symbols + discipline hints)
 * Medium: Some keywords or symbols present
 * Low: Minimal or no electrical indicators
 *
 * @param keywords Detected electrical keywords
 * @param symbols Detected electrical symbols
 * @param disciplineCount Count of pages with 'Electrical' discipline hint
 * @param totalPages Total page count for context
 * @returns Confidence level
 */
function calculateElectricalConfidence(
  keywords: string[],
  symbols: string[],
  disciplineCount: number,
  totalPages: number
): 'high' | 'medium' | 'low' {
  const keywordScore = Math.min(keywords.length / 5, 1) * 0.4
  const symbolScore = Math.min(symbols.length / 5, 1) * 0.3
  const disciplineScore = totalPages > 0 ? (disciplineCount / totalPages) * 0.3 : 0

  const totalScore = keywordScore + symbolScore + disciplineScore

  if (totalScore >= 0.6) return 'high'
  if (totalScore >= 0.3) return 'medium'
  return 'low'
}

/**
 * Extract sheet label information from a BlueprintPageLike object.
 *
 * Normalizes various label formats into a consistent SheetLabelInfo.
 *
 * @param page Page metadata
 * @returns SheetLabelInfo or null if invalid
 */
function extractSheetLabelInfo(page: BlueprintPageLike): SheetLabelInfo | null {
  if (!page || typeof page !== 'object') return null

  const pageNumber = normalizePageNumber(page.pageNumber)

  // Prefer sheetNumber, fall back to sheetLabel
  let label = ''
  if (page.sheetNumber && typeof page.sheetNumber === 'string') {
    label = page.sheetNumber.trim()
  } else if (page.sheetLabel && typeof page.sheetLabel === 'string') {
    label = page.sheetLabel.trim()
  }

  if (!label) return null

  const discipline = page.discipline && typeof page.discipline === 'string' ? page.discipline.trim() : undefined

  // Normalize confidence to enum
  let confidence: 'high' | 'medium' | 'low' | undefined
  if (typeof page.confidence === 'number') {
    if (page.confidence >= 0.7) confidence = 'high'
    else if (page.confidence >= 0.4) confidence = 'medium'
    else confidence = 'low'
  } else if (typeof page.confidence === 'string') {
    if (['high', 'medium', 'low'].includes(page.confidence.toLowerCase())) {
      confidence = page.confidence.toLowerCase() as 'high' | 'medium' | 'low'
    }
  }

  return {
    pageNumber,
    label,
    discipline,
    confidence,
    title: page.sheetTitle && typeof page.sheetTitle === 'string' ? page.sheetTitle.trim() : undefined,
  }
}

/**
 * Group pages by discipline hint.
 *
 * @param sheetLabels Array of sheet label info
 * @returns Record mapping discipline to set of page numbers
 */
function groupPagesByDiscipline(sheetLabels: SheetLabelInfo[]): Record<string, Set<number>> {
  const grouped: Record<string, Set<number>> = {}

  for (const sheet of sheetLabels) {
    const discipline = sheet.discipline || 'Uncategorized'
    if (!grouped[discipline]) {
      grouped[discipline] = new Set()
    }
    grouped[discipline].add(sheet.pageNumber)
  }

  return grouped
}

/**
 * Convert discipline grouping to DisciplineHint array.
 *
 * @param grouped Discipline-grouped pages
 * @returns Array of DisciplineHint
 */
function toDisciplineHints(grouped: Record<string, Set<number>>): DisciplineHint[] {
  return Object.entries(grouped)
    .map(([discipline, pageSet]) => ({
      discipline,
      pageNumbers: Array.from(pageSet).sort((a, b) => a - b),
      count: pageSet.size,
    }))
    .sort((a, b) => b.count - a.count) // Sort by most common first
}

// ── Public Adapter Functions ────────────────────────────────────────────────────

/**
 * Normalize any blueprint-shaped object into consistent metadata.
 *
 * This is the main entry point for the adapter.
 * It accepts a broad BlueprintDocumentLike and returns normalized VR-friendly metadata.
 *
 * @param doc Any object with blueprint-like properties
 * @returns NormalizedBlueprintMetadata with guaranteed structure
 */
export function normalizeBlueprint(doc: BlueprintDocumentLike): NormalizedBlueprintMetadata {
  // Normalize core metadata
  const projectName = extractProjectName(doc)
  const blueprintId = extractBlueprintId(doc)
  const blueprintTitle = extractBlueprintTitle(doc)
  const pageCount = normalizePageCount(doc.pageCount)
  const activePage = normalizePageNumber(1, pageCount) // Default to page 1

  // Extract sheet labels from index
  const sheetLabels: SheetLabelInfo[] = []
  if (Array.isArray(doc.sheetIndex)) {
    for (const page of doc.sheetIndex) {
      const info = extractSheetLabelInfo(page)
      if (info) {
        sheetLabels.push(info)
      }
    }
  }

  // Organize by discipline
  const grouped = groupPagesByDiscipline(sheetLabels)
  const disciplineHints = toDisciplineHints(grouped)

  // Extract electrical keywords
  const extractedText = doc.extractedText || ''
  const electricalKeywords = detectElectricalKeywords(extractedText)

  // Also check pageTexts if available (fallback)
  let allText = extractedText
  if (!extractedText && Array.isArray(doc.pageTexts)) {
    allText = doc.pageTexts.join(' ')
  }

  // Detect symbols for additional confidence
  const electricalSymbols = detectElectricalSymbols(allText)

  // If electricalFlags were pre-extracted, merge them
  if (Array.isArray(doc.electricalFlags)) {
    for (const flag of doc.electricalFlags) {
      if (typeof flag === 'string' && !electricalKeywords.includes(flag)) {
        electricalKeywords.push(flag)
      }
    }
  }

  // Calculate electrical confidence
  const electricalPageCount = disciplineHints.find((d) => d.discipline === 'Electrical')?.count || 0
  const electricalConfidence = calculateElectricalConfidence(
    electricalKeywords,
    electricalSymbols,
    electricalPageCount,
    pageCount || sheetLabels.length || 1
  )

  // Extract annotation page numbers if available
  const annotationPageNumbers: number[] = []
  if (Array.isArray(doc.annotations)) {
    const pages = new Set<number>()
    for (const ann of doc.annotations) {
      const pageNum = normalizePageNumber(ann.pageNumber, pageCount || 1000)
      if (isValidPageNumber(pageNum)) {
        pages.add(pageNum)
      }
    }
    annotationPageNumbers.push(...Array.from(pages).sort((a, b) => a - b))
  }

  // Build source metadata
  const sourceMetadata: Record<string, unknown> = {}
  if (doc.type) sourceMetadata.type = doc.type
  if (doc.storagePath) sourceMetadata.storagePath = doc.storagePath
  if (doc.createdAt) sourceMetadata.uploadedAt = doc.createdAt

  return {
    projectName,
    blueprintId,
    blueprintTitle,
    pageCount,
    activePage,
    sheetLabels,
    totalSheets: sheetLabels.length,
    disciplineHints,
    electricalKeywords: Array.from(new Set(electricalKeywords)).sort(),
    electricalConfidence,
    hasAnnotations: annotationPageNumbers.length > 0,
    annotationPageNumbers,
    extractedTextSample: extractedText.slice(0, 500),
    sourceMetadata: Object.keys(sourceMetadata).length > 0 ? sourceMetadata : undefined,
  }
}

/**
 * Extract VR-specific inputs from a blueprint.
 *
 * Convenience function that calls normalizeBlueprint and packages results
 * in a VR-friendly format.
 *
 * @param doc Blueprint document
 * @returns Object with VR-ready fields
 */
export function extractVRInputs(doc: BlueprintDocumentLike) {
  const normalized = normalizeBlueprint(doc)

  return {
    projectName: normalized.projectName,
    blueprintId: normalized.blueprintId,
    blueprintTitle: normalized.blueprintTitle,
    pageCount: normalized.pageCount,
    activePage: normalized.activePage,
    sheetLabels: normalized.sheetLabels.map((s) => s.label),
    electricalHints: {
      keywords: normalized.electricalKeywords,
      confidence: normalized.electricalConfidence,
      disciplineCount: normalized.disciplineHints.find((d) => d.discipline === 'Electrical')?.count || 0,
    },
    annotatedPages: normalized.annotationPageNumbers,
    hasContent: normalized.pageCount > 0,
  }
}

/**
 * Extract electrical-specific hints from a blueprint.
 *
 * Returns keywords, symbols, and confidence for electrical work identification.
 *
 * @param doc Blueprint document
 * @returns Electrical hints object
 */
export function getElectricalHints(doc: BlueprintDocumentLike) {
  const normalized = normalizeBlueprint(doc)

  const extractedText = doc.extractedText || ''
  const allText = extractedText || (Array.isArray(doc.pageTexts) ? doc.pageTexts.join(' ') : '')

  const symbols = detectElectricalSymbols(allText)

  return {
    keywords: normalized.electricalKeywords,
    symbols,
    confidence: normalized.electricalConfidence,
    foundPageCount: normalized.disciplineHints.find((d) => d.discipline === 'Electrical')?.count || 0,
    totalPageCount: normalized.pageCount,
  }
}

/**
 * Extract sheet labels from the sheet index.
 *
 * Useful for building sheet selection menus or understanding page organization.
 *
 * @param doc Blueprint document
 * @returns Array of sheet label info
 */
export function getSheetLabelsFromIndex(doc: BlueprintDocumentLike): SheetLabelInfo[] {
  const sheetLabels: SheetLabelInfo[] = []

  if (!Array.isArray(doc.sheetIndex)) {
    return sheetLabels
  }

  for (const page of doc.sheetIndex) {
    const info = extractSheetLabelInfo(page)
    if (info) {
      sheetLabels.push(info)
    }
  }

  return sheetLabels.sort((a, b) => a.pageNumber - b.pageNumber)
}

/**
 * Get a summary of disciplines found in the blueprint.
 *
 * Useful for UI that displays "Electrical + Mechanical + Plumbing" hints.
 *
 * @param doc Blueprint document
 * @returns Object with discipline counts and confidence
 */
export function getDisciplineSummary(doc: BlueprintDocumentLike) {
  const normalized = normalizeBlueprint(doc)

  const summary: Record<string, { count: number; pageNumbers: number[]; percentage: number }> = {}

  for (const hint of normalized.disciplineHints) {
    const percentage = normalized.pageCount > 0 ? (hint.count / normalized.pageCount) * 100 : 0
    summary[hint.discipline] = {
      count: hint.count,
      pageNumbers: hint.pageNumbers,
      percentage: Math.round(percentage),
    }
  }

  return summary
}

/**
 * Check if a blueprint is primarily electrical (high confidence).
 *
 * @param doc Blueprint document
 * @returns True if electrical confidence is 'high'
 */
export function isElectricalBlueprint(doc: BlueprintDocumentLike): boolean {
  const normalized = normalizeBlueprint(doc)
  return normalized.electricalConfidence === 'high'
}

/**
 * Get recommended active page for VR generation.
 *
 * If the blueprint has electrical pages, suggests the first electrical page.
 * Otherwise suggests page 1.
 *
 * @param doc Blueprint document
 * @returns Recommended page number
 */
export function getRecommendedActivePage(doc: BlueprintDocumentLike): number {
  const hints = getElectricalHints(doc)
  const sheetLabels = getSheetLabelsFromIndex(doc)

  // Find first electrical page
  for (const sheet of sheetLabels) {
    if (sheet.discipline === 'Electrical') {
      return sheet.pageNumber
    }
  }

  // Fallback to page 1
  return 1
}
