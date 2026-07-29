import {
  BLUEPRINT_SNAPSHOT_MAX_EDGE,
  BLUEPRINT_SNAPSHOT_MAX_FILE_SIZE_BYTES,
  BLUEPRINT_SNAPSHOT_TARGET_DPI,
  type BlueprintSnapshotCaptureContext,
  type BlueprintSnapshotCaptureMetadata,
  type BlueprintSnapshotCaptureResult,
  type BlueprintSnapshotDimensions,
} from './types'

const SVG_NS = 'http://www.w3.org/2000/svg'

export type BlueprintSnapshotCaptureStage =
  | 'PAGE_UNAVAILABLE'
  | 'INVALID_DIMENSIONS'
  | 'CANVAS_UNAVAILABLE'
  | 'PDF_RENDER_FAILED'
  | 'OVERLAY_SERIALIZATION_FAILED'
  | 'OVERLAY_IMAGE_DECODE_FAILED'
  | 'PNG_ENCODING_FAILED'

export class BlueprintSnapshotCaptureError extends Error {
  stage: BlueprintSnapshotCaptureStage

  constructor(stage: BlueprintSnapshotCaptureStage, message = stage) {
    super(message)
    this.name = 'BlueprintSnapshotCaptureError'
    this.stage = stage
  }
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
  pageNumber: number
  rotation: number
  dimensions: BlueprintSnapshotDimensions
  viewMode: 'general' | 'scoped'
  scopedWorkPackageIds: string[]
  labelsVisible: boolean
  circuitLabelsVisible: boolean
  annotationCount: number
}): BlueprintSnapshotCaptureMetadata {
  return {
    schemaVersion: 1,
    captureMode: 'full-page',
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
    circuitLabelsVisible: Boolean(input.circuitLabelsVisible),
    annotationCount: Math.max(0, Math.floor(Number(input.annotationCount) || 0)),
  }
}

export async function captureBlueprintSnapshot(context: BlueprintSnapshotCaptureContext): Promise<BlueprintSnapshotCaptureResult> {
  if (!context.page || typeof context.page.getViewport !== 'function' || typeof context.page.render !== 'function') {
    throw new BlueprintSnapshotCaptureError('PAGE_UNAVAILABLE')
  }

  const rotation = normalizeRotation(context.rotation)
  const baseViewport = context.page.getViewport({ scale: 1, rotation })
  const dimensions = calculateBlueprintSnapshotDimensions({
    pageWidth: baseViewport.width,
    pageHeight: baseViewport.height,
  })
  if (!isValidSnapshotDimensions(dimensions)) throw new BlueprintSnapshotCaptureError('INVALID_DIMENSIONS')

  const canvas = document.createElement('canvas')
  canvas.width = dimensions.width
  canvas.height = dimensions.height
  const canvasContext = canvas.getContext('2d')
  if (!canvasContext) throw new BlueprintSnapshotCaptureError('CANVAS_UNAVAILABLE')

  try {
    const viewport = context.page.getViewport({ scale: dimensions.scale, rotation })
    const renderTask = context.page.render({ canvasContext, viewport })
    await renderTask.promise
  } catch {
    throw new BlueprintSnapshotCaptureError('PDF_RENDER_FAILED')
  }

  if (context.overlayElement && context.annotations.length > 0) {
    await drawSanitizedAnnotationOverlay(canvasContext, {
      overlayElement: context.overlayElement,
      annotationIds: context.annotations.map((annotation) => annotation.id),
      width: dimensions.width,
      height: dimensions.height,
    })
  }

  const blob = await canvasToPngBlob(canvas)
  if (blob.size > BLUEPRINT_SNAPSHOT_MAX_FILE_SIZE_BYTES) throw new BlueprintSnapshotCaptureError('PNG_ENCODING_FAILED')

  const captureMetadata = buildBlueprintSnapshotMetadata({
    pageNumber: context.pageNumber,
    rotation: context.rotation,
    dimensions,
    viewMode: context.viewMode,
    scopedWorkPackageIds: context.scopedWorkPackageIds,
    labelsVisible: context.labelsVisible,
    circuitLabelsVisible: context.circuitLabelsVisible,
    annotationCount: context.annotations.length,
  })

  return {
    blob,
    width: dimensions.width,
    height: dimensions.height,
    pageNumber: captureMetadata.pageNumber,
    rotation: captureMetadata.rotation,
    annotationCount: context.annotations.length,
    captureMetadata,
  }
}

async function drawSanitizedAnnotationOverlay(
  canvasContext: CanvasRenderingContext2D,
  input: { overlayElement: HTMLElement; annotationIds: string[]; width: number; height: number },
): Promise<void> {
  await document.fonts?.ready?.catch?.(() => undefined)
  const svg = buildSanitizedAnnotationSvg(input)
  if (!svg.childNodes.length) return

  let serialized = ''
  try {
    serialized = new XMLSerializer().serializeToString(svg)
  } catch {
    throw new BlueprintSnapshotCaptureError('OVERLAY_SERIALIZATION_FAILED')
  }
  if (!serialized.trim()) throw new BlueprintSnapshotCaptureError('OVERLAY_SERIALIZATION_FAILED')
  const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.width = input.width
    image.height = input.height
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new BlueprintSnapshotCaptureError('OVERLAY_IMAGE_DECODE_FAILED'))
    })
    image.src = url
    try {
      await loaded
    } catch (error) {
      if (error instanceof BlueprintSnapshotCaptureError) throw error
      throw new BlueprintSnapshotCaptureError('OVERLAY_IMAGE_DECODE_FAILED')
    }
    canvasContext.drawImage(image, 0, 0, input.width, input.height)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function buildSanitizedAnnotationSvg(input: {
  overlayElement: HTMLElement
  annotationIds: string[]
  width: number
  height: number
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
  for (const annotationId of input.annotationIds) {
    const source = findAnnotationElement(input.overlayElement, annotationId)
    if (!source || seen.has(annotationId)) continue
    seen.add(annotationId)
    const layer = buildAnnotationSvgLayer(source, overlayRect, input.width, input.height)
    if (layer) svg.appendChild(layer)
  }
  return svg
}

function findAnnotationElement(overlayElement: HTMLElement, annotationId: string): HTMLElement | null {
  return overlayElement.querySelector(`[data-annotation-id="${cssEscape(annotationId)}"]`) as HTMLElement | null
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
  group.setAttribute('data-annotation-id', source.dataset.annotationId || '')
  group.setAttribute('transform', `translate(${round(x)} ${round(y)}) scale(${round(width / sourceRect.width)} ${round(height / sourceRect.height)})`)

  appendHtmlPaintNodes(group, source, sourceRect)
  appendNestedSvgNodes(group, source, sourceRect)
  appendHtmlTextNodes(group, source, sourceRect)
  return group.childNodes.length ? group : null
}

function appendNestedSvgNodes(group: SVGGElement, source: HTMLElement, sourceRect: DOMRect): void {
  source.querySelectorAll('svg').forEach((sourceSvg) => {
    if (!(sourceSvg instanceof SVGSVGElement) || isEditorOnlyElement(sourceSvg)) return
    const rect = sourceSvg.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const clone = sourceSvg.cloneNode(true) as SVGSVGElement
    sanitizeSvgClone(clone)
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
  root.querySelectorAll('*').forEach((node) => {
    if (node instanceof SVGElement) {
      if (isEditorOnlyElement(node) || node.getAttribute('stroke') === 'transparent') {
        node.remove()
        return
      }
      node.removeAttribute('class')
      node.removeAttribute('role')
      node.removeAttribute('aria-label')
      node.removeAttribute('tabindex')
      node.style.pointerEvents = 'none'
      node.style.cursor = 'default'
    }
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
          reject(new BlueprintSnapshotCaptureError('PNG_ENCODING_FAILED'))
          return
        }
        resolve(blob)
      }, 'image/png')
    } catch {
      reject(new BlueprintSnapshotCaptureError('PNG_ENCODING_FAILED'))
    }
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
