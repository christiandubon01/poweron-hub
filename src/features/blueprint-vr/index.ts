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

// Landscape viewer (legacy 2D fallback — kept for reference)
export { default as BlueprintVRLandscapeViewer } from './BlueprintVRLandscapeViewer'
export type { BlueprintVRLandscapeViewerProps } from './BlueprintVRLandscapeViewer'

// 3D space viewer — BVR14 Planner5D-style isometric renderer
export { default as Blueprint3DSpaceViewer } from './Blueprint3DSpaceViewer'
export type { Blueprint3DSpaceViewerProps } from './Blueprint3DSpaceViewer'

// Space geometry helpers — BVR14
export { buildSpaceGeometry, compileBuildingModelToGeometry } from './spaceGeometry'
export type { SpaceGeometry, GeoShape, GeoDim, Pt, CompiledGeometry } from './spaceGeometry'

// Dimension model — measurement types
export type {
  Unit,
  MeasurementValue,
  Point2D,
  Point3D,
  Rectangle,
  Bounds,
  Bounds2D,
  Size2D,
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

// Building model — source-of-truth for Planner5D-style scene
export type {
  BlueprintBuildingModel,
  BuildingLevelModel,
  BuildingRoomModel,
  BuildingWallModel,
  BuildingOpeningModel,
  BuildingDimensionModel,
  ElectricalAnchorType,
  BuildingElectricalAnchorModel,
  WallKind,
  DoorSwingDirection,
  OpeningSubtype,
  RoomRole,
  RoomEquipmentHint,
} from './buildingModel'

export {
  createEmptyBuildingModel,
} from './buildingModel'

// Blueprint-to-building-model adapter — dimension extraction and conversion
export type {
  BlueprintToBuildingModelInput,
  BlueprintToBuildingModelResult,
} from './blueprintToBuildingModel'

export {
  convertBlueprintToModel,
  blueprintToModel,
} from './blueprintToBuildingModel'

// Building model defaults — fallback layouts
export type {
  DefaultLayoutType,
} from './buildingModelDefaults'

export {
  detectLayoutType,
  createDefaultBuildingModel,
  createAutoDetectedDefaultModel,
} from './buildingModelDefaults'

// Building model validation
export type {
  ValidationSeverity,
  ValidationMessage,
  ValidationResult,
} from './buildingModelValidation'

export {
  validateBuildingModel,
  validateRoomsInsideFootprint,
  validateWallHeights,
  validateDimensionsNonZero,
  validateElectricalAnchors,
  isModelValid,
  getValidationSummary,
} from './buildingModelValidation'

// Measured plan viewer component
export { default as MeasuredPlanViewer } from './MeasuredPlanViewer'
export type { MeasuredPlanViewerProps } from './MeasuredPlanViewer'

// Electrical 3D placement engine — BVR-W3-ELECTRICAL-STAGES
export type {
  ElectricalComponent,
  ElectricalPlacementGroup,
  ElectricalPlacementHints,
} from './electrical3DPlacement'

export {
  placeUndergroundStage,
  placeRoughInStage,
  placeTrimStage,
  placeFinishedStage,
  placeElectricalComponentsInModel,
  getAllStageComponentsByType,
  getComponentCountsByStage,
  getLegendEntriesByStage,
} from './electrical3DPlacement'

// Blueprint VR Legend — component display and counts
export { default as BlueprintVRLegend } from './BlueprintVRLegend'
export type { BlueprintVRLegendProps } from './BlueprintVRLegend'

// Room interior viewer for immersive room mode
export { default as BlueprintRoomInteriorView } from './BlueprintRoomInteriorView'
export type { BlueprintRoomInteriorViewProps } from './BlueprintRoomInteriorView'

// Dimension extraction adapter — BVR12
export type {
  ExtractedDimensionText,
  ExtractedScaleInfo,
  DimensionExtractionWarningCode,
  DimensionExtractionWarning,
  BlueprintDimensionExtractionInput,
  BlueprintDimensionExtractionResult,
} from './blueprintDimensionExtractor'

export {
  parseArchitecturalScale,
  parseDimensionText,
  normalizeDimensionStrings,
  inferFootprintFromBlueprintMetadata,
  inferRoomZonesFromFootprint,
  createFallbackMeasuredSpace,
  extractBlueprintDimensions,
} from './blueprintDimensionExtractor'

// PDF trace types — future vector input shape
export type {
  PdfTracePoint,
  WorldPoint2D,
  PdfTraceScale,
  PdfTraceScaleHint,
  PdfTraceLineRole,
  PdfTraceLine,
  PdfTraceRect,
  PdfTracePolyline,
  PdfTraceArc,
  PdfTraceTextNote,
  PdfTraceTextRun,
  PdfTracePageBounds,
  PdfTraceViewport,
  PdfTracePayload,
  PdfTraceExtractionWarning,
  PdfTraceExtractionResult,
  PdfTracePagePayload,
} from './pdfTraceTypes'

// Trace adapter — converts upstream vector trace into world plan candidates
export type {
  PlanTraceLine,
  LineOrientation,
  AdaptedTrace,
} from './blueprintTraceAdapter'
export {
  adaptPdfTraceToPlanLines,
  normalizeTraceLines,
  filterNoiseLines,
  classifyLineOrientation,
  mergeCollinearSegments,
  detectDoubleLineWalls,
  detectOuterFootprint,
  inferWallCandidatesFromTrace,
  inferOpeningCandidatesFromGaps,
  inferDoorCandidatesFromArcs,
  inferGlassStorefrontCandidates,
  inferDimensionCandidatesFromText,
  inferScaleFromTraceText,
} from './blueprintTraceAdapter'

export type { PdfVectorTraceExtractorInput } from './pdfVectorTraceExtractor'
export {
  extractPdfVectorTraceFromPage,
  normalizePdfTracePayload,
  hasUsableTracePayload,
} from './pdfVectorTraceExtractor'

export type {
  BlueprintPdfRuntimeProvider,
  BlueprintPdfRuntimeLookup,
  RuntimeTraceForSheetInput,
  RuntimeTraceForSheetResult,
} from './blueprintPdfTraceRuntimeBridge'
export {
  buildBlueprintPdfRuntimeKey,
  buildBlueprintPdfRuntimeProviderKey,
  registerBlueprintPdfRuntimeProvider,
  unregisterBlueprintPdfRuntimeProvider,
  getBlueprintPdfRuntimeProvider,
  getActivePdfTracePageProvider,
  listBlueprintPdfRuntimeProviderKeys,
  getBlueprintPdfRuntimeProviderDebug,
  extractTraceForBlueprintSheet,
} from './blueprintPdfTraceRuntimeBridge'

// Blueprint plan scanner — deterministic floor-plan scan + fallback
export type {
  BlueprintPlanScanInput,
  BlueprintPlanScanResult,
  BlueprintPlanScanSheetHint,
  PlanWallCandidate,
  PlanOpeningCandidate,
  PlanRoomCandidate,
  PlanDimensionCandidate,
  PlanScanWarning,
  PlanScanWarningCode,
  // Full-set scan types
  SheetRole,
  BlueprintVRSourceSet,
  BlueprintVRSourceSheet,
  BlueprintFullSetScanInput,
  BlueprintFullSetScanResult,
  FullSetSheetClassification,
  SelectedFloorPlanSheet,
  ScanConfidenceBreakdown,
  BlueprintPageClassificationRole,
  BlueprintPageClassification,
  RankedWallPlanCandidate,
  CanonicalWallPlanPage,
  ExtractedProjectHint,
  EquipmentHint,
  FinishHint,
  ElectricalDeviceHint,
  DoorHint,
  WallHint,
} from './blueprintPlanScanner'

export {
  scanBlueprintPlan,
  convertPlanScanToBuildingModel,
  inferBuildingFootprintFromTraceLines,
  inferWallsFromOrthogonalLines,
  inferOpeningsFromGaps,
  inferRoomsFromEnclosedOrGridLayout,
  validateRoomCandidates,
  convertRoomCandidatesToBuildingModel,
  chooseSalonSuiteFallbackFromBlueprintContext,
  // Full-set scan functions
  scanBlueprintFullSet,
  classifySheetRole,
  classifyBlueprintPage,
  enumerateFullSourceSetSheets,
  chooseBestFloorPlanSheet,
  chooseBestElectricalSheets,
  chooseBestRenderingSheets,
  extractProjectStyleHints,
  extractEquipmentHints,
  extractDoorAndOpeningHints,
  extractWallThicknessHints,
  mergeFullSetScanIntoBuildingModel,
} from './blueprintPlanScanner'

// Project model cache — keep generated models stable across page changes
export type { BlueprintVRProjectCacheEntry, BlueprintVRCacheIdentity } from './blueprintVRProjectModelCache'
export {
  getBlueprintVRCacheKey,
  buildBlueprintVRCacheIdentityKey,
  getCachedProjectModel,
  setCachedProjectModel,
  clearCachedProjectModel,
  clearProjectCache,
  clearAllProjectModelCache,
  listCachedProjectModels,
} from './blueprintVRProjectModelCache'

// VR source selector component
export { default as BlueprintVRSourceSelector } from './BlueprintVRSourceSelector'
export type { BlueprintVRSourceSelectorProps } from './BlueprintVRSourceSelector'
