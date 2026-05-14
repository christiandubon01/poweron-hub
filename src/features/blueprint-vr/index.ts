/**
 * src/features/blueprint-vr/index.ts
 *
 * Barrel export for the Blueprint VR feature.
 * Provides the public API for VR generation, stage management, and related utilities.
 */

// ── Type Exports ────────────────────────────────────────────────────────────
export type { VRStage, Discipline, BlueprintSource, VRJobStatus, StageItem, VRSceneManifest, VRGenerationJob } from './types'
export type { QualityProfile, AssetPlaceholder, LayoutZone, BlueprintVRSceneManifest, CreateManifestInput } from './sceneManifestBuilder'

// ── Stage Exports ───────────────────────────────────────────────────────────
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

// ── Scene Manifest Builder Exports ──────────────────────────────────────────
export { createBlueprintVRSceneManifest } from './sceneManifestBuilder'
