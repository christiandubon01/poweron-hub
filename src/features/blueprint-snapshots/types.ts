import type { BlueprintAnnotation, BlueprintLibraryItem, BlueprintScopeLayer } from '@/services/blueprintLibraryService'

export const BLUEPRINT_SNAPSHOT_BUCKET = 'blueprint-snapshots'
export const BLUEPRINT_SNAPSHOT_MAX_EDGE = 4096
export const BLUEPRINT_SNAPSHOT_TARGET_DPI = 150
export const BLUEPRINT_SNAPSHOT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

export type BlueprintSnapshotViewMode = 'general' | 'scoped'

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
  captureMode: 'full-page'
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
  circuitLabelsVisible: boolean
  annotationCount: number
}

export interface BlueprintSnapshotCaptureResult {
  blob: Blob
  width: number
  height: number
  pageNumber: number
  rotation: number
  annotationCount: number
  captureMetadata: BlueprintSnapshotCaptureMetadata
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
  viewMode: BlueprintSnapshotViewMode
  scopedWorkPackageIds: string[]
  labelsVisible: boolean
  circuitLabelsVisible: boolean
}

export interface BlueprintSnapshotViewerState {
  blueprint: BlueprintLibraryItem
  visibleAnnotations: BlueprintAnnotation[]
  scopedWorkPackages: BlueprintScopeLayer[]
  viewMode: BlueprintSnapshotViewMode
}
