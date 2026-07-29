import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BLUEPRINT_SNAPSHOT_MAX_EDGE,
  calculateBlueprintSnapshotDimensions,
  buildBlueprintSnapshotMetadata,
  captureBlueprintSnapshot,
  BlueprintSnapshotCaptureError,
} from '@/features/blueprint-snapshots'
import fs from 'node:fs'
import path from 'node:path'

const captureSourcePath = path.resolve(process.cwd(), 'src/features/blueprint-snapshots/blueprintSnapshotCapture.ts')

function installPdfOnlyCanvasDocumentStub(input?: { toBlobResult?: Blob | null }) {
  const canvasContext = { drawImage: vi.fn() }
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => canvasContext),
    toBlob: vi.fn((callback: (blob: Blob | null) => void, type: string) => {
      callback(input?.toBlobResult === undefined ? new Blob(['png'], { type }) : input.toBlobResult)
    }),
  }
  vi.stubGlobal('document', {
    createElement: vi.fn((tagName: string) => {
      if (tagName !== 'canvas') throw new Error(`Unexpected element: ${tagName}`)
      return canvas
    }),
  })
  return { canvas, canvasContext }
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
      circuitLabelsVisible: false,
      annotationCount: 3,
    })
    expect(JSON.stringify(metadata)).not.toContain('annotations')
  })

  it('captures a full-page PDF-only PNG before any upload flow runs', async () => {
    const { canvas } = installPdfOnlyCanvasDocumentStub()
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
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png')
    expect(result.blob.type).toBe('image/png')
    expect(result.pageNumber).toBe(25)
    expect(result.captureMetadata.annotationCount).toBe(0)
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
      stage: 'PDF_RENDER_FAILED',
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

  it('keeps annotation compositing on sanitized SVG nodes instead of foreignObject HTML snapshots', () => {
    const source = fs.readFileSync(captureSourcePath, 'utf8')

    expect(source).toContain('buildSanitizedAnnotationSvg')
    expect(source).toContain('createElementNS(SVG_NS,')
    expect(source).toContain('viewBox')
    expect(source).toContain('querySelector(`[data-annotation-id="${cssEscape(annotationId)}"]`)')
    expect(source).toContain("root.querySelectorAll('[title],title,desc,script,foreignObject')")
    expect(source).not.toContain("createElementNS(SVG_NS, 'foreignObject')")
    expect(source).not.toContain('<foreignObject')
  })
})
