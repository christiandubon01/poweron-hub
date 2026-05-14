/**
 * src/features/blueprint-vr/index.ts
 *
 * Barrel export for the Blueprint VR feature.
 * Provides the public API for VR generation, stage management, and related utilities.
 */

// Type exports
export type {
  VRStage,
  Discipline,
  BlueprintSource,
  VRJobStatus,
  StageItem,
  VRSceneManifest,
  VRGenerationJob,
} from './types'

export type {
  BlueprintDocumentLike,
  BlueprintPageLike,
  NormalizedBlueprintMetadata,
  SheetLabelInfo,
  DisciplineHint,
} from './blueprintExtractionAdapter'

export type {
  QualityProfile,
  AssetPlaceholder,
  LayoutZone,
  BlueprintVRSceneManifest,
  CreateManifestInput,
} from './sceneManifestBuilder'

// Stage exports
export {
  STAGE_ORDER,
  STAGE_LABELS,
  STAGE_DESCRIPTIONS,
  getStageLabelByType,
  getStageDescription,
  getStageOrder,
  isStageBeforeStage,
  getNextStage,
  getPreviousStage,
  getAllStages,
  isValidStage,
} from './stages'

// Adapter exports
export {
  normalizeBlueprint,
  extractVRInputs,
  getElectricalHints,
  getSheetLabelsFromIndex,
  getDisciplineSummary,
  isElectricalBlueprint,
  getRecommendedActivePage,
} from './blueprintExtractionAdapter'

// Scene manifest builder exports
export {
  createBlueprintVRSceneManifest,
} from './sceneManifestBuilder'

// Landscape viewer
export { default as BlueprintVRLandscapeViewer } from './BlueprintVRLandscapeViewer'
export type { BlueprintVRLandscapeViewerProps } from './BlueprintVRLandscapeViewer'

// Dimension model — measurement types
export type {
  Unit,
  MeasurementValue,
  Point2D,
  Rectangle,
  Bounds,
  DimensionLine,
} from './measurementTypes'

// Dimension model — building space types and helpers
export type {
  Opening,
  Wall,
  RoomZone,
  ScaleSource,
  BuildingSpace,
} from './dimensionModel'

export {
  feetToInches,
  inchesToFeet,
  formatFeetInches,
  createMeasurement,
  createDefaultBuildingSpace,
  getRoomArea,
  getFootprintArea,
} from './dimensionModel'
