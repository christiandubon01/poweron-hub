/**
 * blueprintAI.ts
 * V3 Merge — Re-exports from the full blueprint/ orchestrator.
 *
 * V2 had a stub here. V3 ships the full BLUEPRINT agent in src/agents/blueprint/index.ts.
 * This file now re-exports the full implementation so existing callers that import
 * from 'agents/blueprintAI' continue to work unchanged, while also exposing the
 * complete V3 action set.
 */

export {
  processBlueprintRequest,
  BLUEPRINT_SYSTEM_PROMPT,
} from './blueprint/index'

export type { BlueprintAction, BlueprintRequest, BlueprintResponse } from './blueprint/index'

/**
 * initBlueprintAIAgent — agent bus initialization shim.
 * The V3 blueprint orchestrator is request-driven (no persistent bus subscriber)
 * so this is a no-op kept for backward compatibility with any V2 callers.
 */
export function initBlueprintAIAgent(): void {
  console.log('[BLUEPRINT AI] Agent ready — V3 orchestrator via blueprint/index.ts')
}
