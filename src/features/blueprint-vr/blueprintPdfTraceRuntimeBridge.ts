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

export type PdfRuntimeProviderMatchTier = 'exact' | 'partial' | 'none'

export interface RuntimeTraceForSheetResult {
  providerStatus: 'available' | 'partial' | 'missing' | 'error'
  /** How the active runtime registry entry relates to the requested lookup key. */
  providerMatchTier: PdfRuntimeProviderMatchTier
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
let lastUnregisterInfo: { key: string; reason?: string; at: number } | null = null

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

export function unregisterBlueprintPdfRuntimeProvider(key: string, reason?: string): boolean {
  const normalized = String(key || '').trim()
  if (!normalized) return false
  if (runtimeProviders.has(normalized)) {
    lastUnregisterInfo = { key: normalized, reason, at: Date.now() }
  }
  return runtimeProviders.delete(normalized)
}

export function getBlueprintPdfRuntimeProvider(key: string): BlueprintPdfRuntimeProvider | null {
  const normalized = String(key || '').trim()
  if (!normalized) return null
  return runtimeProviders.get(normalized)?.provider || null
}

/** Shared ids must never contradict; then require blueprint or source-set overlap (not project-only). */
function providersIdentityCompatible(
  req: ReturnType<typeof normalizeLookup>,
  p: ReturnType<typeof normalizeLookup>,
): boolean {
  if (req.projectId !== 'na' && p.projectId !== 'na' && req.projectId !== p.projectId) return false
  if (req.blueprintId !== 'na' && p.blueprintId !== 'na' && req.blueprintId !== p.blueprintId) return false
  if (req.sourceSetId !== 'na' && p.sourceSetId !== 'na' && req.sourceSetId !== p.sourceSetId) return false
  const blueprintOverlap =
    req.blueprintId !== 'na' && p.blueprintId !== 'na' && req.blueprintId === p.blueprintId
  const sourceSetOverlap =
    req.sourceSetId !== 'na' && p.sourceSetId !== 'na' && req.sourceSetId === p.sourceSetId
  return blueprintOverlap || sourceSetOverlap
}

function providerNormalizedFromRegistry(provider: BlueprintPdfRuntimeProvider) {
  return normalizeLookup({
    projectId: provider.projectId,
    sourceSetId: provider.sourceSetId,
    sourceSetName: provider.sourceSetName,
    blueprintId: provider.blueprintId,
    fileName: provider.fileName,
    pageCount: provider.pageCount,
  })
}

/** Secondary scoring among identity-compatible providers (filename, page count, name). */
function scoreCompatibleProviderPartial(
  request: BlueprintPdfRuntimeLookup,
  provider: BlueprintPdfRuntimeProvider,
): { score: number; reason: string } {
  const req = normalizeLookup(request)
  const p = providerNormalizedFromRegistry(provider)
  const fields: Array<{
    name: string
    req: string | number
    provider: string | number
    weight: number
  }> = [
    { name: 'sourceSetName', req: req.sourceSetName, provider: p.sourceSetName, weight: 2 },
    { name: 'fileName', req: req.fileName, provider: p.fileName, weight: 4 },
    { name: 'pageCount', req: safeCount(req.pageCount), provider: safeCount(p.pageCount), weight: 3 },
  ]
  let score = 0
  const mismatches: string[] = []
  for (const field of fields) {
    const reqValue = String(field.req)
    const providerValue = String(field.provider)
    if (reqValue === 'na' || providerValue === 'na') continue
    if (reqValue === providerValue) {
      score += field.weight
    } else {
      mismatches.push(field.name)
    }
  }
  const reason =
    mismatches.length > 0
      ? `aligned_identity;secondary_mismatch=${mismatches.join(',')}`
      : 'aligned_identity;secondary_fields_match'
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
  registrySize: number
  matched: boolean
  matchTier: PdfRuntimeProviderMatchTier
  matchReason: string
  matchedKey?: string
  providerAgeSec?: number
  lastUnregisterReason?: string
  providerMetadata?: Record<string, any>
} {
  const requestedKey = buildBlueprintPdfRuntimeKey(request)
  const exact = runtimeProviders.get(requestedKey)
  if (exact) {
    const ageSec = Math.round((Date.now() - exact.registeredAt) / 1000)
    const baseMeta = exact.provider.metadata || {
      projectId: exact.provider.projectId,
      blueprintId: exact.provider.blueprintId,
      sourceSetId: exact.provider.sourceSetId,
      sourceSetName: exact.provider.sourceSetName,
      fileName: exact.provider.fileName,
      pageCount: exact.provider.pageCount,
    }
    return {
      requestedKey,
      registeredKeys: listBlueprintPdfRuntimeProviderKeys(),
      registrySize: runtimeProviders.size,
      matched: true,
      matchTier: 'exact',
      matchReason: 'exact_key_match',
      matchedKey: exact.key,
      providerAgeSec: ageSec,
      lastUnregisterReason: lastUnregisterInfo?.reason,
      providerMetadata: {
        ...baseMeta,
        providerAgeSec: ageSec,
        hasGetPage: typeof exact.provider.getPage === 'function',
        pdfDocReady: exact.provider.metadata?.pdfDocReady,
        lastUnregisterReason: lastUnregisterInfo?.reason,
        registrySize: runtimeProviders.size,
        matchTier: 'exact',
      },
    }
  }

  const compatibleEntries = Array.from(runtimeProviders.values()).filter((entry) =>
    providersIdentityCompatible(normalizeLookup(request), providerNormalizedFromRegistry(entry.provider)),
  )
  if (!compatibleEntries.length) {
    return {
      requestedKey,
      registeredKeys: listBlueprintPdfRuntimeProviderKeys(),
      registrySize: runtimeProviders.size,
      matched: false,
      matchTier: 'none',
      matchReason: 'no_identity_compatible_runtime_provider',
      lastUnregisterReason: lastUnregisterInfo?.reason,
    }
  }

  let best: RuntimeRegistryEntry | null = null
  let bestScore = -1
  let bestReason = 'no_runtime_provider_registered'
  for (const entry of compatibleEntries) {
    const scored = scoreCompatibleProviderPartial(request, entry.provider)
    const s = scored.score
    if (s > bestScore || (s === bestScore && best && entry.registeredAt > best.registeredAt)) {
      best = entry
      bestScore = s
      bestReason = scored.reason
    }
  }

  if (!best) {
    return {
      requestedKey,
      registeredKeys: listBlueprintPdfRuntimeProviderKeys(),
      registrySize: runtimeProviders.size,
      matched: false,
      matchTier: 'none',
      matchReason: bestReason,
      lastUnregisterReason: lastUnregisterInfo?.reason,
    }
  }

  const tied = compatibleEntries.filter((e) => scoreCompatibleProviderPartial(request, e.provider).score === bestScore)
  if (tied.length > 1 && new Set(tied.map((e) => e.key)).size > 1) {
    return {
      requestedKey,
      registeredKeys: listBlueprintPdfRuntimeProviderKeys(),
      registrySize: runtimeProviders.size,
      matched: false,
      matchTier: 'none',
      matchReason: 'ambiguous_multiple_identity_compatible_providers',
      lastUnregisterReason: lastUnregisterInfo?.reason,
    }
  }
  const bestAgeSec = Math.round((Date.now() - best.registeredAt) / 1000)
  const bestBaseMeta = best.provider.metadata || {
    projectId: best.provider.projectId,
    blueprintId: best.provider.blueprintId,
    sourceSetId: best.provider.sourceSetId,
    sourceSetName: best.provider.sourceSetName,
    fileName: best.provider.fileName,
    pageCount: best.provider.pageCount,
  }
  return {
    requestedKey,
    registeredKeys: listBlueprintPdfRuntimeProviderKeys(),
    registrySize: runtimeProviders.size,
    matched: true,
    matchTier: 'partial',
    matchReason: bestReason,
    matchedKey: best.key,
    providerAgeSec: bestAgeSec,
    lastUnregisterReason: lastUnregisterInfo?.reason,
    providerMetadata: {
      ...bestBaseMeta,
      providerAgeSec: bestAgeSec,
      hasGetPage: typeof best.provider.getPage === 'function',
      pdfDocReady: best.provider.metadata?.pdfDocReady,
      lastUnregisterReason: lastUnregisterInfo?.reason,
      registrySize: runtimeProviders.size,
      matchTier: 'partial',
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
            providerMatchTier: 'none',
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
      providerMatchTier: 'none',
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
  const matchTier = runtimeDebug.matchTier
  let providerStatus: RuntimeTraceForSheetResult['providerStatus'] =
    matchTier === 'exact' ? 'available' : 'partial'
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

    let mergedWarnings = extracted.warnings
    if (providerStatus === 'partial') {
      mergedWarnings = addWarning(
        mergedWarnings,
        'RUNTIME_PROVIDER_PARTIAL_MATCH',
        `Runtime PDF provider matched by partial identity only (${runtimeDebug.matchReason}). ` +
          `Registered key "${key}" does not exactly equal requested key "${runtimeDebug.requestedKey}".`,
      )
    }

    const payload: PdfTracePayload | null = extracted.payload
      ? {
          ...extracted.payload,
          runtime: {
            providerMatchTier: matchTier,
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
          warnings: mergedWarnings,
        }
      : null

    return {
      providerStatus,
      providerMatchTier: matchTier,
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
        warnings: mergedWarnings,
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
            providerMatchTier: matchTier,
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
      providerMatchTier: matchTier,
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
