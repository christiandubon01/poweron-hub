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
  blueprintId?: string
  pageCount?: number
  getPage?: (pageNumber: number) => Promise<any>
  getCurrentPage?: () => Promise<any>
  getTextContent?: (pageNumber: number) => Promise<any>
  getOperatorList?: (pageNumber: number) => Promise<any>
}

export interface BlueprintPdfRuntimeLookup {
  projectId?: string
  sourceSetId?: string
  blueprintId?: string
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

export function buildBlueprintPdfRuntimeProviderKey(input: BlueprintPdfRuntimeLookup): string {
  return [
    safePart(input.projectId),
    safePart(input.sourceSetId),
    safePart(input.blueprintId),
  ].join('::')
}

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

export function getActivePdfTracePageProvider(
  lookup: BlueprintPdfRuntimeLookup,
): { key: string; provider: BlueprintPdfRuntimeProvider } | null {
  const exactKey = buildBlueprintPdfRuntimeProviderKey(lookup)
  const exact = runtimeProviders.get(exactKey)
  if (exact) return { key: exact.key, provider: exact.provider }

  let best: RuntimeRegistryEntry | null = null
  let bestScore = -1
  for (const entry of runtimeProviders.values()) {
    const provider = entry.provider
    if (lookup.sourceSetId && provider.sourceSetId && provider.sourceSetId !== lookup.sourceSetId) {
      continue
    }
    if (lookup.blueprintId && provider.blueprintId && provider.blueprintId !== lookup.blueprintId) {
      continue
    }
    if (lookup.projectId && provider.projectId && provider.projectId !== lookup.projectId) {
      continue
    }
    let score = 0
    if (lookup.projectId && provider.projectId === lookup.projectId) score += 3
    if (lookup.sourceSetId && provider.sourceSetId === lookup.sourceSetId) score += 4
    if (lookup.blueprintId && provider.blueprintId === lookup.blueprintId) score += 5
    if (score > bestScore || (score === bestScore && !!best && entry.registeredAt > best.registeredAt)) {
      best = entry
      bestScore = score
    }
  }
  if (!best || bestScore < 1) return null
  return { key: best.key, provider: best.provider }
}

export async function extractTraceForBlueprintSheet(
  input: RuntimeTraceForSheetInput,
): Promise<RuntimeTraceForSheetResult> {
  const pageNumber = Math.max(1, Math.floor(Number(input.pageNumber) || 1))
  const runtimeMatch = getActivePdfTracePageProvider(input)
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
            selectedPageNumber: pageNumber,
            operatorListStatus: 'unknown',
            textContentStatus: 'unknown',
          },
          warnings,
        }
      : null
    return {
      providerStatus: 'missing',
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
      expectedAdapterFields: ['provider.getPage', 'page.getOperatorList', 'page.getTextContent'],
    })

    const payload: PdfTracePayload | null = extracted.payload
      ? {
          ...extracted.payload,
          runtime: {
            providerStatus,
            providerKey: key,
            selectedPageNumber: pageNumber,
            operatorListStatus,
            textContentStatus,
          },
          warnings: extracted.warnings,
        }
      : null

    return {
      providerStatus,
      providerKey: key,
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
            selectedPageNumber: pageNumber,
            operatorListStatus,
            textContentStatus,
          },
          warnings,
        }
      : null

    return {
      providerStatus,
      providerKey: key,
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
