import {
  extractPdfVectorTraceFromPage,
  hasUsableTracePayload,
} from './pdfVectorTraceExtractor'
import type {
  PdfTraceExtractionResult,
  PdfTraceExtractionWarning,
  PdfTracePayload,
} from './pdfTraceTypes'

export type BlueprintPdfRuntimeProvider = {
  projectId?: string
  sourceSetId?: string
  sourceSetName?: string
  blueprintId?: string
  fileName?: string
  pageCount?: number
  metadata?: Record<string, any>
  getPage?: (pageNumber: number) => Promise<any>
  getCurrentPage?: () => Promise<any>
  getTextContent?: (pageNumber: number) => Promise<any>
  getOperatorList?: (pageNumber: number) => Promise<any>
}

export interface BlueprintPdfRuntimeLookup {
  projectId?: string
  sourceSetId?: string
  sourceSetName?: string
  blueprintId?: string
  fileName?: string
  pageCount?: number
}

export interface RuntimeTraceForSheetInput extends BlueprintPdfRuntimeLookup {
  pageNumber: number
  sheetNumber?: string
  sheetTitle?: string
  existingPayload?: PdfTracePayload | null
}

export interface RuntimeTraceForSheetResult {
  providerStatus: 'available' | 'missing' | 'error'
  providerKey?: string
  providerRequestedKey?: string
  providerRegisteredKeys?: string[]
  providerMatchReason?: string
  providerMetadata?: Record<string, any>
  selectedPageNumber: number
  operatorListStatus: 'available' | 'missing' | 'error' | 'unknown'
  textContentStatus: 'available' | 'missing' | 'error' | 'unknown'
  result: PdfTraceExtractionResult
}

type RuntimeRegistryEntry = {
  key: string
  provider: BlueprintPdfRuntimeProvider
  registeredAt: number
}

const runtimeProviders = new Map<string, RuntimeRegistryEntry>()

function safePart(value?: string): string {
  const raw = String(value || '').trim().toLowerCase()
  return raw || 'na'
}

function safeCount(value?: number): string {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 'na'
  return String(Math.floor(parsed))
}

function normalizeLookup(input: BlueprintPdfRuntimeLookup): Required<BlueprintPdfRuntimeLookup> {
  return {
    projectId: safePart(input.projectId),
    sourceSetId: safePart(input.sourceSetId),
    sourceSetName: safePart(input.sourceSetName),
    blueprintId: safePart(input.blueprintId),
    fileName: safePart(input.fileName),
    pageCount: Number(safeCount(input.pageCount)),
  }
}

export function buildBlueprintPdfRuntimeKey(input: BlueprintPdfRuntimeLookup): string {
  const normalized = normalizeLookup(input)
  return [
    normalized.projectId,
    normalized.blueprintId,
    normalized.sourceSetId,
    normalized.sourceSetName,
    normalized.fileName,
    safeCount(normalized.pageCount),
  ].join('::')
}

// Backward-compatible alias from W3.10C.
export const buildBlueprintPdfRuntimeProviderKey = buildBlueprintPdfRuntimeKey

function addWarning(
  warnings: PdfTraceExtractionWarning[],
  code: PdfTraceExtractionWarning['code'],
  message: string,
): PdfTraceExtractionWarning[] {
  return [...warnings, { code, message }]
}

export function registerBlueprintPdfRuntimeProvider(
  key: string,
  provider: BlueprintPdfRuntimeProvider,
): string {
  const normalized = String(key || '').trim()
  if (!normalized) return ''
  runtimeProviders.set(normalized, {
    key: normalized,
    provider,
    registeredAt: Date.now(),
  })
  return normalized
}

export function unregisterBlueprintPdfRuntimeProvider(key: string): boolean {
  const normalized = String(key || '').trim()
  if (!normalized) return false
  return runtimeProviders.delete(normalized)
}

export function getBlueprintPdfRuntimeProvider(key: string): BlueprintPdfRuntimeProvider | null {
  const normalized = String(key || '').trim()
  if (!normalized) return null
  return runtimeProviders.get(normalized)?.provider || null
}

function scoreProviderMatch(
  request: BlueprintPdfRuntimeLookup,
  provider: BlueprintPdfRuntimeProvider,
): { score: number; reason: string } {
  const req = normalizeLookup(request)
  const p = normalizeLookup({
    projectId: provider.projectId,
    sourceSetId: provider.sourceSetId,
    sourceSetName: provider.sourceSetName,
    blueprintId: provider.blueprintId,
    fileName: provider.fileName,
    pageCount: provider.pageCount,
  })
  const fields: Array<{
    name: string
    req: string | number
    provider: string | number
    weight: number
  }> = [
    { name: 'projectId', req: req.projectId, provider: p.projectId, weight: 4 },
    { name: 'blueprintId', req: req.blueprintId, provider: p.blueprintId, weight: 6 },
    { name: 'sourceSetId', req: req.sourceSetId, provider: p.sourceSetId, weight: 6 },
    { name: 'sourceSetName', req: req.sourceSetName, provider: p.sourceSetName, weight: 2 },
    { name: 'fileName', req: req.fileName, provider: p.fileName, weight: 3 },
    { name: 'pageCount', req: safeCount(req.pageCount), provider: safeCount(p.pageCount), weight: 2 },
  ]
  let score = 0
  let matched = 0
  const mismatches: string[] = []
  for (const field of fields) {
    const reqValue = String(field.req)
    const providerValue = String(field.provider)
    if (reqValue === 'na' || providerValue === 'na') continue
    if (reqValue === providerValue) {
      score += field.weight
      matched += 1
    } else {
      mismatches.push(field.name)
    }
  }
  const reason =
    matched > 0
      ? mismatches.length
        ? `best_partial_match;mismatched=${mismatches.join(',')}`
        : 'best_partial_match;all_available_fields_matched'
      : 'no_shared_identity_fields'
  return { score, reason }
}

export function listBlueprintPdfRuntimeProviderKeys(): string[] {
  return Array.from(runtimeProviders.keys())
}

export function getBlueprintPdfRuntimeProviderDebug(
  request: BlueprintPdfRuntimeLookup,
): {
  requestedKey: string
  registeredKeys: string[]
  matched: boolean
  matchReason: string
  matchedKey?: string
  providerMetadata?: Record<string, any>
} {
  const requestedKey = buildBlueprintPdfRuntimeKey(request)
  const exact = runtimeProviders.get(requestedKey)
  if (exact) {
    return {
      requestedKey,
      registeredKeys: listBlueprintPdfRuntimeProviderKeys(),
      matched: true,
      matchReason: 'exact_key_match',
      matchedKey: exact.key,
      providerMetadata: exact.provider.metadata || {
        projectId: exact.provider.projectId,
        blueprintId: exact.provider.blueprintId,
        sourceSetId: exact.provider.sourceSetId,
        sourceSetName: exact.provider.sourceSetName,
        fileName: exact.provider.fileName,
        pageCount: exact.provider.pageCount,
      },
    }
  }

  let best: RuntimeRegistryEntry | null = null
  let bestReason = 'no_runtime_provider_registered'
  let bestScore = -1
  for (const entry of runtimeProviders.values()) {
    const scored = scoreProviderMatch(request, entry.provider)
    if (scored.score > bestScore || (scored.score === bestScore && !!best && entry.registeredAt > best.registeredAt)) {
      best = entry
      bestScore = scored.score
      bestReason = scored.reason
    }
  }
  if (!best || bestScore < 1) {
    return {
      requestedKey,
      registeredKeys: listBlueprintPdfRuntimeProviderKeys(),
      matched: false,
      matchReason: bestReason,
    }
  }
  return {
    requestedKey,
    registeredKeys: listBlueprintPdfRuntimeProviderKeys(),
    matched: true,
    matchReason: bestReason,
    matchedKey: best.key,
    providerMetadata: best.provider.metadata || {
      projectId: best.provider.projectId,
      blueprintId: best.provider.blueprintId,
      sourceSetId: best.provider.sourceSetId,
      sourceSetName: best.provider.sourceSetName,
      fileName: best.provider.fileName,
      pageCount: best.provider.pageCount,
    },
  }
}

export function getActivePdfTracePageProvider(
  lookup: BlueprintPdfRuntimeLookup,
): { key: string; provider: BlueprintPdfRuntimeProvider } | null {
  const debug = getBlueprintPdfRuntimeProviderDebug(lookup)
  if (!debug.matched || !debug.matchedKey) return null
  const entry = runtimeProviders.get(debug.matchedKey)
  if (!entry) return null
  return { key: entry.key, provider: entry.provider }
}

export async function extractTraceForBlueprintSheet(
  input: RuntimeTraceForSheetInput,
): Promise<RuntimeTraceForSheetResult> {
  const pageNumber = Math.max(1, Math.floor(Number(input.pageNumber) || 1))
  const runtimeDebug = getBlueprintPdfRuntimeProviderDebug(input)
  const opsConstants = (runtimeDebug.providerMetadata?.opsConstants || {}) as Record<string, number>
  const runtimeMatch = runtimeDebug.matchedKey
    ? getActivePdfTracePageProvider(input)
    : null
  const existingPayload = input.existingPayload || null

  if (!runtimeMatch) {
    const fallback = await extractPdfVectorTraceFromPage({
      pageNumber,
      sheetNumber: input.sheetNumber,
      sheetTitle: input.sheetTitle,
      existingPayload,
      page: null,
      expectedAdapterFields: ['runtime provider registration in OperationsBlueprintPdfViewer'],
    })
    const warnings = addWarning(
      fallback.warnings,
      'RUNTIME_PROVIDER_MISSING',
      'Runtime PDF provider missing for selected floor-plan sheet.',
    )
    const payload: PdfTracePayload | null = fallback.payload
      ? {
          ...fallback.payload,
          runtime: {
            providerStatus: 'missing',
            providerRequestedKey: runtimeDebug.requestedKey,
            providerRegisteredKeys: runtimeDebug.registeredKeys,
            providerMatchReason: runtimeDebug.matchReason,
            selectedPageNumber: pageNumber,
            operatorListStatus: 'unknown',
            textContentStatus: 'unknown',
          },
          warnings,
        }
      : null
    return {
      providerStatus: 'missing',
      providerRequestedKey: runtimeDebug.requestedKey,
      providerRegisteredKeys: runtimeDebug.registeredKeys,
      providerMatchReason: runtimeDebug.matchReason,
      providerMetadata: runtimeDebug.providerMetadata,
      selectedPageNumber: pageNumber,
      operatorListStatus: 'unknown',
      textContentStatus: 'unknown',
      result: {
        success: hasUsableTracePayload(payload),
        payload,
        warnings,
      },
    }
  }

  const { provider, key } = runtimeMatch
  let providerStatus: RuntimeTraceForSheetResult['providerStatus'] = 'available'
  let operatorListStatus: RuntimeTraceForSheetResult['operatorListStatus'] = 'unknown'
  let textContentStatus: RuntimeTraceForSheetResult['textContentStatus'] = 'unknown'

  try {
    const canGetPage = typeof provider.getPage === 'function'
    const canGetCurrent = typeof provider.getCurrentPage === 'function'
    const page =
      canGetPage
        ? await provider.getPage!(pageNumber)
        : canGetCurrent
        ? await provider.getCurrentPage!()
        : null

    const textFromProvider =
      typeof provider.getTextContent === 'function'
        ? async () => provider.getTextContent!(pageNumber)
        : null
    const opFromProvider =
      typeof provider.getOperatorList === 'function'
        ? async () => provider.getOperatorList!(pageNumber)
        : null

    if (page && typeof page.getOperatorList === 'function') operatorListStatus = 'available'
    else if (opFromProvider) operatorListStatus = 'available'
    else operatorListStatus = 'missing'

    if (page && typeof page.getTextContent === 'function') textContentStatus = 'available'
    else if (textFromProvider) textContentStatus = 'available'
    else textContentStatus = 'missing'

    const pageLike = page
      ? {
          ...page,
          getOperatorList:
            typeof page.getOperatorList === 'function'
              ? () => page.getOperatorList()
              : opFromProvider || undefined,
          getTextContent:
            typeof page.getTextContent === 'function'
              ? () => page.getTextContent()
              : textFromProvider || undefined,
        }
      : null

    const extracted = await extractPdfVectorTraceFromPage({
      page: pageLike,
      pageNumber,
      sheetNumber: input.sheetNumber,
      sheetTitle: input.sheetTitle,
      existingPayload,
      opsConstants,
      expectedAdapterFields: ['provider.getPage', 'page.getOperatorList', 'page.getTextContent'],
    })

    const payload: PdfTracePayload | null = extracted.payload
      ? {
          ...extracted.payload,
          runtime: {
            providerStatus,
            providerKey: key,
            providerRequestedKey: runtimeDebug.requestedKey,
            providerRegisteredKeys: runtimeDebug.registeredKeys,
            providerMatchReason: runtimeDebug.matchReason,
            providerMetadata: runtimeDebug.providerMetadata,
            selectedPageNumber: pageNumber,
            operatorListStatus,
            textContentStatus,
            opsSource: extracted.opsSource,
          },
          warnings: extracted.warnings,
        }
      : null

    return {
      providerStatus,
      providerKey: key,
      providerRequestedKey: runtimeDebug.requestedKey,
      providerRegisteredKeys: runtimeDebug.registeredKeys,
      providerMatchReason: runtimeDebug.matchReason,
      providerMetadata: runtimeDebug.providerMetadata,
      selectedPageNumber: pageNumber,
      operatorListStatus,
      textContentStatus,
      result: {
        success: hasUsableTracePayload(payload),
        payload,
        warnings: extracted.warnings,
      },
    }
  } catch (error: any) {
    providerStatus = 'error'
    operatorListStatus = operatorListStatus === 'unknown' ? 'error' : operatorListStatus
    textContentStatus = textContentStatus === 'unknown' ? 'error' : textContentStatus
    const extracted = await extractPdfVectorTraceFromPage({
      page: null,
      pageNumber,
      sheetNumber: input.sheetNumber,
      sheetTitle: input.sheetTitle,
      existingPayload,
      opsConstants,
      expectedAdapterFields: ['runtime provider failed to resolve page object'],
    })
    const message = error?.message
      ? `Runtime PDF provider error: ${String(error.message)}`
      : 'Runtime PDF provider error while reading selected floor-plan sheet.'
    const warnings = addWarning(extracted.warnings, 'RUNTIME_PROVIDER_ERROR', message)
    const payload: PdfTracePayload | null = extracted.payload
      ? {
          ...extracted.payload,
          runtime: {
            providerStatus,
            providerKey: key,
            providerRequestedKey: runtimeDebug.requestedKey,
            providerRegisteredKeys: runtimeDebug.registeredKeys,
            providerMatchReason: runtimeDebug.matchReason,
            providerMetadata: runtimeDebug.providerMetadata,
            selectedPageNumber: pageNumber,
            operatorListStatus,
            textContentStatus,
            opsSource: extracted.opsSource,
          },
          warnings,
        }
      : null

    return {
      providerStatus,
      providerKey: key,
      providerRequestedKey: runtimeDebug.requestedKey,
      providerRegisteredKeys: runtimeDebug.registeredKeys,
      providerMatchReason: runtimeDebug.matchReason,
      providerMetadata: runtimeDebug.providerMetadata,
      selectedPageNumber: pageNumber,
      operatorListStatus,
      textContentStatus,
      result: {
        success: hasUsableTracePayload(payload),
        payload,
        warnings,
      },
    }
  }
}
