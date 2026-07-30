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

export interface BlueprintSnapshotSavedResult extends BlueprintSnapshotLibraryItem {
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

export interface BlueprintSnapshotLibraryItem {
  id: string
  projectId: string
  projectName: string
  blueprintSetId: string
  blueprintTitle: string | null
  workPackageId: string | null
  workPackageName: string | null
  pageNumber: number | null
  caption: string | null
  captureMode: BlueprintSnapshotCaptureMode | null
  width: number | null
  height: number | null
  fileSizeBytes: number | null
  annotationCount: number | null
  attachedToIssuedWorkOrder: boolean
  capturedAt: string | null
  createdAt: string | null
}

export interface BlueprintSnapshotListFilters {
  projectId?: string | null
  blueprintSetId?: string | null
  pageNumber?: number | null
  workPackageId?: string | null
  workPackageMode?: 'any' | 'untagged' | 'untagged-or-matching'
  captureMode?: BlueprintSnapshotCaptureMode | null
  cursor?: string | null
  limit?: number | null
}

export type BlueprintSnapshotListResult =
  | {
      status: 'available'
      snapshots: BlueprintSnapshotLibraryItem[]
      totalCount: number
      nextCursor: string | null
      hasMore: boolean
    }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string }

export interface BlueprintSnapshotPreviewUrlResult {
  status: 'available'
  snapshotId: string
  signedUrl: string
  expiresAt: number
}

export type BlueprintSnapshotPreviewResult =
  | BlueprintSnapshotPreviewUrlResult
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string }

export type BlueprintSnapshotCaptionUpdateResult =
  | { status: 'available'; snapshot: BlueprintSnapshotLibraryItem }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string }

export type BlueprintSnapshotWorkPackageUpdateResult =
  | { status: 'available'; snapshot: BlueprintSnapshotLibraryItem }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string }

export type BlueprintSnapshotDeleteResult =
  | { status: 'deleted'; snapshotId: string }
  | { status: 'rejected'; message: string }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string }

export type BlueprintSnapshotLibraryChangeEvent =
  | { type: 'upsert'; snapshot: BlueprintSnapshotLibraryItem; source?: string }
  | { type: 'delete'; snapshotId: string; source?: string }
  | { type: 'refresh'; source?: string }

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
