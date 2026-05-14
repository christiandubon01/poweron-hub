/**
 * src/features/blueprint-vr/stages.ts
 *
 * Stage definitions, constants, and helper functions for VR lifecycle management.
 */

import type { VRStage } from './types'

/**
 * Ordered definition of VR lifecycle stages.
 * This order represents the typical progression of a construction project.
 */
export const STAGE_ORDER: readonly VRStage[] = ['underground', 'roughIn', 'trim', 'finished'] as const

/**
 * Human-readable labels for each VR stage.
 */
export const STAGE_LABELS: Record<VRStage, string> = {
  underground: 'Underground',
  roughIn: 'Rough In',
  trim: 'Trim',
  finished: 'Finished',
} as const

/**
 * Descriptions for each VR stage to provide context in the UI.
 */
export const STAGE_DESCRIPTIONS: Record<VRStage, string> = {
  underground: 'Foundation and below-grade electrical work',
  roughIn: 'Wall and framing phase electrical installation',
  trim: 'Final trim and fixture installation',
  finished: 'Complete project with all connections and covers installed',
} as const

/**
 * Get the human-readable label for a VR stage.
 *
 * @param stage - The VR stage identifier
 * @returns The display label for the stage
 */
export function getStageLabelByType(stage: VRStage): string {
  return STAGE_LABELS[stage] ?? stage
}

/**
 * Get the description for a VR stage.
 *
 * @param stage - The VR stage identifier
 * @returns The description for the stage
 */
export function getStageDescription(stage: VRStage): string {
  return STAGE_DESCRIPTIONS[stage] ?? ''
}

/**
 * Get the index/order position of a stage in the construction lifecycle.
 *
 * @param stage - The VR stage identifier
 * @returns The zero-based index position, or -1 if not found
 */
export function getStageOrder(stage: VRStage): number {
  return STAGE_ORDER.indexOf(stage)
}

/**
 * Check if a stage comes before another stage in the lifecycle.
 *
 * @param stageBefore - The stage to check as earlier
 * @param stageAfter - The stage to check as later
 * @returns True if stageBefore comes before stageAfter in the lifecycle
 */
export function isStageBeforeStage(stageBefore: VRStage, stageAfter: VRStage): boolean {
  const beforeIdx = getStageOrder(stageBefore)
  const afterIdx = getStageOrder(stageAfter)
  return beforeIdx >= 0 && afterIdx >= 0 && beforeIdx < afterIdx
}

/**
 * Get the next stage in the lifecycle.
 *
 * @param currentStage - The current VR stage
 * @returns The next stage, or undefined if at the final stage
 */
export function getNextStage(currentStage: VRStage): VRStage | undefined {
  const currentIdx = getStageOrder(currentStage)
  if (currentIdx >= 0 && currentIdx < STAGE_ORDER.length - 1) {
    return STAGE_ORDER[currentIdx + 1]
  }
  return undefined
}

/**
 * Get the previous stage in the lifecycle.
 *
 * @param currentStage - The current VR stage
 * @returns The previous stage, or undefined if at the first stage
 */
export function getPreviousStage(currentStage: VRStage): VRStage | undefined {
  const currentIdx = getStageOrder(currentStage)
  if (currentIdx > 0) {
    return STAGE_ORDER[currentIdx - 1]
  }
  return undefined
}

/**
 * Get all stages in order.
 *
 * @returns Array of all VR stages in construction lifecycle order
 */
export function getAllStages(): VRStage[] {
  return [...STAGE_ORDER]
}

/**
 * Check if a given stage is a valid VR stage.
 *
 * @param value - The value to validate
 * @returns True if value is a valid VRStage
 */
export function isValidStage(value: unknown): value is VRStage {
  return typeof value === 'string' && STAGE_ORDER.includes(value as VRStage)
}
