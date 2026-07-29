import {
  BLUEPRINT_SNAPSHOT_MAX_EDGE,
  BLUEPRINT_SNAPSHOT_MAX_FILE_SIZE_BYTES,
  BLUEPRINT_SNAPSHOT_TARGET_DPI,
  type BlueprintSnapshotCaptureContext,
  type BlueprintSnapshotCaptureMetadata,
  type BlueprintSnapshotCaptureResult,
  type BlueprintSnapshotDimensions,
  type BlueprintSnapshotCropRect,
  type BlueprintSnapshotExportQualityDiagnostics,
  type BlueprintSnapshotPreviewState,
} from './types'
import {
  resolveBlueprintSnapshotCanvasLabelStyle,
  resolveBlueprintSnapshotSymbolLabelBox,
  resolveBlueprintSnapshotSymbolLabelScale,
  type BlueprintSnapshotCanvasLabelKind,
  type BlueprintSnapshotCanvasLabelStyle,
} from './blueprintSnapshotLabelStyle'
import { getElectricalSymbolMetadata, isElectricalShapeKind } from '@/components/blueprint/electricalSymbolRegistry'

const SVG_NS = 'http://www.w3.org/2000/svg'

export type BlueprintSnapshotCaptureStage =
  | 'CONTEXT_VALIDATION'
  | 'PDF_DOCUMENT_RESOLUTION'
  | 'PDF_PAGE_RESOLUTION'
  | 'EXPORT_DIMENSION_CALCULATION'
  | 'CANVAS_ALLOCATION'
  | 'PDF_RENDER'
  | 'OVERLAY_ROOT_RESOLUTION'
  | 'ANNOTATION_NODE_COLLECTION'
  | 'ANNOTATION_PAINT_EXTRACTION'
  | 'SVG_CONSTRUCTION'
  | 'SVG_VALIDATION'
  | 'SVG_SERIALIZATION'
  | 'SVG_IMAGE_DECODE'
  | 'ANNOTATION_COMPOSITE'
  | 'PNG_ENCODING'
  | 'PNG_VALIDATION'
  | 'PREVIEW_RESULT_CREATION'
  | 'PREVIEW_STATE_COMMIT'

export type BlueprintSnapshotCaptureErrorCode =
  | 'PAGE_UNAVAILABLE'
  | 'PDF_DOCUMENT_UNAVAILABLE'
  | 'PDF_PAGE_UNAVAILABLE'
  | 'INVALID_DIMENSIONS'
  | 'CANVAS_UNAVAILABLE'
  | 'PDF_RENDER_FAILED'
  | 'OVERLAY_ROOT_MISSING'
  | 'OVERLAY_ROOT_EMPTY'
  | 'ANNOTATION_NODE_MISSING'
  | 'ANNOTATION_PAINT_EMPTY'
  | 'INVALID_SVG'
  | 'SVG_XML_PARSE_FAILED'
  | 'SVG_ROOT_INVALID'
  | 'SVG_DIMENSIONS_INVALID'
  | 'SVG_UNSUPPORTED_ELEMENT'
  | 'SVG_EXTERNAL_RESOURCE'
  | 'SVG_UNRESOLVED_REFERENCE'
  | 'SVG_DUPLICATE_ID'
  | 'SVG_EMPTY_PAINT'
  | 'SVG_TRANSFORM_INVALID'
  | 'OVERLAY_SERIALIZATION_FAILED'
  | 'OVERLAY_IMAGE_DECODE_FAILED'
  | 'ANNOTATION_COMPOSITE_FAILED'
  | 'PNG_ENCODING_FAILED'
  | 'PNG_VALIDATION_FAILED'
  | 'INVALID_PNG_SIGNATURE'
  | 'PNG_BITMAP_DECODE_FAILED'
  | 'PREVIEW_RESULT_FAILED'
  | 'STALE_CAPTURE'

export interface BlueprintSnapshotCaptureDiagnostics {
  pageNumber?: number
  rotation?: number
  outputWidth?: number
  outputHeight?: number
  annotationNodeCount?: number
  overlayRootTagName?: string
  serializedSvgLength?: number
  captureRequestGeneration?: number
  capturedAnnotationCount?: number
  exportedPaintNodeCount?: number
  svgRootChildCount?: number
  parsererrorCount?: number
  duplicateIdCount?: number
  unresolvedReferenceCount?: number
  unsupportedElementCount?: number
  externalResourceCount?: number
  blobType?: string
  blobSize?: number
  previewGeneration?: number
  pngSignatureValid?: boolean
  createImageBitmapAvailable?: boolean
  bitmapDecodeSucceeded?: boolean
  decodedWidth?: number
  decodedHeight?: number
  previewResourceReleased?: boolean
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] as const
const releasedPreviewCanvases = new WeakSet<HTMLCanvasElement>()

export class BlueprintSnapshotCaptureError extends Error {
  stage: BlueprintSnapshotCaptureStage
  code: BlueprintSnapshotCaptureErrorCode
  safeMessage: string
  diagnostics: BlueprintSnapshotCaptureDiagnostics

  constructor(
    stage: BlueprintSnapshotCaptureStage,
    code: BlueprintSnapshotCaptureErrorCode,
    safeMessage = 'Snapshot capture failed before preview.',
    diagnostics: BlueprintSnapshotCaptureDiagnostics = {},
  ) {
    super(safeMessage)
    this.name = 'BlueprintSnapshotCaptureError'
    this.stage = stage
    this.code = code
    this.safeMessage = safeMessage
    this.diagnostics = diagnostics
  }
}

export function formatBlueprintSnapshotCaptureFailureMessage(error: unknown): string {
  if (error instanceof BlueprintSnapshotCaptureError) {
    const diagnosticLine = formatSafeDiagnostics(error.diagnostics)
    return `${error.safeMessage}\n[${error.stage} / ${error.code}].${diagnosticLine ? `\n${diagnosticLine}` : ''}\nNo image was uploaded.`
  }
  return 'Snapshot capture failed before preview.\n[CONTEXT_VALIDATION / PAGE_UNAVAILABLE].\nNo image was uploaded.'
}

export function validateSerializedAnnotationSvg(
  serialized: string,
  input: {
    expectedWidth: number
    expectedHeight: number
    visibleAnnotationCount: number
    diagnostics?: BlueprintSnapshotCaptureDiagnostics
  },
): BlueprintSnapshotCaptureDiagnostics {
  const diagnostics: BlueprintSnapshotCaptureDiagnostics = {
    ...input.diagnostics,
    outputWidth: input.expectedWidth,
    outputHeight: input.expectedHeight,
    capturedAnnotationCount: input.visibleAnnotationCount,
    serializedSvgLength: serialized.length,
  }
  if (!serialized.trim()) throw svgValidationError('SVG_EMPTY_PAINT', diagnostics)

  const parsed = parseSerializedSvg(serialized)
  const parsererrorCount = parsed.parsererrorCount
  if (parsererrorCount > 0) throw svgValidationError('SVG_XML_PARSE_FAILED', { ...diagnostics, parsererrorCount })

  if (parsed.rootName !== 'svg' || parsed.rootNamespace !== SVG_NS) {
    throw svgValidationError('SVG_ROOT_INVALID', diagnostics)
  }
  const width = Number(parsed.rootAttributes.width)
  const height = Number(parsed.rootAttributes.height)
  if (!isFinitePositive(width) || !isFinitePositive(height) || width !== input.expectedWidth || height !== input.expectedHeight) {
    throw svgValidationError('SVG_DIMENSIONS_INVALID', diagnostics)
  }
  if (!isValidSvgViewBox(parsed.rootAttributes.viewBox, width, height)) {
    throw svgValidationError('SVG_DIMENSIONS_INVALID', diagnostics)
  }

  const unsupportedElementCount = countUnsupportedSvgElements(serialized, parsed.elementNamespaces)
  if (unsupportedElementCount > 0 || serialized.includes('foreignObject')) {
    throw svgValidationError('SVG_UNSUPPORTED_ELEMENT', { ...diagnostics, unsupportedElementCount })
  }
  const externalResourceCount = countExternalSvgReferences(serialized)
  if (externalResourceCount > 0 || serialized.includes('var(')) {
    throw svgValidationError('SVG_EXTERNAL_RESOURCE', { ...diagnostics, externalResourceCount })
  }
  const duplicateIdCount = countDuplicateSvgIds(serialized)
  if (duplicateIdCount > 0) throw svgValidationError('SVG_DUPLICATE_ID', { ...diagnostics, duplicateIdCount })
  const unresolvedReferenceCount = countUnresolvedInternalSvgReferences(serialized)
  if (unresolvedReferenceCount > 0) throw svgValidationError('SVG_UNRESOLVED_REFERENCE', { ...diagnostics, unresolvedReferenceCount })
  if (!hasValidSvgTransforms(serialized)) throw svgValidationError('SVG_TRANSFORM_INVALID', diagnostics)

  return {
    ...diagnostics,
    svgRootChildCount: parsed.rootChildCount,
    exportedPaintNodeCount: parsed.paintNodeCount,
    parsererrorCount,
    duplicateIdCount,
    unresolvedReferenceCount,
    unsupportedElementCount,
    externalResourceCount,
  }
}

export function isBlueprintSnapshotCaptureStillCurrent(input: {
  requestGeneration: number
  currentRequestGeneration: number
  pageNumber: number
  currentPageNumber: number
  blueprintSetId: string | null | undefined
  currentBlueprintSetId: string | null | undefined
  viewerMounted: boolean
}): boolean {
  return Boolean(input.viewerMounted)
    && input.requestGeneration === input.currentRequestGeneration
    && input.pageNumber === input.currentPageNumber
    && String(input.blueprintSetId || '') === String(input.currentBlueprintSetId || '')
}

export async function validateBlueprintSnapshotCaptureResult(
  capture: BlueprintSnapshotCaptureResult | null | undefined,
  input: {
    generation: number
    currentGeneration: number
    pageNumber: number
    currentPageNumber: number
    blueprintSetId: string | null | undefined
    currentBlueprintSetId: string | null | undefined
    viewerMounted: boolean
  },
): Promise<BlueprintSnapshotCaptureDiagnostics> {
  const blob = capture?.blob
  const diagnostics: BlueprintSnapshotCaptureDiagnostics = {
    pageNumber: capture?.pageNumber ?? input.pageNumber,
    rotation: capture?.rotation,
    outputWidth: capture?.width,
    outputHeight: capture?.height,
    capturedAnnotationCount: capture?.annotationCount,
    blobType: blob instanceof Blob ? blob.type : typeof blob,
    blobSize: blob instanceof Blob ? blob.size : undefined,
    previewGeneration: input.generation,
  }
  if (!capture) {
    throw new BlueprintSnapshotCaptureError('PREVIEW_RESULT_CREATION', 'PREVIEW_RESULT_FAILED', 'Snapshot capture did not produce preview state.', diagnostics)
  }
  if (!isBlueprintSnapshotCaptureStillCurrent({
    requestGeneration: input.generation,
    currentRequestGeneration: input.currentGeneration,
    pageNumber: input.pageNumber,
    currentPageNumber: input.currentPageNumber,
    blueprintSetId: input.blueprintSetId,
    currentBlueprintSetId: input.currentBlueprintSetId,
    viewerMounted: input.viewerMounted,
  })) {
    throw new BlueprintSnapshotCaptureError('PREVIEW_RESULT_CREATION', 'STALE_CAPTURE', 'Snapshot capture was superseded before preview.', diagnostics)
  }
  if (!(blob instanceof Blob) || blob.type !== 'image/png' || blob.size <= 0 || blob.size > BLUEPRINT_SNAPSHOT_MAX_FILE_SIZE_BYTES) {
    throw new BlueprintSnapshotCaptureError('PREVIEW_RESULT_CREATION', 'PNG_VALIDATION_FAILED', 'Snapshot capture produced an invalid preview image.', diagnostics)
  }
  const pngSignatureValid = await hasValidPngSignature(blob)
  diagnostics.pngSignatureValid = pngSignatureValid
  if (!pngSignatureValid) {
    throw new BlueprintSnapshotCaptureError('PNG_VALIDATION', 'INVALID_PNG_SIGNATURE', 'Snapshot capture produced non-PNG image bytes.', diagnostics)
  }
  if (!Number.isFinite(capture?.width) || !Number.isFinite(capture?.height) || Number(capture?.width) <= 0 || Number(capture?.height) <= 0) {
    throw new BlueprintSnapshotCaptureError('PREVIEW_RESULT_CREATION', 'PREVIEW_RESULT_FAILED', 'Snapshot capture produced invalid preview dimensions.', diagnostics)
  }
  if (capture.pageNumber !== input.pageNumber || capture.captureMetadata.pageNumber !== input.pageNumber) {
    throw new BlueprintSnapshotCaptureError('PREVIEW_RESULT_CREATION', 'STALE_CAPTURE', 'Snapshot capture was superseded before preview.', diagnostics)
  }
  if (!capture.previewCanvas || capture.previewCanvas.width <= 0 || capture.previewCanvas.height <= 0) {
    throw new BlueprintSnapshotCaptureError('PREVIEW_RESULT_CREATION', 'PREVIEW_RESULT_FAILED', 'Snapshot capture did not produce a preview canvas.', diagnostics)
  }
  await addBitmapDecodeDiagnostics(blob, diagnostics)
  return diagnostics
}

export async function createBlueprintSnapshotPreviewState(
  capture: BlueprintSnapshotCaptureResult,
  input: Parameters<typeof validateBlueprintSnapshotCaptureResult>[1],
): Promise<BlueprintSnapshotPreviewState> {
  const diagnostics = await validateBlueprintSnapshotCaptureResult(capture, input)
  releasedPreviewCanvases.delete(capture.previewCanvas)
  logBlueprintSnapshotPreviewDiagnostics('created', diagnostics)
  return {
    capture,
    previewCanvas: capture.previewCanvas,
    generation: input.generation,
    blobType: capture.blob.type,
    blobSize: capture.blob.size,
    pngSignatureValid: Boolean(diagnostics.pngSignatureValid),
    createImageBitmapAvailable: Boolean(diagnostics.createImageBitmapAvailable),
    bitmapDecodeSucceeded: diagnostics.bitmapDecodeSucceeded ?? null,
    decodedWidth: diagnostics.decodedWidth ?? null,
    decodedHeight: diagnostics.decodedHeight ?? null,
  }
}

export function revokeBlueprintSnapshotPreviewState(
  preview: BlueprintSnapshotPreviewState | null | undefined,
  reason: 'replace' | 'retake' | 'cancel' | 'saved' | 'unmount',
): boolean {
  if (!preview?.previewCanvas || releasedPreviewCanvases.has(preview.previewCanvas)) return false
  releasedPreviewCanvases.add(preview.previewCanvas)
  preview.previewCanvas.width = 0
  preview.previewCanvas.height = 0
  logBlueprintSnapshotPreviewDiagnostics('revoked', {
    pageNumber: preview.capture.pageNumber,
    rotation: preview.capture.rotation,
    outputWidth: preview.capture.width,
    outputHeight: preview.capture.height,
    capturedAnnotationCount: preview.capture.annotationCount,
    blobType: preview.blobType,
    blobSize: preview.blobSize,
    previewGeneration: preview.generation,
    pngSignatureValid: preview.pngSignatureValid,
    createImageBitmapAvailable: preview.createImageBitmapAvailable,
    bitmapDecodeSucceeded: preview.bitmapDecodeSucceeded ?? undefined,
    decodedWidth: preview.decodedWidth ?? undefined,
    decodedHeight: preview.decodedHeight ?? undefined,
    previewResourceReleased: true,
  }, reason)
  return true
}

export function logBlueprintSnapshotPreviewCanvasResult(
  result: 'canvas-ready' | 'canvas-error',
  preview: BlueprintSnapshotPreviewState | null | undefined,
): void {
  if (!preview) return
  logBlueprintSnapshotPreviewDiagnostics(result, {
    pageNumber: preview.capture.pageNumber,
    rotation: preview.capture.rotation,
    outputWidth: preview.capture.width,
    outputHeight: preview.capture.height,
    capturedAnnotationCount: preview.capture.annotationCount,
    blobType: preview.blobType,
    blobSize: preview.blobSize,
    previewGeneration: preview.generation,
    pngSignatureValid: preview.pngSignatureValid,
    createImageBitmapAvailable: preview.createImageBitmapAvailable,
    bitmapDecodeSucceeded: preview.bitmapDecodeSucceeded ?? undefined,
    decodedWidth: preview.decodedWidth ?? undefined,
    decodedHeight: preview.decodedHeight ?? undefined,
    previewResourceReleased: releasedPreviewCanvases.has(preview.previewCanvas),
  })
}

function logBlueprintSnapshotPreviewDiagnostics(
  event: 'created' | 'revoked' | 'canvas-ready' | 'canvas-error',
  diagnostics: BlueprintSnapshotCaptureDiagnostics,
  reason?: string,
): void {
  if (typeof console === 'undefined' || typeof console.debug !== 'function') return
  console.debug('[blueprint-snapshot-preview]', {
    event,
    reason,
    blobType: diagnostics.blobType,
    blobSize: diagnostics.blobSize,
    previewGeneration: diagnostics.previewGeneration,
    pngSignatureValid: diagnostics.pngSignatureValid,
    createImageBitmapAvailable: diagnostics.createImageBitmapAvailable,
    bitmapDecodeSucceeded: diagnostics.bitmapDecodeSucceeded,
    decodedWidth: diagnostics.decodedWidth,
    decodedHeight: diagnostics.decodedHeight,
    previewResourceReleased: Boolean(diagnostics.previewResourceReleased),
    pageNumber: diagnostics.pageNumber,
    outputWidth: diagnostics.outputWidth,
    outputHeight: diagnostics.outputHeight,
    annotationCount: diagnostics.capturedAnnotationCount,
  })
}

async function hasValidPngSignature(blob: Blob): Promise<boolean> {
  const bytes = new Uint8Array(await blob.slice(0, PNG_SIGNATURE.length).arrayBuffer())
  return bytes.length === PNG_SIGNATURE.length && PNG_SIGNATURE.every((value, index) => bytes[index] === value)
}

async function addBitmapDecodeDiagnostics(blob: Blob, diagnostics: BlueprintSnapshotCaptureDiagnostics): Promise<void> {
  const decode = typeof createImageBitmap === 'function' ? createImageBitmap : null
  diagnostics.createImageBitmapAvailable = Boolean(decode)
  if (!decode) {
    diagnostics.bitmapDecodeSucceeded = false
    return
  }
  try {
    const bitmap = await decode(blob)
    diagnostics.bitmapDecodeSucceeded = true
    diagnostics.decodedWidth = bitmap.width
    diagnostics.decodedHeight = bitmap.height
    bitmap.close?.()
  } catch {
    diagnostics.bitmapDecodeSucceeded = false
    throw new BlueprintSnapshotCaptureError('PNG_VALIDATION', 'PNG_BITMAP_DECODE_FAILED', 'Snapshot capture produced PNG bytes that could not be decoded.', diagnostics)
  }
}

function formatSafeDiagnostics(diagnostics: BlueprintSnapshotCaptureDiagnostics): string {
  const parts: string[] = []
  if (diagnostics.capturedAnnotationCount != null) parts.push(`Annotations: ${diagnostics.capturedAnnotationCount}`)
  if (diagnostics.exportedPaintNodeCount != null) parts.push(`paint nodes: ${diagnostics.exportedPaintNodeCount}`)
  if (diagnostics.svgRootChildCount != null) parts.push(`SVG children: ${diagnostics.svgRootChildCount}`)
  if (diagnostics.serializedSvgLength != null) parts.push(`SVG length: ${diagnostics.serializedSvgLength}`)
  if (diagnostics.blobType != null) parts.push(`Blob type: ${diagnostics.blobType}`)
  if (diagnostics.blobSize != null) parts.push(`Blob size: ${diagnostics.blobSize}`)
  if (diagnostics.previewGeneration != null) parts.push(`Preview generation: ${diagnostics.previewGeneration}`)
  if (diagnostics.pngSignatureValid != null) parts.push(`PNG signature valid: ${diagnostics.pngSignatureValid ? 'yes' : 'no'}`)
  if (diagnostics.createImageBitmapAvailable != null) parts.push(`createImageBitmap available: ${diagnostics.createImageBitmapAvailable ? 'yes' : 'no'}`)
  if (diagnostics.bitmapDecodeSucceeded != null) parts.push(`bitmap decode succeeded: ${diagnostics.bitmapDecodeSucceeded ? 'yes' : 'no'}`)
  if (diagnostics.decodedWidth != null && diagnostics.decodedHeight != null) parts.push(`decoded size: ${diagnostics.decodedWidth} x ${diagnostics.decodedHeight}`)
  if (diagnostics.parsererrorCount) parts.push(`parser errors: ${diagnostics.parsererrorCount}`)
  if (diagnostics.duplicateIdCount) parts.push(`duplicate IDs: ${diagnostics.duplicateIdCount}`)
  if (diagnostics.unresolvedReferenceCount) parts.push(`unresolved references: ${diagnostics.unresolvedReferenceCount}`)
  if (diagnostics.unsupportedElementCount) parts.push(`unsupported elements: ${diagnostics.unsupportedElementCount}`)
  if (diagnostics.externalResourceCount) parts.push(`external resources: ${diagnostics.externalResourceCount}`)
  return parts.length ? `${parts.join('; ')}.` : ''
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

export function calculateBlueprintSnapshotDimensions(input: {
  pageWidth: number
  pageHeight: number
  targetDpi?: number
  maxEdge?: number
}): BlueprintSnapshotDimensions {
  const sourcePageWidth = Math.max(1, Number(input.pageWidth) || 0)
  const sourcePageHeight = Math.max(1, Number(input.pageHeight) || 0)
  const targetDpi = Number(input.targetDpi) > 0 ? Number(input.targetDpi) : BLUEPRINT_SNAPSHOT_TARGET_DPI
  const maxEdge = Number(input.maxEdge) > 0 ? Number(input.maxEdge) : BLUEPRINT_SNAPSHOT_MAX_EDGE
  const dpiScale = targetDpi / 72
  const edgeScale = Math.min(maxEdge / sourcePageWidth, maxEdge / sourcePageHeight)
  const scale = Math.max(0.0001, Math.min(dpiScale, edgeScale))
  return {
    width: Math.max(1, Math.min(maxEdge, Math.round(sourcePageWidth * scale))),
    height: Math.max(1, Math.min(maxEdge, Math.round(sourcePageHeight * scale))),
    scale,
    sourcePageWidth,
    sourcePageHeight,
    targetDpi,
  }
}

export function buildBlueprintSnapshotMetadata(input: {
  captureMode?: 'area' | 'full-page'
  pageNumber: number
  rotation: number
  dimensions: BlueprintSnapshotDimensions
  viewMode: 'general' | 'scoped'
  scopedWorkPackageIds: string[]
  labelsVisible: boolean
  symbolLabelSettings?: BlueprintSnapshotCaptureContext['symbolLabelSettings']
  circuitLabelsVisible: boolean
  annotationCount: number
  cropRect?: BlueprintSnapshotCropRect | null
}): BlueprintSnapshotCaptureMetadata {
  const normalizedCropRect = input.captureMode === 'area' ? normalizeCropRect(input.cropRect) : null
  const symbolLabelSettings = normalizeBlueprintSnapshotSymbolLabelSettings(input.symbolLabelSettings, input.labelsVisible)
  return {
    schemaVersion: 1,
    captureMode: input.captureMode || 'full-page',
    pageNumber: Math.max(1, Math.floor(Number(input.pageNumber) || 1)),
    rotation: normalizeRotation(input.rotation),
    targetDpi: input.dimensions.targetDpi,
    outputWidth: input.dimensions.width,
    outputHeight: input.dimensions.height,
    sourcePageWidth: input.dimensions.sourcePageWidth,
    sourcePageHeight: input.dimensions.sourcePageHeight,
    viewMode: input.viewMode,
    scopedWorkPackageIds: input.viewMode === 'scoped' ? input.scopedWorkPackageIds.filter(Boolean) : [],
    labelsVisible: Boolean(input.labelsVisible),
    symbolLabelsVisible: symbolLabelSettings.symbolLabelsVisible,
    symbolLabelScale: symbolLabelSettings.symbolLabelScale,
    symbolLabelCustomColorsEnabled: symbolLabelSettings.customLabelColorsEnabled,
    symbolLabelTextColor: symbolLabelSettings.resolvedLabelColors.textColor,
    symbolLabelBorderColor: symbolLabelSettings.resolvedLabelColors.borderColor,
    symbolLabelFillColor: symbolLabelSettings.resolvedLabelColors.fillColor,
    circuitLabelsVisible: Boolean(input.circuitLabelsVisible),
    annotationCount: Math.max(0, Math.floor(Number(input.annotationCount) || 0)),
    ...(normalizedCropRect ? { cropRect: normalizedCropRect } : {}),
  }
}

function normalizeBlueprintSnapshotSymbolLabelSettings(
  settings: BlueprintSnapshotCaptureContext['symbolLabelSettings'] | null | undefined,
  labelsVisible: boolean,
): NonNullable<BlueprintSnapshotCaptureContext['symbolLabelSettings']> {
  const resolvedLabelColors = settings?.resolvedLabelColors
  return {
    symbolLabelsVisible: settings?.symbolLabelsVisible ?? Boolean(labelsVisible),
    symbolLabelScale: resolveBlueprintSnapshotSymbolLabelScale(settings?.symbolLabelScale),
    customLabelColorsEnabled: Boolean(settings?.customLabelColorsEnabled),
    resolvedLabelColors: {
      textColor: String(resolvedLabelColors?.textColor || '#22d3ee'),
      borderColor: String(resolvedLabelColors?.borderColor || '#22d3ee'),
      fillColor: String(resolvedLabelColors?.fillColor || '#0b1020'),
    },
  }
}

export async function captureBlueprintSnapshot(context: BlueprintSnapshotCaptureContext): Promise<BlueprintSnapshotCaptureResult> {
  if (!context.page || typeof context.page.getViewport !== 'function' || typeof context.page.render !== 'function') {
    throw captureError('CONTEXT_VALIDATION', 'PAGE_UNAVAILABLE', context)
  }

  const rotation = normalizeRotation(context.rotation)
  let baseViewport: { width: number; height: number }
  try {
    baseViewport = context.page.getViewport({ scale: 1, rotation })
  } catch {
    throw captureError('EXPORT_DIMENSION_CALCULATION', 'INVALID_DIMENSIONS', context)
  }
  const cropRect = normalizeCropRect(context.cropRect || null)
  const symbolLabelSettings = normalizeBlueprintSnapshotSymbolLabelSettings(context.symbolLabelSettings, context.labelsVisible)
  const captureMode = cropRect ? 'area' : 'full-page'
  const sourceWidth = cropRect ? baseViewport.width * cropRect.w : baseViewport.width
  const sourceHeight = cropRect ? baseViewport.height * cropRect.h : baseViewport.height
  const dimensions = calculateBlueprintSnapshotDimensions({ pageWidth: sourceWidth, pageHeight: sourceHeight })
  if (!isValidSnapshotDimensions(dimensions)) throw captureError('EXPORT_DIMENSION_CALCULATION', 'INVALID_DIMENSIONS', context)

  const canvas = createSnapshotCanvas(dimensions.width, dimensions.height, context, dimensions)
  const canvasContext = canvas.getContext('2d')
  if (!canvasContext) throw captureError('CANVAS_ALLOCATION', 'CANVAS_UNAVAILABLE', context, dimensions)
  const renderScale = dimensions.scale
  const pageRenderCanvas = cropRect ? createSnapshotCanvas(
    Math.max(1, Math.ceil(baseViewport.width * renderScale)),
    Math.max(1, Math.ceil(baseViewport.height * renderScale)),
    context,
    dimensions,
  ) : canvas
  const pageRenderContext = pageRenderCanvas.getContext('2d')
  if (!pageRenderContext) throw captureError('CANVAS_ALLOCATION', 'CANVAS_UNAVAILABLE', context, dimensions)

  try {
    const viewport = context.page.getViewport({ scale: renderScale, rotation })
    const renderTask = context.page.render({ canvasContext: pageRenderContext, viewport })
    await renderTask.promise
  } catch {
    throw captureError('PDF_RENDER', 'PDF_RENDER_FAILED', context, dimensions)
  }

  if (cropRect) {
    const sx = Math.round(cropRect.x * baseViewport.width * renderScale)
    const sy = Math.round(cropRect.y * baseViewport.height * renderScale)
    const sw = Math.round(cropRect.w * baseViewport.width * renderScale)
    const sh = Math.round(cropRect.h * baseViewport.height * renderScale)
    canvasContext.clearRect(0, 0, dimensions.width, dimensions.height)
    canvasContext.drawImage(pageRenderCanvas, sx, sy, sw, sh, 0, 0, dimensions.width, dimensions.height)
  }

  const exportTransform = buildBlueprintSnapshotExportTransform({
    sourcePageWidth: baseViewport.width,
    sourcePageHeight: baseViewport.height,
    cropRect,
    outputWidth: dimensions.width,
    outputHeight: dimensions.height,
    pdfRenderScale: renderScale,
  })

  if (context.annotations.length > 0) {
    drawBlueprintAnnotationsToCanvas(canvasContext, {
      annotations: context.annotations,
      cropRect,
      outputWidth: dimensions.width,
      outputHeight: dimensions.height,
      sourcePageWidth: baseViewport.width,
      sourcePageHeight: baseViewport.height,
      labelsVisible: context.labelsVisible,
      symbolLabelSettings,
      circuitLabelsVisible: context.circuitLabelsVisible,
      exportTransform,
    })
  }

  const blob = await canvasToPngBlob(canvas)
  if (blob.type !== 'image/png' || blob.size <= 0 || blob.size > BLUEPRINT_SNAPSHOT_MAX_FILE_SIZE_BYTES) {
    throw captureError('PNG_VALIDATION', 'PNG_VALIDATION_FAILED', context, dimensions)
  }

  const captureMetadata = buildBlueprintSnapshotMetadata({
    captureMode,
    pageNumber: context.pageNumber,
    rotation: context.rotation,
    dimensions,
    viewMode: context.viewMode,
    scopedWorkPackageIds: context.scopedWorkPackageIds,
    labelsVisible: context.labelsVisible,
    symbolLabelSettings,
    circuitLabelsVisible: context.circuitLabelsVisible,
    annotationCount: context.annotations.length,
    cropRect,
  })

  return {
    blob,
    previewCanvas: canvas,
    width: dimensions.width,
    height: dimensions.height,
    pageNumber: captureMetadata.pageNumber,
    rotation: captureMetadata.rotation,
    annotationCount: context.annotations.length,
    captureMetadata,
    qualityDiagnostics: exportTransform,
  }
}

function createSnapshotCanvas(
  width: number,
  height: number,
  context: Partial<BlueprintSnapshotCaptureContext>,
  dimensions?: BlueprintSnapshotDimensions,
): HTMLCanvasElement {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw captureError('CANVAS_ALLOCATION', 'CANVAS_UNAVAILABLE', context, dimensions)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function clampNorm(value: number, min = 0, max = 1): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.max(min, Math.min(max, number))
}

function clampNumber(value: number, min: number, max: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.max(min, Math.min(max, number))
}

function normalizeCropRect(rect: BlueprintSnapshotCropRect | null | undefined): BlueprintSnapshotCropRect | null {
  if (!rect) return null
  const x = clampNorm(rect.x)
  const y = clampNorm(rect.y)
  const w = Math.max(0, Math.min(1 - x, Number(rect.w) || 0))
  const h = Math.max(0, Math.min(1 - y, Number(rect.h) || 0))
  if (w < 0.005 || h < 0.005) return null
  return { x, y, w, h }
}

export function buildBlueprintSnapshotExportTransform(input: {
  sourcePageWidth: number
  sourcePageHeight: number
  cropRect?: BlueprintSnapshotCropRect | null
  outputWidth: number
  outputHeight: number
  pdfRenderScale: number
}): BlueprintSnapshotExportQualityDiagnostics {
  const crop = normalizeCropRect(input.cropRect || null) || { x: 0, y: 0, w: 1, h: 1 }
  const selectedPdfWidth = Math.max(1, input.sourcePageWidth * crop.w)
  const selectedPdfHeight = Math.max(1, input.sourcePageHeight * crop.h)
  const exportScaleX = input.outputWidth / selectedPdfWidth
  const exportScaleY = input.outputHeight / selectedPdfHeight
  return {
    sourcePageWidth: input.sourcePageWidth,
    sourcePageHeight: input.sourcePageHeight,
    selectedPdfWidth,
    selectedPdfHeight,
    outputWidth: input.outputWidth,
    outputHeight: input.outputHeight,
    pdfRenderScale: input.pdfRenderScale,
    exportScaleX,
    exportScaleY,
    annotationRenderScaleX: exportScaleX,
    annotationRenderScaleY: exportScaleY,
    annotationVisualScale: clampNumber((exportScaleX + exportScaleY) / 2, 0.75, 4),
    annotationBackingWidth: input.outputWidth,
    annotationBackingHeight: input.outputHeight,
    annotationPaintSource: 'final-canvas-vector-geometry',
    usesCssOverlaySource: false,
    usesPreviewCanvasSource: false,
  }
}

function drawBlueprintAnnotationsToCanvas(
  ctx: CanvasRenderingContext2D,
  input: {
    annotations: BlueprintSnapshotCaptureContext['annotations']
    cropRect: BlueprintSnapshotCropRect | null
    outputWidth: number
    outputHeight: number
    sourcePageWidth: number
    sourcePageHeight: number
    labelsVisible: boolean
    symbolLabelSettings: NonNullable<BlueprintSnapshotCaptureContext['symbolLabelSettings']>
    circuitLabelsVisible: boolean
    exportTransform?: BlueprintSnapshotExportQualityDiagnostics
  },
): void {
  const crop = input.cropRect || { x: 0, y: 0, w: 1, h: 1 }
  const exportTransform = input.exportTransform || buildBlueprintSnapshotExportTransform({
    sourcePageWidth: input.sourcePageWidth,
    sourcePageHeight: input.sourcePageHeight,
    cropRect: input.cropRect,
    outputWidth: input.outputWidth,
    outputHeight: input.outputHeight,
    pdfRenderScale: (input.outputWidth / Math.max(1, input.sourcePageWidth * crop.w) + input.outputHeight / Math.max(1, input.sourcePageHeight * crop.h)) / 2,
  })
  const map = {
    x: (value: number) => ((value - crop.x) / crop.w) * input.outputWidth,
    y: (value: number) => ((value - crop.y) / crop.h) * input.outputHeight,
    w: (value: number) => (value / crop.w) * input.outputWidth,
    h: (value: number) => (value / crop.h) * input.outputHeight,
    visualScale: exportTransform.annotationVisualScale,
    exportScaleX: exportTransform.exportScaleX,
    exportScaleY: exportTransform.exportScaleY,
  }
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, input.outputWidth, input.outputHeight)
  ctx.clip()
  input.annotations.forEach((annotation) => {
    if (!annotation || annotation.deletedAt) return
    const meta = getSnapshotAnnotationMeta(annotation)
    const color = String(annotation.color || meta.borderColor || meta.fillColor || '#facc15')
    try {
      if (annotation.type === 'pen' || annotation.type === 'marker') {
        drawSnapshotPolyline(ctx, pointsFromMeta(meta), map, {
          stroke: color,
          width: Number(meta.thickness) || (annotation.type === 'marker' ? 12 : 3),
          opacity: Number(meta.opacity ?? (annotation.type === 'marker' ? 0.35 : 0.9)),
          lineCap: 'round',
          lineJoin: 'round',
        })
        return
      }
      if (annotation.type === 'underline' && annotation.rect) {
        const r = mapRect(annotation.rect, map)
        ctx.save()
        ctx.globalAlpha = Number(meta.opacity ?? 1)
        ctx.strokeStyle = color
        ctx.lineWidth = scaleExportLength(Number(meta.thickness) || 3, map.visualScale)
        ctx.beginPath()
        ctx.moveTo(r.x, r.y + r.h)
        ctx.lineTo(r.x + r.w, r.y + r.h)
        ctx.stroke()
        ctx.restore()
        return
      }
      if (annotation.type === 'highlight' && annotation.rect) {
        const r = mapRect(annotation.rect, map)
        fillRect(ctx, r, color, Number(meta.opacity ?? 0.35))
        strokeRect(ctx, r, color, 1, 1, undefined, map.visualScale)
        return
      }
      if (annotation.type === 'textHighlight' && annotation.rect) {
        const base = mapRect(annotation.rect, map)
        const highlight = withAlpha(color, Number(meta.opacity ?? 0.4))
        const quads = Array.isArray(meta.quads) ? meta.quads : []
        if (quads.length > 0) {
          quads.forEach((quad: any) => {
            fillRect(ctx, {
              x: base.x + Number(quad.x || 0) * base.w,
              y: base.y + Number(quad.y || 0) * base.h,
              w: Number(quad.w || 0) * base.w,
              h: Number(quad.h || 0) * base.h,
            }, highlight, 1)
          })
        } else {
          fillRect(ctx, { x: base.x, y: base.y + base.h * 0.14, w: base.w, h: base.h * 0.72 }, highlight, 1)
        }
        return
      }
      if (annotation.type === 'note' && annotation.rect) {
        const r = mapRect(annotation.rect, map)
        drawNoteDot(ctx, r.x, r.y, color, map.visualScale)
        return
      }
      if ((annotation.type === 'textBox' || annotation.type === 'callout' || annotation.type === 'generate') && annotation.rect) {
        drawTextAnnotation(ctx, annotation, map, color)
        return
      }
      if (annotation.type === 'shape' && annotation.rect) {
        drawShapeAnnotation(ctx, annotation, meta, map, {
          labelsVisible: input.labelsVisible,
          symbolLabelSettings: input.symbolLabelSettings,
          circuitLabelsVisible: input.circuitLabelsVisible,
        })
        return
      }
      if (annotation.type === 'measure-distance' || annotation.type === 'measure-area' || annotation.type === 'measure-perimeter') {
        drawMeasureAnnotation(ctx, annotation, meta, map, input.labelsVisible)
      }
    } catch {
      throw new BlueprintSnapshotCaptureError('ANNOTATION_COMPOSITE', 'ANNOTATION_COMPOSITE_FAILED')
    }
  })
  ctx.restore()
}

function drawShapeAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: BlueprintSnapshotCaptureContext['annotations'][number],
  meta: Record<string, any>,
  map: SnapshotCoordinateMap,
  options: {
    labelsVisible: boolean
    symbolLabelSettings: NonNullable<BlueprintSnapshotCaptureContext['symbolLabelSettings']>
    circuitLabelsVisible: boolean
  },
): void {
  const rect = annotation.rect
  if (!rect) return
  const r = mapRect(rect, map)
  const kind = String(meta.shapeKind || 'square')
  const borderColor = String(meta.borderColor || annotation.color || '#facc15')
  const fillColor = String(meta.fillColor || annotation.color || '#facc15')
  const borderWidth = Number(meta.borderThickness) || 2
  const opacity = Number(meta.fillOpacity ?? 0.2)
  if (kind === 'line' || kind === 'arrow') {
    const x1 = meta.lineAbsX1 != null ? map.x(Number(meta.lineAbsX1)) : r.x + r.w * Number(meta.lineX1 ?? 0)
    const y1 = meta.lineAbsY1 != null ? map.y(Number(meta.lineAbsY1)) : r.y + r.h * Number(meta.lineY1 ?? 0)
    const x2 = meta.lineAbsX2 != null ? map.x(Number(meta.lineAbsX2)) : r.x + r.w * Number(meta.lineX2 ?? 1)
    const y2 = meta.lineAbsY2 != null ? map.y(Number(meta.lineAbsY2)) : r.y + r.h * Number(meta.lineY2 ?? 1)
    drawLine(ctx, x1, y1, x2, y2, borderColor, borderWidth, meta.borderStyle, opacity, map.visualScale)
    if (kind === 'arrow') drawArrowHead(ctx, x1, y1, x2, y2, borderColor, borderWidth, map.visualScale)
    return
  }
  if (kind === 'arch-line') {
    const x1 = meta.lineAbsX1 != null ? map.x(Number(meta.lineAbsX1)) : r.x + r.w * Number(meta.lineX1 ?? 0)
    const y1 = meta.lineAbsY1 != null ? map.y(Number(meta.lineAbsY1)) : r.y + r.h * Number(meta.lineY1 ?? 0)
    const x2 = meta.lineAbsX2 != null ? map.x(Number(meta.lineAbsX2)) : r.x + r.w * Number(meta.lineX2 ?? 1)
    const y2 = meta.lineAbsY2 != null ? map.y(Number(meta.lineAbsY2)) : r.y + r.h * Number(meta.lineY2 ?? 1)
    const cx = meta.archCtrlX != null ? map.x(Number(meta.archCtrlX)) : (x1 + x2) / 2
    const cy = meta.archCtrlY != null ? map.y(Number(meta.archCtrlY)) : (y1 + y2) / 2
    ctx.save()
    applyStroke(ctx, borderColor, borderWidth, meta.borderStyle, opacity, map.visualScale)
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.quadraticCurveTo(cx, cy, x2, y2)
    ctx.stroke()
    ctx.restore()
    return
  }
  if (kind === 'polyline' || kind === 'circuit-path' || kind === 'electrical-led-strip') {
    const points = pointsFromMeta(meta)
    const isLedStrip = kind === 'electrical-led-strip'
    drawSnapshotPolyline(ctx, points, map, {
      stroke: borderColor,
      width: Math.max(1, isLedStrip ? borderWidth * 1.7 : borderWidth),
      opacity: isLedStrip ? 0.82 : opacity,
      dash: isLedStrip ? [1, 9] : dashForStyle(meta.borderStyle),
      lineCap: 'round',
      lineJoin: 'round',
    })
    if (kind === 'circuit-path' && options.circuitLabelsVisible && meta.distanceLabel) drawLabelAtPoints(ctx, String(meta.distanceLabel), points, map, borderColor, 'circuit')
    return
  }
  if (kind === 'circuit-arc') {
    const points = pointsFromMeta(meta)
    if (points.length < 2) return
    ctx.save()
    applyStroke(ctx, borderColor, borderWidth, meta.borderStyle, opacity, map.visualScale)
    ctx.beginPath()
    ctx.moveTo(map.x(points[0].x), map.y(points[0].y))
    for (let i = 1; i < points.length; i += 1) {
      const ctrl = Array.isArray(meta.arcCtrls) && meta.arcCtrls[i - 1] ? meta.arcCtrls[i - 1] : {
        x: (points[i - 1].x + points[i].x) / 2,
        y: (points[i - 1].y + points[i].y) / 2,
      }
      ctx.quadraticCurveTo(map.x(Number(ctrl.x)), map.y(Number(ctrl.y)), map.x(points[i].x), map.y(points[i].y))
    }
    ctx.stroke()
    ctx.restore()
    if (options.circuitLabelsVisible && meta.distanceLabel) drawLabelAtPoints(ctx, String(meta.distanceLabel), points, map, borderColor, 'circuit')
    return
  }
  if (isSnapshotElectricalSymbolKind(kind)) {
    drawElectricalSymbol(ctx, r, kind, meta, {
      borderColor,
      fillColor,
      borderWidth,
      opacity,
      labelsVisible: options.symbolLabelSettings.symbolLabelsVisible,
      visualScale: map.visualScale,
      symbolLabelSettings: options.symbolLabelSettings,
    })
    return
  }
  if (isUnknownElectricalLikeSymbolKind(kind)) {
    drawUnknownElectricalSymbolFallback(ctx, r, kind, {
      borderColor,
      fillColor,
      borderWidth,
      opacity,
      labelsVisible: options.symbolLabelSettings.symbolLabelsVisible,
      visualScale: map.visualScale,
    })
    return
  }
  if (kind === 'circle') {
    ctx.save()
    ctx.globalAlpha = opacity
    ctx.fillStyle = fillColor
    ctx.strokeStyle = borderColor
    ctx.lineWidth = scaleExportLength(borderWidth, map.visualScale)
    ctx.beginPath()
    ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.abs(r.w / 2), Math.abs(r.h / 2), 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.stroke()
    ctx.restore()
    return
  }
  fillRect(ctx, r, fillColor, opacity)
  strokeRect(ctx, r, borderColor, borderWidth, 1, meta.borderStyle, map.visualScale)
}

function drawMeasureAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: BlueprintSnapshotCaptureContext['annotations'][number],
  meta: Record<string, any>,
  map: SnapshotCoordinateMap,
  labelsVisible: boolean,
): void {
  const points = pointsFromMeta(meta)
  if (points.length < 2) return
  const color = String(annotation.color || '#38bdf8')
  const style = meta.style || {}
  const width = Number(style.lineThickness) || 2
  const dash = measureDashForStyle(style.linePattern)
  if (annotation.type === 'measure-area') {
    ctx.save()
    ctx.globalAlpha = Number(style.fillOpacity ?? 0.15)
    ctx.fillStyle = String(style.fillColor || color)
    drawClosedPath(ctx, points, map)
    ctx.fill()
    ctx.restore()
    drawSnapshotPolyline(ctx, [...points, points[0]], map, { stroke: color, width, opacity: 0.9, dash, lineJoin: 'round' })
  } else {
    drawSnapshotPolyline(ctx, points, map, { stroke: color, width, opacity: 0.9, dash, lineCap: 'round', lineJoin: 'round' })
  }
  if (labelsVisible && meta.label) drawLabelAtPoints(ctx, String(meta.label), points, map, color, 'measurement')
}

function drawTextAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: BlueprintSnapshotCaptureContext['annotations'][number],
  map: SnapshotCoordinateMap,
  color: string,
): void {
  if (!annotation.rect) return
  const r = mapRect(annotation.rect, map)
  const text = String(annotation.text || '').trim()
  fillRect(ctx, r, '#ffffff', annotation.type === 'textBox' ? 0.92 : 0.85)
  strokeRect(ctx, r, color, 2, 1, undefined, map.visualScale)
  const padding = scaleExportLength(6, map.visualScale)
  const fontSize = clampNumber(Math.min(16 * map.visualScale, r.h / 3), 10 * map.visualScale, 22 * map.visualScale)
  if (text) drawWrappedText(ctx, text, r.x + padding, r.y + padding + fontSize * 0.15, Math.max(10, r.w - padding * 2), color, fontSize)
}

function drawElectricalSymbol(
  ctx: CanvasRenderingContext2D,
  rect: SnapshotRect,
  kind: string,
  meta: Record<string, any>,
  style: {
    borderColor: string
    fillColor: string
    borderWidth: number
    opacity: number
    labelsVisible: boolean
    visualScale: number
    symbolLabelSettings: NonNullable<BlueprintSnapshotCaptureContext['symbolLabelSettings']>
  },
): void {
  ctx.save()
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  ctx.translate(cx, cy)
  ctx.rotate((Number(meta.rotationDeg) || 0) * Math.PI / 180)
  const size = Math.max(scaleExportLength(8, style.visualScale), Math.min(Math.abs(rect.w), Math.abs(rect.h)))
  const unit = size / 100
  ctx.scale(unit, unit)
  ctx.translate(-50, -50)
  ctx.globalAlpha = Math.max(0.25, Math.min(1, style.opacity || 1))
  ctx.fillStyle = style.fillColor === 'transparent' ? 'rgba(0,0,0,0)' : withAlpha(style.fillColor, 0.2)
  ctx.strokeStyle = style.borderColor
  ctx.lineWidth = Math.max(1.2, style.borderWidth)
  renderSnapshotElectricalGlyph(ctx, kind, style)
  ctx.restore()
  if (style.labelsVisible) {
    const label = electricalLabelForKind(kind)
    if (label) drawElectricalSymbolLabel(ctx, label, rect, style)
  }
}

function renderSnapshotElectricalGlyph(
  ctx: CanvasRenderingContext2D,
  kind: string,
  style: { borderColor: string; fillColor: string; borderWidth: number; opacity: number; labelsVisible: boolean; visualScale: number },
): void {
  const symbolFill = style.fillColor === 'transparent' ? 'rgba(0,0,0,0)' : withAlpha(style.fillColor, 0.18)
  const stroke = style.borderColor
  const strokeWidth = Math.max(1.4, style.borderWidth)
  const fine = Math.max(1, strokeWidth * 0.58)
  const text = (value: string, x: number, y: number, size = 18) => {
    ctx.fillStyle = stroke
    ctx.font = `800 ${size}px monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(value, x, y)
  }
  const circle = (x: number, y: number, radius: number, fill = symbolFill, width = strokeWidth) => {
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fillStyle = fill
    ctx.strokeStyle = stroke
    ctx.lineWidth = width
    ctx.fill()
    ctx.stroke()
  }
  const rectPath = (x: number, y: number, w: number, h: number, fill = symbolFill, width = strokeWidth) => {
    ctx.beginPath()
    ctx.rect(x, y, w, h)
    ctx.fillStyle = fill
    ctx.strokeStyle = stroke
    ctx.lineWidth = width
    ctx.fill()
    ctx.stroke()
  }
  const line = (x1: number, y1: number, x2: number, y2: number, width = fine) => {
    ctx.beginPath()
    ctx.strokeStyle = stroke
    ctx.lineWidth = width
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
  const ringedLight = (label: string, innerRadius: number) => {
    circle(50, 48, 24, 'rgba(0,0,0,0)', Math.max(1.1, fine))
    circle(50, 48, innerRadius, symbolFill, fine)
    line(31, 48, 69, 48, Math.max(1, fine * 0.75))
    line(50, 29, 50, 67, Math.max(1, fine * 0.75))
    text(label, 50, 86, 12)
  }
  if (kind === 'can-light-2') return ringedLight('2"', 7)
  if (kind === 'can-light-4') return ringedLight('4"', 10)
  if (kind === 'can-light-6') return ringedLight('6"', 13)
  if (kind === 'canless-light-2' || kind === 'canless-light-4' || kind === 'canless-light-6' || kind === 'canless-light-10') {
    const label = kind.includes('10') ? '10" CL' : kind.includes('6') ? '6" CL' : kind.includes('4') ? '4" CL' : '2" CL'
    const inner = kind.includes('10') ? 17 : kind.includes('6') ? 14 : kind.includes('4') ? 11 : 8
    circle(50, 48, 24, symbolFill, strokeWidth)
    circle(50, 48, 19, 'rgba(0,0,0,0)', fine)
    line(32, 39, 68, 39, fine)
    line(32, 57, 68, 57, fine)
    circle(50, 48, inner, 'rgba(0,0,0,0)', fine)
    text(label, 50, 86, 10)
    return
  }
  if (kind === 'electrical-recessed-light') {
    circle(48, 45, 34, symbolFill, strokeWidth)
    circle(48, 45, 17, 'rgba(0,0,0,0)', fine)
    line(18, 45, 78, 45, fine)
    line(48, 15, 48, 75, fine)
    return
  }
  if (kind === 'electrical-pendant-light') {
    circle(50, 16, 6, symbolFill, fine)
    line(50, 22, 50, 52, strokeWidth)
    line(30, 54, 70, 54, strokeWidth)
    circle(50, 62, 13, 'rgba(0,0,0,0)', fine)
    return
  }
  if (kind === 'electrical-sconce') {
    line(24, 20, 24, 78, strokeWidth)
    line(26, 38, 58, 28, fine)
    line(26, 62, 58, 72, fine)
    circle(42, 50, 7, symbolFill, fine)
    return
  }
  if (kind.includes('switch') || kind === 'electrical-dimmer') {
    text('S', 48, 51, 48)
    line(48, 20, 48, 76, strokeWidth)
    if (kind.includes('3way')) text('3', 78, 80, 13)
    if (kind.includes('4way')) text('4', 78, 80, 13)
    if (kind === 'electrical-dimmer') {
      line(72, 28, 84, 28, fine)
      line(74, 38, 84, 38, fine)
      line(76, 48, 84, 48, fine)
    }
    return
  }
  if (kind === 'electrical-emergency-exit-sign') {
    rectPath(12, 28, 76, 38, symbolFill, strokeWidth)
    text('EXIT', 50, 48, 20)
    return
  }
  if (kind === 'electrical-led-panel-2x2' || kind === 'electrical-led-panel-2x4') {
    const wide = kind.endsWith('2x4')
    rectPath(wide ? 10 : 18, wide ? 22 : 14, wide ? 78 : 58, wide ? 40 : 58, symbolFill, strokeWidth)
    line(wide ? 49 : 18, wide ? 22 : 43, wide ? 49 : 76, wide ? 62 : 43, fine)
    line(wide ? 10 : 47, wide ? 42 : 14, wide ? 88 : 47, wide ? 42 : 72, fine)
    text(wide ? '2x4' : '2x2', 82, 82, 10)
    return
  }
  if (kind === 'electrical-low-voltage-transformer' || kind === 'electrical-transformer') {
    rectPath(14, 18, 72, 62, symbolFill, strokeWidth)
    line(43, 30, 43, 62, fine)
    line(57, 30, 57, 62, fine)
    text(kind.includes('low-voltage') ? 'LVT' : 'XFMR', 50, 52, 15)
    return
  }
  if (kind === 'electrical-panel' || kind === 'electrical-sub-panel' || kind === 'electrical-switchboard' || kind === 'electrical-switchgear' || kind === 'electrical-ats') {
    rectPath(12, 16, 76, 66, symbolFill, strokeWidth)
    line(30, 28, 70, 28, fine)
    line(30, 70, 70, 70, fine)
    if (kind === 'electrical-switchgear') {
      line(31, 16, 31, 82, fine)
      line(69, 16, 69, 82, fine)
    }
    text(kind === 'electrical-sub-panel' ? 'SP' : kind === 'electrical-switchboard' ? 'SWBD' : kind === 'electrical-switchgear' ? 'SWGR' : kind === 'electrical-ats' ? 'ATS' : 'PNL', 50, 51, 16)
    return
  }
  if (kind.includes('receptacle') || kind === 'electrical-gfci' || kind === 'electrical-gfci-wp') {
    if (kind === 'electrical-gfci-wp') rectPath(22, 14, 56, 66, 'rgba(0,0,0,0)', fine)
    rectPath(30, 22, 40, 48, symbolFill, strokeWidth)
    circle(50, 35, 9, 'rgba(0,0,0,0)', fine)
    circle(50, 58, 9, 'rgba(0,0,0,0)', fine)
    line(45, 35, 55, 35, fine)
    line(45, 58, 55, 58, fine)
    if (kind === 'electrical-receptacle-240v') {
      line(38, 30, 48, 42, strokeWidth)
      line(62, 30, 52, 42, strokeWidth)
    }
    if (kind === 'electrical-half-hot-receptacle') line(32, 46, 68, 46, fine)
    text(kind === 'electrical-gfci-wp' ? 'WP' : kind === 'electrical-gfci' ? 'GFCI' : kind === 'electrical-receptacle-240v' ? '240' : kind === 'electrical-single-receptacle' ? 'SR' : kind === 'electrical-half-hot-receptacle' ? 'HH' : 'REC', 50, 84, 10)
    return
  }
  if (kind === 'electrical-timer-control') {
    rectPath(18, 18, 58, 54, symbolFill, strokeWidth)
    circle(47, 43, 15, 'rgba(0,0,0,0)', fine)
    line(47, 43, 47, 33, fine)
    line(47, 43, 57, 49, fine)
    text('TMR', 75, 82, 10)
    return
  }
  if (kind === 'electrical-photocell') {
    circle(46, 45, 27, symbolFill, strokeWidth)
    circle(46, 45, 6, stroke, fine)
    line(72, 23, 80, 15, fine)
    line(76, 44, 88, 44, fine)
    text('PC', 78, 82, 10)
    return
  }
  if (kind.includes('occupancy-sensor')) {
    const wall = kind.includes('wall')
    if (wall) rectPath(26, 15, 44, 60, symbolFill, strokeWidth)
    else circle(48, 45, 28, symbolFill, strokeWidth)
    circle(48, 45, 7, stroke, fine)
    text(wall ? 'OS-W' : 'OS-C', 78, 82, 10)
    return
  }
  if (kind === 'electrical-smoke-alarm' || kind === 'electrical-co-alarm') {
    circle(48, 45, 30, symbolFill, strokeWidth)
    circle(48, 45, 19, 'rgba(0,0,0,0)', fine)
    text(kind === 'electrical-smoke-alarm' ? 'SA' : 'CO', 48, 45, 18)
    return
  }
  if (kind === 'electrical-hdmi' || kind === 'electrical-data') {
    rectPath(22, 26, 52, 38, symbolFill, strokeWidth)
    text(kind === 'electrical-hdmi' ? 'HDMI' : 'DATA', 48, 46, 13)
    return
  }
  circle(50, 50, 28, symbolFill, strokeWidth)
  line(32, 50, 68, 50, fine)
  line(50, 32, 50, 68, fine)
}

function drawUnknownElectricalSymbolFallback(
  ctx: CanvasRenderingContext2D,
  rect: SnapshotRect,
  kind: string,
  style: { borderColor: string; fillColor: string; borderWidth: number; opacity: number; labelsVisible: boolean; visualScale: number },
): void {
  ctx.save()
  ctx.globalAlpha = Math.max(0.25, Math.min(1, style.opacity || 1))
  fillRect(ctx, rect, style.fillColor, Math.min(0.18, style.opacity || 0.18))
  strokeRect(ctx, rect, style.borderColor, style.borderWidth, 1, 'dashed', style.visualScale)
  ctx.strokeStyle = style.borderColor
  ctx.lineWidth = scaleExportLength(style.borderWidth, style.visualScale)
  ctx.beginPath()
  ctx.moveTo(rect.x, rect.y)
  ctx.lineTo(rect.x + rect.w, rect.y + rect.h)
  ctx.moveTo(rect.x + rect.w, rect.y)
  ctx.lineTo(rect.x, rect.y + rect.h)
  ctx.stroke()
  ctx.restore()
  if (style.labelsVisible) {
    const styleDescriptor = resolveBlueprintSnapshotCanvasLabelStyle({
      kind: 'unknown-electrical',
      textColor: style.borderColor,
      borderColor: style.borderColor,
    })
    drawCanvasLabel(ctx, `UNKNOWN ${electricalLabelForKind(kind)}`, rect.x + rect.w, rect.y, styleDescriptor, 'right')
  }
}

function isUnknownElectricalLikeSymbolKind(kind: string): boolean {
  return kind.startsWith('electrical-') || kind.startsWith('can-light-') || kind.startsWith('canless-light-')
}

function isSnapshotElectricalSymbolKind(kind: string): boolean {
  return isElectricalShapeKind(kind)
}

type SnapshotCoordinateMap = {
  x: (value: number) => number
  y: (value: number) => number
  w: (value: number) => number
  h: (value: number) => number
  visualScale: number
  exportScaleX: number
  exportScaleY: number
}

type SnapshotRect = { x: number; y: number; w: number; h: number }

function getSnapshotAnnotationMeta(annotation: any): Record<string, any> {
  return { ...(annotation || {}), ...((annotation?.meta || annotation?.metadata || {}) as Record<string, any>) }
}

function mapRect(rect: { x: number; y: number; w: number; h: number }, map: SnapshotCoordinateMap): SnapshotRect {
  return { x: map.x(rect.x), y: map.y(rect.y), w: map.w(rect.w), h: map.h(rect.h) }
}

function pointsFromMeta(meta: Record<string, any>): Array<{ x: number; y: number }> {
  return Array.isArray(meta.points)
    ? meta.points
        .map((point: any) => ({ x: Number(point.x), y: Number(point.y) }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    : []
}

function drawSnapshotPolyline(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  map: SnapshotCoordinateMap,
  style: { stroke: string; width: number; opacity: number; dash?: number[]; lineCap?: CanvasLineCap; lineJoin?: CanvasLineJoin },
): void {
  if (points.length < 2) return
  ctx.save()
  applyStroke(ctx, style.stroke, style.width, style.dash, style.opacity, map.visualScale)
  if (style.lineCap) ctx.lineCap = style.lineCap
  if (style.lineJoin) ctx.lineJoin = style.lineJoin
  ctx.beginPath()
  ctx.moveTo(map.x(points[0].x), map.y(points[0].y))
  points.slice(1).forEach((point) => ctx.lineTo(map.x(point.x), map.y(point.y)))
  ctx.stroke()
  ctx.restore()
}

function drawClosedPath(ctx: CanvasRenderingContext2D, points: Array<{ x: number; y: number }>, map: SnapshotCoordinateMap): void {
  ctx.beginPath()
  ctx.moveTo(map.x(points[0].x), map.y(points[0].y))
  points.slice(1).forEach((point) => ctx.lineTo(map.x(point.x), map.y(point.y)))
  ctx.closePath()
}

function fillRect(ctx: CanvasRenderingContext2D, rect: SnapshotRect, color: string, opacity: number): void {
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity))
  ctx.fillStyle = color
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
  ctx.restore()
}

function strokeRect(ctx: CanvasRenderingContext2D, rect: SnapshotRect, color: string, width: number, opacity: number, dash?: string, visualScale = 1): void {
  ctx.save()
  applyStroke(ctx, color, width, dash, opacity, visualScale)
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
  ctx.restore()
}

function drawLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width: number, dash: unknown, opacity: number, visualScale = 1): void {
  ctx.save()
  applyStroke(ctx, color, width, dash, opacity, visualScale)
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  ctx.restore()
}

function drawArrowHead(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width: number, visualScale = 1): void {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const size = Math.max(scaleExportLength(8, visualScale), scaleExportLength(width * 4, visualScale))
  ctx.save()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - size * Math.cos(angle - Math.PI / 6), y2 - size * Math.sin(angle - Math.PI / 6))
  ctx.lineTo(x2 - size * Math.cos(angle + Math.PI / 6), y2 - size * Math.sin(angle + Math.PI / 6))
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function applyStroke(ctx: CanvasRenderingContext2D, color: string, width: number, dash: unknown, opacity: number, visualScale = 1): void {
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity))
  ctx.strokeStyle = color
  ctx.lineWidth = scaleExportLength(Number(width) || 1, visualScale)
  ctx.setLineDash(scaleDashPattern(Array.isArray(dash) ? dash : dashForStyle(dash), visualScale))
}

function dashForStyle(style: unknown): number[] {
  return style === 'dashed' ? [8, 5] : style === 'dotted' ? [2, 5] : []
}

function measureDashForStyle(style: unknown): number[] {
  return style === 'dashed' ? [10, 6] : style === 'dotted' ? [2, 6] : []
}

function drawLabelAtPoints(
  ctx: CanvasRenderingContext2D,
  text: string,
  points: Array<{ x: number; y: number }>,
  map: SnapshotCoordinateMap,
  color: string,
  kind: Extract<BlueprintSnapshotCanvasLabelKind, 'measurement' | 'circuit'>,
): void {
  if (!text || points.length === 0) return
  const center = points.reduce((sum, point) => ({ x: sum.x + map.x(point.x) / points.length, y: sum.y + map.y(point.y) / points.length }), { x: 0, y: 0 })
  drawCanvasLabel(ctx, text, center.x, center.y, resolveBlueprintSnapshotCanvasLabelStyle({
    kind,
    textColor: color,
    borderColor: color,
  }))
}

function scaleExportLength(value: number, visualScale: number): number {
  return Math.max(0.5, (Number(value) || 1) * visualScale)
}

function scaleDashPattern(dash: number[], visualScale: number): number[] {
  return dash.map((value) => scaleExportLength(value, visualScale))
}

function drawElectricalSymbolLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  rect: SnapshotRect,
  style: {
    borderColor: string
    fillColor: string
    borderWidth: number
    opacity: number
    labelsVisible: boolean
    visualScale: number
    symbolLabelSettings: NonNullable<BlueprintSnapshotCaptureContext['symbolLabelSettings']>
  },
): void {
  const size = Math.max(scaleExportLength(8, style.visualScale), Math.min(Math.abs(rect.w), Math.abs(rect.h)))
  const unit = size / 100
  const originX = rect.x + rect.w / 2 - size / 2
  const originY = rect.y + rect.h / 2 - size / 2
  const capturedLabelScale = resolveBlueprintSnapshotSymbolLabelScale(style.symbolLabelSettings.symbolLabelScale)
  const labelColors = style.symbolLabelSettings.resolvedLabelColors
  const labelStyle = resolveBlueprintSnapshotCanvasLabelStyle({
    kind: 'symbol',
    textColor: String(style.symbolLabelSettings.customLabelColorsEnabled ? labelColors.textColor : style.borderColor),
    borderColor: String(style.symbolLabelSettings.customLabelColorsEnabled ? labelColors.borderColor : style.borderColor),
    fillColor: String(style.symbolLabelSettings.customLabelColorsEnabled ? labelColors.fillColor : '#0b1020'),
    labelScale: capturedLabelScale,
  })

  ctx.save()
  ctx.font = `${labelStyle.fontWeight} ${labelStyle.fontSize * unit}px ${labelStyle.fontFamily}`
  const box = resolveBlueprintSnapshotSymbolLabelBox({
    textWidth: ctx.measureText(text).width,
    labelScale: capturedLabelScale,
    symbolUnit: unit,
  })
  drawCanvasLabel(ctx, text, originX + (box.x + box.width / 2) * unit, originY + (box.y + box.height / 2) * unit, {
    ...labelStyle,
    fontSize: labelStyle.fontSize * unit,
    borderWidth: labelStyle.borderWidth * unit,
    borderRadius: box.radius * unit,
    minWidth: box.width * unit,
    height: box.height * unit,
    paddingX: labelStyle.paddingX * unit,
  })
  ctx.restore()
}

function drawCanvasLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, style: BlueprintSnapshotCanvasLabelStyle, align: 'center' | 'right' = 'center'): void {
  ctx.save()
  ctx.font = `${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`
  const metrics = ctx.measureText(text)
  const w = Math.max(style.minWidth, metrics.width + style.paddingX * 2)
  const h = style.height
  const left = align === 'right' ? x - w : x - w / 2
  const top = y - h / 2
  ctx.globalAlpha = style.backgroundOpacity
  ctx.fillStyle = style.backgroundColor
  drawRoundedRectPath(ctx, left, top, w, h, style.borderRadius)
  ctx.fill()
  if (style.borderWidth > 0 && style.borderOpacity > 0) {
    ctx.globalAlpha = style.borderOpacity
    ctx.strokeStyle = style.borderColor
    ctx.lineWidth = style.borderWidth
    drawRoundedRectPath(ctx, left, top, w, h, style.borderRadius)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.fillStyle = style.textColor
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, left + w / 2, top + h / 2)
  ctx.restore()
}

function drawRoundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function drawWrappedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, color: string, fontSize: number): void {
  ctx.save()
  ctx.fillStyle = color
  ctx.font = `${fontSize}px sans-serif`
  ctx.textBaseline = 'top'
  const words = text.split(/\s+/)
  let line = ''
  let offset = 0
  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, y + offset)
      line = word
      offset += fontSize * 1.25
    } else {
      line = next
    }
  })
  if (line) ctx.fillText(line, x, y + offset)
  ctx.restore()
}

function drawNoteDot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, visualScale = 1): void {
  const radius = scaleExportLength(10, visualScale)
  ctx.save()
  ctx.fillStyle = color
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = scaleExportLength(1, visualScale)
  ctx.beginPath()
  ctx.arc(x + radius, y + radius, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${scaleExportLength(10, visualScale)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('N', x + radius, y + radius)
  ctx.restore()
}

function electricalLabelForKind(kind: string): string {
  const metadata = getElectricalSymbolMetadata(kind)
  if (metadata?.shortLabel) return metadata.shortLabel
  return kind.replace(/^electrical-/, '').split('-').map((part) => part[0]?.toUpperCase() || '').join('').slice(0, 4)
}

function withAlpha(color: string, alpha: number): string {
  const safeAlpha = Math.max(0, Math.min(1, alpha))
  if (/^#([0-9a-f]{6})$/i.test(color)) {
    const hex = color.slice(1)
    const r = Number.parseInt(hex.slice(0, 2), 16)
    const g = Number.parseInt(hex.slice(2, 4), 16)
    const b = Number.parseInt(hex.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`
  }
  return color
}

export function buildSanitizedAnnotationSvg(input: {
  overlayElement: HTMLElement
  annotationIds: string[]
  width: number
  height: number
  paintRoots?: HTMLElement[]
}): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('xmlns', SVG_NS)
  svg.setAttribute('width', String(input.width))
  svg.setAttribute('height', String(input.height))
  svg.setAttribute('viewBox', `0 0 ${input.width} ${input.height}`)
  svg.setAttribute('preserveAspectRatio', 'none')

  const overlayRect = input.overlayElement.getBoundingClientRect()
  if (overlayRect.width <= 0 || overlayRect.height <= 0) return svg

  const seen = new Set<string>()
  const roots = input.paintRoots || collectAnnotationPaintRoots(input.overlayElement, input.annotationIds)
  for (const source of roots) {
    const annotationId = source.dataset.annotationId || source.getAttribute('data-annotation-id') || ''
    if (annotationId && seen.has(annotationId)) continue
    if (annotationId) seen.add(annotationId)
    const layer = buildAnnotationSvgLayer(source, overlayRect, input.width, input.height)
    if (layer) svg.appendChild(layer)
  }
  return svg
}

function collectAnnotationPaintRoots(overlayElement: HTMLElement, annotationIds: string[]): HTMLElement[] {
  return Array.from(new Set(annotationIds.filter(Boolean)))
    .map((annotationId) => findAnnotationPaintRoot(overlayElement, annotationId))
    .filter((element): element is HTMLElement => Boolean(element))
}

function findAnnotationPaintRoot(overlayElement: HTMLElement, annotationId: string): HTMLElement | null {
  const target = overlayElement.querySelector(`[data-annotation-id="${cssEscape(annotationId)}"]`) as Element | null
  if (!target) return null
  const directHtmlRoot = target instanceof HTMLElement ? target : null
  const htmlDataRoot = target.closest('div[data-annotation-id]') as HTMLElement | null
  if (htmlDataRoot && overlayElement.contains(htmlDataRoot)) return htmlDataRoot
  const svgRoot = target instanceof SVGElement ? target.closest('svg') : null
  if (svgRoot && svgRoot.parentElement && overlayElement.contains(svgRoot.parentElement)) {
    svgRoot.parentElement.setAttribute('data-annotation-id', annotationId)
    return svgRoot.parentElement
  }
  const parentWithSvg = directHtmlRoot?.parentElement
  if (parentWithSvg && parentWithSvg !== overlayElement && parentWithSvg.querySelector(':scope > svg')) {
    parentWithSvg.setAttribute('data-annotation-id', annotationId)
    return parentWithSvg
  }
  return directHtmlRoot
}

function buildAnnotationSvgLayer(
  source: HTMLElement,
  overlayRect: DOMRect,
  outputWidth: number,
  outputHeight: number,
): SVGGElement | null {
  const sourceRect = source.getBoundingClientRect()
  if (sourceRect.width <= 0 || sourceRect.height <= 0) return null
  const x = ((sourceRect.left - overlayRect.left) / overlayRect.width) * outputWidth
  const y = ((sourceRect.top - overlayRect.top) / overlayRect.height) * outputHeight
  const width = (sourceRect.width / overlayRect.width) * outputWidth
  const height = (sourceRect.height / overlayRect.height) * outputHeight
  if (![x, y, width, height].every((value) => Number.isFinite(value)) || width <= 0 || height <= 0) return null

  const group = document.createElementNS(SVG_NS, 'g')
  const annotationId = source.dataset.annotationId || ''
  group.setAttribute('data-annotation-id', annotationId)
  group.setAttribute('transform', `translate(${round(x)} ${round(y)}) scale(${round(width / sourceRect.width)} ${round(height / sourceRect.height)})`)

  appendHtmlPaintNodes(group, source, sourceRect)
  appendNestedSvgNodes(group, source, sourceRect, annotationId)
  appendHtmlTextNodes(group, source, sourceRect)
  return group.childNodes.length ? group : null
}

function appendNestedSvgNodes(group: SVGGElement, source: HTMLElement, sourceRect: DOMRect, annotationId: string): void {
  const sourceSvgs = [
    ...(source instanceof SVGSVGElement ? [source] : []),
    ...Array.from(source.querySelectorAll('svg')),
  ]
  sourceSvgs.forEach((sourceSvg, index) => {
    if (!(sourceSvg instanceof SVGSVGElement) || isEditorOnlyElement(sourceSvg)) return
    const rect = sourceSvg.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const clone = sourceSvg.cloneNode(true) as SVGSVGElement
    sanitizeSvgClone(clone)
    prefixSvgIds(clone, `snap-${sanitizeSvgIdPart(annotationId || 'annotation')}-${index}-`)
    clone.setAttribute('x', String(round(rect.left - sourceRect.left)))
    clone.setAttribute('y', String(round(rect.top - sourceRect.top)))
    clone.setAttribute('width', String(round(rect.width)))
    clone.setAttribute('height', String(round(rect.height)))
    clone.setAttribute('overflow', 'visible')
    if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${round(rect.width)} ${round(rect.height)}`)
    group.appendChild(clone)
  })
}

function appendHtmlPaintNodes(group: SVGGElement, source: HTMLElement, sourceRect: DOMRect): void {
  const elements = [source, ...Array.from(source.querySelectorAll<HTMLElement>('*'))]
  elements.forEach((element) => {
    if (isEditorOnlyElement(element) || element.querySelector('svg')) return
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const computed = window.getComputedStyle(element)
    const background = computed.backgroundColor
    const borderColor = computed.borderColor
    const hasBackground = isVisibleCssColor(background)
    const borderWidth = Math.max(
      parseCssPx(computed.borderTopWidth),
      parseCssPx(computed.borderRightWidth),
      parseCssPx(computed.borderBottomWidth),
      parseCssPx(computed.borderLeftWidth),
    )
    const hasBorder = borderWidth > 0 && isVisibleCssColor(borderColor)
    if (!hasBackground && !hasBorder) return
    const rectangle = document.createElementNS(SVG_NS, 'rect')
    rectangle.setAttribute('x', String(round(rect.left - sourceRect.left)))
    rectangle.setAttribute('y', String(round(rect.top - sourceRect.top)))
    rectangle.setAttribute('width', String(round(rect.width)))
    rectangle.setAttribute('height', String(round(rect.height)))
    rectangle.setAttribute('rx', String(round(parseCssPx(computed.borderTopLeftRadius))))
    rectangle.setAttribute('fill', hasBackground ? background : 'none')
    if (hasBorder) {
      rectangle.setAttribute('stroke', borderColor)
      rectangle.setAttribute('stroke-width', String(round(borderWidth)))
    }
    group.appendChild(rectangle)
  })
}

function appendHtmlTextNodes(group: SVGGElement, source: HTMLElement, sourceRect: DOMRect): void {
  const elements = [source, ...Array.from(source.querySelectorAll<HTMLElement>('*'))]
  elements.forEach((element) => {
    if (isEditorOnlyElement(element) || element.querySelector('svg') || element.children.length > 0) return
    const text = String(element.textContent || '').trim()
    if (!text) return
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const computed = window.getComputedStyle(element)
    const fontSize = parseCssPx(computed.fontSize) || 12
    const textNode = document.createElementNS(SVG_NS, 'text')
    textNode.setAttribute('x', String(round(rect.left - sourceRect.left + parseCssPx(computed.paddingLeft))))
    textNode.setAttribute('y', String(round(rect.top - sourceRect.top + fontSize + parseCssPx(computed.paddingTop))))
    textNode.setAttribute('fill', isVisibleCssColor(computed.color) ? computed.color : '#111827')
    textNode.setAttribute('font-size', String(round(fontSize)))
    textNode.setAttribute('font-family', computed.fontFamily || 'Helvetica')
    textNode.setAttribute('font-weight', computed.fontWeight || '400')
    textNode.setAttribute('font-style', computed.fontStyle || 'normal')
    textNode.textContent = text
    group.appendChild(textNode)
  })
}

function sanitizeSvgClone(root: SVGSVGElement): void {
  root.querySelectorAll('[title],title,desc,script,foreignObject').forEach((node) => node.remove())
  const nodes = [root, ...Array.from(root.querySelectorAll('*'))]
  nodes.forEach((node) => {
    if (node instanceof SVGElement) {
      if (isEditorOnlyElement(node) || node.getAttribute('stroke') === 'transparent') {
        node.remove()
        return
      }
      node.removeAttribute('class')
      node.removeAttribute('role')
      node.removeAttribute('aria-label')
      node.removeAttribute('tabindex')
      resolveSvgPaintAttributes(node)
      node.style.pointerEvents = 'none'
      node.style.cursor = 'default'
    }
  })
}

function prefixSvgIds(root: SVGSVGElement, prefix: string): void {
  const idMap = new Map<string, string>()
  const nodes = [root, ...Array.from(root.querySelectorAll('*'))]
  nodes.forEach((node) => {
    if (!(node instanceof SVGElement)) return
    const id = node.getAttribute('id')
    if (!id) return
    const nextId = `${prefix}${sanitizeSvgIdPart(id)}`
    idMap.set(id, nextId)
    node.setAttribute('id', nextId)
  })
  if (idMap.size === 0) return
  nodes.forEach((node) => {
    if (!(node instanceof SVGElement)) return
    Array.from(node.attributes).forEach((attribute) => {
      const value = attribute.value
      if (!value) return
      let nextValue = value
      idMap.forEach((nextId, previousId) => {
        const escaped = escapeRegExp(previousId)
        nextValue = nextValue
          .replace(new RegExp(`url\\((['"]?)#${escaped}\\1\\)`, 'g'), `url(#${nextId})`)
          .replace(new RegExp(`^#${escaped}$`, 'g'), `#${nextId}`)
      })
      if (nextValue !== value) node.setAttribute(attribute.name, nextValue)
    })
  })
}

function validateConstructedSvg(svg: SVGSVGElement, diagnostics: BlueprintSnapshotCaptureDiagnostics): void {
  const width = Number(svg.getAttribute('width'))
  const height = Number(svg.getAttribute('height'))
  const viewBox = String(svg.getAttribute('viewBox') || '')
  if (svg.namespaceURI !== SVG_NS || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !/^0 0 \d/.test(viewBox)) {
    throw new BlueprintSnapshotCaptureError('SVG_CONSTRUCTION', 'INVALID_SVG', undefined, diagnostics)
  }
  const serialized = new XMLSerializer().serializeToString(svg)
  if (serialized.includes('foreignObject') || serialized.includes('var(') || /url\((?!#)/i.test(serialized)) {
    throw new BlueprintSnapshotCaptureError('SVG_CONSTRUCTION', 'INVALID_SVG', undefined, {
      ...diagnostics,
      serializedSvgLength: serialized.length,
    })
  }
}

function parseSerializedSvg(serialized: string): {
  rootName: string
  rootNamespace: string
  rootAttributes: Record<string, string>
  rootChildCount: number
  paintNodeCount: number
  parsererrorCount: number
  elementNamespaces: string[]
} {
  if (typeof DOMParser !== 'undefined') {
    const parsed = new DOMParser().parseFromString(serialized, 'application/xml')
    const root = parsed.documentElement
    return {
      rootName: root?.localName || '',
      rootNamespace: root?.namespaceURI || '',
      rootAttributes: root ? attributesToRecord(root) : {},
      rootChildCount: root ? Array.from(root.childNodes).filter((node) => node.nodeType === Node.ELEMENT_NODE).length : 0,
      paintNodeCount: root ? parsed.querySelectorAll('path,line,polyline,polygon,circle,ellipse,rect,text,use,image,svg,g').length : 0,
      parsererrorCount: parsed.getElementsByTagName('parsererror').length,
      elementNamespaces: Array.from(parsed.getElementsByTagName('*')).map((element) => element.namespaceURI || ''),
    }
  }
  const rootMatch = serialized.match(/<svg\b([^>]*)>/i)
  const rootAttributes = parseSvgAttributes(rootMatch?.[1] || '')
  return {
    rootName: rootMatch ? 'svg' : '',
    rootNamespace: rootAttributes.xmlns || '',
    rootAttributes,
    rootChildCount: Math.max(0, (serialized.match(/<g\b|<svg\b|<path\b|<line\b|<polyline\b|<polygon\b|<circle\b|<ellipse\b|<rect\b|<text\b|<use\b|<image\b/gi) || []).length - 1),
    paintNodeCount: (serialized.match(/<g\b|<svg\b|<path\b|<line\b|<polyline\b|<polygon\b|<circle\b|<ellipse\b|<rect\b|<text\b|<use\b|<image\b/gi) || []).length,
    parsererrorCount: serialized.includes('<parsererror') || isLikelyMalformedXml(serialized) ? 1 : 0,
    elementNamespaces: serialized.includes('http://www.w3.org/1999/xhtml') ? ['http://www.w3.org/1999/xhtml'] : [SVG_NS],
  }
}

function isLikelyMalformedXml(serialized: string): boolean {
  const stack: string[] = []
  const tags = Array.from(serialized.matchAll(/<\/?([a-zA-Z][\w:-]*)(?:\s[^>]*)?>/g))
  for (const match of tags) {
    const raw = match[0]
    const name = match[1]
    if (raw.startsWith('<?') || raw.startsWith('<!--') || raw.endsWith('/>')) continue
    if (raw.startsWith('</')) {
      if (stack.pop() !== name) return true
    } else {
      stack.push(name)
    }
  }
  return stack.length > 0
}

function attributesToRecord(element: Element): Record<string, string> {
  return Array.from(element.attributes).reduce<Record<string, string>>((record, attribute) => {
    record[attribute.name] = attribute.value
    return record
  }, {})
}

function parseSvgAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  source.replace(/([:\w-]+)\s*=\s*(['"])(.*?)\2/g, (_match, name: string, _quote: string, value: string) => {
    attributes[name] = value
    return ''
  })
  return attributes
}

function countUnsupportedSvgElements(serialized: string, elementNamespaces: string[]): number {
  const unsupportedTagCount = (serialized.match(/<(?:foreignObject|script|iframe)\b/gi) || []).length
  const htmlNamespaceCount = elementNamespaces.filter((namespace) => namespace && namespace !== SVG_NS).length
  return unsupportedTagCount + htmlNamespaceCount
}

function countExternalSvgReferences(serialized: string): number {
  const hrefMatches = Array.from(serialized.matchAll(/\b(?:href|xlink:href)\s*=\s*["']([^"']+)["']/gi))
    .filter((match) => {
      const value = String(match[1] || '').trim()
      return Boolean(value && !value.startsWith('#'))
    }).length
  const urlMatches = Array.from(serialized.matchAll(/url\(([^)]+)\)/gi))
    .filter((match) => {
      const value = String(match[1] || '').trim().replace(/^['"]|['"]$/g, '')
      return !value.startsWith('#')
    }).length
  const externalImageMatches = Array.from(serialized.matchAll(/<image\b[^>]*(?:href|xlink:href)\s*=\s*["']([^"']+)["']/gi))
    .filter((match) => !String(match[1] || '').trim().startsWith('#')).length
  return hrefMatches + urlMatches + externalImageMatches
}

function countDuplicateSvgIds(serialized: string): number {
  const ids = Array.from(serialized.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)).map((match) => match[1])
  const seen = new Set<string>()
  let duplicates = 0
  ids.forEach((id) => {
    if (seen.has(id)) duplicates += 1
    else seen.add(id)
  })
  return duplicates
}

function countUnresolvedInternalSvgReferences(serialized: string): number {
  const ids = new Set(Array.from(serialized.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)).map((match) => match[1]))
  const references = [
    ...Array.from(serialized.matchAll(/url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/gi)).map((match) => match[1]),
    ...Array.from(serialized.matchAll(/\b(?:href|xlink:href)\s*=\s*["']#([^"']+)["']/gi)).map((match) => match[1]),
  ]
  return references.filter((reference) => !ids.has(reference)).length
}

function hasValidSvgTransforms(serialized: string): boolean {
  return Array.from(serialized.matchAll(/\btransform\s*=\s*["']([^"']+)["']/gi)).every((match) => {
    const transform = String(match[1] || '').trim()
    if (!transform) return true
    const functions = Array.from(transform.matchAll(/([a-zA-Z]+)\(([^)]*)\)/g))
    if (functions.length === 0) return false
    return functions.every((fn) => {
      const name = fn[1]
      if (!['matrix', 'translate', 'scale', 'rotate', 'skewX', 'skewY'].includes(name)) return false
      return fn[2].split(/[\s,]+/).filter(Boolean).every((value) => Number.isFinite(Number(value)))
    })
  })
}

function isValidSvgViewBox(viewBox: string | undefined, width: number, height: number): boolean {
  const parts = String(viewBox || '').trim().split(/[\s,]+/).map(Number)
  return parts.length === 4
    && parts.every((value) => Number.isFinite(value))
    && parts[0] === 0
    && parts[1] === 0
    && parts[2] === width
    && parts[3] === height
}

function svgValidationError(
  code: BlueprintSnapshotCaptureErrorCode,
  diagnostics: BlueprintSnapshotCaptureDiagnostics,
): BlueprintSnapshotCaptureError {
  return new BlueprintSnapshotCaptureError('SVG_VALIDATION', code, undefined, diagnostics)
}

function resolveSvgPaintAttributes(node: SVGElement): void {
  const computed = window.getComputedStyle(node)
  ;[
    ['fill', computed.fill],
    ['fill-opacity', computed.fillOpacity],
    ['stroke', computed.stroke],
    ['stroke-opacity', computed.strokeOpacity],
    ['stroke-width', computed.strokeWidth],
    ['stroke-dasharray', computed.strokeDasharray],
    ['stroke-linecap', computed.strokeLinecap],
    ['stroke-linejoin', computed.strokeLinejoin],
    ['opacity', computed.opacity],
    ['color', computed.color],
    ['stop-color', computed.stopColor],
    ['font-family', computed.fontFamily],
    ['font-size', computed.fontSize],
    ['font-weight', computed.fontWeight],
    ['paint-order', computed.paintOrder],
    ['vector-effect', computed.vectorEffect],
  ].forEach(([name, value]) => {
    const current = node.getAttribute(name)
    if (current?.includes('var(') && value && !value.includes('var(')) node.setAttribute(name, value)
  })
}

function isEditorOnlyElement(element: Element): boolean {
  const className = typeof (element as HTMLElement).className === 'string' ? (element as HTMLElement).className : ''
  return /\bcursor-/.test(className)
    || element.matches('button,input,textarea,select,[contenteditable="true"]')
    || className.split(/\s+/).some((token) => token.startsWith('ring'))
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob || blob.type !== 'image/png') {
          reject(new BlueprintSnapshotCaptureError('PNG_ENCODING', 'PNG_ENCODING_FAILED'))
          return
        }
        resolve(blob)
      }, 'image/png')
    } catch {
      reject(new BlueprintSnapshotCaptureError('PNG_ENCODING', 'PNG_ENCODING_FAILED'))
    }
  })
}

function captureError(
  stage: BlueprintSnapshotCaptureStage,
  code: BlueprintSnapshotCaptureErrorCode,
  context: Partial<BlueprintSnapshotCaptureContext>,
  dimensions?: BlueprintSnapshotDimensions,
): BlueprintSnapshotCaptureError {
  return new BlueprintSnapshotCaptureError(stage, code, undefined, {
    pageNumber: context.pageNumber,
    rotation: context.rotation,
    outputWidth: dimensions?.width,
    outputHeight: dimensions?.height,
  })
}

function isValidSnapshotDimensions(dimensions: BlueprintSnapshotDimensions): boolean {
  return Number.isInteger(dimensions.width)
    && Number.isInteger(dimensions.height)
    && dimensions.width > 0
    && dimensions.height > 0
    && dimensions.width <= BLUEPRINT_SNAPSHOT_MAX_EDGE
    && dimensions.height <= BLUEPRINT_SNAPSHOT_MAX_EDGE
}

function normalizeRotation(rotation: number): number {
  const normalized = ((Math.round(Number(rotation) || 0) % 360) + 360) % 360
  return [0, 90, 180, 270].includes(normalized) ? normalized : 0
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value)
  return String(value).replace(/["\\]/g, '\\$&')
}

function sanitizeSvgIdPart(value: string): string {
  const clean = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '-')
  return clean || 'id'
}

function escapeRegExp(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseCssPx(value: string | null | undefined): number {
  const parsed = Number.parseFloat(String(value || '0'))
  return Number.isFinite(parsed) ? parsed : 0
}

function isVisibleCssColor(value: string | null | undefined): boolean {
  const color = String(value || '').trim().toLowerCase()
  return Boolean(color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)' && color !== 'rgba(0,0,0,0)')
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
