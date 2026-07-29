import type { BlueprintAnnotation, BlueprintLibraryItem, BlueprintScopeLayer } from '@/services/blueprintLibraryService'

export const BLUEPRINT_SNAPSHOT_BUCKET = 'blueprint-snapshots'
export const BLUEPRINT_SNAPSHOT_MAX_EDGE = 4096
export const BLUEPRINT_SNAPSHOT_TARGET_DPI = 150
export const BLUEPRINT_SNAPSHOT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

export type BlueprintSnapshotViewMode = 'general' | 'scoped'
export type BlueprintSnapshotCaptureMode = 'area' | 'full-page'

export interface BlueprintSnapshotCropRect {
  x: number
  y: number
  w: number
  h: number
}

export interface BlueprintSnapshotDimensions {
  width: number
  height: number
  scale: number
  sourcePageWidth: number
  sourcePageHeight: number
  targetDpi: number
}

export interface BlueprintSnapshotCaptureMetadata {
  schemaVersion: 1
  captureMode: BlueprintSnapshotCaptureMode
  pageNumber: number
  rotation: number
  targetDpi: number
  outputWidth: number
  outputHeight: number
  sourcePageWidth: number
  sourcePageHeight: number
  viewMode: BlueprintSnapshotViewMode
  scopedWorkPackageIds: string[]
  labelsVisible: boolean
  symbolLabelsVisible?: boolean
  symbolLabelScale?: number
  symbolLabelCustomColorsEnabled?: boolean
  symbolLabelTextColor?: string
  symbolLabelBorderColor?: string
  symbolLabelFillColor?: string
  circuitLabelsVisible: boolean
  annotationCount: number
  cropRect?: BlueprintSnapshotCropRect
}

export interface BlueprintSnapshotExportQualityDiagnostics {
  sourcePageWidth: number
  sourcePageHeight: number
  selectedPdfWidth: number
  selectedPdfHeight: number
  outputWidth: number
  outputHeight: number
  pdfRenderScale: number
  exportScaleX: number
  exportScaleY: number
  annotationRenderScaleX: number
  annotationRenderScaleY: number
  annotationVisualScale: number
  annotationBackingWidth: number
  annotationBackingHeight: number
  annotationPaintSource: 'final-canvas-vector-geometry'
  usesCssOverlaySource: false
  usesPreviewCanvasSource: false
}

export interface BlueprintSnapshotCaptureResult {
  blob: Blob
  previewCanvas: HTMLCanvasElement
  width: number
  height: number
  pageNumber: number
  rotation: number
  annotationCount: number
  captureMetadata: BlueprintSnapshotCaptureMetadata
  qualityDiagnostics?: BlueprintSnapshotExportQualityDiagnostics
}

export interface BlueprintSnapshotPreviewState {
  capture: BlueprintSnapshotCaptureResult
  previewCanvas: HTMLCanvasElement
  generation: number
  blobType: string
  blobSize: number
  pngSignatureValid: boolean
  createImageBitmapAvailable: boolean
  bitmapDecodeSucceeded: boolean | null
  decodedWidth: number | null
  decodedHeight: number | null
}

export interface BlueprintSnapshotWorkPackageTag {
  workPackageId: string | null
  workPackageName: string | null
}

export interface BlueprintSnapshotSaveInput {
  blob: Blob
  width: number
  height: number
  pageNumber: number
  caption: string | null
  orgId: string
  projectId: string
  projectName: string
  blueprintSetId: string
  capturedBy: string
  captureMetadata: BlueprintSnapshotCaptureMetadata
  workPackageTag: BlueprintSnapshotWorkPackageTag
}

export interface BlueprintSnapshotSavedResult {
  id: string
  storagePath: string
  width: number
  height: number
  fileSizeBytes: number
  pageNumber: number
  caption: string | null
  workPackageId: string | null
  workPackageName: string | null
}

export interface BlueprintSnapshotCaptureContext {
  page: {
    getViewport: (params: { scale: number; rotation?: number }) => { width: number; height: number }
    render: (params: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<unknown>; cancel?: () => void }
  }
  pageNumber: number
  rotation: number
  annotations: BlueprintAnnotation[]
  overlayElement: HTMLElement | null
  cropRect?: BlueprintSnapshotCropRect | null
  viewMode: BlueprintSnapshotViewMode
  scopedWorkPackageIds: string[]
  labelsVisible: boolean
  symbolLabelSettings?: {
    symbolLabelsVisible: boolean
    symbolLabelScale: number
    customLabelColorsEnabled: boolean
    resolvedLabelColors: {
      textColor: string
      borderColor: string
      fillColor: string
    }
  }
  circuitLabelsVisible: boolean
}

export interface BlueprintSnapshotViewerState {
  blueprint: BlueprintLibraryItem
  visibleAnnotations: BlueprintAnnotation[]
  scopedWorkPackages: BlueprintScopeLayer[]
  viewMode: BlueprintSnapshotViewMode
}
