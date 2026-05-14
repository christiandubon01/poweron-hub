/**
 * src/features/blueprint-vr/index.ts
 *
 * Barrel export for the Blueprint VR feature.
 * Provides the public API for VR generation, stage management, and related utilities.
 */

// ── Type Exports ────────────────────────────────────────────────────────────
export type { VRStage, Discipline, BlueprintSource, VRJobStatus, StageItem, VRSceneManifest, VRGenerationJob } from './types'

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

// ── Component Exports ───────────────────────────────────────────────────────
export { VRStageProgress } from './VRStageProgress'
export type { VRStageProgressProps, StageStatus } from './VRStageProgress'
