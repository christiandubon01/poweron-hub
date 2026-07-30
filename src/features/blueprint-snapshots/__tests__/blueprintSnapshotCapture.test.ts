import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BLUEPRINT_SNAPSHOT_MAX_EDGE,
  calculateBlueprintSnapshotFitScale,
  clampBlueprintSnapshotPan,
  clampBlueprintSnapshotZoom,
  calculateBlueprintSnapshotDimensions,
  formatBlueprintSnapshotZoomPercent,
  buildBlueprintSnapshotExportTransform,
  buildBlueprintSnapshotMetadata,
  zoomBlueprintSnapshotAtPoint,
  captureBlueprintSnapshot,
  BlueprintSnapshotCaptureError,
  createBlueprintSnapshotPreviewState,
  formatBlueprintSnapshotCaptureFailureMessage,
  isBlueprintSnapshotCaptureStillCurrent,
  revokeBlueprintSnapshotPreviewState,
  validateBlueprintSnapshotCaptureResult,
  validateSerializedAnnotationSvg,
  resolveBlueprintSnapshotCanvasLabelStyle,
  resolveBlueprintSnapshotSymbolLabelBox,
  resolveBlueprintSnapshotSymbolLabelScale,
  type BlueprintSnapshotCaptureResult,
} from '@/features/blueprint-snapshots'
import fs from 'node:fs'
import path from 'node:path'

const captureSourcePath = path.resolve(process.cwd(), 'src/features/blueprint-snapshots/blueprintSnapshotCapture.ts')
const viewerSourcePath = path.resolve(process.cwd(), 'src/components/blueprint/OperationsBlueprintPdfViewer.tsx')
const dialogSourcePath = path.resolve(process.cwd(), 'src/features/blueprint-snapshots/BlueprintSnapshotCaptureDialog.tsx')
const viewportSourcePath = path.resolve(process.cwd(), 'src/features/blueprint-snapshots/BlueprintSnapshotPreviewViewport.tsx')
const validSerializedSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><defs><marker id="m"><path d="M0 0 L1 1"/></marker></defs><g><path d="M0 0 L10 10" stroke="red" marker-end="url(#m)"/></g></svg>'
const validPngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0])
const previewValidationContext = {
  generation: 12,
  currentGeneration: 12,
  pageNumber: 25,
  currentPageNumber: 25,
  blueprintSetId: 'set-1',
  currentBlueprintSetId: 'set-1',
  viewerMounted: true,
}

function expectSvgValidationCode(svg: string, code: string) {
  try {
    validateSerializedAnnotationSvg(svg, {
      expectedWidth: 100,
      expectedHeight: 50,
      visibleAnnotationCount: 1,
    })
  } catch (error) {
    expect(error).toBeInstanceOf(BlueprintSnapshotCaptureError)
    expect(error).toMatchObject({ stage: 'SVG_VALIDATION', code })
    return
  }
  throw new Error(`Expected SVG validation code ${code}`)
}

function installPdfOnlyCanvasDocumentStub(input?: { toBlobResult?: Blob | null }) {
  const canvases: any[] = []
  const createCanvasContext = () => ({
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    ellipse: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    fillText: vi.fn(),
    setLineDash: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 7 })),
  })
  vi.stubGlobal('document', {
    createElement: vi.fn((tagName: string) => {
      if (tagName !== 'canvas') throw new Error(`Unexpected element: ${tagName}`)
      const canvasContext = createCanvasContext()
      const canvas = {
        width: 0,
        height: 0,
        getContext: vi.fn(() => canvasContext),
        toBlob: vi.fn((callback: (blob: Blob | null) => void, type: string) => {
          callback(input?.toBlobResult === undefined ? new Blob(['png'], { type }) : input.toBlobResult)
        }),
      }
      canvases.push(canvas)
      return canvas
    }),
  })
  return { canvases }
}

function createPageStub(input?: { renderRejects?: boolean }) {
  return {
    rotate: 0,
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: 612 * scale,
      height: 792 * scale,
    })),
    render: vi.fn(() => ({
      promise: input?.renderRejects ? Promise.reject(new Error('render failed')) : Promise.resolve(),
    })),
  }
}

function createCaptureResult(input?: { blob?: Blob; width?: number; height?: number; pageNumber?: number }): BlueprintSnapshotCaptureResult {
  const width = input?.width ?? 1689
  const height = input?.height ?? 1059
  const pageNumber = input?.pageNumber ?? 25
  const previewCanvas = {
    width,
    height,
    getContext: vi.fn(() => ({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    })),
  } as unknown as HTMLCanvasElement
  return {
    blob: input?.blob ?? new Blob([validPngBytes], { type: 'image/png' }),
    previewCanvas,
    width,
    height,
    pageNumber,
    rotation: 0,
    annotationCount: 42,
    captureMetadata: {
      schemaVersion: 1,
      captureMode: 'area',
      pageNumber,
      rotation: 0,
      targetDpi: 150,
      outputWidth: width,
      outputHeight: height,
      sourcePageWidth: 3378,
      sourcePageHeight: 2118,
      viewMode: 'scoped',
      scopedWorkPackageIds: ['wp-1'],
      labelsVisible: true,
      circuitLabelsVisible: true,
      annotationCount: 42,
      cropRect: { x: 0.1, y: 0.2, w: 0.4, h: 0.5 },
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('blueprint snapshot capture helpers', () => {
  it('uses approximately 150 DPI for a normal page', () => {
    const dimensions = calculateBlueprintSnapshotDimensions({ pageWidth: 612, pageHeight: 792 })
    expect(dimensions.scale).toBeCloseTo(150 / 72, 5)
    expect(dimensions.width).toBe(1275)
    expect(dimensions.height).toBe(1650)
  })

  it('caps the longest edge at 4096', () => {
    const dimensions = calculateBlueprintSnapshotDimensions({ pageWidth: 4000, pageHeight: 2000 })
    expect(dimensions.width).toBe(BLUEPRINT_SNAPSHOT_MAX_EDGE)
    expect(dimensions.height).toBe(2048)
    expect(dimensions.scale).toBeCloseTo(4096 / 4000, 5)
  })

  it('never creates zero dimensions', () => {
    const dimensions = calculateBlueprintSnapshotDimensions({ pageWidth: 0, pageHeight: 0 })
    expect(dimensions.width).toBeGreaterThan(0)
    expect(dimensions.height).toBeGreaterThan(0)
  })

  it('reflects rotated viewport dimensions when PDF.js swaps orientation', () => {
    const portrait = calculateBlueprintSnapshotDimensions({ pageWidth: 612, pageHeight: 792 })
    const landscape = calculateBlueprintSnapshotDimensions({ pageWidth: 792, pageHeight: 612 })
    expect(landscape.width).toBe(portrait.height)
    expect(landscape.height).toBe(portrait.width)
  })

  it('is independent of viewer zoom and CSS visualScale inputs by design', () => {
    const first = calculateBlueprintSnapshotDimensions({ pageWidth: 960, pageHeight: 720 })
    const second = calculateBlueprintSnapshotDimensions({ pageWidth: 960, pageHeight: 720 })
    expect(second).toEqual(first)
  })

  it('derives annotation export scale from selected PDF coordinates and final output size', () => {
    const transform = buildBlueprintSnapshotExportTransform({
      sourcePageWidth: 1200,
      sourcePageHeight: 800,
      cropRect: { x: 0.25, y: 0.125, w: 0.5, h: 0.25 },
      outputWidth: 1500,
      outputHeight: 500,
      pdfRenderScale: 2.5,
    })

    expect(transform.selectedPdfWidth).toBe(600)
    expect(transform.selectedPdfHeight).toBe(200)
    expect(transform.exportScaleX).toBeCloseTo(1500 / 600, 5)
    expect(transform.exportScaleY).toBeCloseTo(500 / 200, 5)
    expect(transform.annotationRenderScaleX).toBe(transform.exportScaleX)
    expect(transform.annotationRenderScaleY).toBe(transform.exportScaleY)
    expect(transform.annotationBackingWidth).toBe(1500)
    expect(transform.annotationBackingHeight).toBe(500)
    expect(transform.annotationPaintSource).toBe('final-canvas-vector-geometry')
    expect(transform.usesCssOverlaySource).toBe(false)
    expect(transform.usesPreviewCanvasSource).toBe(false)
  })

  it('uses the same export transform model for large, small, and full-page captures', () => {
    const large = buildBlueprintSnapshotExportTransform({
      sourcePageWidth: 2820,
      sourcePageHeight: 1454,
      cropRect: { x: 0.1, y: 0.2, w: 0.8, h: 0.7 },
      outputWidth: 2820,
      outputHeight: 1454,
      pdfRenderScale: 1.25,
    })
    const small = buildBlueprintSnapshotExportTransform({
      sourcePageWidth: 2820,
      sourcePageHeight: 1454,
      cropRect: { x: 0.4, y: 0.45, w: 0.1, h: 0.1 },
      outputWidth: 588,
      outputHeight: 303,
      pdfRenderScale: 2.083333,
    })
    const fullPage = buildBlueprintSnapshotExportTransform({
      sourcePageWidth: 2820,
      sourcePageHeight: 1454,
      cropRect: null,
      outputWidth: 4096,
      outputHeight: 2113,
      pdfRenderScale: 4096 / 2820,
    })

    expect(large.annotationBackingWidth).toBe(large.outputWidth)
    expect(small.annotationBackingHeight).toBe(small.outputHeight)
    expect(fullPage.selectedPdfWidth).toBe(2820)
    expect(fullPage.selectedPdfHeight).toBe(1454)
    expect(fullPage.annotationRenderScaleX).toBeCloseTo(fullPage.pdfRenderScale, 2)
    expect(small.annotationVisualScale).toBeLessThanOrEqual(4)
  })

  it('calculates Fit, 100%, zoom clamping, and zoom percentage for native preview inspection', () => {
    const fullPageFit = calculateBlueprintSnapshotFitScale({
      viewportWidth: 1000,
      viewportHeight: 600,
      imageWidth: 2820,
      imageHeight: 1454,
    })
    const smallFit = calculateBlueprintSnapshotFitScale({
      viewportWidth: 1000,
      viewportHeight: 600,
      imageWidth: 400,
      imageHeight: 240,
    })

    expect(fullPageFit).toBeCloseTo(1000 / 2820, 5)
    expect(smallFit).toBe(1)
    expect(clampBlueprintSnapshotZoom(0.1, fullPageFit)).toBe(fullPageFit)
    expect(clampBlueprintSnapshotZoom(9, fullPageFit)).toBe(4)
    expect(formatBlueprintSnapshotZoomPercent(1)).toBe('100%')
    expect(formatBlueprintSnapshotZoomPercent(2.25)).toBe('225%')
  })

  it('clamps pan and keeps wheel or pinch zoom centered near the pointer', () => {
    expect(clampBlueprintSnapshotPan({
      panX: 999,
      panY: -999,
      zoom: 1,
      viewportWidth: 500,
      viewportHeight: 400,
      imageWidth: 1000,
      imageHeight: 800,
    })).toEqual({ x: 250, y: -200 })

    const centered = zoomBlueprintSnapshotAtPoint({
      previousZoom: 0.5,
      nextZoom: 1,
      panX: 0,
      panY: 0,
      pointerX: 400,
      pointerY: 200,
      viewportWidth: 800,
      viewportHeight: 400,
      imageWidth: 1200,
      imageHeight: 800,
    })

    expect(centered.zoom).toBe(1)
    expect(centered.pan.x).toBe(0)
    expect(centered.pan.y).toBe(0)
  })

  it('builds narrow v1 full-page metadata without raw annotations', () => {
    const dimensions = calculateBlueprintSnapshotDimensions({ pageWidth: 960, pageHeight: 720 })
    const metadata = buildBlueprintSnapshotMetadata({
      pageNumber: 2,
      rotation: 90,
      dimensions,
      viewMode: 'scoped',
      scopedWorkPackageIds: ['wp-1', 'wp-2'],
      labelsVisible: true,
      circuitLabelsVisible: false,
      annotationCount: 3,
    })

    expect(metadata).toEqual({
      schemaVersion: 1,
      captureMode: 'full-page',
      pageNumber: 2,
      rotation: 90,
      targetDpi: 150,
      outputWidth: 2000,
      outputHeight: 1500,
      sourcePageWidth: 960,
      sourcePageHeight: 720,
      viewMode: 'scoped',
      scopedWorkPackageIds: ['wp-1', 'wp-2'],
      labelsVisible: true,
      symbolLabelsVisible: true,
      symbolLabelScale: 1,
      symbolLabelCustomColorsEnabled: false,
      symbolLabelTextColor: '#22d3ee',
      symbolLabelBorderColor: '#22d3ee',
      symbolLabelFillColor: '#0b1020',
      circuitLabelsVisible: false,
      annotationCount: 3,
    })
    expect(JSON.stringify(metadata)).not.toContain('annotations')
  })

  it('captures a full-page PDF-only PNG before any upload flow runs', async () => {
    const documentStub = installPdfOnlyCanvasDocumentStub()
    const page = createPageStub()

    const result = await captureBlueprintSnapshot({
      page,
      pageNumber: 25,
      rotation: 0,
      annotations: [],
      overlayElement: null,
      viewMode: 'general',
      scopedWorkPackageIds: [],
      labelsVisible: false,
      circuitLabelsVisible: false,
    } as any)

    expect(page.getViewport).toHaveBeenCalledWith({ scale: 1, rotation: 0 })
    expect(page.render).toHaveBeenCalledOnce()
    const canvas = documentStub.canvases[0]
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png')
    expect(result.blob.type).toBe('image/png')
    expect(result.pageNumber).toBe(25)
    expect(result.captureMetadata.annotationCount).toBe(0)
  })

  it('captures a clean selected area with area metadata and a cropped PDF composite', async () => {
    const documentStub = installPdfOnlyCanvasDocumentStub()
    const page = createPageStub()

    const result = await captureBlueprintSnapshot({
      page,
      pageNumber: 25,
      rotation: 0,
      annotations: [],
      overlayElement: null,
      cropRect: { x: 0.25, y: 0.2, w: 0.5, h: 0.4 },
      viewMode: 'scoped',
      scopedWorkPackageIds: ['wp-1'],
      labelsVisible: true,
      circuitLabelsVisible: true,
    } as any)

    expect(documentStub.canvases).toHaveLength(2)
    expect(documentStub.canvases[0].width).toBe(result.width)
    expect(documentStub.canvases[0].height).toBe(result.height)
    expect(documentStub.canvases[0].getContext().drawImage).toHaveBeenCalled()
    expect(result.captureMetadata.captureMode).toBe('area')
    expect(result.captureMetadata.cropRect).toEqual({ x: 0.25, y: 0.2, w: 0.5, h: 0.4 })
    expect(result.captureMetadata.scopedWorkPackageIds).toEqual(['wp-1'])
  })

  it('captures annotations through final-resolution export diagnostics instead of overlay CSS pixels', async () => {
    const documentStub = installPdfOnlyCanvasDocumentStub()
    const page = createPageStub()

    const result = await captureBlueprintSnapshot({
      page,
      pageNumber: 25,
      rotation: 0,
      annotations: [{
        id: 'symbol-1',
        type: 'shape',
        color: '#22d3ee',
        rect: { x: 0.3, y: 0.3, w: 0.05, h: 0.05 },
        meta: { shapeKind: 'can-light-4', borderThickness: 2, rotationDeg: 45 },
      }],
      overlayElement: { getBoundingClientRect: vi.fn(() => ({ width: 320, height: 160 })) },
      cropRect: { x: 0.25, y: 0.2, w: 0.5, h: 0.4 },
      viewMode: 'scoped',
      scopedWorkPackageIds: ['wp-1'],
      labelsVisible: true,
      circuitLabelsVisible: true,
    } as any)

    expect(result.qualityDiagnostics).toMatchObject({
      selectedPdfWidth: 306,
      selectedPdfHeight: 316.8,
      annotationBackingWidth: result.width,
      annotationBackingHeight: result.height,
      annotationPaintSource: 'final-canvas-vector-geometry',
      usesCssOverlaySource: false,
      usesPreviewCanvasSource: false,
    })
    expect(result.qualityDiagnostics?.annotationRenderScaleX).toBeCloseTo(result.width / 306, 5)
    expect(result.qualityDiagnostics?.annotationRenderScaleY).toBeCloseTo(result.height / 316.8, 5)
    expect(documentStub.canvases[0].getContext().scale).toHaveBeenCalled()
    expect(documentStub.canvases[0].getContext().rotate).toHaveBeenCalledWith(Math.PI / 4)
  })

  it('classifies PDF.js render failures at the capture stage', async () => {
    installPdfOnlyCanvasDocumentStub()

    await expect(captureBlueprintSnapshot({
      page: createPageStub({ renderRejects: true }),
      pageNumber: 25,
      rotation: 0,
      annotations: [],
      overlayElement: null,
      viewMode: 'general',
      scopedWorkPackageIds: [],
      labelsVisible: false,
      circuitLabelsVisible: false,
    } as any)).rejects.toMatchObject({
      name: 'BlueprintSnapshotCaptureError',
      stage: 'PDF_RENDER',
      code: 'PDF_RENDER_FAILED',
    })
  })

  it('classifies PNG encoding failures before preview', async () => {
    installPdfOnlyCanvasDocumentStub({ toBlobResult: null })

    await expect(captureBlueprintSnapshot({
      page: createPageStub(),
      pageNumber: 25,
      rotation: 0,
      annotations: [],
      overlayElement: null,
      viewMode: 'general',
      scopedWorkPackageIds: [],
      labelsVisible: false,
      circuitLabelsVisible: false,
    } as any)).rejects.toBeInstanceOf(BlueprintSnapshotCaptureError)
  })

  it('formats safe owner-visible stage and code without raw errors', () => {
    const message = formatBlueprintSnapshotCaptureFailureMessage(
      new BlueprintSnapshotCaptureError('SVG_IMAGE_DECODE', 'OVERLAY_IMAGE_DECODE_FAILED'),
    )

    expect(message).toBe('Snapshot capture failed before preview.\n[SVG_IMAGE_DECODE / OVERLAY_IMAGE_DECODE_FAILED].\nNo image was uploaded.')
    expect(message).not.toContain('Error:')
    expect(message).not.toContain('stack')
  })

  it('passes a valid standalone serialized SVG through structural validation', () => {
    const diagnostics = validateSerializedAnnotationSvg(validSerializedSvg, {
      expectedWidth: 100,
      expectedHeight: 50,
      visibleAnnotationCount: 1,
    })

    expect(diagnostics.capturedAnnotationCount).toBe(1)
    expect(diagnostics.serializedSvgLength).toBe(validSerializedSvg.length)
    expect(diagnostics.duplicateIdCount).toBe(0)
    expect(diagnostics.unresolvedReferenceCount).toBe(0)
    expect(diagnostics.externalResourceCount).toBe(0)
  })

  it('classifies malformed serialized SVG before image decode', () => {
    expectSvgValidationCode('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><g></svg>', 'SVG_XML_PARSE_FAILED')
  })

  it('rejects invalid root namespace and dimensions', () => {
    expectSvgValidationCode('<svg width="100" height="50" viewBox="0 0 100 50"></svg>', 'SVG_ROOT_INVALID')
    expectSvgValidationCode('<svg xmlns="http://www.w3.org/2000/svg" width="NaN" height="50" viewBox="0 0 100 50"></svg>', 'SVG_DIMENSIONS_INVALID')
    expectSvgValidationCode('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"></svg>', 'SVG_DIMENSIONS_INVALID')
  })

  it('rejects unsupported elements, HTML namespaces, and external resources', () => {
    expectSvgValidationCode('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><foreignObject /></svg>', 'SVG_UNSUPPORTED_ELEMENT')
    expectSvgValidationCode('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><g xmlns="http://www.w3.org/1999/xhtml"><div /></g></svg>', 'SVG_UNSUPPORTED_ELEMENT')
    expectSvgValidationCode('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><image href="https://example.com/a.png"/></svg>', 'SVG_EXTERNAL_RESOURCE')
    expectSvgValidationCode('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><rect fill="url(https://example.com/p.svg#x)"/></svg>', 'SVG_EXTERNAL_RESOURCE')
    expectSvgValidationCode('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><rect fill="var(--bad)"/></svg>', 'SVG_EXTERNAL_RESOURCE')
  })

  it('rejects unresolved internal references, duplicate ids, and malformed transforms', () => {
    expectSvgValidationCode('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><path marker-end="url(#missing)"/></svg>', 'SVG_UNRESOLVED_REFERENCE')
    expectSvgValidationCode('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><g id="dup"/><path id="dup"/></svg>', 'SVG_DUPLICATE_ID')
    expectSvgValidationCode('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><g transform="translate(bad 1)"/></svg>', 'SVG_TRANSFORM_INVALID')
  })

  it('uses stable scalar generation, page, and blueprint-set ids for preview freshness', () => {
    expect(isBlueprintSnapshotCaptureStillCurrent({
      requestGeneration: 7,
      currentRequestGeneration: 7,
      pageNumber: 26,
      currentPageNumber: 26,
      blueprintSetId: 'set-1',
      currentBlueprintSetId: 'set-1',
      viewerMounted: true,
    })).toBe(true)

    expect(isBlueprintSnapshotCaptureStillCurrent({
      requestGeneration: 7,
      currentRequestGeneration: 7,
      pageNumber: 26,
      currentPageNumber: 27,
      blueprintSetId: 'set-1',
      currentBlueprintSetId: 'set-1',
      viewerMounted: true,
    })).toBe(false)

    expect(isBlueprintSnapshotCaptureStillCurrent({
      requestGeneration: 7,
      currentRequestGeneration: 7,
      pageNumber: 26,
      currentPageNumber: 26,
      blueprintSetId: 'set-1',
      currentBlueprintSetId: 'set-2',
      viewerMounted: true,
    })).toBe(false)
  })

  it('validates PNG Blob preview inputs before opening the dialog', async () => {
    const capture = createCaptureResult()
    const diagnostics = await validateBlueprintSnapshotCaptureResult(capture, previewValidationContext)

    expect(diagnostics).toMatchObject({
      blobType: 'image/png',
      blobSize: validPngBytes.length,
      outputWidth: 1689,
      outputHeight: 1059,
      capturedAnnotationCount: 42,
      previewGeneration: 12,
      pngSignatureValid: true,
      createImageBitmapAvailable: false,
      bitmapDecodeSucceeded: false,
    })
  })

  it('rejects invalid preview captures before preview state or upload can proceed', async () => {
    await expect(validateBlueprintSnapshotCaptureResult(createCaptureResult({ blob: new Blob([], { type: 'image/png' }) }), previewValidationContext))
      .rejects.toMatchObject({ code: 'PNG_VALIDATION_FAILED' })
    await expect(validateBlueprintSnapshotCaptureResult(createCaptureResult({ blob: new Blob(['x'], { type: 'text/plain' }) }), previewValidationContext))
      .rejects.toMatchObject({ code: 'PNG_VALIDATION_FAILED' })
    await expect(validateBlueprintSnapshotCaptureResult(createCaptureResult({ width: 0 }), previewValidationContext))
      .rejects.toMatchObject({ code: 'PREVIEW_RESULT_FAILED' })
    await expect(validateBlueprintSnapshotCaptureResult(createCaptureResult({ pageNumber: 26 }), previewValidationContext))
      .rejects.toMatchObject({ code: 'STALE_CAPTURE' })
  })

  it('rejects an invalid PNG signature distinctly before preview', async () => {
    await expect(validateBlueprintSnapshotCaptureResult(createCaptureResult({
      blob: new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], { type: 'image/png' }),
    }), previewValidationContext)).rejects.toMatchObject({
      stage: 'PNG_VALIDATION',
      code: 'INVALID_PNG_SIGNATURE',
    })
  })

  it('records direct Blob decode diagnostics when createImageBitmap succeeds', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1689, height: 1059, close })))

    const diagnostics = await validateBlueprintSnapshotCaptureResult(createCaptureResult(), previewValidationContext)

    expect(createImageBitmap).toHaveBeenCalledOnce()
    expect(diagnostics).toMatchObject({
      pngSignatureValid: true,
      createImageBitmapAvailable: true,
      bitmapDecodeSucceeded: true,
      decodedWidth: 1689,
      decodedHeight: 1059,
    })
    expect(close).toHaveBeenCalledOnce()
  })

  it('classifies bitmap decode failure after a valid PNG signature', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      throw new Error('decode failed')
    }))

    await expect(validateBlueprintSnapshotCaptureResult(createCaptureResult(), previewValidationContext))
      .rejects.toMatchObject({
        stage: 'PNG_VALIDATION',
        code: 'PNG_BITMAP_DECODE_FAILED',
      })
  })

  it('creates one stable canvas preview state for a valid PNG Blob', async () => {
    const capture = createCaptureResult()

    const preview = await createBlueprintSnapshotPreviewState(capture, previewValidationContext)

    expect(preview.capture).toBe(capture)
    expect(preview.previewCanvas).toBe(capture.previewCanvas)
    expect(preview.blobType).toBe('image/png')
    expect(preview.blobSize).toBe(validPngBytes.length)
    expect(preview.pngSignatureValid).toBe(true)
  })

  it('does not release or replace the preview canvas for initial render, caption changes, save start, save failure, or retry', async () => {
    const capture = createCaptureResult()
    const preview = await createBlueprintSnapshotPreviewState(capture, previewValidationContext)
    const dialogPreviewCanvas = preview.previewCanvas

    const captionEditUsesSamePreview = preview
    const saveStartUsesSamePreview = captionEditUsesSamePreview
    const saveFailureUsesSamePreview = saveStartUsesSamePreview
    const retryUsesSamePreview = saveFailureUsesSamePreview

    expect(retryUsesSamePreview.previewCanvas).toBe(dialogPreviewCanvas)
    expect(retryUsesSamePreview.capture.blob).toBe(capture.blob)
    expect(dialogPreviewCanvas.width).toBe(1689)
    expect(dialogPreviewCanvas.height).toBe(1059)
  })

  it('releases the preview canvas exactly once for retake, cancel, successful save, and unmount cleanup paths', async () => {
    for (const [index, reason] of (['retake', 'cancel', 'saved', 'unmount'] as const).entries()) {
      const preview = await createBlueprintSnapshotPreviewState(createCaptureResult({
        blob: new Blob([validPngBytes, new Uint8Array([index])], { type: 'image/png' }),
      }), {
        ...previewValidationContext,
        generation: 20 + index,
        currentGeneration: 20 + index,
      })

      expect(revokeBlueprintSnapshotPreviewState(preview, reason)).toBe(true)
      expect(preview.previewCanvas.width).toBe(0)
      expect(preview.previewCanvas.height).toBe(0)
      expect(revokeBlueprintSnapshotPreviewState(preview, reason)).toBe(false)
    }
  })

  it('releases the old preview canvas, not the new one, when replacing captures', async () => {
    const oldPreview = await createBlueprintSnapshotPreviewState(createCaptureResult(), previewValidationContext)
    const newPreview = await createBlueprintSnapshotPreviewState(createCaptureResult({
      blob: new Blob([validPngBytes, new Uint8Array([9])], { type: 'image/png' }),
    }), {
      ...previewValidationContext,
      generation: 13,
      currentGeneration: 13,
    })

    revokeBlueprintSnapshotPreviewState(oldPreview, 'replace')

    expect(oldPreview.previewCanvas.width).toBe(0)
    expect(oldPreview.previewCanvas.height).toBe(0)
    expect(newPreview.previewCanvas.width).toBe(1689)
    expect(newPreview.previewCanvas.height).toBe(1059)
  })

  it('keeps Strict Mode-style effect cleanup from owning the active preview resource', () => {
    const viewerSource = fs.readFileSync(viewerSourcePath, 'utf8')
    const dialogSource = fs.readFileSync(dialogSourcePath, 'utf8')

    expect(dialogSource).not.toContain('URL.createObjectURL')
    expect(dialogSource).not.toContain('URL.revokeObjectURL')
    expect(dialogSource).not.toContain('<img')
    expect(viewerSource).toContain('createBlueprintSnapshotPreviewState(result')
    expect(viewerSource).toContain("revokeBlueprintSnapshotPreviewState(snapshotPreviewRef.current, 'unmount')")
    expect(viewerSource).toContain("revokeBlueprintSnapshotPreviewState(previous, 'replace')")
  })

  it('uses canvas preview rendering and does not rerun capture or upload on preview render failure', () => {
    const viewerSource = fs.readFileSync(viewerSourcePath, 'utf8')
    const dialogSource = fs.readFileSync(dialogSourcePath, 'utf8')
    const viewportSource = fs.readFileSync(viewportSourcePath, 'utf8')
    const canvasEffectSource = dialogSource.slice(
      dialogSource.indexOf('const handlePreviewReady'),
      dialogSource.indexOf('const safeCaption'),
    )

    expect(dialogSource).toContain('Snapshot was captured, but the preview could not be rendered.')
    expect(dialogSource).toContain('BlueprintSnapshotPreviewViewport')
    expect(viewportSource).toContain('role="img"')
    expect(dialogSource).toContain('accessibleLabel={`Blueprint snapshot preview for page ${capture.pageNumber}`}')
    expect(dialogSource).toContain('max-w-6xl')
    expect(viewportSource).toContain('mount.replaceChildren(sourceCanvas)')
    expect(viewportSource).toContain("sourceCanvas.style.width = `${imageWidth}px`")
    expect(viewportSource).toContain('scale(${zoom})')
    expect(viewportSource).toContain('onWheel={handleWheel}')
    expect(viewportSource).toContain('onPointerDown={handlePointerDown}')
    expect(viewportSource).toContain('touchAction: \'none\'')
    expect(viewportSource).toContain('onDoubleClick={handleDoubleClick}')
    expect(viewportSource).not.toContain('toBlob')
    expect(viewportSource).not.toContain('drawImage')
    expect(dialogSource).toContain("canvasStatus === 'preparing'")
    expect(dialogSource).toContain("setCanvasStatus('ready')")
    expect(canvasEffectSource).not.toContain('saveBlueprintSnapshot')
    expect(canvasEffectSource).not.toContain('captureBlueprintSnapshot')
    expect(viewerSource).toContain('preview={snapshotPreview}')
  })

  it('audits CSP as blocking blob image sources and avoids changing global CSP for canvas preview', () => {
    const csp = fs.readFileSync(path.resolve(process.cwd(), 'netlify.toml'), 'utf8')
    const imgSrc = csp.match(/img-src ([^;"]+)/)?.[1] || ''
    const dialogSource = fs.readFileSync(dialogSourcePath, 'utf8')
    const viewportSource = fs.readFileSync(viewportSourcePath, 'utf8')

    expect(imgSrc).not.toContain('blob:')
    expect(csp).toContain('media-src')
    expect(csp).toContain('blob:')
    expect(viewportSource).toContain('sourceCanvas')
    expect(dialogSource).not.toContain('<img')
  })

  it('declares every required capture pipeline stage as a stable diagnostic stage', () => {
    const source = fs.readFileSync(captureSourcePath, 'utf8')
    ;[
      'CONTEXT_VALIDATION',
      'PDF_DOCUMENT_RESOLUTION',
      'PDF_PAGE_RESOLUTION',
      'EXPORT_DIMENSION_CALCULATION',
      'CANVAS_ALLOCATION',
      'PDF_RENDER',
      'OVERLAY_ROOT_RESOLUTION',
      'ANNOTATION_NODE_COLLECTION',
      'ANNOTATION_PAINT_EXTRACTION',
      'SVG_CONSTRUCTION',
      'SVG_VALIDATION',
      'SVG_SERIALIZATION',
      'SVG_IMAGE_DECODE',
      'ANNOTATION_COMPOSITE',
      'PNG_ENCODING',
      'PNG_VALIDATION',
      'PREVIEW_RESULT_CREATION',
      'PREVIEW_STATE_COMMIT',
    ].forEach((stage) => expect(source).toContain(`'${stage}'`))
  })

  it('keeps production capture on the clean PDF plus annotation-data renderer path', () => {
    const source = fs.readFileSync(captureSourcePath, 'utf8')
    const captureFunction = source.slice(
      source.indexOf('export async function captureBlueprintSnapshot'),
      source.indexOf('function createSnapshotCanvas'),
    )

    expect(captureFunction).toContain('drawBlueprintAnnotationsToCanvas')
    expect(captureFunction).toContain('cropRect')
    expect(captureFunction).toContain("captureMode = cropRect ? 'area' : 'full-page'")
    expect(captureFunction).not.toContain('drawSanitizedAnnotationOverlay')
    expect(captureFunction).not.toContain('buildSanitizedAnnotationSvg')
    expect(captureFunction).not.toContain('createObjectURL')
    expect(captureFunction).not.toContain('new Image')
  })

  it('keeps export annotations on final canvas geometry with scaled symbols, paths, measurements, and labels', () => {
    const source = fs.readFileSync(captureSourcePath, 'utf8')
    const annotationRenderer = source.slice(
      source.indexOf('function drawBlueprintAnnotationsToCanvas'),
      source.indexOf('function drawShapeAnnotation'),
    )
    const shapeRenderer = source.slice(
      source.indexOf('function drawShapeAnnotation'),
      source.indexOf('function drawMeasureAnnotation'),
    )
    const helpers = source.slice(
      source.indexOf('function drawSnapshotPolyline'),
      source.indexOf('function electricalLabelForKind'),
    )

    expect(source).toContain('buildBlueprintSnapshotExportTransform')
    expect(annotationRenderer).toContain('exportTransform.annotationVisualScale')
    expect(annotationRenderer).not.toContain('getBoundingClientRect')
    expect(annotationRenderer).not.toContain('overlayElement')
    expect(shapeRenderer).toContain("kind === 'circuit-path'")
    expect(shapeRenderer).toContain("kind === 'circuit-arc'")
    expect(shapeRenderer).toContain('isSnapshotElectricalSymbolKind(kind)')
    expect(source).toContain('isElectricalShapeKind(kind)')
    expect(source).toContain('getElectricalSymbolMetadata(kind)')
    expect(source).toContain('drawUnknownElectricalSymbolFallback')
    expect(source).toContain('UNKNOWN ${electricalLabelForKind(kind)}')
    expect(source).toContain('renderSnapshotElectricalGlyph')
    expect(source).toContain("ctx.rotate((Number(meta.rotationDeg) || 0) * Math.PI / 180)")
    expect(source).toContain("text('EXIT', 50, 48, 20)")
    expect(source).toContain('resolveBlueprintSnapshotCanvasLabelStyle')
    expect(source).toContain('drawElectricalSymbolLabel')
    expect(source).toContain('resolveBlueprintSnapshotSymbolLabelBox')
    expect(source).toContain('drawRoundedRectPath')
    expect(helpers).toContain('scaleExportLength')
    expect(helpers).toContain('scaleDashPattern')
    expect(helpers).toContain('ctx.fillText(text')
    expect(helpers).not.toContain("ctx.font = '12px monospace'")
  })

  it('matches live viewer constants for exported symbol labels without export-scale inflation', () => {
    const style = resolveBlueprintSnapshotCanvasLabelStyle({
      kind: 'symbol',
      textColor: '#22d3ee',
      borderColor: '#22d3ee',
      labelScale: 1,
    })
    const fullPageScaleStyle = resolveBlueprintSnapshotCanvasLabelStyle({
      kind: 'symbol',
      textColor: '#22d3ee',
      borderColor: '#22d3ee',
      labelScale: undefined,
    })
    const box = resolveBlueprintSnapshotSymbolLabelBox({
      textWidth: 28,
      labelScale: 1,
      symbolUnit: 1,
    })

    expect(resolveBlueprintSnapshotSymbolLabelScale(undefined)).toBe(1)
    expect(resolveBlueprintSnapshotSymbolLabelScale(0.75)).toBe(0.75)
    expect(resolveBlueprintSnapshotSymbolLabelScale(3.15)).toBe(3.15)
    expect(resolveBlueprintSnapshotSymbolLabelScale(5)).toBe(5)
    expect(resolveBlueprintSnapshotSymbolLabelScale(0.1)).toBe(0.5)
    expect(resolveBlueprintSnapshotSymbolLabelScale(6)).toBe(5)
    expect(style).toMatchObject({
      fontFamily: 'monospace',
      fontSize: 9.5,
      fontWeight: 800,
      backgroundColor: '#0b1020',
      backgroundOpacity: 0.82,
      borderWidth: 1.2,
      borderRadius: 4,
      minWidth: 22,
      height: 16,
      paddingX: 4,
    })
    expect(fullPageScaleStyle.fontSize).toBe(9.5)
    expect(box).toMatchObject({
      width: 36,
      height: 16,
      x: 60,
      y: 78,
      radius: 4,
    })
  })

  it('applies the live symbol label percentage exactly once and keeps 75%, 315%, and 500% supported', () => {
    const label75 = resolveBlueprintSnapshotCanvasLabelStyle({ kind: 'symbol', textColor: '#22d3ee', labelScale: 0.75 })
    const label100 = resolveBlueprintSnapshotCanvasLabelStyle({ kind: 'symbol', textColor: '#22d3ee', labelScale: 1 })
    const label315 = resolveBlueprintSnapshotCanvasLabelStyle({ kind: 'symbol', textColor: '#22d3ee', labelScale: 3.15 })
    const label500 = resolveBlueprintSnapshotCanvasLabelStyle({ kind: 'symbol', textColor: '#22d3ee', labelScale: 5 })

    expect(label75.fontSize).toBeCloseTo(9.5 * 0.75, 5)
    expect(label75.fontSize).toBeLessThan(label100.fontSize)
    expect(label315.fontSize).toBeCloseTo(9.5 * 3.15, 5)
    expect(label315.fontSize).toBeGreaterThan(label100.fontSize)
    expect(label500.fontSize).toBeCloseTo(9.5 * 5, 5)
    expect(label315.height).toBeCloseTo(16 * 3.15, 5)
  })

  it('uses restrained live-style canvas label families for exported route and measurement labels', () => {
    expect(resolveBlueprintSnapshotCanvasLabelStyle({
      kind: 'circuit',
      textColor: '#facc15',
    })).toMatchObject({
      fontSize: 10,
      fontWeight: 400,
      backgroundColor: '#0a0d16',
      backgroundOpacity: 0.9,
      borderWidth: 0,
      height: 16,
    })

    expect(resolveBlueprintSnapshotCanvasLabelStyle({
      kind: 'measurement',
      textColor: '#38bdf8',
    })).toMatchObject({
      fontSize: 11,
      backgroundColor: '#0a0d16',
      backgroundOpacity: 0.88,
      borderWidth: 0,
      height: 16,
    })

    expect(resolveBlueprintSnapshotCanvasLabelStyle({
      kind: 'unknown-electrical',
      textColor: '#f97316',
    })).toMatchObject({
      fontSize: 9,
      fontWeight: 700,
      backgroundColor: '#ffffff',
      backgroundOpacity: 0.76,
      borderWidth: 0.8,
      height: 14,
    })
  })

  it('passes the live electrical label settings into snapshot capture and keeps circuit labels independent', () => {
    const viewerSource = fs.readFileSync(viewerSourcePath, 'utf8')
    const captureHandler = viewerSource.slice(
      viewerSource.indexOf('const handleCaptureSnapshot'),
      viewerSource.indexOf('const beginSnapshotAreaSelection'),
    )

    expect(captureHandler).toContain('symbolLabelSettings: {')
    expect(captureHandler).toContain('symbolLabelsVisible: Boolean(electricalSymbolLabelsVisible)')
    expect(captureHandler).toContain('symbolLabelScale')
    expect(captureHandler).toContain('customLabelColorsEnabled: Boolean(symbolLabelCustomColorsEnabled)')
    expect(captureHandler).toContain('textColor: symbolLabelTextColor')
    expect(captureHandler).toContain('borderColor: symbolLabelBorderColor')
    expect(captureHandler).toContain('fillColor: symbolLabelFillColor')
    expect(captureHandler).toContain('circuitLabelsVisible: Boolean(showCircuitMeasurementLabels)')
    expect(captureHandler).not.toContain('circuitLabelsVisible: Boolean(electricalSymbolLabelsVisible')
  })

  it('freezes live electrical label settings into area and full-page capture metadata', async () => {
    installPdfOnlyCanvasDocumentStub()
    const page = createPageStub()
    const annotations = [{
      id: 'symbol-1',
      type: 'shape',
      color: '#22d3ee',
      rect: { x: 0.3, y: 0.3, w: 0.05, h: 0.05 },
      meta: { shapeKind: 'electrical-switch-3way', borderThickness: 2 },
    }]
    const symbolLabelSettings = {
      symbolLabelsVisible: true,
      symbolLabelScale: 3.15,
      customLabelColorsEnabled: true,
      resolvedLabelColors: {
        textColor: '#111111',
        borderColor: '#222222',
        fillColor: '#eeeeee',
      },
    }

    const area = await captureBlueprintSnapshot({
      page,
      pageNumber: 25,
      rotation: 0,
      annotations,
      overlayElement: { getBoundingClientRect: vi.fn(() => ({ width: 320, height: 160 })) },
      cropRect: { x: 0.25, y: 0.2, w: 0.5, h: 0.4 },
      viewMode: 'scoped',
      scopedWorkPackageIds: ['wp-1'],
      labelsVisible: true,
      symbolLabelSettings,
      circuitLabelsVisible: false,
    } as any)
    const fullPage = await captureBlueprintSnapshot({
      page,
      pageNumber: 25,
      rotation: 0,
      annotations,
      overlayElement: { getBoundingClientRect: vi.fn(() => ({ width: 320, height: 160 })) },
      cropRect: null,
      viewMode: 'scoped',
      scopedWorkPackageIds: ['wp-1'],
      labelsVisible: true,
      symbolLabelSettings,
      circuitLabelsVisible: true,
    } as any)

    expect(area.captureMetadata).toMatchObject({
      captureMode: 'area',
      symbolLabelsVisible: true,
      symbolLabelScale: 3.15,
      symbolLabelCustomColorsEnabled: true,
      symbolLabelTextColor: '#111111',
      symbolLabelBorderColor: '#222222',
      symbolLabelFillColor: '#eeeeee',
      circuitLabelsVisible: false,
    })
    expect(fullPage.captureMetadata).toMatchObject({
      captureMode: 'full-page',
      symbolLabelsVisible: true,
      symbolLabelScale: 3.15,
      symbolLabelCustomColorsEnabled: true,
      symbolLabelTextColor: '#111111',
      symbolLabelBorderColor: '#222222',
      symbolLabelFillColor: '#eeeeee',
      circuitLabelsVisible: true,
    })
  })

  it('does not mutate an open preview when label settings change; retake captures the new settings', async () => {
    installPdfOnlyCanvasDocumentStub({ toBlobResult: new Blob([validPngBytes], { type: 'image/png' }) })
    const page = createPageStub()
    const baseContext = {
      page,
      pageNumber: 25,
      rotation: 0,
      annotations: [],
      overlayElement: null,
      viewMode: 'general',
      scopedWorkPackageIds: [],
      labelsVisible: true,
      circuitLabelsVisible: false,
    }

    const first = await captureBlueprintSnapshot({
      ...baseContext,
      symbolLabelSettings: {
        symbolLabelsVisible: true,
        symbolLabelScale: 0.75,
        customLabelColorsEnabled: false,
        resolvedLabelColors: { textColor: '#22d3ee', borderColor: '#22d3ee', fillColor: '#0b1020' },
      },
    } as any)
    const preview = await createBlueprintSnapshotPreviewState(first, previewValidationContext)
    const frozenCanvas = preview.previewCanvas
    const firstMetadata = first.captureMetadata

    const retake = await captureBlueprintSnapshot({
      ...baseContext,
      symbolLabelSettings: {
        symbolLabelsVisible: false,
        symbolLabelScale: 5,
        customLabelColorsEnabled: true,
        resolvedLabelColors: { textColor: '#ffffff', borderColor: '#ff00ff', fillColor: '#101010' },
      },
    } as any)

    expect(preview.capture.captureMetadata).toBe(firstMetadata)
    expect(preview.previewCanvas).toBe(frozenCanvas)
    expect(preview.capture.captureMetadata).toMatchObject({
      symbolLabelsVisible: true,
      symbolLabelScale: 0.75,
      symbolLabelCustomColorsEnabled: false,
    })
    expect(retake.captureMetadata).toMatchObject({
      symbolLabelsVisible: false,
      symbolLabelScale: 5,
      symbolLabelCustomColorsEnabled: true,
      symbolLabelTextColor: '#ffffff',
      symbolLabelBorderColor: '#ff00ff',
      symbolLabelFillColor: '#101010',
    })
  })

  it('omits symbol label text, backgrounds, and borders when Hide Labels is active', async () => {
    const documentStub = installPdfOnlyCanvasDocumentStub()
    const page = createPageStub()

    await captureBlueprintSnapshot({
      page,
      pageNumber: 25,
      rotation: 0,
      annotations: [{
        id: 'symbol-hidden-label',
        type: 'shape',
        color: '#22d3ee',
        rect: { x: 0.3, y: 0.3, w: 0.05, h: 0.05 },
        meta: { shapeKind: 'electrical-switch-3way', borderThickness: 2 },
      }],
      overlayElement: { getBoundingClientRect: vi.fn(() => ({ width: 320, height: 160 })) },
      viewMode: 'general',
      scopedWorkPackageIds: [],
      labelsVisible: true,
      symbolLabelSettings: {
        symbolLabelsVisible: false,
        symbolLabelScale: 3.15,
        customLabelColorsEnabled: true,
        resolvedLabelColors: { textColor: '#ffffff', borderColor: '#ff00ff', fillColor: '#101010' },
      },
      circuitLabelsVisible: false,
    } as any)

    const ctx = documentStub.canvases[0].getContext()
    expect(ctx.measureText).not.toHaveBeenCalledWith('S3')
    expect(ctx.fillText).not.toHaveBeenCalledWith('S3', expect.any(Number), expect.any(Number))
    expect(ctx.fillStyle).not.toBe('#101010')
    expect(ctx.strokeStyle).not.toBe('#ff00ff')
  })

  it('keeps symbol geometry and preview zoom independent from symbol label size', () => {
    const source = fs.readFileSync(captureSourcePath, 'utf8')
    const symbolRenderer = source.slice(
      source.indexOf('function drawElectricalSymbol'),
      source.indexOf('function renderSnapshotElectricalGlyph'),
    )
    const viewportSource = fs.readFileSync(viewportSourcePath, 'utf8')

    expect(symbolRenderer).toContain('const size = Math.max(scaleExportLength(8, style.visualScale), Math.min(Math.abs(rect.w), Math.abs(rect.h)))')
    expect(symbolRenderer).not.toContain('style.symbolLabelSettings.symbolLabelScale)')
    expect(symbolRenderer).toContain('drawElectricalSymbolLabel')
    expect(viewportSource).toContain('scale(${zoom})')
    expect(viewportSource).not.toContain('symbolLabelScale')
    expect(viewportSource).not.toContain('drawElectricalSymbolLabel')
  })

  it('does not add snapshot-specific label persistence keys', () => {
    const source = fs.readFileSync(captureSourcePath, 'utf8')
    const labelSource = fs.readFileSync(path.resolve(process.cwd(), 'src/features/blueprint-snapshots/blueprintSnapshotLabelStyle.ts'), 'utf8')
    const viewerSource = fs.readFileSync(viewerSourcePath, 'utf8')

    expect(`${source}\n${labelSource}`).not.toContain('localStorage')
    expect(viewerSource).not.toContain('snapshotSymbolLabel')
    expect(viewerSource).not.toContain('blueprintSnapshotLabel')
  })

  it('removes the retired standalone SVG image decode implementation', () => {
    const source = fs.readFileSync(captureSourcePath, 'utf8')

    expect(source).not.toContain('drawSanitizedAnnotationOverlay')
    expect(source).not.toContain("new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' })")
    expect(source).not.toContain('URL.createObjectURL(svgBlob)')
    expect(source).not.toContain('new Image()')
  })

  it('keeps upload services out of the capture click path until preview save', () => {
    const viewerSource = fs.readFileSync(viewerSourcePath, 'utf8')
    const captureHandler = viewerSource.slice(
      viewerSource.indexOf('const handleCaptureSnapshot'),
      viewerSource.indexOf('const animationRouteAnnotations'),
    )
    const dialogSource = fs.readFileSync(dialogSourcePath, 'utf8')

    expect(captureHandler).toContain('setSnapshotPreview((previous)')
    expect(captureHandler).toContain('createBlueprintSnapshotPreviewState(result')
    expect(captureHandler).toContain('setIsSnapshotPreviewOpen(true)')
    expect(captureHandler).not.toContain('saveBlueprintSnapshot')
    expect(captureHandler).not.toContain('upload')
    expect(dialogSource.indexOf('const handleSave')).toBeLessThan(dialogSource.indexOf('saveBlueprintSnapshot({'))
  })

  it('keeps Capture Area primary while preserving Full Page as a clean capture option', () => {
    const viewerSource = fs.readFileSync(viewerSourcePath, 'utf8')

    expect(viewerSource).toContain('aria-label="Capture Area"')
    expect(viewerSource).toContain('aria-label="Capture Full Page"')
    expect(viewerSource).toContain('onClick={beginSnapshotAreaSelection}')
    expect(viewerSource).toContain('onClick={() => void handleCaptureSnapshot(null)}')
    expect(viewerSource).toContain('cropRect: cropRect || null')
    expect(viewerSource).toContain('handleSnapshotAreaPointerDown')
    expect(viewerSource).toContain('handleSnapshotAreaPointerUp')
  })

  it('shows a Work Package picker in capture preview and saves the selected tag atomically', () => {
    const dialogSource = fs.readFileSync(dialogSourcePath, 'utf8')
    const viewerSource = fs.readFileSync(viewerSourcePath, 'utf8')
    const saveBlock = dialogSource.slice(dialogSource.indexOf('const handleSave'), dialogSource.indexOf('} catch (error)', dialogSource.indexOf('const handleSave')))

    expect(dialogSource).toContain('htmlFor="blueprint-snapshot-work-package"')
    expect(dialogSource).toContain('<option value="">Untagged</option>')
    expect(dialogSource).toContain('workPackageOptions.map')
    expect(dialogSource).toContain('setSelectedWorkPackageId(workPackageTag.workPackageId || \'\')')
    expect(saveBlock).toContain('workPackageTag: selectedWorkPackageTag')
    expect(saveBlock).not.toContain('updateBlueprintSnapshotWorkPackage')
    expect(viewerSource).toContain('workPackageOptions={snapshotWorkPackageOptions}')
  })

  it('preserves caption and selected Work Package across Retake while reset remains tied to cancel or save', () => {
    const dialogSource = fs.readFileSync(dialogSourcePath, 'utf8')
    const retakeButton = dialogSource.slice(dialogSource.indexOf('onClick={onRetake}'), dialogSource.indexOf('onClick={resetDraftAndCancel}'))

    expect(dialogSource).toContain('draftInitializedRef')
    expect(dialogSource).toContain('setCaption(\'\')')
    expect(dialogSource).toContain('setSelectedWorkPackageId(\'\')')
    expect(retakeButton).not.toContain('setCaption')
    expect(retakeButton).not.toContain('setSelectedWorkPackageId')
    expect(dialogSource).toContain('draftInitializedRef.current = false')
  })

  it('keeps Package Pick and Scoped View from participating in stale-capture checks', () => {
    const viewerSource = fs.readFileSync(viewerSourcePath, 'utf8')
    const captureHandler = viewerSource.slice(
      viewerSource.indexOf('const handleCaptureSnapshot'),
      viewerSource.indexOf('const animationRouteAnnotations'),
    )

    expect(captureHandler).toContain('isBlueprintSnapshotCaptureStillCurrent')
    expect(captureHandler).toContain('blueprintSetId: captureBlueprintId')
    expect(captureHandler).not.toContain('isPackagePickMode')
    expect(captureHandler).not.toContain('isolatedScopeLayers')
    expect(captureHandler).not.toContain('captureProjectId')
  })
})
